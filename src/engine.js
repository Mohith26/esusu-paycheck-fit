// Everything the app screens need for one renter, computed from the renter's transactions.
import { makeRenter, AS_OF, TODAY, HORIZON_END, DUE } from './generate.js';
import { analyze, simulatePaths, nominalPaydays, balanceBands } from './forecast.js';
import { standardPlans, optimizeSplit, evaluatePlan, bestWithFirst, makeSplitPlan, RULES, businessDaysIn } from './plan.js';
import { applyIsotonic } from './calibrate.js';
import { prevBusinessDay, parts } from './calendar.js';

export const PATHS = 800;

export function buildRenterView(seed, knots) {
  const renter = makeRenter(seed);
  const model = analyze(renter.history, AS_OF);
  const paths = simulatePaths(model, renter.balance, TODAY, HORIZON_END, PATHS, seed * 31 + 7);
  const rent = renter.profile.rent;
  const plans = standardPlans(rent);
  const evals = {};
  for (const k of Object.keys(plans)) evals[k] = evaluatePlan(paths, plans[k]);
  const opt = optimizeSplit(paths, rent);
  plans.splitFit = opt.best.plan;
  evals.splitFit = opt.best.ev;
  const cal = (p) => applyIsotonic(knots, p);
  const firstDays = businessDaysIn(RULES.i1Window[0], RULES.i1Window[1]).map((d) => {
    const b = opt.byFirst.get(d) || bestWithFirst(paths, rent, d);
    return { day: d, raw: b.ev.pShort, p: cal(b.ev.pShort), schedule: b.schedule };
  });
  // expected paydays (posting dates) in the window, with the stream they come from
  const paydays = [];
  for (const s of model.streams) {
    for (const x of nominalPaydays(s, TODAY - 6, HORIZON_END + 6)) {
      const post = prevBusinessDay(x);
      if (post >= TODAY && post <= HORIZON_END) paydays.push({ day: post, desc: s.desc, typical: s.typical, kind: s.kind });
    }
  }
  paydays.sort((a, b) => a.day - b.day);
  const billDays = [];
  for (const b of model.bills) {
    for (let n = TODAY; n <= HORIZON_END; n++) if (parts(n).d === b.dom) billDays.push({ day: n, desc: b.desc, typical: b.typical });
  }
  const rentTx = renter.history.filter((t) => t.kind === 'rent');
  return {
    seed,
    renter,
    model,
    paths,
    rent,
    plans,
    evals,
    cal,
    firstDays,
    paydays,
    billDays,
    rentsReported: rentTx.filter((t) => parts(t.day).y === 2026).length,
    lastRentDay: rentTx.length ? rentTx[rentTx.length - 1].day : null,
    historyDays: AS_OF - renter.history[0].day + 1,
    txCount: renter.history.length,
    due: DUE,
  };
}

export function customPlan(view, d1) {
  const b = bestWithFirst(view.paths, view.rent, d1);
  return { plan: makeSplitPlan(view.rent, b.schedule[0], b.schedule[1], b.schedule[2], RULES, 'Split Pay, your dates'), ev: b.ev };
}

export function bands(view, plan) {
  return balanceBands(view.paths, plan, [0.1, 0.5, 0.9]);
}

// Plain-language reason for each scheduled debit: the paycheck it follows.
export function reasons(view, plan) {
  return plan.debits.map((d) => {
    const prior = view.paydays.filter((p) => p.day <= d.day).pop();
    const next = view.paydays.find((p) => p.day > d.day);
    return { debit: d, after: prior || null, before: next || null };
  });
}
