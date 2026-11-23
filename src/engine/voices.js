import { createRng } from "./rng.js";
import { midiToFrequency } from "./theory.js";
import {
  TWO_PI, bodyResonate, comb, fadeOut, highpass, lowpass, makeControl, makeLoop, mallet, modalBank, normalizePeak,
  pinkNoise, readControl, whiteNoise,
} from "./dsp.js";

// instrument sounds rendered offline from a gene (see genome.js). each renderer returns { channels, sampleRate, loop? }.
// everything stays warm: partial amplitudes fall quickly and the top end is filtered down.

const CONTROL_HZ = 200;
const pan = (position) => [Math.cos(((position + 1) * Math.PI) / 4), Math.sin(((position + 1) * Math.PI) / 4)];

function finish(channels, sampleRate, extra = {}) {
  normalizePeak(channels, 0.9);
  return { channels, sampleRate, ...extra };
}

// ---- sustained pads, rendered as seamless loops ----

export function renderPad(g, { seed, midi, sampleRate = 24000, seconds = 7 }) {
  const rng = createRng(seed * 53 + midi);
  const frequency = midiToFrequency(midi);
  const fade = 1.5;
  const warmup = 0.5;
  const total = Math.floor((warmup + seconds + fade) * sampleRate);
  const duration = total / sampleRate;
  const left = new Float32Array(total);
  const right = new Float32Array(total);

  for (let v = 0; v < g.voices; v++) {
    const position = (v / (g.voices - 1)) * 2 - 1;
    const [gl, gr] = pan(position * 0.95);
    const cents = position * g.spread;
    const drift = makeControl(rng, duration, rng.between(0.08, 0.25), CONTROL_HZ);
    const partials = [];
    for (let k = 1; k <= g.partials; k++) {
      const ratio = k * Math.sqrt(1 + g.inharm * k * k);
      if (frequency * ratio > 7000) break;
      partials.push({
        ratio,
        amplitude: k ** -g.rolloff * (k % 2 === 0 ? 1 - g.oddBias * 0.8 : 1),
        phase: rng() * TWO_PI,
        level: makeControl(rng, duration, g.wobble * rng.between(0.5, 1.5), CONTROL_HZ),
      });
    }

    // each partial is a rotating phasor rather than a sin() call per sample: several times faster, and the render blocks the main thread
    const BLOCK = 32;
    for (const p of partials) {
      p.cos = Math.cos(p.phase);
      p.sin = Math.sin(p.phase);
    }
    const rotCos = new Float64Array(partials.length);
    const rotSin = new Float64Array(partials.length);
    const amps = new Float64Array(partials.length);
    for (let i0 = 0; i0 < total; i0 += BLOCK) {
      const t = i0 / sampleRate;
      const f = frequency * 2 ** ((cents + g.drift * readControl(drift, CONTROL_HZ, t)) / 1200);
      for (let k = 0; k < partials.length; k++) {
        const step = (TWO_PI * f * partials[k].ratio) / sampleRate;
        rotCos[k] = Math.cos(step);
        rotSin[k] = Math.sin(step);
        amps[k] = partials[k].amplitude * (0.65 + 0.35 * readControl(partials[k].level, CONTROL_HZ, t));
      }
      const end = Math.min(total, i0 + BLOCK);
      for (let i = i0; i < end; i++) {
        let sample = 0;
        for (let k = 0; k < partials.length; k++) {
          const p = partials[k];
          const c = p.cos * rotCos[k] - p.sin * rotSin[k];
          p.sin = p.cos * rotSin[k] + p.sin * rotCos[k];
          p.cos = c;
          sample += amps[k] * p.sin;
        }
        left[i] += sample * gl;
        right[i] += sample * gr;
      }
      for (const p of partials) {
        const m = Math.hypot(p.cos, p.sin) || 1;
        p.cos /= m;
        p.sin /= m;
      }
    }
  }

  const formants = [g.formantFreq, g.formantFreq * 2.1];
  for (const ch of [left, right]) bodyResonate(ch, { sampleRate, freqs: formants, tau: 0.005, mix: g.formant });
  const channels = [left, right].map((ch) => makeLoop(lowpass(ch, g.top, sampleRate, 1), Math.floor(warmup * sampleRate), Math.floor(fade * sampleRate)));
  return finish(channels, sampleRate, { loop: true });
}

