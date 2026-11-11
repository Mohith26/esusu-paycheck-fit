// Synthetic "true world" for renters: income streams, recurring bills, everyday spending, rent.
// The forecaster never sees these parameters; it only sees the transactions this produces.
import { substream, normal, lognormalMean, poisson, pick, uniform } from './rng.js';
import { day, parts, dow, daysInMonth, prevBusinessDay, nextBusinessDay } from './calendar.js';

export const HISTORY_START = day(2026, 2, 1);
export const AS_OF = day(2026, 11, 9); // balance known at end of this day ("today" is Nov 10)
export const TODAY = AS_OF + 1;
export const DUE = day(2026, 12, 1);
export const HORIZON_END = day(2026, 12, 31);

const EMPLOYERS = [
  'BRIGHTLINE LOGISTICS', 'NORTHGATE DISTRIBUTION', 'CEDAR RIDGE SCHOOLS', 'SUNRISE SENIOR LIVING',
  'METRO TRANSIT AUTH', 'LAKESIDE MEDICAL GRP', 'PARKVIEW HOTELS', 'RIVERBEND FOODS',
];
const GIG = ['RIDEWAY DRIVER PAY', 'DASHLY INSTANT PAYOUT', 'TASKHIVE EARNINGS'];
const BILLS = [
  { name: 'BRIGHTWAVE MOBILE', lo: 55, hi: 95, cv: 0.01 },
  { name: 'CITYPOWER ELECTRIC', lo: 70, hi: 150, cv: 0.2 },
  { name: 'STREAMBOX', lo: 15.49, hi: 15.49, cv: 0 },
  { name: 'SUMMIT AUTO FINANCE', lo: 280, hi: 420, cv: 0 },
  { name: 'KEYSTONE AUTO INS', lo: 110, hi: 190, cv: 0 },
  { name: 'FIBERLINK INTERNET', lo: 55, hi: 75, cv: 0 },
  { name: 'FITLIFE GYM', lo: 25, hi: 40, cv: 0 },
  { name: 'NOVA STUDENT LOANS', lo: 120, hi: 260, cv: 0 },
];
const MERCHANTS = ['FRESHMART', 'QUIKFUEL', 'CORNER DELI', 'VALUE MART', 'METRO CARD', 'PHARMACARE', 'TACO VERDE', 'CASH APP TRANSFER', 'ATM WITHDRAWAL', 'DOLLAR PLUS'];
const PROPERTIES = ['THE MERIDIAN APTS', 'OAK HOLLOW RESIDENCES', 'PARKSIDE COMMONS', 'LIBERTY POINTE', 'WILLOW CREEK HOMES'];

export const ARCHETYPES = ['biweekly', 'semimonthly', 'weekly', 'gig', 'mixed'];

const round2 = (x) => Math.round(x * 100) / 100;

