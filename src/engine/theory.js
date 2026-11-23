export const MODE_INTERVALS = {
  locrian: [0, 1, 3, 5, 6, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const BASE_MIDI = 48;

// degree can be negative or past 6, it wraps into other octaves
export function midiOf(tonicPc, mode, degree) {
  const intervals = MODE_INTERVALS[mode];
  const octave = Math.floor(degree / 7);
  const index = ((degree % 7) + 7) % 7;
  return BASE_MIDI + tonicPc + intervals[index] + 12 * octave;
}

export function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function scaleName(tonicPc, mode) {
  return `${NOTE_NAMES[((tonicPc % 12) + 12) % 12]} ${mode}`;
}

// progressions that suit each mode, as scale degrees. the characteristic chord of each mode is in there
// (lydian II, mixolydian bVII, dorian IV, phrygian bII), and chords that sound tense or unresolved are left out.
export const PROGRESSIONS = {
  lydian: [[0, 1, 0, 4], [0, 1, 5, 4], [0, 4, 1, 0], [5, 1, 0, 4], [0, 1, 0, 5]],
  ionian: [[0, 4, 5, 3], [0, 5, 3, 4], [3, 0, 4, 5], [0, 2, 3, 4], [0, 3, 0, 4], [0, 3, 5, 4]],
  mixolydian: [[0, 6, 3, 0], [0, 3, 6, 3], [0, 6, 3, 4], [3, 6, 0, 0], [0, 4, 6, 3]],
  dorian: [[0, 3, 0, 6], [0, 6, 3, 0], [0, 3, 6, 0], [0, 1, 3, 0], [0, 2, 3, 6]],
  aeolian: [[0, 5, 2, 6], [0, 3, 6, 2], [0, 6, 5, 6], [5, 6, 0, 0], [0, 2, 6, 5], [0, 3, 4, 0]],
  phrygian: [[0, 1, 0, 6], [0, 6, 5, 1], [0, 3, 1, 0], [0, 5, 6, 0]],
};


const FAMILY = { lydian: "bright", ionian: "bright", mixolydian: "bright", dorian: "dark", aeolian: "dark", phrygian: "dark" };

// every mode has exactly one diminished triad, and these are the chords that stand in for it
const DIMINISHED = { ionian: 6, dorian: 5, phrygian: 4, lydian: 3, mixolydian: 2, aeolian: 1 };
const STAND_IN = { 6: 4, 5: 3, 4: 6, 3: 1, 2: 5, 1: 3 };

export const fitToMode = (degree, mode) => (degree % 7 === DIMINISHED[mode] ? STAND_IN[degree % 7] : degree);

// classical chord patterns as scale degrees (0 = tonic), with a bright and a dark reading each
export const SCHEMATA = {
  // I V vi iii IV I IV V, the Pachelbel / romanesca ground
  romanesca: { bright: [0, 4, 5, 2, 3, 0, 3, 4], dark: [0, 6, 5, 2, 3, 0, 3, 4] },
  // IV I V I, the galant prinner
  prinner: { bright: [3, 0, 4, 0], dark: [3, 0, 4, 0] },
  galant: { bright: [0, 3, 4, 0], dark: [0, 3, 4, 0] },
  popular: { bright: [0, 4, 5, 3], dark: [0, 5, 2, 6] },
  // descending lament bass i VII VI V
  lament: { bright: [0, 4, 5, 3], dark: [0, 6, 5, 4] },
  // descending thirds, a sequence
  thirds: { bright: [0, 5, 3, 1], dark: [0, 5, 3, 6] },
  // descending fifths, as in Baroque sequences
  circle: { bright: [0, 3, 1, 4], dark: [0, 3, 6, 2] },
  // passamezzo antico / moderno
  passamezzo: { bright: [0, 3, 0, 4, 0, 3, 0, 4], dark: [0, 6, 0, 4, 2, 6, 0, 4] },
};

export const HOME_SCHEMATA = ["modal", "modal", "romanesca", "prinner", "galant", "popular", "lament"];
export const CONTRAST_SCHEMATA = ["modal", "thirds", "circle", "popular", "passamezzo", "galant", "romanesca"];
export const GROUND_SCHEMATA = ["lament", "romanesca", "passamezzo"];
export const DEVELOPMENT_SCHEMATA = ["thirds", "circle"];

export function schemaDegrees(id, mode, oneOf) {
  if (id === "modal") return oneOf(PROGRESSIONS[mode] ?? PROGRESSIONS.ionian).slice();
  return SCHEMATA[id][FAMILY[mode]].map((degree) => fitToMode(degree, mode));
}

// [chord before the end, final chord]
export function cadenceFor(kind, mode) {
  const special = { authentic: { phrygian: [1, 0], mixolydian: [6, 0] }, plagal: { lydian: [1, 0] }, half: { lydian: [1, 4], phrygian: [3, 6] } };
  const base = { authentic: [4, 0], plagal: [3, 0], deceptive: [4, 5], half: [3, 4] };
  return (special[kind]?.[mode] ?? base[kind]).map((degree) => fitToMode(degree, mode));
}

export const isMinorish = (mode) => mode === "aeolian" || mode === "dorian";
export const isMajorish = (mode) => mode === "ionian" || mode === "mixolydian";
