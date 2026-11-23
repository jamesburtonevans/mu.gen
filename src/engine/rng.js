export function createRng(seed) {
  let state = seed | 0;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.between = (a, b) => a + (b - a) * next();
  next.int = (a, b) => Math.floor(next.between(a, b + 1));
  next.choose = (list) => list[Math.floor(next() * list.length)];
  return next;
}