export function makeProfile(seed, archetype) {
  const r = substream(seed, 'profile');
  const arch = archetype || pick(r, ['biweekly', 'biweekly', 'biweekly', 'semimonthly', 'semimonthly', 'weekly', 'gig', 'mixed']);
  const income = Math.round(uniform(r, 2700, 5600)); // net monthly take-home
  const rentShare = uniform(r, 0.35, 0.48);
  const rent = Math.round((income * rentShare) / 5) * 5;
  const streams = [];
  const emp = pick(r, EMPLOYERS);
  const payDow = r() < 0.8 ? 5 : 4; // Friday or Thursday payroll
  if (arch === 'biweekly' || arch === 'mixed') {
    const share = arch === 'mixed' ? 0.72 : 1;
    // anchor: a pay Friday in Jan 2026, random phase
    let a = day(2026, 1, 2);
    while (dow(a) !== payDow) a++;
    if (r() < 0.5) a += 7;
    streams.push({ kind: 'biweekly', desc: `${emp} PAYROLL`, anchor: a, amount: (income * share * 12) / 26, cv: 0.03, otP: 0.18 });
  }
  if (arch === 'semimonthly') {
    streams.push({ kind: 'semimonthly', desc: `${emp} PAYROLL`, amount: (income * 12) / 24, cv: 0.02, otP: 0.1 });
  }
  if (arch === 'weekly') {
    let a = day(2026, 1, 2);
    while (dow(a) !== payDow) a++;
    streams.push({ kind: 'weekly', desc: `${emp} PAYROLL`, anchor: a, amount: (income * 12) / 52, cv: 0.06, otP: 0.15 });
  }
  if (arch === 'gig' || arch === 'mixed') {
    const share = arch === 'mixed' ? 0.28 : 1;
    // weekday-varying payout probability; Fri-Sun busier
    const dayP = [0.55, 0.3, 0.3, 0.35, 0.45, 0.65, 0.7].map((p) => Math.min(0.95, p * uniform(r, 0.85, 1.15)));
    const expectedPerWeek = dayP.reduce((s, p) => s + p, 0);
    streams.push({ kind: 'gig', desc: pick(r, GIG), dayP, amount: (income * share * 12) / 52 / expectedPerWeek, cv: 0.55 });
  }
  // bills
  const nb = 4 + Math.floor(r() * 3);
  const pool = BILLS.slice();
  const bills = [];
  for (let i = 0; i < nb; i++) {
    const b = pool.splice(Math.floor(r() * pool.length), 1)[0];
    const dom = r() < 0.35 ? 1 + Math.floor(r() * 6) : 1 + Math.floor(r() * 28);
    bills.push({ desc: b.name, dom, amount: round2(uniform(r, b.lo, b.hi)), cv: b.cv });
  }
  const billsMonthly = bills.reduce((s, b) => s + b.amount, 0);
  const surplus = income * uniform(r, 0.0, 0.045);
  const shockRate = uniform(r, 0.2, 0.55); // per month
  const shockMean = uniform(r, 140, 380);
  const discretionary = Math.max(300, income - rent - billsMonthly - surplus - shockRate * shockMean);
  return {
    seed,
    archetype: arch,
    incomeMonthly: income,
    rent,
    property: pick(r, PROPERTIES),
    streams,
    bills,
    spend: { daily: (discretionary * 12) / 365, cv: 0.55, shockRate, shockMean, lowBalanceCut: uniform(r, 0.45, 0.75) },
    startBalance: Math.round(uniform(r, 60, 700)),
  };
}

// Deposits the true process schedules on day n (before randomness on amount/lateness).
function nominalPaydays(stream, n) {
  const p = parts(n);
  if (stream.kind === 'biweekly' || stream.kind === 'weekly') {
    const period = stream.kind === 'biweekly' ? 14 : 7;
    return (n - stream.anchor) % period === 0 && n >= stream.anchor;
  }
  if (stream.kind === 'semimonthly') {
    return p.d === 15 || p.d === daysInMonth(p.y, p.m);
  }
  return false;
}

/**
 * Simulate the account day by day.
 * opts.rent: include the usual full rent payment on the 1st (history mode).
 * opts.debits: extra scheduled debits [{day, amount, desc}] (plan mode).
 * Within a day: deposits post first, then scheduled debits/rent, then bills, then spending.
 * Returns transactions, end-of-day balances and, for each scheduled debit, whether it came up short.
 */
