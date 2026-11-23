import * as Tone from "tone";
import { createRng } from "./rng.js";
import { inlineRenderer } from "./renderer.js";
import { SPECS, drawInstrumentGenes, mutateGene } from "./genome.js";

// every role picks one instrument type from the seed. sounds are rendered once as buffers and played
// through cheap native nodes, so nothing synthesizes in real time. slider values and drifting macros
// move filters and levels, and each hit gets its own small random pitch, level and pan.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const toDb = (gain, floor) => Math.max(floor, 20 * Math.log10(gain + 1e-6));
const toneRamp = (param, value, seconds) => (seconds > 0 ? param.rampTo(value, seconds) : (param.value = value));

function glide(ctx, param, value, seconds) {
  param.cancelScheduledValues(ctx.currentTime);
  if (seconds > 0) param.setTargetAtTime(value, ctx.currentTime, Math.max(0.001, seconds / 3));
  else param.value = value;
}

function createContext(seed, renderer) {
  const ctx = Tone.getContext().rawContext;
  const rng = createRng(seed);
  const entries = new Map();
  const nodes = [];
  const sources = [];
  const live = new Set();
  const base = drawInstrumentGenes(seed);
  const genes = { ...base };
  const version = Object.fromEntries([...Object.keys(base), "gust", "ambience"].map((role) => [role, 0]));

  // onended can be missed after an interruption, and a leaked voice would count against the caps forever
  const prune = () => {
    for (const chain of live) {
      if (chain.stopAt + 1 < ctx.currentTime) {
        chain.forEach((node) => node.disconnect());
        live.delete(chain);
      }
    }
  };

  const toBuffer = ({ channels, sampleRate }) => {
    const buffer = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
    channels.forEach((channel, i) => buffer.copyToChannel(channel, i));
    return buffer;
  };

  // an entry is one sound: how to render it, the newest buffer so far, and the gene version that buffer was made from.
  // after a role evolves its entries go stale and are re-rendered in the background the next time they are used
  const refresh = (entry) => {
    const stamp = version[entry.role];
    if (entry.buffer && entry.stamp === stamp) return true;
    const [name, args] = entry.make();
    if (renderer.sync) {
      entry.buffer = toBuffer(renderer.run(name, args));
      entry.stamp = stamp;
      return true;
    }
    if (entry.pending && entry.pendingStamp === stamp) return false;
    entry.pendingStamp = stamp;
    entry.pending = renderer
      .request(name, args, c)
      .then((result) => {
        entry.buffer = toBuffer(result);
        entry.stamp = stamp;
        entry.pending = null;
        return entry.buffer;
      })
      .catch((error) => {
        entry.pending = null;
        if (error.message !== "cancelled") console.error(error);
        throw error;
      });
    entry.pending.catch(() => {});
    return false;
  };

  const c = {
    ctx,
    rng,
    seed,
    genes,
    base,
    version,
    render(role, key, make) {
      const id = `${role}:${key}`;
      if (!entries.has(id)) entries.set(id, { role, make, buffer: null, stamp: -1, pending: null });
      const entry = entries.get(id);
      return entry;
    },
    ready(entry) {
      return refresh(entry) ? Promise.resolve(entry.buffer) : entry.pending;
    },
    // old sounds that nothing has asked for since the last evolution are dropped, so memory stays bounded
    forget(role) {
      for (const [id, entry] of entries) if (entry.role === role && entry.stamp !== version[role] && !entry.pending) entries.delete(id);
    },
    own: (node) => (nodes.push(node), node),
    sources,
    // a playing instance of a buffer: source, envelope and optional pan, released when it ends
    voice(destination, entry, options) {
      // a sound that is not ready yet is waited for, and played late only if there is no older version to use
      if (!refresh(entry)) {
        if (entry.buffer && options.time - ctx.currentTime < 0.3) return c.play(destination, entry.buffer, options);
        entry.pending.then((buffer) => {
          if (options.time > ctx.currentTime - 0.05) c.play(destination, buffer, options);
        }, () => {});
        return;
      }
      c.play(destination, entry.buffer, options);
    },
    play(destination, buffer, { time, gain = 1, rate = 1, loop = false, attack = 0, hold = null, release = 0, pan = 0, offset = 0, glide = null }) {
      // whatever the planner does, the graph never carries an unbounded number of voices
      prune();
      if (live.size > 140) return;
      offset *= buffer.duration;
      const source = ctx.createBufferSource();
      const envelope = ctx.createGain();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      // slide into the note from a few cents away
      if (glide && Math.abs(glide.cents) > 1) {
        source.playbackRate.setValueAtTime(rate * 2 ** (glide.cents / 1200), time);
        source.playbackRate.exponentialRampToValueAtTime(rate, time + glide.seconds);
      }
      source.loop = loop;
      const chain = [source, envelope];
      if (pan !== 0) chain.push(ctx.createStereoPanner());
      chain.forEach((node, i) => i && chain[i - 1].connect(node));
      chain[chain.length - 1].connect(destination);
      if (pan !== 0) chain[2].pan.value = pan;

      let stop = time + buffer.duration / rate;
      if (attack > 0) {
        envelope.gain.setValueAtTime(0, time);
        envelope.gain.linearRampToValueAtTime(gain, time + attack);
      } else {
        envelope.gain.setValueAtTime(gain, time);
      }
      if (hold !== null) {
        const end = Math.max(time + attack, time + hold);
        envelope.gain.setValueAtTime(gain, end);
        envelope.gain.linearRampToValueAtTime(0, end + release);
        stop = end + release + 0.05;
      }
      source.start(time, offset);
      source.stop(stop);
      chain.stopAt = stop;
      live.add(chain);
      source.onended = () => {
        chain.forEach((node) => node.disconnect());
        live.delete(chain);
      };
    },
    liveCount: () => (prune(), live.size),
    dispose() {
      sources.forEach((source) => {
        try {
          source.stop();
        } catch {
          // already stopped
        }
        source.disconnect();
      });
      live.forEach((chain) => {
        try {
          chain[0].stop();
        } catch {
          // already stopped
        }
        chain.forEach((node) => node.disconnect());
      });
      live.clear();
      nodes.forEach((node) => node.disconnect());
    },
  };
  return c;
}

