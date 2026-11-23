import { createEngine } from "./engine/engine.js";
import { createWebOutput } from "./platform/web.js";
import { createPresetStore } from "./platform/presets.js";
import { loadSettings, saveSettings } from "./platform/settings.js";
import { DEFAULT_PRESETS } from "./engine/presets.js";
import { mountApp } from "./ui/app.js";
import "./ui/style.css";

const saved = loadSettings();
const engine = createEngine({ initial: saved, onSleep: () => stop() });
const output = createWebOutput(engine.context, { onInterrupt: () => engine.pause({ immediate: true }), onPause: () => systemPause(), onPlay: () => play() });
const presetStore = createPresetStore();
let mix = Boolean(saved.mix);

const presets = {
  list: () => [...DEFAULT_PRESETS, ...presetStore.list()],
  subscribe: presetStore.subscribe,
  apply: (id) => {
    const preset = presets.list().find((p) => p.id === id);
    return preset ? engine.applyPreset(preset) : engine.clearPreset();
  },
  save: (name) => engine.applyPreset(presetStore.save({ name, ...engine.snapshot() })),
  remove: (id) => {
    presetStore.remove(id);
    if (engine.store.get().activePreset?.id === id) engine.clearPreset();
  },
};

async function start() {
  if (engine.store.get().running) return;
  // output.open() must run before any await in the click
  const playing = output.open({ mix });
  engine.output.connect(output.node);
  try {
    await engine.start();
  } catch (error) {
    engine.output.disconnect();
    output.close();
    // the audio context can be left dead by an interruption. a fresh page is the reliable way back, and settings are kept
    if (error.code === "context") location.reload();
    else throw error;
    return;
  }
  await playing.catch(() => {});
  output.setMetadata({ title: "mu.gen", artist: "generative" });
}

// Control Center and the lock screen derive "playing" from the media element itself, so unlike the in-app button the element
// must really be paused (after the fade) or the system flips back to playing and the user has to tap again
async function systemPause() {
  output.setPlaybackState("paused");
  await engine.pause({ immediate: true });
  output.hold();
}

async function pause() {
  await engine.pause();
  output.setPlaybackState("paused");
}

// the Play button and the lock screen both land here: first play, or carrying on from a pause
async function play() {
  const { running, paused } = engine.store.get();
  if (!running) return start();
  if (!paused) return;
  try {
    await output.play();
    await engine.resume();
    output.setPlaybackState("playing");
  } catch {
    // the session did not survive (a call, another app), so start fresh rather than sit silent
    await stop();
    await start();
  }
}

async function stop() {
  await engine.stop();
  engine.output.disconnect();
  output.close();
}

// coming back to a page whose audio was taken away while it looked like it was playing
document.addEventListener("visibilitychange", () => {
  const { running, paused } = engine.store.get();
  if (document.visibilityState === "visible" && running && !paused && engine.context.state !== "running") engine.pause({ immediate: true });
});

mountApp(document.querySelector("main"), {
  store: engine.store,
  axes: engine.axes,
  internals: engine.internals,
  noteNames: engine.noteNames,
  onPlay: play,
  onPause: pause,
  onAxis: engine.setAxis,
  onInternal: engine.setInternal,
  onRegenerate: engine.regenerate,
  onVolume: engine.setVolume,
  onSleep: engine.setSleep,
  mix,
  onMix: (value) => {
    mix = value;
    persist();
  },
  presets,
});

// remember where the user left off
if (saved.presetId) {
  const preset = presets.list().find((p) => p.id === saved.presetId);
  if (preset) engine.markPreset(preset);
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const state = engine.store.get();
    saveSettings({ axes: state.axes, internals: state.internals, volume: state.volume, sleepMinutes: state.sleepMinutes, presetId: state.activePreset?.id ?? null, mix });
  }, 300);
}
engine.store.subscribe(persist);
