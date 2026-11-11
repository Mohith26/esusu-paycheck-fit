import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { day, prevBusinessDay, nextBusinessDay, isBusinessDay, dow } from '../src/calendar.js';
import { makeRenter, makeProfile, realize, AS_OF, TODAY, HORIZON_END } from '../src/generate.js';
import { analyze, detectIncome, nominalPaydays, simulatePaths } from '../src/forecast.js';
import { evaluatePlan, candidateSchedules, optimizeSplit, standardPlans, makeSplitPlan, splitAmounts, RULES } from '../src/plan.js';
import { fitIsotonic, applyIsotonic, ece, wilson, brier } from '../src/calibrate.js';
import { buildRenterView } from '../src/engine.js';
import { PERSONAS } from '../src/personas.js';

test('bank-holiday and weekend shifts', () => {
  assert.equal(dow(day(2026, 12, 25)), 5); // Friday
  assert.equal(isBusinessDay(day(2026, 12, 25)), false); // Christmas
  assert.equal(prevBusinessDay(day(2026, 12, 25)), day(2026, 12, 24)); // payroll moves earlier
  assert.equal(nextBusinessDay(day(2026, 11, 26)), day(2026, 11, 27)); // bills move later (Thanksgiving)
  assert.equal(prevBusinessDay(day(2027, 1, 1)), day(2026, 12, 31));
});

test('generator is deterministic per seed', () => {
  const a = makeRenter(5526);
  const b = makeRenter(5526);
  assert.equal(a.history.length, b.history.length);
  assert.equal(a.balance, b.balance);
  assert.deepEqual(a.history.slice(0, 20), b.history.slice(0, 20));
});

test('paycheck detection recovers the true schedule for payroll renters', () => {
  let checked = 0;
  let correct = 0;
  for (let s = 100; s < 260; s++) {
    const r = makeRenter(s);
    const truth = r.profile.streams.find((x) => x.kind !== 'gig');
    if (!truth) continue;
    checked++;
    const found = detectIncome(r.history, AS_OF).find((x) => x.desc === truth.desc);
    if (!found || found.kind !== truth.kind) continue;
    if (truth.kind === 'semimonthly') { correct++; continue; }
    const period = truth.kind === 'biweekly' ? 14 : 7;
    // predicted nominal paydays must land on the true grid
    const pred = nominalPaydays(found, TODAY, TODAY + 40);
    if (pred.every((x) => (((x - truth.anchor) % period) + period) % period === 0)) correct++;
  }
  assert.ok(checked > 100);
  assert.ok(correct / checked >= 0.97, `accuracy ${correct}/${checked}`);
});

test('bill detection finds the recurring bills', () => {
  let truth = 0;
  let hit = 0;
  for (let s = 300; s < 360; s++) {
    const r = makeRenter(s);
    const m = analyze(r.history, AS_OF);
    truth += r.profile.bills.length;
    for (const b of r.profile.bills) if (m.bills.some((x) => x.desc === b.desc)) hit++;
  }
  assert.ok(hit / truth >= 0.95, `recall ${hit}/${truth}`);
});

test('evaluatePlan computes exact frequencies on hand-built paths', () => {
  // 4 paths x 3 days; debits of 100 on day 0 and 50 on day 2
  const D = 3;
  const sod = new Float64Array([150, 150, 150, 90, 90, 90, 200, 200, 120, 100, 100, 160]);
  const eod = new Float64Array([140, 140, 140, 80, 80, 80, 190, 190, 110, 90, 90, 150]);
  const paths = { from: 10, to: 12, D, nPaths: 4, sod, eod };
  const plan = { debits: [{ day: 10, amount: 100 }, { day: 12, amount: 50 }] };
  const ev = evaluatePlan(paths, plan);
  // path0: 150>=100, then 150-100=50>=50 ok | path1: 90<100 short
  // path2: 200>=100, then 120-100=20<50 short | path3: 100>=100, then 160-100=60>=50 ok
  assert.equal(ev.pShort, 0.5);
  // per debit: path1 is also short on the second debit because the first one still posts
  assert.deepEqual(ev.perDebit, [0.25, 0.5]);
  // end of day after debits: path0 day2 140-150<0, path1 day0 80-100<0, path2 day2 110-150<0,
  // path3 day0 90-100<0, so every path dips below zero at least once
  assert.equal(ev.pOverdraft, 1);
  // a plan with only the first debit: path1 short; overdraft for path1 (80-100) and path3 (90-100)
  const one = evaluatePlan(paths, { debits: [{ day: 10, amount: 100 }] });
  assert.equal(one.pShort, 0.25);
  assert.equal(one.pOverdraft, 0.5);
});