// ---- lead and arp voices: a blend of plucked string, FM keys and breathy flute ----

function pluckSignal(g, rng, frequency, sampleRate) {
  const length = Math.floor(2.6 * sampleRate);
  const burst = Math.floor((g.burstMs / 1000) * sampleRate);
  const input = new Float32Array(length);
  const excitation = highpass(pinkNoise(rng, burst), Math.min(frequency * g.burstTone * 0.5, 4000), sampleRate, 1);
  for (let i = 0; i < burst; i++) input[i] = excitation[i] * (1 - i / burst);
  // plucking nearer the bridge or the middle changes which harmonics are missing
  const notch = Math.max(1, Math.round((g.pickPos * sampleRate) / frequency));
  for (let i = length - 1; i >= notch; i--) input[i] -= input[i - notch];

  const feedback = 10 ** (-3 / (frequency * g.decay));
  const out = comb(input, { sampleRate, freq: frequency, feedback, damping: g.damping });
  if (g.stringBeat > 0.5) {
    const second = comb(input, { sampleRate, freq: frequency * 2 ** (g.stringBeat / 1200), feedback, damping: g.damping });
    for (let i = 0; i < length; i++) out[i] = out[i] * 0.6 + second[i] * 0.5;
  }
  highpass(out, 35, sampleRate, 1);
  lowpass(out, g.pluckTop, sampleRate, 1);
  const bodyBase = Math.min(g.bodyFreq, frequency * 0.9);
  return bodyResonate(out, { sampleRate, freqs: [bodyBase, bodyBase * 1.9, bodyBase * 3.1], tau: 0.05, mix: g.body });
}

function keysSignal(g, frequency, sampleRate) {
  const length = Math.floor(2.8 * sampleRate);
  const ratio = Math.max(0.5, Math.round(g.fmRatio * 2) / 2);
  const out = new Float32Array(length);
  const twin = 2 ** (g.keysDetune / 1200);
  let carrier = 0;
  let modulator = 0;
  let carrierB = 0;
  let sub = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    modulator += (TWO_PI * frequency * ratio) / sampleRate;
    carrier += (TWO_PI * frequency) / sampleRate;
    carrierB += (TWO_PI * frequency * twin) / sampleRate;
    sub += (TWO_PI * frequency * 0.5) / sampleRate;
    const amplitude = Math.min(1, t / g.keysAttack) * Math.exp(-t / g.keysDecay) * (1 + g.tremDepth * Math.sin(TWO_PI * g.tremRate * t));
    const index = g.fmIndex * Math.exp(-t / g.fmDecay) * Math.sin(modulator);
    out[i] = amplitude * (Math.sin(carrier + index) + 0.7 * Math.sin(carrierB + index) + g.keysSub * Math.sin(sub));
  }
  const thud = mallet(createRng(Math.floor(frequency * 31)), { sampleRate, ms: 7, hardness: 0.25 });
  for (let i = 0; i < thud.length; i++) out[i] += thud[i] * g.hammer * 0.8;
  return lowpass(out, g.keysTop, sampleRate, 1);
}

function fluteSignal(g, rng, frequency, sampleRate) {
  const length = Math.floor(1.8 * sampleRate);
  const tone = new Float32Array(length);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const vibrato = 1 + g.vibDepth * Math.min(1, Math.max(0, t - g.vibDelay) * 2) * Math.sin(TWO_PI * g.vibRate * t);
    phase += (TWO_PI * frequency * vibrato) / sampleRate;
    const envelope = Math.min(1, t / g.fluteAttack) * Math.exp(-t / g.fluteDecay);
    tone[i] = envelope * (Math.sin(phase) + g.h2 * Math.sin(2 * phase) + g.h3 * Math.sin(3 * phase));
  }
  const noise = pinkNoise(rng, length);
  for (let i = 0; i < length; i++) noise[i] *= Math.min(1, i / sampleRate / 0.03) * Math.exp(-i / sampleRate / 0.5);
  const breath = comb(noise, { sampleRate, freq: frequency, feedback: 0.9, damping: 0.5 });
  for (let i = 0; i < length; i++) tone[i] += breath[i] * g.breath * 0.9;
  lowpass(tone, g.fluteTop, sampleRate, 1);
  return bodyResonate(tone, { sampleRate, freqs: [frequency * 2, frequency * 3.02, frequency * 4.05], tau: 0.03, mix: 0.35 });
}

