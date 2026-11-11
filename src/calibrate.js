// Probability calibration: weighted isotonic regression (pool-adjacent-violators),
// reliability bins, expected calibration error and Brier score.

// points: [{p, y, w}] where y is an observed frequency in [0,1] and w its weight.
export function fitIsotonic(points) {
  const pts = points.slice().sort((a, b) => a.p - b.p);
  const blocks = [];
  for (const q of pts) {
    blocks.push({ lo: q.p, hi: q.p, sumW: q.w, sumWY: q.w * q.y, sumWP: q.w * q.p });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sumWY / a.sumW <= b.sumWY / b.sumW) break;
      blocks.splice(blocks.length - 2, 2, {
        lo: a.lo, hi: b.hi, sumW: a.sumW + b.sumW, sumWY: a.sumWY + b.sumWY, sumWP: a.sumWP + b.sumWP,
      });
    }
  }
  // knots at each block's weighted mean prediction -> block mean outcome
  return blocks.map((b) => ({ x: b.sumWP / b.sumW, y: b.sumWY / b.sumW, w: b.sumW }));
}

export function applyIsotonic(knots, p) {
  if (!knots || !knots.length) return p;
  if (p <= knots[0].x) return knots[0].y;
  const last = knots[knots.length - 1];
  if (p >= last.x) return last.y;
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1];
    const b = knots[i];
    if (p <= b.x) return a.y + ((b.y - a.y) * (p - a.x)) / (b.x - a.x || 1);
  }
  return last.y;
}

export function reliability(points, edges = [0, 0.05, 0.1, 0.2, 0.3, 0.45, 0.6, 1.0001]) {
  const bins = edges.slice(0, -1).map((lo, i) => ({ lo, hi: edges[i + 1], w: 0, sp: 0, sy: 0 }));
  for (const q of points) {
    const b = bins.find((x) => q.p >= x.lo && q.p < x.hi) || bins[bins.length - 1];
    b.w += q.w;
    b.sp += q.w * q.p;
    b.sy += q.w * q.y;
  }
  return bins.filter((b) => b.w > 0).map((b) => ({ lo: b.lo, hi: b.hi, n: b.w, pred: b.sp / b.w, obs: b.sy / b.w }));
}

export function ece(points, edges) {
  const bins = reliability(points, edges);
  const W = bins.reduce((s, b) => s + b.n, 0);
  return bins.reduce((s, b) => s + (b.n / W) * Math.abs(b.pred - b.obs), 0);
}

export function brier(points) {
  // y is a frequency over w Bernoulli draws: E[(p - Y)^2] = (p - y)^2 + y(1 - y)
  let s = 0;
  let W = 0;
  for (const q of points) {
    s += q.w * ((q.p - q.y) ** 2 + q.y * (1 - q.y));
    W += q.w;
  }
  return s / W;
}

export function wilson(k, n, z = 1.96) {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - r) / d, (c + r) / d];
}