test('candidate schedules follow the product rules', () => {
  const c = candidateSchedules();
  assert.ok(c.length > 30);
  for (const [dd, d1, d2] of c) {
    assert.ok(isBusinessDay(dd) && isBusinessDay(d1) && isBusinessDay(d2));
    assert.ok(dd >= RULES.downWindow[0] && dd <= RULES.downWindow[1]);
    assert.ok(d2 - d1 >= RULES.gap[0] && d2 - d1 <= RULES.gap[1]);
    assert.ok(d2 <= RULES.lastBy && d1 >= RULES.i1Window[0]);
  }
  const a = splitAmounts(1225);
  assert.equal(a.down + a.i1 + a.i2, 1225);
  assert.equal(a.down, 735);
});

test('optimizer never does worse than the standard dates on the same paths', () => {
  for (const s of [5526, 7279, 6422, 5686]) {
    const r = makeRenter(s);
    const m = analyze(r.history, AS_OF);
    const paths = simulatePaths(m, r.balance, TODAY, HORIZON_END, 400, s);
    const std = evaluatePlan(paths, standardPlans(r.profile.rent).splitStandard);
    const best = optimizeSplit(paths, r.profile.rent).best;
    assert.ok(best.ev.pShort + 0.25 * best.ev.pOverdraft <= std.pShort + 0.25 * std.pOverdraft + 1e-12);
  }
});

test('plans do not change the random draws of the true future (common random numbers)', () => {
  const r = makeRenter(5526);
  const p = standardPlans(r.profile.rent);
  const a = realize(r, p.full, 42).txns.filter((t) => t.kind === 'income');
  const b = realize(r, makeSplitPlan(r.profile.rent, day(2026, 11, 23), day(2026, 12, 7), day(2026, 12, 23)), 42).txns.filter((t) => t.kind === 'income');
  assert.deepEqual(a, b);
});

test('isotonic regression is monotone and fixes a known miscalibration', () => {
  const pts = [];
  for (let i = 0; i < 50; i++) {
    const p = i / 49;
    pts.push({ p, y: Math.min(1, p * 0.6), w: 10 }); // model overpredicts by 40%
  }
  const k = fitIsotonic(pts);
  for (let i = 1; i < k.length; i++) assert.ok(k[i].y >= k[i - 1].y);
  const calPts = pts.map((q) => ({ ...q, p: applyIsotonic(k, q.p) }));
  assert.ok(ece(pts) > 0.15);
  assert.ok(ece(calPts) < 1e-9);
  assert.ok(brier(calPts) < brier(pts));
});

test('wilson interval brackets the point estimate', () => {
  const [lo, hi] = wilson(10, 100);
  assert.ok(lo < 0.1 && hi > 0.1 && lo > 0.04 && hi < 0.18);
});

test('persona screens are internally consistent', () => {
  const ev = JSON.parse(readFileSync(new URL('../data/eval.json', import.meta.url)));
  for (const p of PERSONAS) {
    const v = buildRenterView(p.seed, ev.isotonic);
    // the fit plan is the one shown on the calendar for its own first-payment day
    const fd = v.firstDays.find((f) => f.day === v.plans.splitFit.debits[1].day);
    assert.ok(fd, 'fit day appears on the calendar');
    assert.ok(Math.abs(fd.raw - v.evals.splitFit.pShort) < 1e-12);
    // amounts add up to rent
    assert.ok(Math.abs(v.plans.splitFit.debits.reduce((s, d) => s + d.amount, 0) - v.rent) < 0.01);
    // calibration map is monotone, so ordering of raw risks is preserved
    if (v.evals.splitFit.pShort <= v.evals.splitStandard.pShort) assert.ok(v.cal(v.evals.splitFit.pShort) <= v.cal(v.evals.splitStandard.pShort));
  }
});

test('backtest file is internally consistent', () => {
  const ev = JSON.parse(readFileSync(new URL('../data/eval.json', import.meta.url)));
  const m = ev.test.missed;
  assert.ok(Math.abs(ev.test.relativeReduction - (1 - m.splitFit.rate / m.splitStandard.rate)) < 1e-9);
  for (const k of Object.keys(m)) assert.equal(m[k].n, ev.population.testRenters * ev.config.futures);
  assert.ok(ev.test.calibration.eceCalibrated < ev.test.calibration.eceRaw);
});