export function renderLead(g, { seed, midi, variant = 0, sampleRate = 32000 }) {
  const rng = createRng(seed * 71 + midi * 3 + variant * 1009);
  const frequency = midiToFrequency(midi);
  const parts = [
    [g.wPluck, () => pluckSignal(g, rng, frequency, sampleRate)],
    [g.wKeys, () => keysSignal(g, frequency, sampleRate)],
    [g.wFlute ?? 0, () => fluteSignal(g, rng, frequency, sampleRate)],
  ].filter(([weight]) => weight > 0.08);
  const chosen = parts.length ? parts : [[1, () => pluckSignal(g, rng, frequency, sampleRate)]];
  const total = chosen.reduce((sum, [w]) => sum + w, 0);
  const signals = chosen.map(([w, make]) => [w / total, make()]);
  const out = new Float32Array(Math.max(...signals.map(([, s]) => s.length)));
  for (const [weight, signal] of signals) {
    // each part is levelled first so the blend weights mean something
    const max = signal.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-6);
    for (let i = 0; i < signal.length; i++) out[i] += (signal[i] / max) * weight;
  }
  fadeOut(out, 0.1, sampleRate);
  return finish([out], sampleRate);
}

// ---- bells, inharmonic partials that die at different rates ----

// only octaves and fifths of the root: a real bell's minor-third partial (1.183) and its inharmonic upper partials make the note sound
// dark and slightly out of tune against the chord, and no third means the bell suits every mode
const BELL_RATIOS = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12];
export function renderBell(g, { seed, midi, variant = 0, sampleRate = 32000, seconds = 4.5 }) {
  const rng = createRng(seed * 89 + variant * 1013);
  const frequency = midiToFrequency(midi);
  const length = Math.floor(seconds * sampleRate);
  const partials = BELL_RATIOS.slice(0, g.partials).map((ratio) => {
    const r = ratio * (1 + (rng() - 0.5) * 2 * g.inharm);
    return { ratio: r, amplitude: ratio ** -g.ampSlope * rng.between(0.6, 1), decay: g.decayBase / ratio ** g.decaySlope, beat: g.beat * rng.between(0.5, 1.5), phase: rng() * TWO_PI };
  }).filter((p) => frequency * p.ratio < 6500);
  const out = new Float32Array(length);

  for (const p of partials) {
    const w = (TWO_PI * frequency * p.ratio) / sampleRate;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      out[i] += p.amplitude * Math.min(1, t / g.strike) * Math.exp(-t / p.decay) * (Math.sin(w * i) + 0.6 * Math.sin(w * (1 + p.beat) * i + p.phase));
    }
  }
  lowpass(out, g.top, sampleRate, 1);
  fadeOut(out, 0.12, sampleRate);
  return finish([out], sampleRate);
}

// ---- bass, a sine with a few low harmonics so small speakers still hear it ----

export function renderBass(g, { midi, sampleRate = 16000, seconds = 4.5 }) {
  const frequency = midiToFrequency(midi);
  const length = Math.floor(seconds * sampleRate);
  const harmonics = [1, g.h2, g.h3];
  const out = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let sample = 0;
    harmonics.forEach((a, h) => (sample += a * Math.sin(TWO_PI * frequency * (h + 1) * t)));
    const envelope = Math.min(1, t / g.attack) * (g.sustain + (1 - g.sustain) * Math.exp(-t / g.decay));
    out[i] = Math.tanh(g.drive * sample) * envelope;
  }
  const finger = mallet(createRng(midi * 13), { sampleRate, ms: 14, hardness: 0.1 });
  for (let i = 0; i < finger.length; i++) out[i] += finger[i] * g.thump * 1.4;
  lowpass(out, g.top, sampleRate, 1);
  bodyResonate(out, { sampleRate, freqs: [frequency * 2.01, frequency * 3.97], tau: 0.08, mix: g.body * 0.5 });
  fadeOut(out, 0.1, sampleRate);
  return finish([out], sampleRate);
}

// ---- percussion: struck membranes, wood and brushed noise, built from resonating modes ----

