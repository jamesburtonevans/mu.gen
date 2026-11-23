// plain-language names for what the engine reports. the engine itself only deals in short ids

export const SECTION_LABELS = {
  intro: "Intro",
  low: "Low",
  mid: "Mid",
  high: "High",
  break: "Break",
  bloom: "Ambient",
};

export const MODE_LABELS = {
  phrygian: "phrygian",
  aeolian: "minor",
  dorian: "dorian",
  mixolydian: "mixolydian",
  ionian: "major",
  lydian: "lydian",
};

export const SLEEP_OPTIONS = [
  [0, "Off"], [5, "5 minutes"], [15, "15 minutes"], [30, "30 minutes"], [45, "45 minutes"], [60, "1 hour"], [90, "1.5 hours"], [120, "2 hours"],
];
