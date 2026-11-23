import { createRng } from "./rng.js";

// stereo impulse response: sparse early reflections into a dense tail whose highs decay faster
export function createImpulse(seconds, sampleRate, seed) {
  const length = Math.floor(seconds * sampleRate);
  const channels = [new Float32Array(length), new Float32Array(length)];
  const preDelay = Math.floor(0.012 * sampleRate);

  channels.forEach((data, channel) => {
    const rng = createRng(seed * 31 + channel);
    let low = 0;

    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / sampleRate;
      const decay = Math.exp((-6.91 * t) / seconds);
      // one-pole lowpass whose cutoff falls as the tail ages
      const brightness = 0.75 - 0.69 * (1 - Math.exp((-3 * t) / seconds));
      low += brightness * (rng() * 2 - 1 - low);
      const fadeIn = Math.min(1, t / 0.02);
      data[i] = low * decay * fadeIn;
    }

    for (let tap = 0; tap < 10; tap++) {
      const at = preDelay + Math.floor(rng.between(0.004, 0.08) * sampleRate);
      data[at] += (rng() < 0.5 ? -1 : 1) * rng.between(0.15, 0.5) * Math.exp(-tap * 0.18);
    }
  });

  let energy = 0;
  for (const data of channels) for (let i = 0; i < data.length; i++) energy += data[i] * data[i];
  const scale = 1 / Math.sqrt(energy / 2);
  for (const data of channels) for (let i = 0; i < data.length; i++) data[i] *= scale;

  return channels;
}

// equal-power weights across the impulse responses for a length position of 0..1
export function tailWeights(length, count) {
  const position = length * (count - 1);
  const raw = Array.from({ length: count }, (_, i) => Math.max(0, 1 - Math.abs(position - i)));
  const norm = Math.sqrt(raw.reduce((sum, w) => sum + w * w, 0));
  return raw.map((w) => w / norm);
}
