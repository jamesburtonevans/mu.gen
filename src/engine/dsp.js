// pure offline DSP used to render sounds. no audio context, deterministic from an rng.

export const TWO_PI = Math.PI * 2;

export function whiteNoise(rng, length) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = rng() * 2 - 1;
  return out;
}

export function pinkNoise(rng, length) {
  const out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = rng() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return out;
}

export function brownNoise(rng, length) {
  const out = new Float32Array(length);
  let last = 0;
  for (let i = 0; i < length; i++) {
    last = (last + 0.02 * (rng() * 2 - 1)) / 1.02;
    out[i] = last * 3.5;
  }
  return out;
}

// smooth random curve in [-1, 1] changing at about rateHz, stored at controlHz
export function makeControl(rng, seconds, rateHz, controlHz = 500) {
  const points = Array.from({ length: Math.ceil(seconds * rateHz) + 3 }, () => rng() * 2 - 1);
  const out = new Float32Array(Math.ceil(seconds * controlHz) + 2);
  for (let i = 0; i < out.length; i++) {
    const x = (i / controlHz) * rateHz;
    const k = Math.floor(x);
    const smooth = (1 - Math.cos((x - k) * Math.PI)) / 2;
    out[i] = points[k] * (1 - smooth) + points[k + 1] * smooth;
  }
  return out;
}

export function readControl(control, controlHz, time) {
  const x = Math.min(time * controlHz, control.length - 2);
  const i = Math.floor(x);
  return control[i] + (control[i + 1] - control[i]) * (x - i);
}

export function onePoleLowpass(buffer, cutoff, sampleRate) {
  const a = 1 - Math.exp((-TWO_PI * cutoff) / sampleRate);
  let y = 0;
  for (let i = 0; i < buffer.length; i++) {
    y += a * (buffer[i] - y);
    buffer[i] = y;
  }
  return buffer;
}

export function onePoleHighpass(buffer, cutoff, sampleRate) {
  const a = 1 - Math.exp((-TWO_PI * cutoff) / sampleRate);
  let y = 0;
  for (let i = 0; i < buffer.length; i++) {
    y += a * (buffer[i] - y);
    buffer[i] -= y;
  }
  return buffer;
}

// each pass adds 6 dB/oct of slope
export function lowpass(buffer, cutoff, sampleRate, passes = 2) {
  for (let i = 0; i < passes; i++) onePoleLowpass(buffer, cutoff, sampleRate);
  return buffer;
}

export function highpass(buffer, cutoff, sampleRate, passes = 1) {
  for (let i = 0; i < passes; i++) onePoleHighpass(buffer, cutoff, sampleRate);
  return buffer;
}

// feedback comb with a damped loop. on noise it rings at freq and its harmonics, like air across a pipe.
// the delay can wobble through `wobble` (a control curve), which gives slow pitch drift.
export function comb(input, { sampleRate, freq, feedback, damping, wobbleDepth = 0, wobble = null, controlHz = 500 }) {
  const out = new Float32Array(input.length);
  const w = (TWO_PI * freq) / sampleRate;
  const loopDelay = Math.atan2((1 - damping) * Math.sin(w), 1 - (1 - damping) * Math.cos(w)) / w;
  const baseDelay = Math.max(2, sampleRate / freq - loopDelay);
  let size = 1;
  while (size < baseDelay * (1 + wobbleDepth) + 4) size <<= 1;
  const mask = size - 1;
  const ring = new Float32Array(size);
  let write = 0;
  let low = 0;

  for (let i = 0; i < input.length; i++) {
    const delay = wobble ? baseDelay * (1 + wobbleDepth * readControl(wobble, controlHz, i / sampleRate)) : baseDelay;
    const position = write - delay;
    const index = Math.floor(position);
    const frac = position - index;
    const delayed = ring[index & mask] + (ring[(index + 1) & mask] - ring[index & mask]) * frac;
    low += damping * (delayed - low);
    const y = input[i] + feedback * low;
    ring[write & mask] = y;
    write++;
    out[i] = y;
  }
  return out;
}

