import { METERS } from "./meter.js";

const METER_NAMES = Object.keys(METERS);

// neighbouring modes differ by one note, and locrian is left out because its tonic chord is diminished
export const MODES = ["phrygian", "aeolian", "dorian", "mixolydian", "ionian", "lydian"];

// what each emotion means in music: its mode, how wistful the harmony is (see applyFeeling in the composer), how long chords last
// and a tempo lean. each is a fixed recipe, so the same emotion sounds the same whatever the seed. ordered from dark to bright.
// the names are the plain words people use for music: Geneva Emotional Music Scale (sadness, nostalgia, tenderness, peacefulness, wonder,
// joyful activation, tension) and Spotify's most streamed moods (chill, relaxing, nostalgia, dark, sad, happy)
export const EMOTIONS = [
  { id: "dark", label: "Dark", mode: "phrygian", longing: 0.15, chordBars: [2, 4], tempo: 0.92 },
  { id: "sad", label: "Sad", mode: "aeolian", longing: 0.8, chordBars: [2, 4], tempo: 0.92 },
  { id: "nostalgic", label: "Nostalgic", mode: "ionian", longing: 0.95, chordBars: [2, 2, 4], tempo: 0.95 },
  { id: "tender", label: "Tender", mode: "dorian", longing: 0.5, chordBars: [2, 4], tempo: 0.93 },
  { id: "peaceful", label: "Peaceful", mode: "ionian", longing: 0.1, chordBars: [4, 4, 2], tempo: 0.9 },
  { id: "dreamy", label: "Dreamy", mode: "lydian", longing: 0.55, chordBars: [2, 4], tempo: 0.95 },
  { id: "hopeful", label: "Hopeful", mode: "mixolydian", longing: 0.35, chordBars: [1, 2, 2], tempo: 1 },
  { id: "happy", label: "Happy", mode: "ionian", longing: 0, chordBars: [1, 2], tempo: 1.08 },
];

const emotionAt = (value) => EMOTIONS[Math.round(Math.min(1, Math.max(0, value)) * (EMOTIONS.length - 1))];
export const emotionValue = (id) => EMOTIONS.findIndex((e) => e.id === id) / (EMOTIONS.length - 1);

// older saved settings stored a Mood slider over the six modes
const MOOD_TO_EMOTION = ["dark", "sad", "tender", "hopeful", "peaceful", "dreamy"];
export const emotionFromMood = (mood) => emotionValue(MOOD_TO_EMOTION[Math.round(Math.min(1, Math.max(0, mood)) * 5)]);

// user axes, each 0..1
export const axes = {
  emotion: { label: "Emotion", options: EMOTIONS.map((e) => e.label), default: emotionValue("peaceful"), steps: EMOTIONS.length },
  pace: { label: "Pace", low: "slow", high: "fast", default: 0.4 },
  energy: { label: "Energy", low: "gentle", high: "intense", default: 0.4 },
  density: { label: "Density", low: "sparse", high: "full", default: 0.4 },
  structure: { label: "Structure", low: "free", high: "locked", default: 0.2 },
  pulse: { label: "Pulse", low: "beatless", high: "driving", default: 0.45 },
  space: { label: "Space", low: "close", high: "vast", default: 0.6 },
  texture: { label: "Texture", low: "musical", high: "textural", default: 0.45 },
  color: { label: "Color", low: "warm", high: "airy", default: 0.45 },
  brightness: { label: "Brightness", low: "dark", high: "bright", default: 0.5 },
};

