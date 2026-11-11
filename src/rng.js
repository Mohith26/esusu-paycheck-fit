// Small seeded PRNG utilities (mulberry32 + Box-Muller). Deterministic across Node and browsers.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Derive an independent stream from a parent seed and a label (FNV-1a on the label).
export function substream(seed, label) {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  const s = String(label);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return mulberry32(h);
}

export function normal(rng) {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function lognormalMean(rng, mean, cv) {
  // lognormal with the given arithmetic mean and coefficient of variation
  const s2 = Math.log(1 + cv * cv);
  const mu = Math.log(mean) - s2 / 2;
  return Math.exp(mu + Math.sqrt(s2) * normal(rng));
}

export function poisson(rng, lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function uniform(rng, lo, hi) {
  return lo + (hi - lo) * rng();
}
