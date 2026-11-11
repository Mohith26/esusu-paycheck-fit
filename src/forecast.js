// Cash-flow forecaster: learns paychecks, recurring bills and everyday spending from a linked
// account's transactions, then simulates many plausible balance paths for the coming weeks.
import { mulberry32 } from './rng.js';
import { dow, parts, daysInMonth, day, prevBusinessDay, nextBusinessDay, isBusinessDay } from './calendar.js';

const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const isRent = (t) => /^RENT\b/.test(t.desc);
const isFee = (t) => /OVERDRAFT FEE/.test(t.desc);

function groupBy(txns, pred) {
  const g = new Map();
  for (const t of txns) {
    if (!pred(t)) continue;
    if (!g.has(t.desc)) g.set(t.desc, []);
    g.get(t.desc).push(t);
  }
  return g;
}

// Expected posting day for a nominal payday (payroll moves to the prior business day).
const postPay = (x) => prevBusinessDay(x);

function semimonthlyNominals(from, to) {
  const out = [];
  for (let n = from; n <= to; n++) {
    const p = parts(n);
    if (p.d === 15 || p.d === daysInMonth(p.y, p.m)) out.push(n);
  }
  return out;
}

function gridNominals(phase, period, from, to) {
  const out = [];
  let x = from + ((((phase - from) % period) + period) % period);
  for (; x <= to; x += period) out.push(x);
  return out;
}

// Match each deposit to a nominal payday; returns fraction explained and the late rate.
function matchNominals(deps, nominals) {
  let explained = 0;
  let late = 0;
  for (const d of deps) {
    let hit = false;
    for (const x of nominals) {
      const p = postPay(x);
      if (d.day === p) { hit = true; break; }
      if (d.day > p && d.day <= nextBusinessDay(p + 1)) { hit = true; late++; break; }
    }
    if (hit) explained++;
  }
  return { frac: explained / deps.length, late };
}

