// Population backtest. For each synthetic renter: learn from Feb-Nov 9 transactions only,
// recommend Split Pay dates, then score every plan against futures drawn from the true
// generator (which the forecaster never sees). Writes data/eval.json for the page.
//   node scripts/evaluate.mjs [renters=3000] [futures=20] [paths=800]
import { writeFileSync } from 'node:fs';
import { makeRenter, realize, AS_OF, TODAY, HORIZON_END } from '../src/generate.js';
import { analyze, simulatePaths } from '../src/forecast.js';
import { standardPlans, optimizeSplit, evaluatePlan, RULES } from '../src/plan.js';
import { fitIsotonic, applyIsotonic, reliability, ece, brier, wilson } from '../src/calibrate.js';

const N = Number(process.argv[2] || 3000);
const F = Number(process.argv[3] || 20);
const P = Number(process.argv[4] || 800);
const SEED0 = 5000;
const CANDIDATE_MIN = 0.1; // a renter is a Split Pay candidate if paying in full looks risky
const MIN_BALANCE = -100; // ...and the account is not already deep in overdraft (a plausible approval)

const rows = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const seed = SEED0 + i;
  const renter = makeRenter(seed);
  const model = analyze(renter.history, AS_OF);
  const paths = simulatePaths(model, renter.balance, TODAY, HORIZON_END, P, seed * 31 + 7);
  const plans = standardPlans(renter.profile.rent);
  const pred = {};
  for (const k of Object.keys(plans)) pred[k] = evaluatePlan(paths, plans[k]).pShort;
  const opt = optimizeSplit(paths, renter.profile.rent);
  plans.splitFit = opt.best.plan;
  pred.splitFit = opt.best.ev.pShort;
  const real = {};
  const over = {};
  const inst = {}; // Split Pay installments only (the lender's repayment risk)
  for (const k of Object.keys(plans)) { real[k] = 0; over[k] = 0; inst[k] = 0; }
  for (let f = 0; f < F; f++) {
    const fs = seed * 1000 + f; // same future draw for every plan (common random numbers)
    for (const k of Object.keys(plans)) {
      const out = realize(renter, plans[k], fs);
      if (out.results.some((x) => x.short)) real[k]++;
      if (out.results.some((x) => x.short && x.role !== 'Down payment' && x.role !== 'Rent')) inst[k]++;
      let neg = false;
      for (const v of out.eod.values()) if (v < 0) { neg = true; break; }
      if (neg) over[k]++;
    }
  }
  const std = plans.splitStandard.debits.map((d) => d.day);
  const fit = plans.splitFit.debits.map((d) => d.day);
  rows.push({
    seed,
    split: i % 2 === 0 ? 'calibration' : 'test',
    archetype: renter.profile.archetype,
    candidate: pred.full >= CANDIDATE_MIN && renter.balance >= MIN_BALANCE,
    pred,
    real: Object.fromEntries(Object.entries(real).map(([k, v]) => [k, v / F])),
    over: Object.fromEntries(Object.entries(over).map(([k, v]) => [k, v / F])),
    inst: Object.fromEntries(Object.entries(inst).map(([k, v]) => [k, v / F])),
    moved: std.some((d, j) => d !== fit[j]),
    shiftDays: std.reduce((s, d, j) => s + Math.abs(d - fit[j]), 0),
    detected: { streams: model.streams.length, bills: model.bills.length, trueBills: renter.profile.bills.length },
  });
  if ((i + 1) % 50 === 0) console.error(`${i + 1}/${N} renters, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const PLAN_KEYS = ['full', 'affirm', 'splitStandard', 'splitFit'];
const cand = rows.filter((r) => r.candidate);
const cal = cand.filter((r) => r.split === 'calibration');
const test = cand.filter((r) => r.split === 'test');
const pts = (rs, map) => rs.flatMap((r) => PLAN_KEYS.map((k) => ({ p: map ? applyIsotonic(map, r.pred[k]) : r.pred[k], y: r.real[k], w: F })));

const knots = fitIsotonic(pts(cal));
const rawTest = pts(test);
const calTest = pts(test, knots);

function rate(rs, key, field = 'real') {
  const k = Math.round(rs.reduce((s, r) => s + r[field][key] * F, 0));
  const n = rs.length * F;
  return { rate: k / n, k, n, ci: wilson(k, n) };
}

const byArch = {};
for (const a of ['biweekly', 'semimonthly', 'weekly', 'gig', 'mixed']) {
  const rs = test.filter((r) => r.archetype === a);
  if (!rs.length) continue;
  byArch[a] = { renters: rs.length, standard: rate(rs, 'splitStandard').rate, fit: rate(rs, 'splitFit').rate };
}

const std = rate(test, 'splitStandard');
const fit = rate(test, 'splitFit');
const out = {
  generated: new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' }),
  config: { renters: N, futures: F, paths: P, seedStart: SEED0, candidateMin: CANDIDATE_MIN, minBalance: MIN_BALANCE, cycle: 'December 2026 rent', rules: { downShare: RULES.downShare } },
  population: {
    renters: rows.length,
    candidates: cand.length,
    calibrationRenters: cal.length,
    testRenters: test.length,
    detection: {
      payrollFound: rows.filter((r) => r.archetype !== 'gig').filter((r) => r.detected.streams >= 1).length / rows.filter((r) => r.archetype !== 'gig').length,
      billRecall: rows.reduce((s, r) => s + Math.min(r.detected.bills, r.detected.trueBills), 0) / rows.reduce((s, r) => s + r.detected.trueBills, 0),
    },
  },
  test: {
    missed: Object.fromEntries(PLAN_KEYS.map((k) => [k, rate(test, k)])),
    overdraft: Object.fromEntries(PLAN_KEYS.map((k) => [k, rate(test, k, 'over')])),
    installments: Object.fromEntries(PLAN_KEYS.map((k) => [k, rate(test, k, 'inst')])),
    relativeReduction: std.rate > 0 ? 1 - fit.rate / std.rate : 0,
    movedShare: test.filter((r) => r.moved).length / test.length,
    byArchetype: byArch,
    calibration: {
      eceRaw: ece(rawTest),
      eceCalibrated: ece(calTest),
      brierRaw: brier(rawTest),
      brierCalibrated: brier(calTest),
      binsRaw: reliability(rawTest),
      binsCalibrated: reliability(calTest),
    },
  },
  isotonic: knots.map((k) => ({ x: +k.x.toFixed(4), y: +k.y.toFixed(4), w: k.w })),
};
writeFileSync(new URL('../data/eval.json', import.meta.url), JSON.stringify(out, null, 1));
writeFileSync(new URL('../data/eval.js', import.meta.url), `// generated by scripts/evaluate.mjs\nexport default ${JSON.stringify(out)};\n`);
console.log(JSON.stringify({ candidates: cand.length, test: test.length, missed: Object.fromEntries(PLAN_KEYS.map((k) => [k, +out.test.missed[k].rate.toFixed(4)])), over: Object.fromEntries(PLAN_KEYS.map((k) => [k, +out.test.overdraft[k].rate.toFixed(4)])), inst: Object.fromEntries(PLAN_KEYS.map((k) => [k, +out.test.installments[k].rate.toFixed(4)])), rel: out.test.relativeReduction, moved: out.test.movedShare, ece: [out.test.calibration.eceRaw, out.test.calibration.eceCalibrated], byArch, det: out.population.detection, secs: (Date.now() - t0) / 1000 }, null, 1));