// lowpass plus a gentle high shelf, so even bright settings stay soft on top
function tone(c, { shelf = -6 } = {}) {
  const lowpass = c.own(c.ctx.createBiquadFilter());
  lowpass.type = "lowpass";
  lowpass.Q.value = 0.5;
  const high = c.own(c.ctx.createBiquadFilter());
  high.type = "highshelf";
  high.frequency.value = 2400;
  high.gain.value = shelf;
  lowpass.connect(high);
  return { input: lowpass, out: high, setCutoff: (hz, seconds) => glide(c.ctx, lowpass.frequency, hz, seconds) };
}

// slow circular path around the listener, on the audio thread
function orbit(phase, speed) {
  // a slow stereo sweep. the 3D (HRTF) panner it replaced cost far more CPU than anyone could hear
  const panner = new Tone.Panner(0);
  const depth = new Tone.Gain(0.5);
  const sweep = new Tone.LFO({ frequency: 0.05, min: -1, max: 1, phase });
  sweep.chain(depth, panner.pan);
  return {
    panner,
    start(at) {
      sweep.start(at);
    },
    set(radius, rate, seconds) {
      toneRamp(depth.gain, 0.35 + 0.6 * ((radius - 1) / 5), seconds);
      toneRamp(sweep.frequency, rate * speed, seconds);
    },
    dispose: () => [sweep, depth, panner].forEach((node) => node.dispose()),
  };
}

const timbre = (p, m, scale, lo, hi) => clamp(p.filterCutoffHz * scale * 2 ** ((m.timbre - 0.5) * 1.5), lo, hi);


// ---- pads ----

const PAD_ANCHORS = [45, 52, 59, 66, 73];
const nearestAnchor = (midi) => PAD_ANCHORS.reduce((best, a) => (Math.abs(a - midi) < Math.abs(best - midi) ? a : best));

