import * as Tone from "tone";
import { createStore } from "./store.js";
import { createMixer } from "./mixer.js";

// placeholder sound and planner
const LOOKAHEAD_S = 12;
const TICK_MS = 1000;
const SCALE = ["C3", "D3", "E3", "G3", "A3", "C4", "D4", "E4", "G4", "A4", "C5"];

export function createEngine() {
  const store = createStore({ running: false, brightness: 0.4, density: 0.4 });
  const mixer = createMixer();

  const textureChannel = mixer.addChannel({ volume: -18, reverbSend: 0.6 });
  const noise = new Tone.Noise("pink");
  const noiseFilter = new Tone.Filter({ type: "lowpass", frequency: 800, Q: 2 });
  const sweep = new Tone.LFO({ frequency: 0.05, min: 300, max: 1400 });
  noise.chain(noiseFilter, textureChannel.input);
  sweep.connect(noiseFilter.frequency);

  const voiceChannel = mixer.addChannel({ volume: -10, reverbSend: 0.6 });
  const voice = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.4, decay: 0.6, sustain: 0.3, release: 3 },
  });
  const voiceFilter = new Tone.Filter({ type: "lowpass", frequency: 2000 });
  voice.chain(voiceFilter, voiceChannel.input);

  store.subscribe(({ brightness }) => {
    voiceFilter.frequency.rampTo(500 + brightness * 5000, 0.3);
    sweep.min = 150 + brightness * 800;
    sweep.max = 800 + brightness * 3500;
  });

  let timer = null;
  let plannedUntil = 0;

  function plan() {
    const { density } = store.get();
    const now = Tone.now();
    const to = now + LOOKAHEAD_S;
    const meanGap = 6 - 5 * density;

    let t = Math.max(plannedUntil, now + 0.1);
    while (true) {
      t += meanGap * (0.5 + Math.random());
      if (t >= to) break;
      const note = SCALE[Math.floor(Math.random() * SCALE.length)];
      voice.triggerAttackRelease(note, 2 + Math.random() * 2, t, 0.5 + Math.random() * 0.3);
    }
    plannedUntil = to;
  }

  return {
    store,
    output: mixer.master,
    context: Tone.getContext().rawContext,

    // call from a user gesture before any other await
    async start() {
      if (timer !== null) return;
      await Tone.start();
      await mixer.ready;
      noise.start();
      sweep.start();
      plannedUntil = 0;
      plan();
      timer = setInterval(plan, TICK_MS);
      store.set({ running: true });
    },

    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      noise.stop();
      sweep.stop();
      voice.releaseAll();
      store.set({ running: false });
    },

    setParam(key, value) {
      if (key !== "brightness" && key !== "density") return;
      store.set({ [key]: Math.min(1, Math.max(0, value)) });
    },
  };
}
