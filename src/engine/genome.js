import { createRng } from "./rng.js";
import { METER_CHOICES } from "./meter.js";

// a gene spec maps each parameter to [min, max, "int"?]. instruments and composer style are drawn from
// the seed, and instrument genes are mutated a little at section changes so sounds evolve.

const INT = "int";
const SHARP = "sharp";
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finish = (value, kind) => (kind === INT ? Math.round(value) : value);

// looseness is random cents of mistuning per note, scoop/glideMs a pitch slide into the note (negative starts below)
const PLUCK = {
  decay: [0.5, 4], damping: [0.05, 0.8], pluckTop: [1300, 3300], burstMs: [1, 16],
  burstTone: [0.2, 3], pickPos: [0.05, 0.5], stringBeat: [0, 12], body: [0, 1], bodyFreq: [110, 420],
};
const KEYS = {
  fmRatio: [0.5, 4.5], fmIndex: [0.3, 5], fmDecay: [0.1, 1], keysDecay: [0.4, 3],
  tremRate: [2.5, 7], tremDepth: [0, 0.35], keysAttack: [0.001, 0.02], keysTop: [1300, 3400],
  keysDetune: [0, 14], keysSub: [0, 0.5], hammer: [0, 0.6],
};
const FLUTE = {
  breath: [0.005, 0.18], vibRate: [3.5, 6.8], vibDepth: [0, 0.012], vibDelay: [0.05, 0.8],
  fluteAttack: [0.02, 0.2], h2: [0, 0.6], h3: [0, 0.35], fluteDecay: [0.4, 2], fluteTop: [1300, 3300],
};
const WEIGHTS = { wPluck: [0, 1, SHARP], wKeys: [0, 1, SHARP], wFlute: [0, 1, SHARP] };
const BELL = {
  partials: [3, 9, INT], inharm: [0, 0.006], decayBase: [0.6, 6], decaySlope: [0.3, 1.4], ampSlope: [0.2, 1.2], top: [1800, 4200],
  strike: [0.001, 0.03], looseness: [2, 12], beat: [0.0003, 0.003],
};
const MOTION = { looseness: [3, 16], scoop: [-90, 30], glideMs: [25, 170], glideChance: [0.15, 0.9] };

export const SPECS = {
  pad: {
    rolloff: [1, 2.6], partials: [4, 12, INT], voices: [3, 5, INT], spread: [4, 22], drift: [0.5, 4],
    inharm: [0, 0.0012], oddBias: [0, 0.6], top: [1200, 3600], attack: [0.6, 4.5], release: [2, 7], wobble: [0.03, 0.4],
    slide: [0, 25], formant: [0, 0.35], formantFreq: [250, 800],
  },
  bass: {
    h2: [0.05, 1], h3: [0, 0.7], drive: [0.8, 3.2], decay: [0.5, 3], attack: [0.004, 0.12], top: [350, 1100],
    sustain: [0.15, 0.8], scoop: [-100, 0], scoopMs: [20, 90], thump: [0, 0.6], body: [0, 0.8],
  },
  lead: { ...PLUCK, ...KEYS, ...FLUTE, ...WEIGHTS, ...MOTION },
  arp: { ...PLUCK, ...KEYS, ...WEIGHTS, ...MOTION, wFlute: [0, 0] },
  bell: BELL,
  // ear-candy voices that only appear now and then
  sparkle: { ...PLUCK, ...KEYS, ...WEIGHTS, ...MOTION, wFlute: [0, 0] },
  drip: { ...BELL },
  reed: { ...PLUCK, ...KEYS, ...FLUTE, ...MOTION, wPluck: [0, 0.2], wKeys: [0, 0.2], wFlute: [0.7, 1] },
  kick: {
    start: [70, 200], end: [38, 65], sweep: [0.02, 0.09], decay: [0.12, 0.45], click: [0, 0.25], drive: [0.9, 2],
    skin: [0.1, 0.7], hardness: [0.1, 0.8], loose: [0.005, 0.05],
  },
  hat: {
    high: [2200, 4500], low: [4500, 6500], decay: [0.025, 0.3], attack: [0.002, 0.02], ring: [0, 0.8], loose: [0.01, 0.08],
  },
  perc: {
    wDrum: [0, 1, SHARP], wWood: [0, 1, SHARP], wBrush: [0, 1, SHARP],
    pitch: [75, 420], drumDecay: [0.08, 0.5], hardness: [0.1, 0.9], wires: [0, 0.8],
    woodOct: [1, 2, INT], woodDecay: [0.06, 0.4], woodHard: [0.2, 1], woodBlock: [0, 1],
    brushCentre: [1200, 3500], brushDecay: [0.05, 0.3], brushAttack: [0.004, 0.04], loose: [0.01, 0.07],
  },
};