function pad(c) {
  const r = c.rng;
  const bus = tone(c);
  const sounding = [];
  const cutoffScale = r.between(0.7, 1.3);
  const buffer = (anchor) => c.render("pad", anchor, () => ["renderPad", [c.genes.pad, { seed: c.seed, midi: anchor }]]);
  return {
    out: bus.out,
    async warm() {
      await Promise.all(PAD_ANCHORS.map((anchor) => c.ready(buffer(anchor))));
    },
    trigger(e) {
      if (c.liveCount() > 40) return;
      const g = c.genes.pad;
      while (sounding.length && sounding[0] < e.time) sounding.shift();
      // each voice backs off as more are already sounding, so the sum stays level
      const gain = e.velocity * 0.3 * Math.min(1, 2 / Math.sqrt(sounding.length + e.midis.length));
      const until = e.time + e.duration + g.release;
      e.midis.forEach(() => sounding.push(until));
      sounding.sort((a, b) => a - b);
      e.midis.forEach((midi) => {
        const anchor = nearestAnchor(midi);
        const source = buffer(anchor);
        c.voice(bus.input, source, {
          time: e.time,
          gain,
          rate: 2 ** ((midi - anchor) / 12) * (1 + r.between(-0.004, 0.004)),
          glide: { cents: -g.slide * r.between(0.3, 1), seconds: g.attack * 0.5 },
          loop: true,
          attack: g.attack,
          hold: e.duration,
          release: g.release,
          offset: r.between(0, 0.9),
        });
      });
    },
    update(p, m, s) {
      bus.setCutoff(timbre(p, m, cutoffScale, 400, 2600), s);
    },
  };
}

// ---- bass ----

function bass(c) {
  const r = c.rng;
  const bus = tone(c, { shelf: -2 });
  const cutoffScale = r.between(0.8, 1.3);
  return {
    out: bus.out,
    trigger(e) {
      const g = c.genes.bass;
      const midi = e.midis[0];
      const source = c.render("bass", midi, () => ["renderBass", [c.genes.bass, { midi }]]);
      c.voice(bus.input, source, {
        time: e.time,
        gain: e.velocity * 0.9,
        rate: 1 + r.between(-0.002, 0.002),
        glide: { cents: g.scoop * r.between(0.3, 1), seconds: g.scoopMs / 1000 },
        attack: 0.01,
        hold: e.duration,
        release: 0.25,
      });
    },
    update(p, m, s) {
      bus.setCutoff(clamp(p.filterCutoffHz * 0.12 * cutoffScale * 2 ** ((m.timbre - 0.5) * 1.2), 120, 700), s);
    },
  };
}

// ---- pitched voices: lead and arp share a renderer, bell has its own ----

function voiceFactory(role, { render, gain, cutoff, ring }) {
  // width is the stereo spread of single notes. roles that orbit the listener use 0
  return (c, { width = 0 } = {}) => {
    const r = c.rng;
    const bus = tone(c);
    const cutoffScale = r.between(...cutoff);
    const tuning = r.between(-7, 7);
    return {
      out: bus.out,
      trigger(e) {
        if (c.liveCount() > 60) return;
        const g = c.genes[role];
        const sustain = ring ? ring(g) : null;
        e.midis.forEach((midi) => {
          const variant = r.int(0, 1);
          const source = c.render(role, `${midi}:${variant}`, () => [render, [c.genes[role], { seed: c.seed, midi, variant }]]);
          c.voice(bus.input, source, {
            time: e.time,
            gain: e.velocity * gain * r.between(0.85, 1),
            rate: 2 ** ((tuning + r.between(-1, 1) * g.looseness) / 1200),
            glide: g.scoop !== undefined && r() < g.glideChance ? { cents: g.scoop * r.between(0.3, 1), seconds: g.glideMs / 1000 } : null,
            pan: e.pan ?? (width ? r.between(-width, width) : 0),
            ...(sustain ? { hold: e.duration * sustain.hold, release: sustain.release, attack: 0.002 } : {}),
          });
        });
      },
      update(p, m, s) {
        bus.setCutoff(timbre(p, m, cutoffScale, 400, 4200), s);
      },
    };
  };
}

// plucked and FM sounds ring on their own, breathy ones need the note held
const sustainOf = (g) => {
  const ringing = (g.wPluck + g.wKeys) / (g.wPluck + g.wKeys + (g.wFlute ?? 0) + 1e-6);
  return { hold: 1 + 4 * ringing, release: 0.15 + 0.4 * (1 - ringing) };
};

