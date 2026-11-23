import * as Tone from "tone";
import { AudioContext as StandardAudioContext } from "standardized-audio-context";
import { createStore } from "./store.js";
import { createMixer } from "./mixer.js";
import { createInstruments } from "./instruments.js";
import { createComposer } from "./composer.js";
import { createRenderer } from "./renderer.js";
import { axes, internals, randomizeInternals, resolve, emotionFromMood, restoreAxes, restoreInternals, snapAxis } from "./params.js";
import { NOTE_NAMES } from "./theory.js";

// planned this far ahead, but only the next COMMIT_S is handed to the audio graph.
// the rest stays editable so parameter changes can re-plan it.
const PLAN_S = 12;
const COMMIT_S = 5;
const TICK_MS = 1000;
const REPLAN_DELAY_MS = 200;
const SLEW_S = 3;
const SILENCE_S = 1;
const FADE_IN_S = 3;
const FADE_CURVE = Float32Array.from({ length: 64 }, (_, i) => Math.sin((i / 63) * Math.PI * 0.5) ** 2);
const FADE_OUT_S = 0.3;
const MAX_CATCH_UP_S = 120;
const CONTEXT_RATE = 24000;
const PAUSE_FADE_S = 1;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let contextReady = false;

// the default "interactive" context uses the smallest audio buffers, which phones can't always fill in time and which crackle when they miss.
// nothing here reacts to the user within a few milliseconds, so use the large, steady buffers
function useSteadyContext() {
  if (contextReady) return;
  contextReady = true;
  // 32 kHz costs about a third less than 48 kHz and nothing is audible: the master is rolled off well below 16 kHz and the sounds are rendered at 16-24 kHz anyway
  try {
    Tone.setContext(new Tone.Context({ context: new StandardAudioContext({ latencyHint: "playback", sampleRate: CONTEXT_RATE }) }));
  } catch {
    Tone.setContext(new Tone.Context({ latencyHint: "playback" }));
  }
}