export function rms(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / Math.max(1, buffer.length));
}

export function peak(buffer) {
  let max = 0;
  for (let i = 0; i < buffer.length; i++) max = Math.max(max, Math.abs(buffer[i]));
  return max;
}

// scales every channel by the same factor so the combined rms matches target
export function normalizeRms(channels, target) {
  const power = channels.reduce((sum, ch) => sum + rms(ch) ** 2, 0) / channels.length;
  const scale = power > 0 ? target / Math.sqrt(power) : 0;
  channels.forEach((ch) => {
    for (let i = 0; i < ch.length; i++) ch[i] *= scale;
  });
  return channels;
}

export function normalizePeak(channels, target = 0.9) {
  const max = Math.max(...channels.map(peak));
  const scale = max > 0 ? target / max : 0;
  channels.forEach((ch) => {
    for (let i = 0; i < ch.length; i++) ch[i] *= scale;
  });
  return channels;
}

// removes the first `trim` samples and crossfades the last `fade` samples into the start, so the result loops seamlessly
export function makeLoop(buffer, trim, fade) {
  const length = buffer.length - trim - fade;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = buffer[trim + i];
  for (let i = 0; i < fade; i++) {
    const angle = ((i + 0.5) / fade) * (Math.PI / 2);
    out[i] = buffer[trim + i] * Math.sin(angle) + buffer[trim + length + i] * Math.cos(angle);
  }
  return out;
}

// short fade so a rendered one-shot never ends on a click
export function fadeOut(buffer, seconds, sampleRate) {
  const n = Math.min(buffer.length, Math.floor(seconds * sampleRate));
  for (let i = 0; i < n; i++) buffer[buffer.length - 1 - i] *= i / n;
  return buffer;
}

export function reverse(buffer) {
  return Float32Array.from(buffer).reverse();
}

// two-pole resonator: rings at freq and dies with time constant tau (seconds)
export function resonator(input, { sampleRate, freq, tau }) {
  const out = new Float32Array(input.length);
  const r = Math.exp(-1 / (tau * sampleRate));
  const w = (TWO_PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
  const a1 = 2 * r * Math.cos(w);
  const a2 = -r * r;
  const gain = (1 - r) * Math.sin(w);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const y = gain * input[i] + a1 * y1 + a2 * y2;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

// sum of resonators excited by the same input. modes: [{ freq, tau, amp }]
export function modalBank(input, modes, sampleRate) {
  const out = new Float32Array(input.length);
  for (const { freq, tau, amp = 1 } of modes) {
    if (freq >= sampleRate * 0.45) continue;
    const ring = resonator(input, { sampleRate, freq, tau });
    for (let i = 0; i < out.length; i++) out[i] += ring[i] * amp;
  }
  return out;
}

// lets a buffer excite a few resonances, like the wood of an instrument body, blended in by mix
export function bodyResonate(buffer, { sampleRate, freqs, tau = 0.04, mix }) {
  if (mix <= 0.01) return buffer;
  const wet = modalBank(buffer, freqs.map((freq, i) => ({ freq, tau: tau / (1 + 0.5 * i), amp: 1 / (1 + 0.4 * i) })), sampleRate);
  const scale = (rms(buffer) || 1) / (rms(wet) || 1);
  for (let i = 0; i < buffer.length; i++) buffer[i] = buffer[i] * (1 - 0.4 * mix) + wet[i] * scale * mix;
  return buffer;
}

// short soft impulse, as from a mallet or fingertip. hardness 0..1 sets how bright it is
export function mallet(rng, { sampleRate, ms, hardness }) {
  const length = Math.max(8, Math.floor((ms / 1000) * sampleRate));
  const out = whiteNoise(rng, length);
  lowpass(out, 400 + 5000 * hardness ** 1.5, sampleRate, 2);
  for (let i = 0; i < length; i++) out[i] *= Math.sin((Math.PI * (i + 0.5)) / length);
  return out;
}