const lead = voiceFactory("lead", { render: "renderLead", gain: 0.5, cutoff: [1.2, 2], ring: sustainOf });
const arp = voiceFactory("arp", { render: "renderLead", gain: 0.45, cutoff: [1.2, 2], ring: sustainOf });
const bell = voiceFactory("bell", { render: "renderBell", gain: 0.35, cutoff: [1.5, 2.4] });
const drip = voiceFactory("drip", { render: "renderBell", gain: 0.3, cutoff: [1.5, 2.4] });
const sparkle = voiceFactory("sparkle", { render: "renderLead", gain: 0.4, cutoff: [1.4, 2.2], ring: sustainOf });
const reed = voiceFactory("reed", { render: "renderLead", gain: 0.45, cutoff: [1.1, 1.8], ring: sustainOf });

// ---- percussion ----

// playback rate that moves a drum's pitch to the nearest chord tone, so percussion stays in key
function retune(hz, midis) {
  const source = 69 + 12 * Math.log2(hz / 440);
  let best = null;
  for (const midi of midis) {
    const shift = ((((midi - source) % 12) + 18) % 12) - 6;
    if (best === null || Math.abs(shift) < Math.abs(best)) best = shift;
  }
  return 2 ** (best / 12);
}

function hitFactory(role, { render, gain, cutoff, pan = 0.3, variants = 4, tune = null }) {
  return (c) => {
    const r = c.rng;
    const bus = tone(c, { shelf: -5 });
    bus.setCutoff(cutoff, 0);
    return {
      out: bus.out,
      trigger(e) {
        const g = c.genes[role];
        const variant = r.int(0, variants - 1);
        const source = c.render(role, variant, () => [render, [c.genes[role], { seed: c.seed, variant }]]);
        c.voice(bus.input, source, {
          time: e.time,
          gain: e.velocity * gain * r.between(0.88, 1),
          rate: (tune && e.midis.length ? retune(tune(g), e.midis) : 1) * (1 + r.between(-1, 1) * g.loose * (tune ? 0.2 : 1)),
          pan: e.pan ?? r.between(-pan, pan),
        });
      },
    };
  };
}

const kick = hitFactory("kick", { render: "renderKick", gain: 0.9, cutoff: 1500, pan: 0, tune: (g) => g.end });
const hat = hitFactory("hat", { render: "renderHat", gain: 0.35, cutoff: 4800, pan: 0.9 });
const perc = hitFactory("perc", { render: "renderPerc", gain: 0.5, cutoff: 3600, pan: 0.95, tune: (g) => g.pitch });

// ---- ambience ----

