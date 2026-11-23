import {
  CONTRAST_SCHEMATA, DEVELOPMENT_SCHEMATA, GROUND_SCHEMATA, HOME_SCHEMATA, MODE_INTERVALS,
  cadenceFor, fitToMode, isMajorish, isMinorish, midiOf, schemaDegrees,
} from "./theory.js";
import { ALTERNATE, METERS } from "./meter.js";
import { drawStyle } from "./genome.js";

// pure planner, no audio. turns params into timed events, one bar at a time.
// bar-start snapshots let the unplayed part be re-planned when params change.

const INTRO_BARS = 8;
const MACRO_EVERY = 4;
const TONAL = ["pad", "bass", "lead", "bell", "arp"];
const MACRO_ROLES = [...TONAL, "ambience"];
const EVOLVING = [...TONAL, "kick", "hat", "perc", "sparkle", "drip", "reed"];
const TWO_PI = Math.PI * 2;

// candy scales how often the occasional ear-candy voices appear. bloom is a beatless, pad-led section
const SECTIONS = {
  intro: { density: 0.6, energy: 0.8, candy: 0.3 },
  low: { density: 0.7, energy: 0.85, candy: 1 },
  mid: { density: 1, energy: 1, candy: 0.8 },
  high: { density: 1.3, energy: 1.1, candy: 0.6 },
  break: { density: 0.5, energy: 0.7, quiet: true, candy: 1.4 },
  bloom: { density: 0.6, energy: 0.75, quiet: true, candy: 2.2 },
};

const SECTION_MOVES = {
  mid: [["high", 0.4], ["low", 0.3], ["break", 0.15], ["bloom", 0.15]],
  high: [["mid", 0.6], ["break", 0.1], ["low", 0.15], ["bloom", 0.15]],
  low: [["mid", 0.65], ["high", 0.2], ["bloom", 0.15]],
  break: [["mid", 0.5], ["high", 0.3], ["bloom", 0.2]],
  bloom: [["mid", 0.55], ["low", 0.45]],
};

// long forms borrowed from the repertoire, as episodes of [section character, theme, variation level].
// themes: A main, B and C contrast, G a ground bass that repeats under changing music, dev a development
const FORMS = {
  rondo: [["mid", "A"], ["low", "B"], ["mid", "A"], ["high", "C"], ["mid", "A"], ["bloom", "A"]],
  ternary: [["mid", "A"], ["low", "B"], ["mid", "A"], ["break", "A"]],
  variations: [["mid", "A", 0], ["low", "A", 1], ["mid", "A", 2], ["high", "A", 3], ["break", "A", 4], ["bloom", "A", 0]],
  sonata: [["mid", "A"], ["high", "B"], ["high", "dev"], ["mid", "A"], ["mid", "B"], ["bloom", "A"]],
  arch: [["low", "A"], ["mid", "B"], ["high", "C"], ["mid", "B"], ["low", "A"]],
  chaconne: [["low", "G", 0], ["mid", "G", 1], ["high", "G", 2], ["mid", "G", 3], ["low", "G", 4], ["bloom", "G", 0]],
};

