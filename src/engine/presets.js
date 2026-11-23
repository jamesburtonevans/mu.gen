import { METERS } from "./meter.js";
import { emotionValue } from "./params.js";

// a preset is only a set of parameter values: any axes, plus any internals (key, evolutionRate, meter).
// leaving a value out leaves it as the user has it. a seed makes it a specific track, but built-in presets never carry one

const meter = (name) => Object.keys(METERS).indexOf(name) + 1;

export const DEFAULT_PRESETS = [
  {
    id: "focus", name: "Focus",
    axes: { emotion: emotionValue("peaceful"), pace: 0.5, energy: 0.35, density: 0.35, structure: 0.7, pulse: 0.4, space: 0.4, texture: 0.2, color: 0.4, brightness: 0.45 },
    internals: { evolutionRate: 0.2 },
  },
  {
    id: "sleep", name: "Sleep",
    axes: { emotion: emotionValue("dreamy"), pace: 0.05, energy: 0.05, density: 0.15, structure: 0.3, pulse: 0, space: 0.9, texture: 0.55, color: 0.15, brightness: 0.15 },
    internals: { evolutionRate: 0.1, meter: meter("6/8") },
  },
  {
    id: "relax", name: "Relax",
    axes: { emotion: emotionValue("tender"), pace: 0.25, energy: 0.2, density: 0.4, structure: 0.3, pulse: 0.2, space: 0.7, texture: 0.35, color: 0.4, brightness: 0.4 },
    internals: { evolutionRate: 0.3 },
  },
  {
    id: "meditate", name: "Meditate",
    axes: { emotion: emotionValue("peaceful"), pace: 0.1, energy: 0.1, density: 0.2, structure: 0.2, pulse: 0, space: 0.85, texture: 0.5, color: 0.3, brightness: 0.35 },
    internals: { evolutionRate: 0.15 },
  },
  {
    id: "morning", name: "Morning",
    axes: { emotion: emotionValue("hopeful"), pace: 0.5, energy: 0.45, density: 0.5, structure: 0.5, pulse: 0.35, space: 0.5, texture: 0.2, color: 0.6, brightness: 0.6 },
    internals: { evolutionRate: 0.4 },
  },
  {
    id: "energize", name: "Energize",
    axes: { emotion: emotionValue("happy"), pace: 0.75, energy: 0.75, density: 0.7, structure: 0.8, pulse: 0.85, space: 0.4, texture: 0.1, color: 0.6, brightness: 0.65 },
    internals: { evolutionRate: 0.5, meter: meter("4/4") },
  },
  {
    id: "late-night", name: "Late night",
    axes: { emotion: emotionValue("sad"), pace: 0.3, energy: 0.3, density: 0.4, structure: 0.4, pulse: 0.25, space: 0.7, texture: 0.3, color: 0.25, brightness: 0.3 },
    internals: { evolutionRate: 0.3 },
  },
  {
    id: "nostalgia", name: "Nostalgia",
    axes: { emotion: emotionValue("nostalgic"), pace: 0.25, energy: 0.2, density: 0.4, structure: 0.4, pulse: 0.1, space: 0.8, texture: 0.25, color: 0.35, brightness: 0.4 },
    internals: { evolutionRate: 0.25 },
  },
  {
    id: "soundscape", name: "Soundscape",
    axes: { emotion: emotionValue("dreamy"), pace: 0.15, energy: 0.15, density: 0.2, structure: 0.1, pulse: 0, space: 0.9, texture: 0.8, color: 0.5, brightness: 0.3 },
    internals: { evolutionRate: 0.2 },
  },
].map((preset) => ({ ...preset, builtin: true }));