function windBed(c) {
  const r = c.rng;
  const out = c.own(c.ctx.createGain());
  // colour of the whole bed: a tilt between low rumble and high air, and a ceiling on the top
  const lowShelf = c.own(c.ctx.createBiquadFilter());
  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = 260;
  const highShelf = c.own(c.ctx.createBiquadFilter());
  highShelf.type = "highshelf";
  highShelf.frequency.value = 2200;
  const ceiling = c.own(c.ctx.createBiquadFilter());
  ceiling.type = "lowpass";
  ceiling.Q.value = 0.5;
  out.connect(lowShelf);
  lowShelf.connect(highShelf);
  highShelf.connect(ceiling);
  const lean = r.between(0.7, 1.3);
  let layers = null;

  const layer = async (name, seed, seconds, pan = 0, moves = false) => {
    const buffer = await c.ready(c.render("ambience", `${name}:${seed}`, () => ["renderTextureLayer", [name, { seed, sampleRate: 16000, seconds }]]));
    const source = c.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    // only the layers whose colour moves get a filter, and only the ones off-centre a panner: the others are already shaped when rendered
    let filter = null;
    if (moves) {
      filter = c.own(c.ctx.createBiquadFilter());
      filter.type = "lowpass";
      filter.frequency.value = 3000;
      filter.Q.value = 0.4;
    }
    const gain = c.own(c.ctx.createGain());
    gain.gain.value = 0;
    source.connect(filter ?? gain);
    filter?.connect(gain);
    if (pan !== 0) {
      const panner = c.own(c.ctx.createStereoPanner());
      panner.pan.value = pan;
      gain.connect(panner);
      panner.connect(out);
    } else {
      gain.connect(out);
    }
    c.sources.push({
      start: (at) => source.start(at, r.between(0, buffer.duration)),
      stop: () => source.stop(),
      disconnect: () => source.disconnect(),
    });
    return { source, filter, gain };
  };

  // the loops start at an arbitrary point in their buffers, so the bed opens slowly instead of with a step
  out.gain.value = 0;

  return {
    out: ceiling,
    start(at) {
      out.gain.cancelScheduledValues(0);
      out.gain.setValueAtTime(0, at);
      out.gain.linearRampToValueAtTime(1, at + 3);
    },
    // layers render one at a time so the page stays responsive
    async warm() {
      if (layers) return;
      const built = {};
      for (const [key, name, seed, seconds, pan, moves] of [
        ["earth", "earth", c.seed, 14], ["body", "body", c.seed, 13], ["windA", "wind", c.seed, 14, -0.85, true], ["windB", "wind", c.seed + 4242, 11, 0.85, true],
        ["air", "air", c.seed, 13, 0, true],
      ]) {
        built[key] = await layer(name, seed, seconds, pan, moves);
      }
      layers = built;
    },
    update(p, m, s) {
      if (!layers) return;
      const ctx = c.ctx;
      glide(ctx, lowShelf.gain, p.noiseLowDb, s);
      glide(ctx, highShelf.gain, p.noiseHighDb, s);
      glide(ctx, ceiling.frequency, p.noiseCutoffHz, s);
      const wind = timbre(p, m, 0.6 * lean, 400, 2000);
      const level = 0.5 + 0.5 * p.modDepth;
      glide(ctx, layers.earth.gain.gain, 1.1, s);
      glide(ctx, layers.windA.gain.gain, level * (0.35 + 0.65 * m.motion), s);
      glide(ctx, layers.windB.gain.gain, level * (0.35 + 0.65 * (1 - m.motion)), s);
      glide(ctx, layers.air.gain.gain, 0.3 + 0.7 * m.timbre, s);
      glide(ctx, layers.body.gain.gain, 0.6 + 0.4 * (1 - m.timbre), s);
      glide(ctx, layers.windA.filter.frequency, wind, s);
      glide(ctx, layers.windB.filter.frequency, wind * 0.8, s);
      glide(ctx, layers.air.filter.frequency, clamp(wind * 2.5, 2500, 6000), s);
      // slight playback rate drift moves the colour of each layer a little
      glide(ctx, layers.windA.source.playbackRate, 1 + (m.timbre - 0.5) * 0.05, s);
      glide(ctx, layers.windB.source.playbackRate, 1 + (m.motion - 0.5) * 0.06, s);
      glide(ctx, layers.body.source.playbackRate, 1 + (m.timbre - 0.5) * 0.04, s);
      glide(ctx, layers.earth.source.playbackRate, 1 + (m.motion - 0.5) * 0.03, s);
    },
  };
}

function gust(c) {
  const r = c.rng;
  const bus = tone(c, { shelf: -3 });
  bus.setCutoff(2200, 0);
  return {
    out: bus.out,
    update(p, m, s) {
      bus.setCutoff(clamp(p.noiseCutoffHz * 0.55, 500, 3800), s);
    },
    trigger(e) {
      const variant = e.variant ?? r.int(0, 1);
      const riser = variant === 2;
      const buffer = c.render("gust", variant, () => ["renderSwell", [{ seed: c.seed + variant, riser }]]);
      c.voice(bus.input, buffer, {
        time: e.time,
        gain: e.velocity * 0.9,
        rate: r.between(0.85, 1.15),
        pan: e.pan,
      });
    },
  };
}

// ---- assembly ----

