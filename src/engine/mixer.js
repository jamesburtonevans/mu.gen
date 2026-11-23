import * as Tone from "tone";
import { createImpulse, tailWeights } from "./reverb.js";

const TAIL_SECONDS = [1.5, 4, 7];

export function createMixer() {
  const master = new Tone.Gain(1);
  const widener = new Tone.StereoWidener(0.5);
  // headroom before the limiter, so it only catches peaks instead of working all the time
  const headroom = new Tone.Gain(1.6);
  // glue compressor ahead of the limiter: peaks are squeezed smoothly so the limiter and clipper almost never have to act
  const glue = new Tone.Compressor({ threshold: -12, ratio: 2, attack: 0.02, release: 0.3, knee: 10 });
  // the native compressor adds makeup gain of its own (about 1.6x at these settings), which is taken back out here
  const glueMakeup = new Tone.Gain(0.63);
  const limiter = new Tone.Limiter(-1.5);
  // the limiter can overshoot, so a soft clipper guarantees nothing exceeds full scale
  const ceiling = new Tone.WaveShaper((x) => {
    const knee = 0.85;
    const magnitude = Math.abs(x);
    return magnitude < knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((magnitude - knee) / (1 - knee)));
  }, 4096);
  // overall warm curve: the top end is always tucked down, whatever the sliders say
  const tilt = new Tone.Filter({ type: "highshelf", frequency: 2000, gain: -6 });
  const rolloff = new Tone.Filter({ type: "lowpass", frequency: 7500, Q: 0.4 });
  // a little low-mid body under everything
  const warmth = new Tone.Filter({ type: "lowshelf", frequency: 220, gain: 2.5 });
  // below about 40 Hz there is nothing to hear on a phone or earbuds, but it eats headroom and makes small speakers work for nothing
  const dcBlock = new Tone.Filter({ type: "highpass", frequency: 40, Q: 0.5, rolloff: -24 });
  master.chain(widener, warmth, tilt, rolloff, dcBlock, headroom, glue, glueMakeup, limiter, ceiling);
  ceiling.oversample = "2x";
  // after the ceiling, so they only ever turn the output down. the sleep fade and the pause are separate from the start fade
  const sleep = new Tone.Gain(1);
  const hold = new Tone.Gain(1);
  const trim = new Tone.Gain(0.9);
  ceiling.chain(sleep, hold, trim);
  const probe = new Tone.Analyser({ type: "waveform", size: 2048 });
  ceiling.connect(probe);

  // fixed impulse responses crossfaded by gain, so changing length never rebuilds anything
  const reverbBus = new Tone.Gain(1);
  const reverbReturn = new Tone.Gain(0.3);
  const sampleRate = Tone.getContext().sampleRate;
  const tails = TAIL_SECONDS.map((seconds, index) => {
    const impulse = Tone.ToneAudioBuffer.fromArray(createImpulse(seconds, sampleRate, index + 1));
    const convolver = new Tone.Convolver({ url: impulse, normalize: false });
    const level = new Tone.Gain(0);
    convolver.chain(level, reverbReturn);
    return { convolver, level, active: false, timer: null };
  });
  reverbReturn.connect(master);

  // shared ping-pong delay, set to a dotted eighth of the tempo. the repeats are darkened and bounce hard left and right
  const delayBus = new Tone.Gain(1);
  const delay = new Tone.PingPongDelay({ delayTime: 0.375, feedback: 0.38, wet: 1 });
  const delayTone = new Tone.Filter({ type: "lowpass", frequency: 2400, Q: 0.4 });
  const delayReturn = new Tone.Gain(0.4);
  delayBus.chain(delay, delayTone, delayReturn, master);

  function addChannel({ volume = 0, pan = 0, reverbSend = 0, delaySend = 0, strip: levelled = false } = {}) {
    const input = new Tone.Channel({ volume, pan, channelCount: 2 });
    // every instrument is levelled on its own before the mix, so no single voice can drive the master into the limiter
    // only the loud, sustained instruments get one; on the quiet ones it cost CPU for no audible effect
    const strip = levelled ? new Tone.Compressor({ threshold: -14, ratio: 4, attack: 0.03, release: 0.5, knee: 12 }) : null;
    const stripMakeup = levelled ? new Tone.Gain(0.65) : input;
    if (levelled) input.chain(strip, stripMakeup, master);
    else input.connect(master);

    const send = new Tone.Gain(reverbSend);
    stripMakeup.connect(send);
    send.connect(reverbBus);
    const echo = new Tone.Gain(delaySend);
    stripMakeup.connect(echo);
    echo.connect(delayBus);

    return {
      input,
      reverbSend: send,
      dispose() {
        input.dispose();
        strip?.dispose();
        if (levelled) stripMakeup.dispose();
        send.dispose();
        echo.dispose();
      },
    };
  }

  function setSpace({ reverbMix, reverbLength, stereoWidth, tiltDb }, seconds) {
    const set = (param, value) => (seconds > 0 ? param.rampTo(value, seconds) : (param.value = value));
    set(reverbReturn.gain, reverbMix);
    set(widener.width, stereoWidth);
    set(tilt.gain, tiltDb);
    // a tail with no weight is disconnected so it stops costing CPU
    tailWeights(reverbLength, tails.length).forEach((weight, i) => {
      const tail = tails[i];
      clearTimeout(tail.timer);
      if (weight > 0.001 && !tail.active) {
        reverbBus.connect(tail.convolver);
        tail.active = true;
      } else if (weight <= 0.001 && tail.active) {
        tail.timer = setTimeout(() => {
          reverbBus.disconnect(tail.convolver);
          tail.active = false;
        }, seconds * 1000 + 500);
      }
      set(tail.level.gain, weight);
    });
  }

  const setTempo = (bpm, seconds) => delay.delayTime.rampTo(Math.min(1.2, (60 / bpm) * 0.75), seconds);

  const setVolume = (value, seconds = 0.1) => trim.gain.rampTo(1.4 * value ** 2, seconds);
  const fadeOut = (seconds) => sleep.gain.rampTo(0, seconds);
  const resetSleep = () => {
    sleep.gain.cancelScheduledValues(0);
    sleep.gain.value = 1;
  };

  // pause and resume fades follow a half cosine, so both ends arrive with zero slope and nothing clicks, even if one interrupts the other
  const fade = { from: 1, to: 1, start: 0, seconds: 0 };
  const holdLevel = () => {
    const t = Math.min(1, (Tone.immediate() - fade.start) / Math.max(fade.seconds, 1e-6));
    return fade.from + (fade.to - fade.from) * (0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, t)));
  };
  const fadeHold = (to, seconds) => {
    const from = holdLevel();
    // not Tone.now(): that adds the scheduling look-ahead, which would start a short fade late and let the caller cut it off
    const now = Tone.immediate();
    hold.gain.cancelAndHoldAtTime(now);
    Object.assign(fade, { from, to, start: now, seconds });
    if (seconds <= 0 || from === to) {
      hold.gain.setValueAtTime(to, now);
      return;
    }
    const curve = Float32Array.from({ length: 128 }, (_, i) => from + (to - from) * (0.5 - 0.5 * Math.cos((Math.PI * i) / 127)));
    hold.gain.setValueCurveAtTime(curve, now, seconds);
  };
  const hush = (seconds) => fadeHold(0, seconds);
  const unhush = (seconds) => fadeHold(1, seconds);
  const silence = () => fadeHold(0, 0);

  // a watchdog reads the final output: a NaN or infinity in the graph never recovers by itself
  const inspect = () => {
    const samples = probe.getValue();
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      if (!Number.isFinite(samples[i])) return { finite: false, peak: Infinity };
      peak = Math.max(peak, Math.abs(samples[i]));
    }
    return { finite: true, peak };
  };

  return { master, output: trim, addChannel, setSpace, setTempo, setVolume, fadeOut, resetSleep, hush, unhush, silence, inspect };
}