export const GENE_ROLES = Object.keys(SPECS);

export function drawGene(spec, rng) {
  const gene = {};
  for (const [key, [lo, hi, kind]] of Object.entries(spec)) {
    gene[key] = finish(kind === SHARP ? lo + (hi - lo) * rng() ** 2 : rng.between(lo, hi), kind);
  }
  return gene;
}

export function mutateGene(gene, spec, rng, amount) {
  const next = {};
  for (const [key, [lo, hi, kind]] of Object.entries(spec)) {
    next[key] = finish(clamp(gene[key] + (rng() * 2 - 1) * amount * (hi - lo), lo, hi), kind);
  }
  return next;
}

export function drawInstrumentGenes(seed) {
  return Object.fromEntries(
    GENE_ROLES.map((role, i) => [role, drawGene(SPECS[role], createRng(seed * 7919 + 101 * (i + 1)))]),
  );
}

// the composer's personality for a seed: groove feel, harmony, motifs, register and timing habits
export function drawStyle(seed) {
  const r = createRng(seed * 104729 + 17);
  const arpKind = r.choose(["free", "free", "alberti", "rolling"]);
  const shuffled = (list) => list.map((v) => [r(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  return {
    tempoBias: r.between(0.88, 1.12),
    swing: r.between(0, 0.3),
    rubato: r.between(0.008, 0.04),
    chordBars: r.choose([[1, 2], [2, 2, 4], [2, 4], [1, 1, 2], [2]]),
    colors: { sus2: r.between(0, 0.35), sus4: r.between(0, 0.3), add9: r.between(0, 0.45), sixth: r.between(0, 0.3), seventh: r.between(0.15, 0.8) },
    voicing: r.choose(["close", "open", "wide"]),
    bassStyle: r.choose(["pedal", "rootFifth", "octave", "syncopated", "pulse"]),
    syncopation: r.between(0.1, 0.7),
    motifLength: r.int(3, 6),
    contour: r.choose(["arch", "rise", "fall", "wave"]),
    stepwise: r.between(0.55, 0.9),
    forms: shuffled(["AAAB", "ABAB", "AxAB", "AABA", "AxAx"]).slice(0, 3),
    legato: r.between(0.8, 1.4),
    arpKind,
    arpPattern: arpKind === "alberti" ? Array.from({ length: 16 }, (_, i) => [0, 2, 1, 2][i % 4])
      : arpKind === "rolling" ? Array.from({ length: 16 }, (_, i) => [0, 1, 2, 3, 2, 1][i % 6])
      : Array.from({ length: 16 }, () => r.int(0, 3)),
    arpSteps: r.choose([8, 8, 16]),
    register: { lead: r.choose([0, 0, 7]), bell: r.choose([7, 14]), arp: r.choose([7, 14]) },
    push: {
      pad: r.between(-6, 10), lead: r.between(-10, 14), bass: r.between(-14, 2), kick: r.between(-4, 4),
      hat: r.between(-6, 8), perc: r.between(-4, 10), bell: r.between(0, 18), arp: r.between(-6, 8),
      sparkle: r.between(-4, 8), drip: r.between(0, 18), reed: r.between(-6, 10),
    },
    // how likely each tonal role is to be picked early in a section's arrangement
    roleBias: { pad: r.between(0.7, 1.4), bass: r.between(0.6, 1.4), lead: r.between(0.5, 1.6), bell: r.between(0.5, 1.5), arp: r.between(0.4, 1.6) },
    candy: { sparkle: r.between(0.2, 1), drip: r.between(0.3, 1), reed: r.between(0.1, 0.8) },
    dropout: r.between(0, 0.35),
    stereo: {
      hat: r.choose([-1, 1]), perc: r.choose([-1, 1]), reed: r.choose([-1, 1]),
      arp: r.choose(["pingpong", "sweep", "scatter", "scatter"]), arpWidth: r.between(0.8, 1),
    },
    meter: r.choose(METER_CHOICES),
    // chance that a contrasting episode slips into the other grouping of a 12-step meter, a hemiola
    hemiola: r.between(0, 0.7),
    cadences: { authentic: r.between(0.4, 1), plagal: r.between(0.1, 0.8), deceptive: r.between(0, 0.4), half: r.between(0.1, 0.7) },
    picardy: r.between(0, 0.4),
    mixture: r.between(0, 0.45),
    chromatic: r.between(0, 0.45),
    // a second voice answers the lead a bar or two later, at the same pitch, a fifth up or an octave up
    canon: { shift: r.choose([0, 4, 7]), delay: r.choose([1, 1, 2]) },
    hatSteps: r.choose([2, 2, 1]),
    fills: r.between(0, 1),
    kickSync: r.between(0, 1),
  };
}