const ROLES = {
  pad: { make: pad, db: -0.5, send: 0.6, group: "music", strip: true },
  bass: { make: bass, db: -6.7, send: 0.12, group: "music", strip: true },
  lead: { make: lead, db: 3, send: 0.6, delay: 0.12, group: "music", strip: true, orbit: [0, 1] },
  bell: { make: bell, db: 4, send: 0.8, delay: 0.3, group: "music", strip: true, orbit: [120, 0.7] },
  arp: { make: arp, db: 0, send: 0.6, delay: 0.25, group: "music", strip: true, width: 0.95 },
  kick: { make: kick, db: -7.8, send: 0.05, group: "music", strip: true },
  hat: { make: hat, db: -4, send: 0.2, group: "music" },
  perc: { make: perc, db: -4, send: 0.4, delay: 0.12, group: "music" },
  sparkle: { make: sparkle, db: -4, send: 0.9, delay: 0.3, group: "music" },
  drip: { make: drip, db: -1, send: 0.9, delay: 0.5, group: "music" },
  reed: { make: reed, db: -2, send: 0.7, delay: 0.2, group: "music", width: 0.9 },
  ambience: { make: windBed, db: 0, send: 0.7, group: "texture" },
  gust: { make: gust, db: -2, send: 0.7, group: "texture" },
};

export function createInstruments(mixer, seed, { renderer = inlineRenderer } = {}) {
  const c = createContext(seed, renderer);
  const rng = createRng(seed);
  const roles = {};
  const orbits = [];
  const macros = {};
  let params = null;

  for (const [name, spec] of Object.entries(ROLES)) {
    const instrument = spec.make(c, { width: spec.width });
    const channel = mixer.addChannel({ volume: spec.db, reverbSend: spec.send * rng.between(0.8, 1.2), delaySend: spec.delay ?? 0, strip: spec.strip });

    if (spec.orbit) {
      const path = orbit(...spec.orbit);
      Tone.connect(instrument.out, path.panner);
      path.panner.connect(channel.input);
      orbits.push(path);
    } else {
      Tone.connect(instrument.out, channel.input);
    }

    roles[name] = { ...instrument, channel, group: spec.group, baseDb: spec.db + rng.between(-1.5, 1) };
    macros[name] = { timbre: 0.5, motion: 0.5 };
  }

  return {
    // renders what the first bars need, yielding so the page stays responsive
    async warm() {
      for (const role of Object.values(roles)) await role.warm?.();
    },

    start(at) {
      c.sources.forEach((source) => source.start(at));
      orbits.forEach((path) => path.start(at));
      Object.values(roles).forEach((role) => role.start?.(at));
    },

    play(event) {
      roles[event.layer]?.trigger(event);
    },

    // nudges an instrument's gene, pulled a little back toward its original character so it wanders without drifting away
    evolve(name, evolveSeed, amount) {
      const spec = SPECS[name];
      if (!roles[name] || !spec) return;
      const blended = Object.fromEntries(Object.keys(spec).map((key) => [key, lerp(c.genes[name][key], c.base[name][key], 0.25)]));
      c.genes[name] = mutateGene(blended, spec, createRng(evolveSeed), amount);
      c.forget(name);
      c.version[name] += 1;
      Promise.resolve(roles[name].warm?.()).catch(() => {});
    },

    // p: resolved params, seconds: how long to slew to the new values
    apply(p, seconds) {
      params = p;
      // the noise bed stays in the background until the slider is well past the middle, and takes over at the top
      const t = p.textureMix;
      const groupDb = { music: toDb(Math.cos((t ** 1.8) * (Math.PI / 2)), -30), texture: toDb(t ** 1.7, -40) };
      for (const [name, role] of Object.entries(roles)) {
        role.update?.(p, macros[name], seconds);
        toneRamp(role.channel.input.volume, role.baseDb + groupDb[role.group], seconds);
      }
      orbits.forEach((path) => path.set(p.orbitRadius, 0.04 * p.modRateScale, seconds));
    },

    setMacro(name, timbreValue, motion, seconds) {
      if (!roles[name]) return;
      macros[name] = { timbre: timbreValue, motion };
      if (params) roles[name].update?.(params, macros[name], seconds);
    },


    dispose() {
      renderer.cancel(c);
      c.dispose();
      orbits.forEach((path) => path.dispose());
      Object.values(roles).forEach((role) => role.channel.dispose());
    },
  };
}