const MEMBRANE = [1, 1.594, 2.136, 2.296, 2.653, 2.918];
// real skin overtones fall between the notes of the key, so each is pulled most of the way to a fifth or octave
// of the fundamental. a little inharmonicity stays, which keeps it a drum
const CONSONANT = [1, 1.5, 2, 2, 3, 3];
const TUNED_MEMBRANE = MEMBRANE.map((ratio, k) => ratio + (CONSONANT[k] - ratio) * 0.8);
// struck wood is modal, not harmonic: an undercut marimba bar is tuned 1 : 3.9 : 9.2 and a block is stiffer and
// duller. harmonic ratios sound like a string.
// the partials are nudged onto octaves so they stay in key
const MARIMBA = [1, 3.96, 8.15];
const BLOCK = [1, 2.06, 4.05];

// a membrane excited by a soft mallet. higher modes die faster and sit lower, so it sounds like a skin
function membrane(rng, { sampleRate, seconds, pitch, decay, hardness, count = 5 }) {
  const length = Math.floor(seconds * sampleRate);
  const input = new Float32Array(length);
  const strike = mallet(rng, { sampleRate, ms: 4 + 6 * (1 - hardness), hardness });
  input.set(strike);
  const modes = TUNED_MEMBRANE.slice(0, count).map((ratio, k) => ({
    freq: pitch * ratio * (1 + (rng() - 0.5) * 0.01), tau: decay / (1 + 0.9 * k), amp: 1 / (1 + 0.9 * k),
  }));
  return modalBank(input, modes, sampleRate);
}

function thump(rng, { sampleRate, seconds, start, end, sweep, decay, drive }) {
  const length = Math.floor(seconds * sampleRate);
  const out = new Float32Array(length);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    phase += (TWO_PI * (end + (start - end) * Math.exp(-t / sweep))) / sampleRate;
    out[i] = Math.min(1, t / 0.002) * Math.exp(-t / decay) * Math.sin(phase);
  }
  for (let i = 0; i < length; i++) out[i] = Math.tanh(drive * out[i]);
  return out;
}

export function renderKick(g, { seed, variant, sampleRate = 32000 }) {
  const rng = createRng(seed * 101 + variant);
  const jitter = () => 1 + (rng() - 0.5) * 0.06;
  const seconds = 0.6;
  const body = thump(rng, { sampleRate, seconds, start: g.start * jitter(), end: g.end * jitter(), sweep: g.sweep, decay: g.decay * jitter(), drive: g.drive });
  const skin = membrane(rng, { sampleRate, seconds, pitch: g.end * 1.25 * jitter(), decay: g.decay * 0.7, hardness: g.hardness, count: 4 });
  const beater = mallet(rng, { sampleRate, ms: 5, hardness: g.hardness });
  const out = new Float32Array(body.length);
  const skinScale = (Math.max(...body.map(Math.abs)) || 1) / (Math.max(...skin.map(Math.abs)) || 1);
  for (let i = 0; i < out.length; i++) out[i] = body[i] + skin[i] * skinScale * g.skin + (i < beater.length ? beater[i] * g.click : 0);
  fadeOut(out, 0.05, sampleRate);
  return finish([out], sampleRate);
}

// brushed cymbal-ish wash: noise through loose metallic modes, soft attack, no hard top
export function renderHat(g, { seed, variant, sampleRate = 32000 }) {
  const rng = createRng(seed * 103 + variant);
  const length = Math.floor(0.4 * sampleRate);
  const decay = g.decay * rng.between(0.85, 1.15);
  const noise = whiteNoise(rng, length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    noise[i] *= Math.min(1, t / g.attack) * Math.exp(-t / decay);
  }
  const air = Float32Array.from(noise);
  highpass(air, g.high, sampleRate, 1);
  lowpass(air, g.low, sampleRate, 2);
  const modes = Array.from({ length: 9 }, () => ({ freq: rng.between(g.high * 0.9, g.low), tau: rng.between(0.002, 0.007), amp: rng.between(0.5, 1) }));
  const metal = modalBank(noise, modes, sampleRate);
  const scale = (Math.sqrt(air.reduce((a, v) => a + v * v, 0)) || 1) / (Math.sqrt(metal.reduce((a, v) => a + v * v, 0)) || 1);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = air[i] * (1 - 0.6 * g.ring) + metal[i] * scale * g.ring * 0.9;
  lowpass(out, g.low * 0.9, sampleRate, 1);
  fadeOut(out, 0.04, sampleRate);
  return finish([out], sampleRate);
}