// resolved value = range interpolated by the axis value
export const mappings = {
  filterCutoffHz: { axis: "brightness", range: [400, 3200], curve: "exp" },
  tiltDb: { axis: "brightness", range: [-9, -5] },

  tempoBpm: { axis: "pace", range: [50, 130] },
  modRateScale: { axis: "pace", range: [0.5, 2], curve: "exp" },

  velocity: { axis: "energy", range: [0.35, 0.9] },
  attackSeconds: { axis: "energy", range: [1.5, 0.05], curve: "exp" },
  modDepth: { axis: "energy", range: [0.1, 0.8] },

  layers: { axis: "density", range: [1, 5], round: true },
  notesPerBar: { axis: "density", range: [1, 8], round: true },

  gridStrength: { axis: "structure", range: [0, 1] },
  rhythm: { axis: "pulse", range: [0, 1] },
  repetition: { axis: "structure", range: [0, 0.9] },
  timingJitterMs: { axis: "structure", range: [120, 0] },

  reverbMix: { axis: "space", range: [0.15, 0.8] },
  reverbLength: { axis: "space", range: [0, 1] },
  stereoWidth: { axis: "space", range: [0.5, 0.75] },
  orbitRadius: { axis: "space", range: [1, 6] },

  textureMix: { axis: "texture", range: [0, 1] },
  noiseLowDb: { axis: "color", range: [7, -4] },
  noiseHighDb: { axis: "color", range: [-14, 3] },
  noiseCutoffHz: { axis: "color", range: [800, 6500], curve: "exp" },

};

const constants = { velocityJitter: 0.12 };

// internal parameters
export const internals = {
  key: { range: [0, 11], round: true, default: 0 },
  evolutionRate: { range: [0.1, 1], default: 0.4 },
  seed: { range: [0, 2 ** 31 - 1], round: true, default: 1 },
  // 0 leaves it to the seed, otherwise it picks from choices. regenerate keeps this as it is
  meter: { range: [0, METER_NAMES.length], round: true, default: 0, random: false, choices: ["auto", ...METER_NAMES] },
};

// stepped axes snap to one of their steps
export function snapAxis(name, value) {
  const { steps } = axes[name];
  return steps ? Math.round(value * (steps - 1)) / (steps - 1) : value;
}

export function defaultAxes() {
  return Object.fromEntries(Object.entries(axes).map(([name, { default: value }]) => [name, value]));
}

export function defaultInternals() {
  return Object.fromEntries(Object.entries(internals).map(([name, { default: value }]) => [name, value]));
}

function interpolate(value, [from, to], { curve, round } = {}) {
  const result = curve === "exp" ? from * (to / from) ** value : from + (to - from) * value;
  return round ? Math.round(result) : result;
}

export function resolve(axisValues, internalValues = defaultInternals()) {
  const resolved = {};
  for (const [name, { axis, ...options }] of Object.entries(mappings)) {
    resolved[name] = interpolate(axisValues[axis], options.range, options);
  }
  const emotion = emotionAt(axisValues.emotion);
  resolved.mode = emotion.mode;
  resolved.modeIndex = MODES.indexOf(emotion.mode);
  resolved.longing = emotion.longing;
  resolved.chordBars = emotion.chordBars;
  resolved.emotionTempo = emotion.tempo;
  return { ...internalValues, ...constants, ...resolved };
}

// rng returns 0..1
export function randomizeInternals(rng = Math.random, current = defaultInternals()) {
  const result = { ...current };
  for (const [name, { range, round, random }] of Object.entries(internals)) {
    if (range && random !== false) result[name] = interpolate(rng(), range, { round });
  }
  return result;
}

// saved values can be old or hand-edited, so only known names with numbers in range are kept
export function restoreAxes(saved) {
  const result = defaultAxes();
  if (!Number.isFinite(saved?.emotion) && Number.isFinite(saved?.mood)) saved = { ...saved, emotion: emotionFromMood(saved.mood) };
  for (const name of Object.keys(result)) {
    const value = saved?.[name];
    if (Number.isFinite(value)) result[name] = snapAxis(name, Math.min(1, Math.max(0, value)));
  }
  return result;
}

export function restoreInternals(saved) {
  const result = defaultInternals();
  for (const [name, { range, round }] of Object.entries(internals)) {
    const value = saved?.[name];
    if (Number.isFinite(value) && value >= range[0] && value <= range[1]) result[name] = round ? Math.round(value) : value;
  }
  return result;
}
