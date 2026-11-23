import { createRng } from "./rng.js";
import {
  brownNoise, fadeOut, highpass, lowpass, makeControl, makeLoop, normalizeRms,
  pinkNoise, readControl, reverse, rms,
} from "./dsp.js";

// organic ambience, rendered once per seed: layers of filtered noise (rumble, body, wind, soft air) with
// slowly wandering band centres and independent breathing. no grains, no resonators, nothing that ticks or rings.

const LAYERS = {
  // low rumble, above the bass register
  earth: { noise: brownNoise, bands: [[90, 170, 0.7]], span: 0.4, dry: 0.6, level: 0.05, post: { low: 230, high: 60, passes: 2 } },
  // warm low-mid body
  body: { noise: pinkNoise, bands: [[170, 300, 0.7], [280, 480, 0.7]], span: 0.6, dry: 0.15, level: 0.045, post: { low: 900, high: 110, passes: 2 } },
  // breath of air, the main band-passed body
  wind: {
    noise: pinkNoise, bands: [[260, 600, 0.7], [480, 1000, 0.7], [800, 1600, 0.8]], span: 0.9,
    dry: 0.25, level: 0.06, post: { low: [1100, 1700], high: 140, passes: 3 },
  },
  // soft high hush, gently rolled on both sides
  air: { noise: pinkNoise, bands: [], span: 0, dry: 1, level: 0.011, post: { low: [4200, 5200], high: 2200, passes: 2 } },
};

const CONTROL_HZ = 250;
const WARMUP_S = 1;

// state variable filter with a moving centre, band-pass output
function sweptBand(input, { sampleRate, centre, q }) {
  const out = new Float32Array(input.length);
  const damp = 1 / q;
  let low = 0;
  let band = 0;
  for (let i = 0; i < input.length; i++) {
    const f = 2 * Math.sin((Math.PI * Math.min(centre(i / sampleRate), sampleRate / 6)) / sampleRate);
    low += f * band;
    const high = input[i] - low - damp * band;
    band += f * high;
    out[i] = band;
  }
  const level = rms(out) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= level;
  return out;
}

function renderChannel(spec, rng, { sampleRate, seconds, fade }) {
  const total = Math.floor((WARMUP_S + seconds + fade) * sampleRate);
  const duration = total / sampleRate;
  const noise = spec.noise(rng, total);
  const out = new Float32Array(total);
  const bands = spec.bands.map(([lo, hi, q]) => {
    const home = rng.between(lo, hi);
    const drift = makeControl(rng, duration, rng.between(0.04, 0.2), CONTROL_HZ);
    const flutter = makeControl(rng, duration, rng.between(0.4, 1.4), CONTROL_HZ);
    const centre = (t) => home * 2 ** (spec.span * readControl(drift, CONTROL_HZ, t) + 0.12 * readControl(flutter, CONTROL_HZ, t));
    return { signal: sweptBand(noise, { sampleRate, centre, q: q * rng.between(0.8, 1.25) }), level: makeControl(rng, duration, rng.between(0.04, 0.22), CONTROL_HZ) };
  });
  for (const band of bands) {
    for (let i = 0; i < total; i++) out[i] += band.signal[i] * (0.45 + 0.55 * (readControl(band.level, CONTROL_HZ, i / sampleRate) * 0.5 + 0.5)) / Math.sqrt(bands.length);
  }
  if (spec.dry) {
    const body = Float32Array.from(noise);
    const level = rms(body) || 1;
    for (let i = 0; i < total; i++) out[i] += (body[i] / level) * spec.dry;
  }
  // slow gusts so the whole layer breathes
  const gust = makeControl(rng, duration, rng.between(0.1, 0.25), CONTROL_HZ);
  for (let i = 0; i < total; i++) out[i] *= 0.35 + 0.65 * (readControl(gust, CONTROL_HZ, i / sampleRate) * 0.5 + 0.5);

  const low = Array.isArray(spec.post.low) ? rng.between(...spec.post.low) : spec.post.low;
  lowpass(out, low, sampleRate, spec.post.passes);
  if (spec.post.high) highpass(out, spec.post.high, sampleRate, 1);

  return makeLoop(out, Math.floor(WARMUP_S * sampleRate), Math.floor(fade * sampleRate));
}

export function renderTextureLayer(name, { seed, sampleRate = 24000, seconds = 14, fade = 2 }) {
  const spec = LAYERS[name];
  const options = { sampleRate, seconds, fade };
  const salt = name.charCodeAt(0) * 977 + name.length;
  const channels = [0, 1].map((index) => renderChannel(spec, createRng(seed * 131 + salt + index * 7919), options));
  normalizeRms(channels, spec.level);
  return { channels, sampleRate };
}

// one-shot swell for gusts, or reversed for risers
export function renderSwell({ seed, sampleRate = 24000, seconds = 7, riser = false }) {
  const rng = createRng(seed * 17 + 5);
  const channels = [0, 1].map(() => {
    const total = Math.floor(seconds * sampleRate);
    const noise = pinkNoise(rng, total);
    const home = rng.between(250, 700);
    const sweep = rng.between(-0.8, 0.8);
    const out = new Float32Array(total);
    for (const [ratio, q] of [[1, 0.8], [1.9, 0.9]]) {
      const band = sweptBand(noise, { sampleRate, centre: (t) => home * ratio * 2 ** (sweep * (t / seconds - 0.5)), q });
      for (let i = 0; i < total; i++) out[i] += band[i] * 0.5;
    }
    for (let i = 0; i < total; i++) out[i] += noise[i] * 0.4;
    for (let i = 0; i < total; i++) out[i] *= Math.sin(Math.PI * (i / total) ** 0.7) ** 2;
    lowpass(out, rng.between(900, 1700), sampleRate, 3);
    highpass(out, 80, sampleRate, 1);
    return riser ? reverse(out) : out;
  });
  normalizeRms(channels, 0.1);
  channels.forEach((ch) => fadeOut(ch, 0.05, sampleRate));
  return { channels, sampleRate };
}