export function simulate(profile, start, end, startBalance, seed, opts = {}) {
  const r = substream(seed, 'sim');
  const txns = [];
  const eod = new Map();
  let bal = startBalance;
  // payday postings computed per nominal date so holiday shifts happen naturally
  const pending = new Map(); // day -> [{amount, desc}]
  const push = (d, item) => {
    if (!pending.has(d)) pending.set(d, []);
    pending.get(d).push(item);
  };
  for (let n = start - 3; n <= end + 3; n++) {
    for (const s of profile.streams) {
      if (s.kind === 'gig') continue;
      if (!nominalPaydays(s, n)) continue;
      let amt = s.amount * (1 + s.cv * normal(r));
      if (r() < s.otP) amt *= uniform(r, 1.05, 1.16);
      let post = prevBusinessDay(n);
      if (r() < 0.03) post = nextBusinessDay(post + 1); // occasional ACH delay
      push(post, { amount: round2(amt), desc: s.desc, kind: 'income' });
    }
  }
  const results = [];
  for (let n = start; n <= end; n++) {
    const w = dow(n);
    const p = parts(n);
    // 1) deposits
    for (const it of pending.get(n) || []) {
      bal += it.amount;
      txns.push({ day: n, amount: it.amount, desc: it.desc, kind: it.kind });
    }
    for (const s of profile.streams) {
      if (s.kind !== 'gig') continue;
      if (r() < s.dayP[w]) {
        const amt = round2(lognormalMean(r, s.amount, s.cv));
        bal += amt;
        txns.push({ day: n, amount: amt, desc: s.desc, kind: 'income' });
      }
    }
    // one overdraft fee per day, only when a debit takes the balance from >= 0 to < 0
    let fees = 0;
    let before = bal;
    const mark = () => { before = bal; };
    const fee = () => {
      if (bal < 0 && before >= 0 && fees < 1) {
        bal -= 35;
        fees++;
        txns.push({ day: n, amount: -35, desc: 'OVERDRAFT FEE', kind: 'fee' });
      }
      before = bal;
    };
    // 2) rent (history) and scheduled plan debits
    mark();
    if (opts.rent && n === nextBusinessDay(day(p.y, p.m, 1))) {
      bal -= profile.rent;
      txns.push({ day: n, amount: -profile.rent, desc: `RENT - ${profile.property}`, kind: 'rent' });
      fee();
    }
    for (const dbt of opts.debits || []) {
      if (dbt.day !== n) continue;
      const short = bal < dbt.amount - 1e-9;
      results.push({ ...dbt, short, available: round2(bal) });
      bal -= dbt.amount;
      txns.push({ day: n, amount: -dbt.amount, desc: dbt.desc, kind: 'plan' });
      fee();
    }
    // 3) bills (post on due day, or next business day)
    for (const b of profile.bills) {
      const dueDay = day(p.y, p.m, Math.min(b.dom, daysInMonth(p.y, p.m)));
      if (nextBusinessDay(dueDay) !== n) continue;
      const amt = round2(b.amount * (1 + b.cv * normal(r)));
      bal -= amt;
      txns.push({ day: n, amount: -amt, desc: b.desc, kind: 'bill' });
      fee();
    }
    // 4) everyday spending (people cut back when the balance is low)
    const wMult = [1.1, 0.85, 0.85, 0.9, 0.95, 1.2, 1.4][w] / 1.0357;
    let target = lognormalMean(r, profile.spend.daily * wMult, profile.spend.cv);
    if (bal < 150) target *= profile.spend.lowBalanceCut;
    if (bal < 0) target *= 0.6; // overdrawn: only essentials
    const k = 1 + poisson(r, 1.1);
    let left = target;
    for (let i = 0; i < k; i++) {
      const amt = round2(i === k - 1 ? left : left * uniform(r, 0.2, 0.7));
      left -= amt;
      if (amt <= 0.01) continue;
      bal -= amt;
      txns.push({ day: n, amount: -amt, desc: pick(r, MERCHANTS), kind: 'spend' });
    }
    if (r() < profile.spend.shockRate / 30.4) {
      const amt = round2(lognormalMean(r, profile.spend.shockMean, 0.8));
      bal -= amt;
      txns.push({ day: n, amount: -amt, desc: pick(r, ['AUTO REPAIR CENTER', 'URGENT CARE COPAY', 'TOWING SVC', 'APPLIANCE DEPOT']), kind: 'spend' });
    }
    fee();
    bal = round2(bal);
    eod.set(n, bal);
  }
  return { txns, eod, results, endBalance: bal };
}

// Build one renter: profile + observed history up to AS_OF.
export function makeRenter(seed, archetype) {
  const profile = makeProfile(seed, archetype);
  const hist = simulate(profile, HISTORY_START, AS_OF, profile.startBalance, seed * 7 + 1, { rent: true });
  return { profile, history: hist.txns, balance: hist.endBalance, eod: hist.eod };
}

// One realized future (Nov 10 .. Dec 31) under a given rent plan; futureSeed selects the draw.
export function realize(renter, plan, futureSeed) {
  return simulate(renter.profile, TODAY, HORIZON_END, renter.balance, futureSeed, { rent: false, debits: plan.debits });
}