export function createEngine({ onSleep, initial = {} } = {}) {
  useSteadyContext();
  const startAxes = restoreAxes(initial.axes);
  const startInternals = restoreInternals(initial.internals);
  const store = createStore({
    running: false,
    axes: startAxes,
    internals: startInternals,
    resolved: resolve(startAxes, startInternals),
    status: { section: null, tonic: null, mode: null, meter: null },
    volume: Number.isFinite(initial.volume) ? clamp01(initial.volume) : 0.8,
    sleepMinutes: Number.isFinite(initial.sleepMinutes) && initial.sleepMinutes > 0 ? initial.sleepMinutes : 0,
    sleepLeft: 0,
    activePreset: null,
    paused: false,
    notice: null,
  });

  const mixer = createMixer();
  const composer = createComposer();
  const renderer = createRenderer();
  mixer.setSpace(store.get().resolved, 0);
  mixer.setVolume(store.get().volume, 0);

  let instruments = null;
  let queue = [];
  let timer = null;
  let replanTimer = null;
  let committedUntil = 0;
  let closing = Promise.resolve();
  let starting = false;
  let sleepFade = null;
  let sleepEnd = null;
  let sleepEndsAt = 0;
  let sleepRemaining = 0;
  let paused = false;
  let pausedWall = 0;
  let settling = Promise.resolve();
  let failures = 0;

  const params = () => store.get().resolved;

  function dispatch(event) {
    const now = Tone.now();
    if (event.time < now - 1) return;
    if (event.type === "bar") {
      setTimeout(() => {
        if (timer === null || paused) return;
        const { status } = store.get();
        store.set({ status: { ...status, section: event.section, meter: event.meter, tonic: event.tonicPc, mode: event.mode } });
        mixer.setTempo(event.tempo, 2);
      }, Math.max(0, (event.time - now) * 1000));
    } else if (event.type === "voice") {
      instruments?.evolve(event.role, event.seed, event.amount);
    } else if (event.type === "macro") {
      instruments?.setMacro(event.role, event.timbre, event.motion, event.ramp);
    } else if (event.time >= now) {
      instruments?.play(event);
    }
  }

  function plan() {
    const now = Tone.now();
    queue.push(...composer.planUntil(now + PLAN_S, params));
    queue.sort((a, b) => a.time - b.time);
    return now;
  }

  // counts down from now. the last minute fades out slowly, then the app stops itself
  function armSleep(remaining = store.get().sleepMinutes * 60000) {
    clearTimeout(sleepFade);
    clearTimeout(sleepEnd);
    mixer.resetSleep();
    const minutes = store.get().sleepMinutes;
    if (!minutes || timer === null) return;
    const total = remaining;
    const fade = Math.min(60000, total / 2);
    sleepEndsAt = Date.now() + total;
    sleepFade = setTimeout(() => mixer.fadeOut(fade / 1000), total - fade);
    sleepEnd = setTimeout(() => onSleep?.(), total);
    store.set({ sleepLeft: Math.ceil(total / 60000) });
  }

  // the engine can't recover from a broken graph or a planner that keeps throwing, so it stops and says so
  function fault(message) {
    store.set({ notice: message });
    stop();
  }

  function tick() {
    if (paused) return;
    try {
      step();
      failures = 0;
    } catch (error) {
      console.error(error);
      if (++failures >= 3) fault("Something went wrong with the audio, so it stopped. Press Play to start again.");
    }
    if (!mixer.inspect().finite) fault("The audio engine hit a problem and stopped. Press Play to start again.");
  }

  function step() {
    if (sleepEndsAt && store.get().sleepMinutes) {
      const left = Math.max(0, Math.ceil((sleepEndsAt - Date.now()) / 60000));
      if (left !== store.get().sleepLeft) store.set({ sleepLeft: left });
    }
    const now = plan();
    committedUntil = now + COMMIT_S;
    while (queue.length && queue[0].time < committedUntil) dispatch(queue.shift());
    composer.prune(now);
  }

  function replan() {
    if (timer === null) return;
    const from = Math.max(committedUntil, Tone.now() + 0.1);
    queue = [];
    composer.rewindTo(from);
    plan();
  }

  function applyParams(seconds) {
    instruments?.apply(params(), seconds);
    mixer.setSpace(params(), seconds);
  }

  function update(patch) {
    const next = { ...store.get(), ...patch };
    store.set({ ...patch, resolved: resolve(next.axes, next.internals) });
    applyParams(SLEW_S);
    clearTimeout(replanTimer);
    replanTimer = setTimeout(replan, REPLAN_DELAY_MS);
  }

  // after a call, another app's audio or a lock screen the context can stay suspended. try to wake it, but never hang on it
  async function wake() {
    const context = Tone.getContext().rawContext;
    for (let attempt = 0; attempt < 2 && context.state !== "running"; attempt++) {
      await Promise.race([Tone.start(), sleep(1500)]);
    }
    return context.state === "running";
  }

  // anything that stops the context while playing (a call, Siri, another app) pauses us, so the button never lies
  Tone.getContext().rawContext.addEventListener("statechange", () => {
    if (timer !== null && !paused && Tone.getContext().rawContext.state !== "running") pause({ immediate: true });
  });

  // stops where it is: the audio clock itself is frozen, so playing on continues from exactly the same moment
  // pausing silences the output and freezes the planner but never suspends the audio context: suspending and resuming is
  // where devices loop stale buffers, glitch pitch or leave scheduled notes dead. the clock keeps running silently and
  // the planner simply catches up, skipping what would have played
  function pause({ immediate = false } = {}) {
    if (timer === null || paused || starting) return settling;
    paused = true;
    pausedWall = Date.now();
    sleepRemaining = sleepEndsAt ? Math.max(0, sleepEndsAt - Date.now()) : 0;
    clearTimeout(sleepFade);
    clearTimeout(sleepEnd);
    store.set({ paused: true });
    settling = settle(immediate);
    return settling;
  }

  async function settle(immediate) {
    // the system may already have cut the audio when it asked us to pause, so that fade is short
    const seconds = immediate ? 0.35 : PAUSE_FADE_S;
    mixer.hush(seconds);
    // the element may only be paused once the fade has been heard, and what is heard trails the audio clock by the output latency
    const context = Tone.getContext().rawContext;
    const latency = (context.outputLatency || 0) + (context.baseLatency || 0);
    await sleep(seconds * 1000 + 200 + latency * 1000);
  }

  async function resume() {
    if (timer === null || !paused) return;
    await settling;
    // a long pause would mean planning an hour of music at once, and a dead context can't be trusted: start fresh instead
    if ((Date.now() - pausedWall) / 1000 > MAX_CATCH_UP_S) throw Object.assign(new Error("paused too long"), { code: "stale" });
    if (!(await wake())) throw Object.assign(new Error("audio context would not resume"), { code: "context" });
    mixer.unhush(0.4);
    paused = false;
    store.set({ paused: false });
    if (sleepRemaining) armSleep(sleepRemaining);
  }

  async function start() {
    if (timer !== null || starting) return;
    starting = true;
    store.set({ notice: null });
    try {
      if (!(await wake())) throw Object.assign(new Error("audio context would not start"), { code: "context" });
      await closing;
      await launch();
    } finally {
      starting = false;
    }
  }

  async function launch() {
    const { seed } = params();
    instruments = createInstruments(mixer, seed, { renderer });
    await instruments.warm();
    applyParams(0);
    const begin = Tone.now() + 0.1;
    mixer.master.gain.cancelScheduledValues(0);
    mixer.master.gain.value = 0;
    mixer.master.gain.setValueAtTime(0, begin);
    mixer.master.gain.setValueCurveAtTime(FADE_CURVE, begin + SILENCE_S, FADE_IN_S);
    // nothing sounds before the fade begins, so no start-up transient can reach the reverb ahead of the music
    instruments.start(begin + SILENCE_S);
    mixer.resetSleep();
    mixer.unhush(0);
    paused = false;
    failures = 0;

    queue = [];
    composer.start(begin + SILENCE_S, seed);
    tick();
    timer = setInterval(tick, TICK_MS);
    armSleep();
    store.set({ running: true, paused: false, status: { section: null, tonic: null, mode: null, meter: null } });
  }

  async function stop() {
    if (timer === null) return;
    clearInterval(timer);
    clearTimeout(replanTimer);
    clearTimeout(sleepFade);
    clearTimeout(sleepEnd);
    sleepEndsAt = 0;
    sleepRemaining = 0;
    paused = false;
    timer = null;
    queue = [];
    store.set({ running: false, paused: false, status: { section: null, tonic: null, mode: null, meter: null } });

    // notes already handed to the audio graph can't be cancelled, so fade out and drop the whole graph
    mixer.master.gain.rampTo(0, FADE_OUT_S);
    const finished = instruments;
    instruments = null;
    closing = sleep(FADE_OUT_S * 1000 + 50).then(() => finished.dispose());
    await closing;
  }

  async function restartWith(patch) {
    const wasRunning = timer !== null;
    if (wasRunning) await stop();
    update(patch);
    if (wasRunning) await start();
  }

  return {
    store,
    axes,
    internals,
    noteNames: NOTE_NAMES,
    output: mixer.output,
    context: Tone.getContext().rawContext,

    // call from a user gesture before any other await
    start,
    stop,
    pause,
    resume,

    setAxis(name, value) {
      if (!(name in axes)) return;
      update({ axes: { ...store.get().axes, [name]: snapAxis(name, clamp01(value)) }, activePreset: null });
    },

    // a new seed means new instruments, so it restarts playback
    setInternal(name, value) {
      if (!(name in internals)) return;
      const patch = { internals: { ...store.get().internals, [name]: value } };
      if (name === "seed") return restartWith(patch);
      return update({ ...patch, activePreset: null });
    },

    // a fresh seed and internals, with the sliders left alone. an active preset keeps the internals it sets
    regenerate() {
      const { internals: current, activePreset } = store.get();
      const { seed: _seed, ...fixed } = activePreset?.internals ?? {};
      return restartWith({ internals: { ...randomizeInternals(Math.random, current), ...fixed } });
    },

    // the values a preset would hold right now. no seed, so a loaded preset still gives a new track
    snapshot() {
      const { axes: current, internals: values } = store.get();
      const { seed: _seed, ...rest } = values;
      return { axes: { ...current }, internals: rest };
    },

    // sets whatever the preset specifies. a preset with a seed restarts playback on that exact track
    applyPreset(preset) {
      const next = store.get();
      const nextAxes = { ...next.axes };
      const presetAxes = { ...preset.axes };
      if (!("emotion" in presetAxes) && "mood" in presetAxes) presetAxes.emotion = emotionFromMood(presetAxes.mood);
      for (const [name, value] of Object.entries(presetAxes)) if (name in axes) nextAxes[name] = snapAxis(name, clamp01(value));
      const nextInternals = { ...next.internals };
      for (const [name, value] of Object.entries(preset.internals ?? {})) if (name in internals) nextInternals[name] = value;
      const patch = { axes: nextAxes, internals: nextInternals, activePreset: preset };
      return nextInternals.seed !== next.internals.seed ? restartWith(patch) : update(patch);
    },

    clearPreset() {
      store.set({ activePreset: null });
    },

    // marks a preset as current without applying it, for restoring where the user left off
    markPreset(preset) {
      store.set({ activePreset: preset });
    },

    setVolume(value) {
      const volume = clamp01(value);
      store.set({ volume });
      mixer.setVolume(volume);
    },

    // minutes until playback fades out and stops, 0 for never
    setSleep(minutes) {
      store.set({ sleepMinutes: minutes, sleepLeft: minutes });
      // while paused the countdown waits too, and starts from the new length when playing resumes
      if (paused) sleepRemaining = minutes * 60000;
      else armSleep();
    },
  };
}
