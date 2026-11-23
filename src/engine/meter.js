// steps are sixteenths. starts are the beat boundaries (a dotted quarter in compound meters), strong the heavy ones
const make = (name, steps, starts, strong) => ({ name, steps, starts, strong, half: Math.floor(steps / 4) * 2 });

export const METERS = Object.fromEntries([
  make("4/4", 16, [0, 4, 8, 12], [0, 8]),
  make("3/4", 12, [0, 4, 8], [0]),
  make("6/8", 12, [0, 6], [0]),
  make("12/8", 24, [0, 6, 12, 18], [0, 12]),
  make("5/4", 20, [0, 4, 8, 12, 16], [0, 12]),
  make("7/8", 14, [0, 4, 8], [0]),
  make("9/8", 18, [0, 6, 12], [0]),
].map((m) => [m.name, m]));

// same bar length, different grouping, so a section can slip into a hemiola
export const ALTERNATE = { "3/4": "6/8", "6/8": "3/4" };

// weighted by repetition: 4/4, waltz and compound time are the home meters, odd ones are rare colour
export const METER_CHOICES = ["4/4", "4/4", "4/4", "4/4", "3/4", "3/4", "6/8", "6/8", "12/8", "5/4", "7/8", "9/8"];