// how readily each tonal role is picked early when a section's arrangement is drawn
const ROLE_WEIGHTS = {
  intro: { pad: 10, bass: 3, lead: 2, bell: 2, arp: 2 },
  low: { pad: 4, bass: 4, lead: 2, bell: 2, arp: 1.5 },
  mid: { pad: 3, bass: 3, lead: 3, bell: 2, arp: 3 },
  high: { pad: 3, bass: 3, lead: 3, bell: 2, arp: 3 },
  break: { pad: 4, bass: 1, lead: 1.5, bell: 3, arp: 1 },
  bloom: { pad: 6, bass: 1, lead: 1, bell: 3, arp: 2 },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const MODE_BRIGHTNESS = ["phrygian", "aeolian", "dorian", "mixolydian", "ionian", "lydian"];

export function createComposer() {
  let state = null;
  let snapshots = [];
  let resumeMid = false;
  let dropBefore = -Infinity;

  function rand() {
    state.rng = (state.rng + 0x6d2b79f5) | 0;
    let t = state.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const oneOf = (list) => list[Math.floor(rand() * list.length)];
  const between = (a, b) => a + (b - a) * rand();
  const homeMeter = () => METERS[state.homeMeter];

  function pick(options) {
    let roll = rand() * options.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [value, weight] of options) {
      roll -= weight;
      if (roll < 0) return value;
    }
    return options[options.length - 1][0];
  }

  // ---- harmony ----

  // how the music feels is set by Mood (the mode) and Feeling, not by the seed. plain is settled: authentic cadences, straight triads.
  // bittersweet is longing: borrowed minor chords in major keys, deceptive and plagal cadences that don't quite land, suspensions,
  // sevenths and added ninths, and a Picardy lift out of minor. the seed only nudges each value a little
  function applyFeeling(p) {
    const L = clamp(p.longing ?? 0.3, 0, 1);
    const bright = MODE_BRIGHTNESS.indexOf(p.mode) / 5;
    const d = state.style.drawn;
    const nudge = (drawn, mid) => 0.3 * (drawn - mid);
    const s = state.style;
    s.chordBars = p.chordBars;
    s.tempoBias = p.emotionTempo * (1 + 0.3 * (d.tempoBias - 1));
    s.mixture = clamp(0.02 + 0.8 * L + nudge(d.mixture, 0.225), 0, 0.95);
    s.chromatic = clamp(0.03 + 0.5 * L + nudge(d.chromatic, 0.225), 0, 0.7);
    s.picardy = clamp(0.05 + 0.8 * L + nudge(d.picardy, 0.2), 0, 0.95);
    s.cadences = {
      authentic: Math.max(0.05, (1 - 0.75 * L + nudge(d.cadences.authentic, 0.7)) * (0.7 + 0.5 * bright)),
      plagal: 0.2 + 0.6 * L + nudge(d.cadences.plagal, 0.45),
      deceptive: 0.02 + 0.6 * L + nudge(d.cadences.deceptive, 0.2),
      half: 0.1 + 0.4 * L + nudge(d.cadences.half, 0.4),
    };
    s.colors = {
      sus2: clamp(0.03 + 0.3 * L + nudge(d.colors.sus2, 0.175), 0, 0.5),
      sus4: clamp(0.03 + 0.3 * L + nudge(d.colors.sus4, 0.15), 0, 0.5),
      add9: clamp(0.08 + 0.5 * L + nudge(d.colors.add9, 0.225), 0, 0.8),
      sixth: clamp(0.35 - 0.3 * L + nudge(d.colors.sixth, 0.15), 0, 0.5),
      seventh: clamp(0.12 + 0.65 * L + nudge(d.colors.seventh, 0.475), 0, 0.95),
    };
  }

  // brighter modes lean on open colours (add9, sixth), darker ones on sevenths and suspensions
  function drawColor(mode) {
    const c = state.style.colors;
    const bright = MODE_BRIGHTNESS.indexOf(mode) / 5;
    return {
      sus: rand() < c.sus2 ? 2 : rand() < c.sus4 ? 4 : 0,
      add9: rand() < c.add9 * (0.5 + 0.9 * bright),
      sixth: rand() < c.sixth * (0.4 + 1.1 * bright),
      seventh: rand() < c.seventh * (1.1 - 0.3 * bright),
    };
  }

  // degrees above the chord root. every colour is checked against the real interval, so a suspension or
  // extension that would form a tritone or a flat ninth over the root is dropped
  function chordOffsets(color, degree, mode) {
    const intervals = MODE_INTERVALS[mode];
    const semis = (offset) => (intervals[(degree + offset) % 7] + 12 * Math.floor((degree + offset) / 7)) - intervals[degree];
    const third = color.sus === 2 && semis(1) === 2 ? 1 : color.sus === 4 && semis(3) === 5 ? 3 : 2;
    const offsets = [0, third, 4];
    const diminished = semis(4) < 7;
    if (color.seventh && !diminished) offsets.push(6);
    else if (color.sixth && semis(5) === 9 && !diminished) offsets.push(5);
    if (color.add9 && semis(8) === 14) offsets.push(8);
    offsets.sort((a, b) => a - b);
    const { voicing } = state.style;
    if (voicing === "open") return offsets.map((o, i) => (i === 1 ? o + 7 : o)).sort((a, b) => a - b);
    if (voicing === "wide") return offsets.map((o, i) => o + (i % 2 ? 7 : 0)).sort((a, b) => a - b);
    return offsets;
  }

  // accidentals a chord carries, as scale degree -> semitones. a major V in a minor key has a raised leading tone
  function autoAlter(degree, mode) {
    return degree === 4 && isMinorish(mode) ? { 6: 1 } : {};
  }

  function drawCadence(mode, upcoming) {
    const w = state.style.cadences;
    const kind = pick([
      ["authentic", w.authentic], ["plagal", w.plagal], ["deceptive", w.deceptive], ["half", w.half * (upcoming ? 1.6 : 0.2)],
    ]);
    const [pre, final] = cadenceFor(kind, mode);
    const cadence = { kind, pre, final, preAlter: null, finalAlter: null };
    // a major third on the last chord of a minor piece (Picardy), or a borrowed minor iv in a major one
    if (isMinorish(mode) && (kind === "authentic" || kind === "plagal") && rand() < state.style.picardy) cadence.finalAlter = { 2: 1 };
    if (isMajorish(mode) && kind === "plagal" && rand() < state.style.mixture) cadence.preAlter = { 5: -1 };
    return cadence;
  }

  // the chords of a whole section, laid out so the last two bars are the cadence
  function planChords(length, degrees, cadence, mode) {
    const list = [];
    let remaining = length - (cadence ? 2 : 0);
    for (let i = 0; remaining > 0; i++) {
      const bars = Math.min(oneOf(state.style.chordBars), remaining);
      list.push({ degree: degrees[i % degrees.length], bars });
      remaining -= bars;
    }
    if (cadence) {
      list.push({ degree: cadence.pre, bars: 1, alter: cadence.preAlter });
      list.push({ degree: cadence.final, bars: 1, alter: cadence.finalAlter });
    }
    // a borrowed minor iv in place of the major IV: the hopeful-then-wistful turn
    if (isMajorish(mode)) {
      for (const entry of list) if (entry.degree === 3 && !entry.alter && rand() < state.style.mixture * 1.1) entry.alter = { 5: -1 };
    }
    // a secondary dominant (V of V) leans into the dominant, borrowed from a bar of the chord before it
    if (isMajorish(mode)) {
      for (let i = 1; i < list.length; i++) {
        if (list[i].degree === 4 && list[i - 1].bars >= 2 && rand() < state.style.chromatic) {
          list[i - 1].bars -= 1;
          list.splice(i, 0, { degree: 1, bars: 1, alter: { 3: 1 }, dominant: true });
          i++;
        }
      }
    }
    return list;
  }

  function advanceChord(mode) {
    if (state.chord.barsLeft > 0) {
      state.chord.isNew = false;
      return;
    }
    const entry = state.section.chords.shift() ?? { degree: 0, bars: 4 };
    const degree = fitToMode(entry.degree, mode);
    const altered = entry.alter || entry.dominant;
    state.chord = {
      degree,
      barsLeft: entry.bars,
      isNew: true,
      age: 0,
      alter: { ...autoAlter(degree, mode), ...entry.alter },
      color: altered ? { sus: 0, add9: false, sixth: false, seventh: rand() < 0.6 } : drawColor(mode),
    };
  }

  // ---- motifs ----

  function makeMotif() {
    const { motifLength, contour, stepwise, syncopation } = state.style;
    const meter = homeMeter();
    const count = clamp(motifLength + (rand() < 0.3 ? 1 : 0), 3, 6);
    const span = count <= 4 ? meter.half : meter.steps;
    const onsets = [0];
    while (onsets.length < count) {
      const candidate = Math.floor(rand() * span);
      if (candidate % 2 === 1 && rand() > syncopation) continue;
      if (!onsets.includes(candidate)) onsets.push(candidate);
    }
    onsets.sort((a, b) => a - b);

    let rel = oneOf([0, 2, 4]);
    const notes = onsets.map((pos, i) => {
      if (i > 0) {
        const progress = i / (count - 1);
        const up = contour === "rise" ? true : contour === "fall" ? false : contour === "arch" ? progress < 0.55 : i % 2 === 1;
        const size = rand() < stepwise ? 1 : 2 + Math.floor(rand() * 3);
        rel += (rand() < 0.8 ? (up ? 1 : -1) : up ? -1 : 1) * size;
      }
      rel = clamp(rel, -3, 8);
      const next = onsets[i + 1] ?? span;
      return { pos, rel, len: clamp(next - pos, 1, 4), vel: meter.starts.includes(pos) ? 1 : 0.65 + 0.2 * rand() };
    });
    return { span, notes };
  }

  // a related motif: a note or two changed, so a theme develops instead of just repeating
  function varyMotif(motif, amount = 1) {
    const notes = motif.notes.map((n) => ({ ...n }));
    for (let i = 0; i < Math.max(1, Math.round(amount * 2)); i++) {
      const n = notes[Math.floor(rand() * notes.length)];
      n.rel = clamp(n.rel + oneOf([-2, -1, 1, 2]), -3, 8);
    }
    if (rand() < 0.5 * amount && notes.length > 2) {
      const n = notes[1 + Math.floor(rand() * (notes.length - 1))];
      n.pos = clamp(n.pos + oneOf([-1, 1]), notes[0].pos + 1, motif.span - 1);
    }
    notes.sort((a, b) => a.pos - b.pos);
    return { span: motif.span, notes };
  }

  function transform(motif, kind) {
    const copy = motif.notes.map((n) => ({ ...n }));
    if (kind === "exact") return copy;
    if (kind.startsWith("seq")) return copy.map((n) => ({ ...n, rel: n.rel + Number(kind.slice(3)) }));
    if (kind === "octave") return copy.map((n) => ({ ...n, rel: n.rel + 7 }));
    if (kind === "invert") return copy.map((n) => ({ ...n, rel: 2 * copy[0].rel - n.rel }));
    if (kind === "fragment") return copy.slice(0, Math.max(2, Math.ceil(copy.length / 2)));
    if (kind === "sparse") return copy.filter((n, i) => i === 0 || rand() > 0.4);
    if (kind === "vary") return varyMotif(motif, 0.6).notes;
    if (kind === "ornament") {
      return copy.flatMap((n, i) => (i > 0 && n.pos > 0 && rand() < 0.5 ? [{ pos: n.pos - 1, rel: n.rel + oneOf([-1, 1]), len: 1, vel: 0.45 }, n] : [n]));
    }
    // an appoggiatura: lean on the note above, then resolve down onto the written note
    if (kind === "appoggiatura") {
      return copy.flatMap((n) => (n.len >= 2 && rand() < 0.6
        ? [{ ...n, rel: n.rel + 1, len: 1, free: true }, { ...n, pos: n.pos + 1, len: n.len - 1, vel: n.vel * 0.8 }]
        : [n]));
    }
    return copy;
  }

  function startPhrase(p) {
    const exact = 0.3 + 0.7 * p.repetition;
    state.phrase = { form: oneOf(state.style.forms), exact, seen: 0 };
  }

  // what the lead plays this bar, as a list of { pos, rel, len, vel } relative to the chord root
  function leadBar(p, section) {
    const sec = state.section;
    const meter = METERS[sec.meter];
    if (!state.phrase || sec.bar % 4 === 0) startPhrase(p);
    const letter = state.phrase.form[sec.bar % 4];
    if (letter === "x") return [];
    const motif = state.themes[letter === "B" ? sec.second : sec.main];
    let kind = "exact";
    if (sec.development) {
      // fragments and sequences of the main theme, climbing or falling through the phrase
      kind = rand() < 0.35 ? oneOf(["fragment", "invert", "seq-2"]) : `seq${(sec.bar % 4) * sec.direction}`;
    } else if (letter === "A") {
      const k = state.phrase.seen++;
      if (k === 1 && rand() > state.phrase.exact) kind = oneOf(["seq1", "seq-1", "invert", "vary", "ornament"]);
      if (k >= 2) kind = oneOf(["seq2", "octave", "vary", "sparse", "seq-2"]);
    } else if (rand() > state.phrase.exact) kind = "vary";
    if (section.density < 0.8 && rand() < 0.6) kind = "fragment";
    // later variations decorate the theme more and more
    // leaning on a note before resolving it is the melodic form of longing
    if (kind === "exact" && rand() < 0.35 * state.style.mixture) kind = "appoggiatura";
    if (sec.vary > 0 && kind === "exact" && rand() < 0.2 * sec.vary) kind = sec.vary >= 3 ? "appoggiatura" : "ornament";

    const limit = clamp(Math.round(p.notesPerBar * section.density) + 1 + sec.vary, 2, 9);
    const first = transform(motif, kind).slice(0, limit);
    if (motif.span === meter.half) {
      const answer = transform(motif, oneOf(["seq1", "seq-2", "exact", "invert"])).slice(0, limit);
      return [...first, ...answer.map((n) => ({ ...n, pos: n.pos + meter.half })).filter((n) => n.pos < meter.steps)];
    }
    return first;
  }

  // ---- rhythm ----

  function makeGroove(meter) {
    const { kickSync, hatSteps } = state.style;
    const { steps, starts, strong } = meter;
    const even = Array.from({ length: steps / 2 }, (_, i) => i * 2);
    const groupLength = (k) => (starts[k + 1] ?? steps) - starts[k];
    const offbeats = starts.map((s, k) => s + Math.floor(groupLength(k) / 4) * 2);

    let kick = starts.slice();
    if (kickSync > 0.3) {
      kick = strong.slice();
      const options = even.filter((s) => !strong.includes(s));
      const count = 1 + Math.floor(rand() * 3);
      while (kick.length <= count + strong.length - 1 && options.length) {
        const step = oneOf(options);
        if (!kick.includes(step)) kick.push(step);
      }
    }
    const hatKind = oneOf(["eighth", "offbeat", "sparse", hatSteps === 1 ? "sixteenth" : "eighth"]);
    let hat = [];
    if (hatKind === "eighth") hat = even;
    else if (hatKind === "offbeat") hat = offbeats;
    else if (hatKind === "sixteenth") hat = Array.from({ length: steps }, (_, i) => i);
    else hat = offbeats.filter(() => rand() < 0.7);
    const backbeat = starts.length >= 4 ? starts.filter((_, k) => k % 2 === 1) : starts.slice(1);
    const perc = rand() < 0.5 ? backbeat : [oneOf(even.filter((s) => !starts.includes(s))), oneOf(offbeats)];
    return { kick, hat: hat.length ? hat : offbeats, perc: perc.length ? perc : [starts[starts.length - 1]] };
  }

  // ---- form ----

  function drawSchemas(keepHome) {
    const home = keepHome && state.schemas ? state.schemas.A : oneOf(HOME_SCHEMATA);
    const contrasts = CONTRAST_SCHEMATA.filter((id) => id !== home);
    const B = oneOf(contrasts);
    const C = oneOf(contrasts.filter((id) => id !== B));
    state.schemas = { A: home, B, C, G: oneOf(GROUND_SCHEMATA), dev: oneOf(DEVELOPMENT_SCHEMATA) };
  }

  function drawForm(p) {
    const g = p.gridStrength;
    const previous = state.formName;
    const options = [
      ["rondo", 2], ["ternary", 2], ["variations", 2 + 2 * g], ["sonata", 1.5], ["arch", 1.5], ["chaconne", 1 + 2 * g], ["wandering", 1.5 * (1 - g) + 0.3],
    ].filter(([name]) => name !== previous);
    const name = pick(options);
    state.formName = name;

    let plan;
    if (name === "wandering") {
      // no fixed shape: sections drift from one to the next like the loose, through-composed ambient pieces
      let section = state.section.name === "intro" ? "mid" : state.section.name;
      plan = Array.from({ length: 5 }, (_, i) => {
        section = pick(SECTION_MOVES[section] ?? SECTION_MOVES.mid);
        return [section, i % 3 === 1 ? "B" : i % 3 === 2 ? oneOf(["A", "C"]) : "A", 0];
      });
    } else plan = FORMS[name];
    state.form = plan.map(([section, theme, vary = 0]) => ({
      section, theme, vary,
      alt: theme !== "A" && theme !== "G" && rand() < state.style.hemiola,
    }));
    state.formIndex = 0;

    // each form refreshes the material: contrasting themes are new, the main one is kept or developed
    drawSchemas(rand() < 0.6);
    state.themes.B = makeMotif();
    state.themes.C = makeMotif();
    if (state.formsPlayed > 0 && rand() < 0.5) state.themes.A = rand() < 0.5 ? varyMotif(state.themes.A, 1.5) : makeMotif();
    state.formsPlayed += 1;
  }

  function nextEpisode(p) {
    if (!state.form || state.formIndex >= state.form.length) drawForm(p);
    return state.form[state.formIndex++];
  }

  const peekEpisode = () => (state.form && state.formIndex < state.form.length ? state.form[state.formIndex] : null);

  // ---- sections ----

  // a different arrangement every section: the order roles join in, and some only play a stretch of it
  function drawOrder(name) {
    const weights = ROLE_WEIGHTS[name];
    const pool = TONAL.map((role) => [role, weights[role] * state.style.roleBias[role]]);
    const order = [];
    while (pool.length) {
      const role = pick(pool);
      order.push(role);
      pool.splice(pool.findIndex(([r]) => r === role), 1);
    }
    return order;
  }

  function drawWindows(name, length) {
    const windows = {};
    if (name === "intro" || length < 8) return windows;
    for (const role of ["lead", "arp", "bell"]) {
      if (rand() < 0.5) continue;
      const from = 4 * Math.floor((rand() * length) / 4);
      windows[role] = [from, from + 4 * (rand() < 0.4 ? 2 : 1)];
    }
    return windows;
  }

  function advanceSection(p) {
    if (state.section.barsLeft > 0) return;
    const first = state.section.name === null;
    // a meter picked by the user takes over at the next section
    const wantedMeter = p.meter > 0 ? Object.keys(METERS)[p.meter - 1] : state.style.meter;
    if (wantedMeter !== state.homeMeter) {
      state.homeMeter = wantedMeter;
      state.themes = { A: makeMotif(), B: makeMotif(), C: makeMotif() };
      state.leadHistory = [];
    }
    const episode = first ? { section: "intro", theme: "A", vary: 0, alt: false } : nextEpisode(p);
    const name = episode.section;
    const development = episode.theme === "dev";
    const base = lerp(16, 4, p.evolutionRate);
    const bars = Math.max(4, 4 * Math.round((base * pick([[0.75, 1], [1, 2], [1.5, 1]])) / 4));
    const length = name === "intro" ? INTRO_BARS : development ? 8 : bars;
    const home = homeMeter();
    const meter = episode.alt && ALTERNATE[home.name] ? ALTERNATE[home.name] : home.name;
    const mode = p.mode;

    const schemaId = state.schemas[episode.theme === "G" ? "G" : development ? "dev" : episode.theme];
    const cadence = name === "intro" ? null : drawCadence(mode, peekEpisode());
    const main = development || episode.theme === "G" ? "A" : episode.theme;

    // a returning main theme is nearly literal, with at most a small change
    if (main === "A" && !first && episode.vary === 0 && rand() < 0.25) state.themes.A = varyMotif(state.themes.A, 0.4);

    state.section = {
      name, theme: episode.theme, main, second: main === "A" ? "B" : "A", vary: episode.vary, development,
      direction: rand() < 0.5 ? 1 : -1, meter, barsLeft: length, bar: 0, cadence,
      pedal: (name === "low" || name === "break" || name === "bloom") && rand() < 0.4,
      order: drawOrder(name), windows: drawWindows(name, length),
      reed: name !== "intro" && rand() < state.style.candy.reed * (name === "bloom" ? 1.6 : 1),
      chords: planChords(length, schemaDegrees(schemaId, mode, oneOf), cadence, mode),
    };
    state.groove = makeGroove(METERS[meter]);
    state.phrase = null;
  }

  function driftMacros(p, t0, barDur, events) {
    const step = 0.15 + 0.5 * p.evolutionRate;
    const walk = (v) => clamp(v + (rand() - 0.5) * step + (0.5 - v) * 0.2, 0.05, 0.95);
    for (const role of MACRO_ROLES) {
      const prev = state.macros[role];
      state.macros[role] = prev
        ? { timbre: walk(prev.timbre), motion: walk(prev.motion) }
        : { timbre: 0.3 + 0.4 * rand(), motion: 0.3 + 0.4 * rand() };
      events.push({ type: "macro", time: t0, role, ...state.macros[role], ramp: barDur * MACRO_EVERY });
    }
  }

  function composeBar(p) {
    const style = state.style;
    const t0 = state.barStart;
    const events = [];

    state.tonicPc = p.key;
    const wasNewSection = state.section.barsLeft <= 0;
    advanceSection(p);
    advanceChord(p.mode);

    // a new mode only starts with a new chord, so ringing notes never clash with it
    if (state.chord.isNew || !state.mode) state.mode = p.mode;
    const mode = state.mode;
    const tonic = state.tonicPc;
    const d = state.chord.degree;
    const sec = state.section;
    const section = SECTIONS[sec.name];
    const meter = METERS[sec.meter];
    const { steps, starts } = meter;
    const g = p.gridStrength;

    // the last bars of a section slow a little, the way players ease into a cadence. less so when the grid is locked
    const closing = sec.cadence && sec.cadence.kind !== "half" ? (sec.barsLeft === 2 ? 0.03 : sec.barsLeft === 1 ? 0.07 : 0) : 0;
    const stepDur = (15 / state.tempoBpm) * (1 + closing * (1 - g));
    const barDur = stepDur * steps;
    const finalBar = sec.cadence !== null && sec.barsLeft === 1;
    const resolving = finalBar && sec.cadence.kind !== "half";

    const introBar = sec.name === "intro" ? INTRO_BARS - sec.barsLeft : Infinity;
    const layerCount = clamp(Math.round(p.layers * section.density), 1, TONAL.length);
    const staged = Math.min(layerCount, 1 + Math.floor(introBar / 2));
    // the first two roles in a section's order always play, the rest may be windowed to part of the section
    const inWindow = (role) => !sec.windows[role] || (sec.bar >= sec.windows[role][0] && sec.bar < sec.windows[role][1]);
    const active = sec.order.slice(0, staged).filter((role, i) => i < 2 || inWindow(role));
    const side = style.stereo;
    const wide = () => (rand() < 0.5 ? -1 : 1) * between(0.5, 1);
    // phrases swell and relax, and the bar before the end of a section settles
    const arc = 0.9 + 0.1 * Math.sin((Math.PI * ((sec.bar % 4) + 0.5)) / 4);
    const velocity = clamp(p.velocity * section.energy * arc * (resolving ? 0.88 : 1), 0.05, 1);
    const alter = state.chord.alter;
    const midi = (degree) => midiOf(tonic, mode, degree) + (alter[((degree % 7) + 7) % 7] ?? 0);
    const jitter = () => ((rand() - 0.5) * 2 * p.timingJitterMs) / 1000;
    const vary = (v) => clamp(v + (rand() - 0.5) * 2 * p.velocityJitter, 0.03, 1);
    const swing = style.swing * (1 - 0.6 * g);
    // all parts share a slow push and pull, like players breathing together
    const sway = (pos) => style.rubato * (1 - 0.6 * g) * Math.sin(((state.barIndex + pos / steps) / 5.3) * TWO_PI + state.swayPhase);
    const when = (pos, role) => t0 + (pos + (Math.round(pos) % 2 === 1 ? swing : 0)) * stepDur + style.push[role] / 1000 + sway(pos) + jitter();
    const accent = (pos) => (meter.strong.includes(pos) ? 1 : starts.includes(pos) ? 0.92 : pos % 2 === 0 ? 0.86 : 0.78);
    const note = (pos, layer, degrees, len, vel, pan) =>
      events.push({
        type: "note", time: when(pos, layer), layer, midis: degrees.map(midi),
        duration: Math.max(0.12, len * stepDur * style.legato), velocity: vary(vel * accent(pos)), pan,
      });
    const hit = (pos, layer, vel, degrees = [], pan) =>
      events.push({ type: "note", time: when(pos, layer), layer, midis: degrees.map(midi), duration: 0.1, velocity: vary(vel), pan });

    events.push({
      type: "bar", time: t0, section: sec.name, tonicPc: tonic, mode, chordDegree: d, tempo: 15 / stepDur,
      meter: meter.name,
    });
    if (state.barIndex % MACRO_EVERY === 0) driftMacros(p, t0, barDur, events);

    // instruments change a little with every section, so the sound keeps evolving
    if (wasNewSection && sec.name !== "intro") {
      const amount = 0.12 + 0.3 * p.evolutionRate;
      for (const role of EVOLVING) events.push({ type: "voice", time: t0 - 0.01, role, seed: Math.floor(rand() * 2 ** 30), amount });
    }

    const offsets = chordOffsets(state.chord.color, d, mode);
    if (active.includes("pad") && state.chord.isNew) {
      note(0, "pad", offsets.map((o) => d + o), steps * state.chord.barsLeft * 1.1, velocity * 0.7);
    }
    // a suspension resolves a bar later: the held fourth or second falls onto the third
    if (active.includes("pad") && state.chord.age === 1 && state.chord.color.sus) {
      note(0, "pad", [d + 2], steps * (state.chord.barsLeft - 0.1), velocity * 0.45);
    }

    if (active.includes("bass")) {
      const base = sec.pedal ? 0 : d;
      // folded into one low octave whatever the key, so the bass never creeps up
      let shift = 0;
      while (midi(base) + shift >= 36) shift -= 12;
      while (midi(base) + shift < 24) shift += 12;
      const low = (degree) => midi(degree) + shift;
      const bass = (pos, degree, len, vel) =>
        events.push({
          type: "note", time: when(pos, "bass"), layer: "bass", midis: [low(degree)],
          duration: Math.max(0.12, len * stepDur * style.legato), velocity: vary(vel * accent(pos)),
        });
      const gap = (k) => (starts[k + 1] ?? steps) - starts[k];
      if (style.bassStyle === "pedal" || section.quiet || resolving) bass(0, base, steps - 1, velocity * 0.8);
      else if (style.bassStyle === "rootFifth") {
        starts.forEach((s, k) => bass(s, base + (k % 2 === 0 ? 0 : rand() < 0.5 ? 4 : 7), gap(k) - 1, velocity * (k === 0 ? 0.8 : 0.6)));
      } else if (style.bassStyle === "octave") {
        bass(0, base, gap(0) - 2, velocity * 0.8);
        bass(gap(0) - 2, base + 7, 2, velocity * 0.5);
        starts.slice(1).forEach((s, k) => bass(s, base, gap(k + 1) - 1, velocity * 0.7));
      } else if (style.bassStyle === "syncopated") {
        bass(0, base, 3, velocity * 0.8);
        const options = starts.slice(1).flatMap((s) => [s - 1, s + 2]).filter((s) => s > 2 && s < steps);
        for (const step of options) if (rand() < 0.25 + 0.4 * g) bass(step, base + (rand() < 0.3 ? 4 : 0), 2, velocity * 0.55);
      } else if (rand() < 0.5 + 0.5 * g) {
        for (let st = 0; st < steps; st += 2) bass(st, base, 1.6, velocity * (starts.includes(st) ? 0.75 : 0.45));
      } else bass(0, base, steps - 1, velocity * 0.8);
    }

    let leadNotes = [];
    if (active.includes("lead")) {
      // the bar that ends a section lands the cadence: lean on the note above, then settle on the root
      leadNotes = finalBar
        ? [{ pos: 0, rel: 1, len: Math.max(2, (starts[1] ?? 4) - 1), vel: 0.9, free: true }, { pos: starts[1] ?? 4, rel: 0, len: steps - (starts[1] ?? 4) - 1, vel: 1 }]
        : leadBar(p, section);
      const chordTones = new Set(offsets.map((o) => o % 7));
      const nearestTone = (rel) => {
        for (let delta = 0; delta < 4; delta++) {
          if (chordTones.has((((rel + delta) % 7) + 7) % 7)) return rel + delta;
          if (chordTones.has((((rel - delta) % 7) + 7) % 7)) return rel - delta;
        }
        return rel;
      };
      leadNotes.forEach((n, i) => {
        // strong beats and the last note land on chord tones, so the line always sounds intended
        const strong = !n.free && (meter.strong.includes(n.pos) || i === leadNotes.length - 1);
        const rel = strong ? nearestTone(n.rel) : n.rel;
        n.degree = d + 7 + style.register.lead + rel;
        note(n.pos, "lead", [n.degree], n.len, velocity * n.vel);
      });
      state.leadHistory = [leadNotes.map(({ pos, len, vel, degree }) => ({ pos, len, vel, rel: degree - d })), ...(state.leadHistory ?? [])].slice(0, 3);
    }

    if (active.includes("bell")) {
      if (leadNotes.length > 1 && rand() < 0.45) {
        // echo the end of the lead's phrase an octave up
        for (const n of leadNotes.slice(-2)) note(Math.min(steps - 1, n.pos + 3), "bell", [n.degree + 7], 8, velocity * 0.4);
      } else if (rand() < 0.45) {
        const pos = Math.round(lerp(rand(), Math.round(rand() * steps) / steps, g) * (steps - 1));
        note(pos, "bell", [d + oneOf([0, 2, 4]) + 7 + style.register.bell], 12, velocity * 0.5);
      }
    }

    if (active.includes("arp")) {
      const tones = [0, 2, 4, 7];
      const stride = style.arpSteps === 16 ? 1 : 2;
      const count = steps / stride;
      const free = style.arpKind === "free";
      // an Alberti or rolling figure keeps its shape bar after bar, so it plays nearly every note
      const keep = free ? lerp(0.35, 1, g) * (stride === 1 ? 0.6 : 1) : lerp(0.8, 1, g) * (stride === 1 ? 0.8 : 1) * (1 + 0.05 * sec.vary);
      const rotate = free ? (state.barIndex * 2) % 8 : 0;
      for (let i = 0; i < count; i++) {
        if (rand() > keep) continue;
        const tone = tones[style.arpPattern[(i + rotate) % 16]];
        const pan = side.arp === "pingpong" ? (i % 2 ? 1 : -1) * side.arpWidth
          : side.arp === "sweep" ? Math.sin(((state.barIndex * count + i) / (count * 3)) * TWO_PI) * side.arpWidth
          : wide();
        note(i * stride, "arp", [d + style.register.arp + tone], stride * 1.5, velocity * 0.45, pan);
      }
    }

    // percussion appears with structure, and later in sections that are sparse
    const phraseEnd = sec.bar % 4 === 3;
    if (introBar >= 4 && !section.quiet) {
      const rhythm = p.rhythm * clamp(section.density, 0.7, 1.3);
      const hatPan = () => side.hat * between(0.55, 1);
      const percPan = () => (rand() < 0.8 ? side.perc : -side.perc) * between(0.55, 1);
      // now and then the kick drops out at a phrase end, which leaves room for the next phrase to land
      const dropKick = phraseEnd && !finalBar && rand() < style.dropout;
      if (resolving) {
        // the final bar of a cadence settles on one low note
        if (rhythm > 0.3) hit(0, "kick", velocity * 0.9, [d, d + 4], 0);
      } else {
        if (rhythm > 0.3 && !dropKick) for (const step of state.groove.kick) hit(step, "kick", velocity * (starts[0] === step ? 0.95 : 0.7), [d, d + 4], 0);
        if (rhythm > 0.5) {
          for (const step of state.groove.hat) {
            if (rand() < 0.65 + 0.35 * g) hit(step, "hat", velocity * (starts.includes(step) ? 0.5 : 0.32), [], hatPan());
          }
        }
        if (rhythm > 0.65) for (const step of state.groove.perc) if (rand() < 0.8) hit(step, "perc", velocity * 0.6, [d, d + 2, d + 4], percPan());
        if (rhythm > 0.5 && phraseEnd && rand() < style.fills) {
          for (let step = steps - 4; step < steps; step++) if (rand() < 0.6) hit(step, "perc", velocity * (0.4 + 0.1 * (step - steps + 4)), [d, d + 2, d + 4], percPan());
        }
      }
    }

    // ear-candy: voices that drop in for a moment and leave. density and the section scale how often
    const candy = section.candy * (0.4 + 0.6 * (p.layers / 5));
    const since = (key) => state.barIndex - state.candy[key];
    const chordTone = () => d + oneOf(offsets);

    // a harp-like run across the stereo field, from hard left to hard right or back
    const runAt = sec.bar === 0 && sec.name !== "intro" ? 0 : phraseEnd && !finalBar ? steps - 4 : null;
    if (runAt !== null && since("sparkle") >= 6 && rand() < 0.28 * style.candy.sparkle * candy * (runAt === 0 ? 1.6 : 1)) {
      state.candy.sparkle = state.barIndex;
      const count = Math.floor(between(5, 9));
      const up = rand() < 0.6;
      const flip = rand() < 0.5 ? 1 : -1;
      const base = d + 7 + oneOf([0, 7]);
      const gapS = between(0.06, 0.11);
      const velocityRun = velocity * between(0.3, 0.45);
      for (let i = 0; i < count; i++) {
        const step = up ? i : count - 1 - i;
        const degree = base + [0, 2, 4, 7, 9, 11, 14, 16, 18][step];
        events.push({
          type: "note", time: when(runAt, "arp") + i * gapS, layer: "sparkle", midis: [midi(degree)], duration: 1.2,
          velocity: vary(velocityRun * (0.7 + 0.3 * (i / count))), pan: flip * (-1 + (2 * i) / (count - 1)),
        });
      }
    }

    // single high notes that fall into the gaps
    if (since("drip") >= 1 && rand() < 0.22 * style.candy.drip * candy) {
      state.candy.drip = state.barIndex;
      note(Math.floor(rand() * (steps - 2)), "drip", [chordTone() + 14], 10, velocity * between(0.3, 0.5), wide());
    }

    // imitation: a second voice answers the lead's last bar, a bar or two late and a fifth or octave away
    // (a fugal answer). with no lead to follow, it plays a slow line of its own
    const history = state.leadHistory?.[style.canon.delay - 1];
    if (sec.reed && sec.bar >= style.canon.delay && !finalBar && rand() < 0.7) {
      if (history?.length && active.includes("lead")) {
        const tones = new Set(offsets.map((o) => o % 7));
        const fit = (rel) => {
          for (let delta = 0; delta < 4; delta++) {
            if (tones.has((((rel + delta) % 7) + 7) % 7)) return rel + delta;
            if (tones.has((((rel - delta) % 7) + 7) % 7)) return rel - delta;
          }
          return rel;
        };
        history.forEach((n, i) => {
          const rel = meter.strong.includes(n.pos) || i === history.length - 1 ? fit(n.rel + style.canon.shift) : n.rel + style.canon.shift;
          note(n.pos, "reed", [d + rel], Math.max(2, n.len), velocity * 0.4 * n.vel, side.reed * between(0.6, 1));
        });
      } else if (sec.bar % 2 === 1) {
        let degree = d + 7 + oneOf([0, 2, 4]);
        const slots = [[0, 0.375], [0.375, 0.25], [0.625, 0.375]];
        for (const [from, len] of slots.slice(0, rand() < 0.5 ? 2 : 3)) {
          note(Math.round(from * steps), "reed", [degree], Math.round(len * steps), velocity * 0.5, side.reed * between(0.6, 1));
          degree += oneOf([-1, 1, 2, -2]);
        }
      }
    }

    const texture = p.textureMix;
    if (state.barIndex - state.lastGust >= 3 && rand() < 0.05 + 0.3 * texture) {
      state.lastGust = state.barIndex;
      events.push({
        type: "note", time: t0 + rand() * barDur, layer: "gust", midis: [], duration: 1,
        velocity: 0.4 + 0.4 * rand(), pan: rand() * 2 - 1, freq: 250 + rand() * 900,
      });
    }
    // a swell into the next section
    const upcoming = peekEpisode();
    if (sec.barsLeft === 2 && sec.name !== "intro" && upcoming && (upcoming.section === "high" || upcoming.section === "mid") && rand() < 0.6) {
      events.push({ type: "note", time: t0, layer: "gust", midis: [], duration: 1, velocity: 0.7, pan: between(-0.6, 0.6), variant: 2 });
    }

    state.barStart += barDur;
    state.barIndex += 1;
    sec.barsLeft -= 1;
    sec.bar += 1;
    state.chord.barsLeft -= 1;
    state.chord.age += 1;
    return events;
  }

  return {
    start(time, seed = 1) {
      state = {
        rng: seed | 0,
        barStart: time,
        barIndex: 0,
        tempoBpm: 80,
        tonicPc: 0,
        mode: null,
        style: drawStyle(seed),
        homeMeter: null,
        swayPhase: 0,
        section: { name: null, barsLeft: 0, bar: 0, chords: [], windows: {}, order: TONAL },
        form: null,
        formIndex: 0,
        formName: null,
        formsPlayed: 0,
        schemas: null,
        chord: { degree: null, barsLeft: 0, isNew: false, age: 0, alter: {}, color: { sus: 0, add9: false, sixth: false, seventh: false } },
        groove: null,
        phrase: null,
        themes: null,
        leadHistory: [],
        macros: {},
        lastGust: -99,
        candy: { sparkle: -99, drip: -99 },
      };
      // what the seed drew for the emotional settings, kept only as a small variation around what Mood and Feeling ask for
      state.style.drawn = structuredClone({ tempoBias: state.style.tempoBias, mixture: state.style.mixture, chromatic: state.style.chromatic, picardy: state.style.picardy, cadences: state.style.cadences, colors: state.style.colors });
      state.swayPhase = rand() * TWO_PI;
      state.homeMeter = state.style.meter;
      state.themes = { A: makeMotif(), B: makeMotif(), C: makeMotif() };
      drawSchemas(false);
      snapshots = [];
      resumeMid = false;
      dropBefore = -Infinity;
    },

    // plans whole bars until one starts at or after `time`
    planUntil(time, getParams) {
      const events = [];
      while (state.barStart < time) {
        const p = getParams();
        applyFeeling(p);
        if (!resumeMid) state.tempoBpm = clamp(p.tempoBpm * state.style.tempoBias, 40, 150);
        resumeMid = false;
        snapshots.push({ start: state.barStart, state: structuredClone(state) });
        for (const event of composeBar(p)) {
          if (event.time >= dropBefore) events.push(event);
        }
        dropBefore = -Infinity;
      }
      return events;
    },

    // restores the bar containing `time` so planning can redo everything from there.
    // events before `time` were already played and are dropped from the redo.
    rewindTo(time) {
      if (snapshots.length === 0) return;
      let index = snapshots.length - 1;
      while (index > 0 && snapshots[index].start > time) index--;
      const snapshot = snapshots[index];
      snapshots = snapshots.slice(0, index);
      state = structuredClone(snapshot.state);
      resumeMid = time > snapshot.start;
      dropBefore = time;
    },

    prune(time) {
      snapshots = snapshots.filter((s) => s.start + 60 > time);
    },

    get state() {
      return state;
    },
  };
}