function drumVoice(g, rng, sampleRate, seconds) {
  const pitch = g.pitch * rng.between(0.97, 1.03);
  const out = membrane(rng, { sampleRate, seconds, pitch, decay: g.drumDecay, hardness: g.hardness });
  if (g.wires > 0.03) {
    // snare wires: band-limited noise that rattles after the hit
    const rattle = whiteNoise(rng, out.length);
    const wires = modalBank(rattle, [{ freq: 2400, tau: 0.03, amp: 1 }, { freq: 3600, tau: 0.025, amp: 0.7 }], sampleRate);
    const level = (Math.max(...out.map(Math.abs)) || 1) * g.wires * 3;
    const peak = Math.max(...wires.map(Math.abs)) || 1;
    for (let i = 0; i < out.length; i++) out[i] += (wires[i] / peak) * level * Math.exp(-i / sampleRate / (g.drumDecay * 0.6)) * Math.min(1, i / sampleRate / 0.004);
  }
  return out;
}

function woodVoice(g, rng, sampleRate, seconds) {
  const length = Math.floor(seconds * sampleRate);
  const input = new Float32Array(length);
  // hertzian contact: a half-sine pulse, shorter and sharper for a hard mallet
  const pulse = Math.floor((0.0035 - 0.0027 * g.woodHard) * sampleRate);
  for (let i = 0; i < pulse; i++) input[i] = Math.sin((Math.PI * (i + 0.5)) / pulse) ** 2;
  const f1 = g.pitch * 2 ** g.woodOct * rng.between(0.995, 1.005);
  const strike = rng.between(0.2, 0.42);
  const block = g.woodBlock;
  const modes = MARIMBA.map((marimba, k) => {
    const ratio = marimba + (BLOCK[k] - marimba) * block;
    // damping grows with frequency, so upper modes are gone almost at once and the fundamental carries the note
    const tau = (g.woodDecay * (1 - 0.55 * block)) / (1 + (0.8 + 1.6 * block) * (ratio - 1));
    const position = Math.max(0.12, Math.abs(Math.sin((k + 1) * Math.PI * strike)));
    return { freq: f1 * ratio * rng.between(0.998, 1.002), tau, amp: (k === 0 ? 1 : 0.55 * g.woodHard) * position / (1 + 0.6 * k) };
  });
  const bar = modalBank(input, modes, sampleRate);
  // the resonator tube or hollow reinforces the fundamental
  const hollow = modalBank(input, [{ freq: f1, tau: g.woodDecay * 0.8, amp: 0.5 }], sampleRate);
  for (let i = 0; i < length; i++) bar[i] += hollow[i];
  return bar;
}

function brushVoice(g, rng, sampleRate, seconds) {
  const length = Math.floor(seconds * sampleRate);
  const noise = pinkNoise(rng, length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    noise[i] *= Math.min(1, t / g.brushAttack) ** 1.5 * Math.exp(-t / g.brushDecay);
  }
  const centre = g.brushCentre * rng.between(0.9, 1.1);
  return modalBank(noise, [{ freq: centre, tau: 0.004, amp: 1 }, { freq: centre * 0.62, tau: 0.005, amp: 0.8 }], sampleRate);
}

export function renderPerc(g, { seed, variant, sampleRate = 32000 }) {
  const rng = createRng(seed * 107 + variant);
  const seconds = 0.6;
  const parts = [
    [g.wDrum, () => drumVoice(g, rng, sampleRate, seconds)],
    [g.wWood, () => woodVoice(g, rng, sampleRate, seconds)],
    [g.wBrush, () => brushVoice(g, rng, sampleRate, seconds)],
  ].filter(([w]) => w > 0.08);
  const chosen = parts.length ? parts : [[1, () => drumVoice(g, rng, sampleRate, seconds)]];
  const total = chosen.reduce((sum, [w]) => sum + w, 0);
  const out = new Float32Array(Math.floor(seconds * sampleRate));
  for (const [weight, make] of chosen) {
    const signal = make();
    const max = signal.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-6);
    for (let i = 0; i < out.length; i++) out[i] += (signal[i] / max) * (weight / total);
  }
  fadeOut(out, 0.05, sampleRate);
  return finish([out], sampleRate);
}
