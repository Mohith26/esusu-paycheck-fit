// Rent plans, their risk under the simulated balance paths, and the date optimizer.
import { day, isBusinessDay } from './calendar.js';
import { DUE } from './generate.js';

// Product rules as published in Esusu's help center (Split Pay: 60% down payment,
// remaining 40% in two semi-monthly installments within a 30-day term; apply 7+ business days
// before the due date). The exact date windows below are this demo's assumptions.
export const RULES = {
  due: DUE,
  downShare: 0.6,
  approval: day(2026, 11, 20), // decision 1-2 business days after applying by Nov 18
  downWindow: [day(2026, 11, 20), day(2026, 11, 24)], // landlord must be funded by the 1st
  standard: { i1: DUE + 15, i2: DUE + 30 }, // semi-monthly: Dec 16, Dec 31
  i1Window: [DUE + 3, DUE + 16],
  gap: [13, 17],
  lastBy: DUE + 30,
};

const cents = (x) => Math.round(x * 100) / 100;

export function splitAmounts(rent, rules = RULES) {
  const down = cents(rent * rules.downShare);
  const rest = cents(rent - down);
  const i1 = cents(rest / 2);
  return { down, i1, i2: cents(rest - i1) };
}

export function makeSplitPlan(rent, dDown, d1, d2, rules = RULES, label = 'Split Pay') {
  const a = splitAmounts(rent, rules);
  return {
    key: 'split',
    label,
    debits: [
      { day: dDown, amount: a.down, desc: 'ESUSU SPLIT PAY DOWN PAYMENT', role: 'Down payment' },
      { day: d1, amount: a.i1, desc: 'STABLE HOME FUND INSTALLMENT', role: 'Payment 1' },
      { day: d2, amount: a.i2, desc: 'STABLE HOME FUND INSTALLMENT', role: 'Payment 2' },
    ],
  };
}

export function standardPlans(rent, rules = RULES) {
  const half = cents(rent / 2);
  return {
    full: { key: 'full', label: 'Pay in full', debits: [{ day: rules.due, amount: rent, desc: 'RENT', role: 'Rent' }] },
    affirm: {
      key: 'affirm',
      label: 'Affirm, 2 payments',
      debits: [
        { day: rules.due + 14, amount: half, desc: 'AFFIRM', role: 'Payment 1' },
        { day: rules.due + 29, amount: cents(rent - half), desc: 'AFFIRM', role: 'Payment 2' },
      ],
    },
    splitStandard: makeSplitPlan(rent, rules.approval, rules.standard.i1, rules.standard.i2, rules, 'Split Pay, standard dates'),
  };
}

// Probability that any debit in the plan finds less money than it needs, plus overdraft risk.
export function evaluatePlan(paths, plan) {
  const { D, nPaths, sod, eod, from } = paths;
  const debits = plan.debits.slice().sort((a, b) => a.day - b.day);
  const idx = debits.map((d) => d.day - from);
  let anyShort = 0;
  let anyOver = 0;
  const perDebit = new Array(debits.length).fill(0);
  for (let i = 0; i < nPaths; i++) {
    let cum = 0;
    let short = false;
    for (let k = 0; k < debits.length; k++) {
      const t = idx[k];
      if (t < 0 || t >= D) continue;
      if (sod[i * D + t] - cum < debits[k].amount - 1e-9) {
        short = true;
        perDebit[k]++;
      }
      cum += debits[k].amount;
    }
    if (short) anyShort++;
    // overdraft: any end-of-day balance below zero after plan debits
    let c = 0;
    let j = 0;
    for (let t = 0; t < D; t++) {
      while (j < debits.length && idx[j] <= t) c += debits[j++].amount;
      if (eod[i * D + t] - c < 0) { anyOver++; break; }
    }
  }
  return {
    pShort: anyShort / nPaths,
    pOverdraft: anyOver / nPaths,
    perDebit: perDebit.map((x) => x / nPaths),
    n: nPaths,
  };
}

export function businessDaysIn(a, b) {
  const out = [];
  for (let n = a; n <= b; n++) if (isBusinessDay(n)) out.push(n);
  return out;
}

export function candidateSchedules(rules = RULES) {
  const out = [];
  for (const dd of businessDaysIn(rules.downWindow[0], rules.downWindow[1])) {
    for (const d1 of businessDaysIn(rules.i1Window[0], rules.i1Window[1])) {
      for (const d2 of businessDaysIn(d1 + rules.gap[0], Math.min(d1 + rules.gap[1], rules.lastBy))) {
        out.push([dd, d1, d2]);
      }
    }
  }
  return out;
}

const objective = (ev, shift) => ev.pShort + 0.25 * ev.pOverdraft + 0.0015 * shift;

/**
 * Search every allowed Split Pay schedule on the same simulated paths (common random numbers),
 * minimizing P(short) with overdraft risk as a secondary term and a tiny preference for the
 * standard dates when risks tie.
 */
export function optimizeSplit(paths, rent, rules = RULES) {
  const std = [rules.approval, rules.standard.i1, rules.standard.i2];
  let best = null;
  const byFirst = new Map();
  for (const s of candidateSchedules(rules)) {
    const plan = makeSplitPlan(rent, s[0], s[1], s[2], rules, 'Split Pay, paycheck fit');
    const ev = evaluatePlan(paths, plan);
    const shift = Math.abs(s[0] - std[0]) + Math.abs(s[1] - std[1]) + Math.abs(s[2] - std[2]);
    const score = objective(ev, shift);
    if (!best || score < best.score) best = { plan, ev, score, schedule: s };
    const prev = byFirst.get(s[1]);
    if (!prev || score < prev.score) byFirst.set(s[1], { score, ev, schedule: s });
  }
  return { best, byFirst };
}

// Best plan when the first installment is pinned to a given day (used by the date picker).
export function bestWithFirst(paths, rent, d1, rules = RULES) {
  let best = null;
  for (const s of candidateSchedules(rules)) {
    if (s[1] !== d1) continue;
    const plan = makeSplitPlan(rent, s[0], s[1], s[2], rules, 'Split Pay, your dates');
    const ev = evaluatePlan(paths, plan);
    const score = objective(ev, 0);
    if (!best || score < best.score) best = { plan, ev, score, schedule: s };
  }
  return best;
}