export function detectIncome(history, asOf, lookback = 182) {
  const from = asOf - lookback;
  const groups = groupBy(history, (t) => t.amount > 0 && t.day > from);
  const streams = [];
  for (const [desc, deps0] of groups) {
    const deps = deps0.slice().sort((a, b) => a.day - b.day);
    if (deps.length < 4) continue;
    const perMonth = deps.length / (lookback / 30.4);
    if (perMonth > 5.2) continue; // too frequent to be payroll: leave to the spending model
    const gaps = [];
    for (let i = 1; i < deps.length; i++) gaps.push(deps[i].day - deps[i - 1].day);
    const g = median(gaps);
    const tryCands = [];
    // semimonthly (15th + last day)
    const sm = matchNominals(deps, semimonthlyNominals(from - 3, asOf + 3));
    tryCands.push({ kind: 'semimonthly', frac: sm.frac, late: sm.late });
    // weekly / biweekly grids at the modal weekday
    for (const period of [7, 14]) {
      if (Math.abs(g - period) > 2.5) continue;
      const votes = new Map();
      for (const d of deps) {
        // nominal weekday guess: the most common posting weekday
        votes.set(dow(d.day), (votes.get(dow(d.day)) || 0) + 1);
      }
      const wd = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const phaseVotes = new Map();
      for (const d of deps) {
        const x = d.day + ((wd - dow(d.day) + 7) % 7);
        const ph = ((x % period) + period) % period;
        phaseVotes.set(ph, (phaseVotes.get(ph) || 0) + 1);
      }
      const phase = [...phaseVotes.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const m = matchNominals(deps, gridNominals(phase, period, from - 7, asOf + 7));
      tryCands.push({ kind: period === 7 ? 'weekly' : 'biweekly', period, phase, frac: m.frac, late: m.late });
    }
    const best = tryCands.sort((a, b) => b.frac - a.frac)[0];
    if (!best || best.frac < 0.8) continue;
    const amounts = deps.slice(-10).map((d) => d.amount);
    streams.push({
      desc,
      kind: best.kind,
      period: best.period || null,
      phase: best.phase ?? null,
      lateP: (best.late + 0.5) / (deps.length + 1),
      amounts,
      typical: median(amounts),
      count: deps.length,
    });
  }
  return streams;
}

export function nominalPaydays(stream, from, to) {
  if (stream.kind === 'semimonthly') return semimonthlyNominals(from, to);
  return gridNominals(stream.phase, stream.period, from, to);
}

export function detectBills(history, asOf, lookback = 185) {
  const from = asOf - lookback;
  const groups = groupBy(history, (t) => t.amount < 0 && t.day > from && !isRent(t) && !isFee(t));
  const bills = [];
  for (const [desc, ts] of groups) {
    const months = new Set(ts.map((t) => { const p = parts(t.day); return p.y * 12 + p.m; }));
    if (months.size < 4 || ts.length > months.size * 1.25) continue;
    // nominal day-of-month: posting rolls forward to the next business day
    const unshifted = ts.filter((t) => isBusinessDay(t.day - 1) || parts(t.day).d === 1).map((t) => parts(t.day).d);
    const dom = Math.round(median(unshifted.length ? unshifted : ts.map((t) => parts(t.day).d)));
    let ok = 0;
    for (const t of ts) {
      const p = parts(t.day);
      const due = day(p.y, p.m, Math.min(dom, daysInMonth(p.y, p.m)));
      if (Math.abs(nextBusinessDay(due) - t.day) <= 1) ok++;
    }
    if (ok / ts.length < 0.75) continue;
    const amounts = ts.slice(-6).map((t) => -t.amount);
    bills.push({ desc, dom, amounts, typical: median(amounts) });
  }
  return bills;
}

// Everything not explained by paychecks, bills, rent and fees becomes "everyday flow".
// We keep the last 13 full Monday-Sunday weeks as blocks for a weekly block bootstrap.
export function residualWeeks(history, asOf, streams, bills, nWeeks = 13) {
  const known = new Set([...streams.map((s) => s.desc), ...bills.map((b) => b.desc)]);
  let end = asOf;
  while (dow(end) !== 0) end--; // last Sunday on or before asOf
  const start = end - nWeeks * 7 + 1; // a Monday
  const net = new Float64Array(nWeeks * 7);
  for (const t of history) {
    if (t.day < start || t.day > end) continue;
    if (known.has(t.desc) || isRent(t) || isFee(t)) continue;
    net[t.day - start] += t.amount;
  }
  const weeks = [];
  for (let w = 0; w < nWeeks; w++) weeks.push(Array.from(net.slice(w * 7, w * 7 + 7)));
  return weeks;
}

export function analyze(history, asOf) {
  const streams = detectIncome(history, asOf);
  const bills = detectBills(history, asOf);
  const weeks = residualWeeks(history, asOf, streams, bills);
  const rentTx = history.filter(isRent);
  return { asOf, streams, bills, weeks, lastRent: rentTx.length ? rentTx[rentTx.length - 1] : null };
}

/**
 * Monte Carlo balance paths with no rent debits.
 * sod[i*D + t]: money available on day t after that day's deposits (when a scheduled debit runs)
 * eod[i*D + t]: end-of-day balance (after bills and everyday flow)
 */
export function simulatePaths(model, balance, from, to, nPaths = 1000, seed = 7) {
  const D = to - from + 1;
  const sod = new Float64Array(nPaths * D);
  const eod = new Float64Array(nPaths * D);
  const rng = mulberry32(seed);
  const payNominals = model.streams.map((s) => nominalPaydays(s, from - 6, to + 6));
  // bill posting days in the window
  const billDays = [];
  for (const b of model.bills) {
    for (let n = from - 2; n <= to + 31; n++) {
      const p = parts(n);
      if (p.d !== Math.min(b.dom, daysInMonth(p.y, p.m))) continue;
      const post = nextBusinessDay(n);
      if (post >= from && post <= to) billDays.push({ day: post, bill: b });
    }
  }
  const dep = new Float64Array(D);
  const out = new Float64Array(D);
  for (let i = 0; i < nPaths; i++) {
    dep.fill(0);
    out.fill(0);
    model.streams.forEach((s, k) => {
      for (const x of payNominals[k]) {
        let post = prevBusinessDay(x);
        if (rng() < s.lateP) post = nextBusinessDay(post + 1);
        if (post < from || post > to) continue;
        dep[post - from] += s.amounts[Math.floor(rng() * s.amounts.length)];
      }
    });
    for (const bd of billDays) out[bd.day - from] += bd.bill.amounts[Math.floor(rng() * bd.bill.amounts.length)];
    // weekly block bootstrap of everyday flow, aligned so block index 0 = Monday
    let weekBlock = null;
    let bal = balance;
    for (let t = 0; t < D; t++) {
      const n = from + t;
      const wd = (dow(n) + 6) % 7; // Monday=0
      if (weekBlock === null || wd === 0) weekBlock = model.weeks[Math.floor(rng() * model.weeks.length)];
      bal += dep[t];
      sod[i * D + t] = bal;
      bal += weekBlock[wd] - out[t];
      eod[i * D + t] = bal;
    }
  }
  return { from, to, D, nPaths, sod, eod };
}

// Summaries for the fan chart: quantiles of end-of-day balance under a plan.
export function balanceBands(paths, plan, qs = [0.1, 0.5, 0.9]) {
  const { D, nPaths, eod, from } = paths;
  const debits = plan.debits.slice().sort((a, b) => a.day - b.day);
  const cum = new Float64Array(D);
  let c = 0;
  let j = 0;
  for (let t = 0; t < D; t++) {
    while (j < debits.length && debits[j].day <= from + t) c += debits[j++].amount;
    cum[t] = c;
  }
  const col = new Float64Array(nPaths);
  const bands = qs.map(() => new Float64Array(D));
  for (let t = 0; t < D; t++) {
    for (let i = 0; i < nPaths; i++) col[i] = eod[i * D + t] - cum[t];
    col.sort();
    qs.forEach((q, k) => { bands[k][t] = col[Math.min(nPaths - 1, Math.floor(q * nPaths))]; });
  }
  return bands;
}
