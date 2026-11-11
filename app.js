import EVAL from './data/eval.js';
import { PERSONAS } from './src/personas.js';
import { buildRenterView, customPlan, bands, reasons } from './src/engine.js';
import { fmt, dow } from './src/calendar.js';
import { TODAY, HORIZON_END } from './src/generate.js';

const q = new URLSearchParams(location.search);
const state = { idx: Math.min(5, Math.max(0, Number(q.get('p') || 0))), mode: q.get('mode') || 'fit', first: q.get('first') ? Number(q.get('first')) : null };
const cache = new Map();
const $ = (id) => document.getElementById(id);

const money = (x) => {
  const v = Math.round(x * 100) / 100;
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
};
const pct = (p) => (p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`);
const pct1 = (p) => `${(p * 100).toFixed(1)}%`;
const tone = (p) => (p < 0.1 ? 'good' : p < 0.25 ? 'mid' : 'bad');
const icon = (name, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;

function view() {
  const seed = PERSONAS[state.idx].seed;
  if (!cache.has(seed)) cache.set(seed, buildRenterView(seed, EVAL.isotonic));
  return cache.get(seed);
}

function current(v) {
  if (state.mode === 'standard') return { plan: v.plans.splitStandard, ev: v.evals.splitStandard };
  if (state.mode === 'custom' && state.first) return customPlan(v, state.first);
  return { plan: v.plans.splitFit, ev: v.evals.splitFit };
}

const statusBar = () => `
  <div class="status"><span>9:41</span><span class="sys">
    <svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
    <svg viewBox="0 0 16 12"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0L8 11.5Zm-4.1-4.2L2.5 5.9a7.8 7.8 0 0 1 11 0l-1.4 1.4a5.8 5.8 0 0 0-8.2 0ZM.9 4.3 0 3.4a11.3 11.3 0 0 1 16 0l-.9.9a10 10 0 0 0-14.2 0Z"/></svg>
    <span class="batt"><i></i></span></span></div>`;

function ring(kind, label, frac = 1) {
  const r = 19;
  const c = 2 * Math.PI * r;
  const color = kind === 'lime' ? '#adee66' : '#13322b';
  const track = kind === 'lime' ? '#adee66' : '#e2e1e0';
  const inner = kind === 'house' || kind === 'lime' ? `<span class="ico">${icon('house')}</span>` : `<span>${label}</span>`;
  return `<div class="ring"><svg class="r" viewBox="0 0 44 44"><circle cx="22" cy="22" r="${r}" fill="none" stroke="${track}" stroke-width="3.2"/>
    <circle cx="22" cy="22" r="${r}" fill="none" stroke="${kind === 'lime' ? color : '#13322b'}" stroke-width="3.2" stroke-dasharray="${c * frac} ${c}" stroke-linecap="round"/></svg>${inner}</div>`;
}

function home(v, cur) {
  const p = PERSONAS[state.idx];
  const e = v.evals;
  const pFull = v.cal(e.full.pShort);
  const pStd = v.cal(e.splitStandard.pShort);
  const pFit = v.cal(e.splitFit.pShort);
  $('screen-home').innerHTML = `${statusBar()}<div class="scroll">
    <div class="app-head"><img class="logo" src="assets/esusu-logo.svg" alt="Esusu">
      <div class="hd-actions"><div class="bell">${icon('bell')}<b>2</b></div><div class="avatar">${p.initials}</div></div></div>
    <div class="sec-t">Flexible rent payments</div>
    <div class="carousel">
      <div class="pcard split"><span class="apr">0% APR</span><img class="mini" src="assets/esusu-logo.svg" alt="">
        <h4>Split Pay</h4><p>Pay a portion upfront and split the remaining balance</p>
        <span class="fitchip">${icon('sparkles')}Dates fit to your paychecks</span></div>
      <div class="pcard affirm"><span class="aff">affirm</span><h4>Pay Rent Over Time</h4></div>
    </div>
    <div class="sec-h"><h3>December rent</h3><a data-go="plan">See plan</a></div>
    <div class="rentsum">
      <div class="top"><div><div class="l">Due ${fmt(v.due, 'dow')}</div><div class="v">${money(v.rent)}</div></div>${ring('lime', '', 1)}</div>
      <div class="cmp">
        <div class="c"><span class="nm"><span class="dot" style="background:#d0d6d5"></span>Pay in full on ${fmt(v.due)}</span><span class="pct ${tone(pFull)}">${pct(pFull)}</span></div>
        <div class="c"><span class="nm"><span class="dot" style="background:#718480"></span>Split Pay, standard dates</span><span class="pct ${tone(pStd)}">${pct(pStd)}</span></div>
        <div class="c"><span class="nm"><span class="dot" style="background:#008f34"></span><b>Split Pay, Paycheck Fit</b></span><span class="pct ${tone(pFit)}">${pct(pFit)}</span></div>
      </div>
      <div class="fine" style="padding:8px 0 0;text-align:left">Chance a payment comes up short, from ${Math.round(v.historyDays / 30.4)} months of your linked account</div>
    </div>
    <div class="sec-t" style="padding-top:20px">Make rent work for you</div>
    <div class="tiles">
      <div class="tile dark"><span class="glyph">${icon('house')}</span><b>Rent Reported</b><small>Last reported ${v.lastRentDay ? fmt(v.lastRentDay, 'dm') : ''}</small></div>
      <div class="tile light"><span class="glyph">${icon('calendar-check')}</span><b>${v.rentsReported} payments</b><small>Reported in 2026</small></div>
      <div class="tile gray"></div>
    </div>
    <div style="height:24px"></div>
  </div>`;
}

function planScreen(v, cur) {
  const std = v.plans.splitStandard.debits;
  const pNow = v.cal(cur.ev.pShort);
  const pStd = v.cal(v.evals.splitStandard.pShort);
  const rows = cur.plan.debits.map((d, i) => {
    const moved = d.day !== std[i].day;
    const kind = i === 0 ? 'house' : 'num';
    const frac = i === 0 ? 0.6 : 1;
    return `<div class="row">${ring(kind, String(i), frac)}<div class="mid">
      <div class="t">${d.role}${i === 0 ? '<span class="badge">Due</span>' : ''}</div>
      <div class="s">${fmt(d.day, 'dow')}${moved && state.mode !== 'standard' ? `<del>${fmt(std[i].day)}</del>` : ''}</div></div>
      ${i === 0 ? `<span class="paybtn">Pay ${money(d.amount)}</span>` : `<span class="amt">${money(d.amount)}</span>`}</div>`;
  }).join('');
  const why = reasons(v, cur.plan);
  const main = v.model.streams[0];
  const bullets = [];
  if (main) {
    const cadence = { biweekly: 'every other', weekly: 'every', semimonthly: 'on the 15th and last day', monthly: 'monthly' }[main.kind];
    const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow(v.paydays.find((x) => x.desc === main.desc)?.day ?? TODAY)];
    const when = main.kind === 'semimonthly' ? cadence : `${cadence} ${wd}`;
    const next = v.paydays.filter((x) => x.desc === main.desc).slice(0, 3).map((x) => fmt(x.day)).join(', ');
    bullets.push(`Your ${title(main.desc)} paycheck, about ${money(Math.round(main.typical))}, lands ${when}: ${next}.`);
  } else {
    bullets.push('No regular paycheck found, so we modeled your gig deposits week by week from your history.');
  }
  for (const w of why.slice(1)) {
    if (w.after && w.after.day <= w.debit.day) {
      const gap = w.debit.day - w.after.day;
      bullets.push(`${w.debit.role} on ${fmt(w.debit.day)}: ${gap === 0 ? 'the same day as' : `${gap} day${gap > 1 ? 's' : ''} after`} your ${fmt(w.after.day)} paycheck.`);
    }
  }
  if (v.model.bills.length) bullets.push(`${v.model.bills.length} recurring bills are counted, like ${v.model.bills.slice(0, 2).map((b) => title(b.desc)).join(' and ')}.`);
  const delta = pStd - pNow;
  $('screen-plan').innerHTML = `${statusBar()}<div class="scroll">
    <div class="sub-head"><span class="back">${icon('chevron-left')}</span><div><h2>Esusu Split Pay</h2><p>December rent · ${money(v.rent)}</p></div></div>
    <div class="chips">
      <button class="chip ${state.mode === 'standard' ? 'on' : ''}" data-mode="standard">Standard dates</button>
      <button class="chip ${state.mode === 'fit' ? 'on' : ''}" data-mode="fit">Paycheck Fit</button>
      ${state.mode === 'custom' ? '<button class="chip on" data-mode="custom">Your dates</button>' : ''}
    </div>
    <div class="card">${rows}</div>
    <div class="risk ${tone(pNow) === 'good' ? '' : tone(pNow) === 'mid' ? 'warn' : 'bad'}">
      <div class="lbl">Chance a payment comes up short</div>
      <div class="big"><b>${pct(pNow)}</b><span>${state.mode === 'standard' ? 'with the standard dates' : delta > 0.005 ? `down from ${pct(pStd)} on standard dates` : 'standard dates already fit your pay'}</span></div>
      <div class="bar"><i style="width:${Math.max(1.5, pNow * 100)}%"></i><u style="left:${Math.min(99, pStd * 100)}%"></u></div>
      <div class="legend"><span>This plan</span><span>Standard ${pct(pStd)}</span></div>
    </div>
    <div class="sec-h" style="padding-bottom:2px"><h3>Why these dates</h3></div>
    <div class="why"><ul>${bullets.slice(0, 4).map((b) => `<li>${b}</li>`).join('')}</ul></div>
    <div class="cta">Confirm these dates</div>
    <div class="fine">Estimated from ${v.txCount.toLocaleString()} transactions since ${fmt(v.renter.history[0].day)}. Lending by Stable Home Fund, subject to approval.</div>
  </div>`;
}

function title(desc) {
  return desc.replace(/ PAYROLL$/, '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bIns\b/, 'Insurance');
}

function chart(v, cur) {
  const W = 347;
  const H = 196;
  const L = 34;
  const R = 8;
  const T = 14;
  const B = 24;
  const [p10, p50, p90] = bands(v, cur.plan);
  const D = p50.length;
  let lo = Math.min(0, ...p10);
  let hi = Math.max(...p90);
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const x = (t) => L + (t / (D - 1)) * (W - L - R);
  const y = (val) => T + (1 - (val - lo) / (hi - lo)) * (H - T - B);
  let band = '';
  for (let t = 0; t < D; t++) band += `${t ? 'L' : 'M'}${x(t).toFixed(1)},${y(p90[t]).toFixed(1)}`;
  for (let t = D - 1; t >= 0; t--) band += `L${x(t).toFixed(1)},${y(p10[t]).toFixed(1)}`;
  const med = Array.from(p50, (val, t) => `${t ? 'L' : 'M'}${x(t).toFixed(1)},${y(val).toFixed(1)}`).join('');
  const step = (hi - lo) > 3000 ? 1000 : 500;
  let grid = '';
  for (let g = Math.ceil(lo / step) * step; g <= hi; g += step) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" stroke="${g === 0 ? '#d64545' : '#eef0ef'}" ${g === 0 ? 'stroke-dasharray="3 3"' : ''}/>
      <text x="${L - 6}" y="${y(g) + 3.5}" text-anchor="end">${g === 0 ? '$0' : `$${(g / 1000).toFixed(g % 1000 ? 1 : 0)}k`}</text>`;
  }
  const tickDays = [TODAY, TODAY + 21, v.due, v.due + 14, HORIZON_END];
  const ticks = tickDays.map((d, i) => `<text x="${x(d - TODAY)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === tickDays.length - 1 ? 'end' : 'middle'}">${fmt(d)}</text>`).join('');
  const pays = v.paydays.map((p) => `<circle cx="${x(p.day - TODAY)}" cy="${H - B + 1}" r="3.2" fill="#008f34"/>`).join('');
  const debits = cur.plan.debits.map((d, i) => {
    const t = d.day - TODAY;
    return `<line x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - B}" stroke="#13322b" stroke-opacity=".18"/>
      <circle cx="${x(t)}" cy="${y(p50[t])}" r="4.5" fill="#fff" stroke="#13322b" stroke-width="2"/>
      <text x="${x(t)}" y="${T - 3}" text-anchor="middle" font-weight="600" fill="#13322b">${i === 0 ? 'Down' : 'P' + i}</text>`;
  }).join('');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="DM Sans" font-size="10" fill="#718480">
    ${grid}<path d="${band}" fill="#def8c2" opacity=".85"/><path d="${med}" fill="none" stroke="#13322b" stroke-width="2"/>
    ${debits}${pays}${ticks}</svg>`;
}

function datesScreen(v, cur) {
  const sel = cur.plan.debits[1].day;
  const allowed = new Map(v.firstDays.map((f) => [f.day, f]));
  const payset = new Set(v.paydays.map((p) => p.day));
  const first = v.due; // Dec 1 2026
  const startPad = dow(first);
  let cells = '';
  for (let i = 0; i < startPad; i++) cells += '<div></div>';
  for (let d = 1; d <= 31; d++) {
    const n = first + d - 1;
    const f = allowed.get(n);
    const bg = f ? { good: '#eafbd9', mid: '#fff1d6', bad: '#fde3e1' }[tone(f.p)] : 'transparent';
    cells += `<div class="d ${f ? 'ok' : ''} ${n === sel ? 'sel' : ''} ${payset.has(n) ? 'pay' : ''}" ${f ? `data-day="${n}"` : ''} style="background:${bg}">${d}${f ? `<small class="pct ${tone(f.p)}">${pct(f.p)}</small>` : ''}</div>`;
  }
  const e = v.evals;
  const opts = [
    ['Pay in full', `${fmt(v.due)}`, v.cal(e.full.pShort)],
    ['Affirm, 2 payments', `${fmt(v.plans.affirm.debits[0].day)} and ${fmt(v.plans.affirm.debits[1].day)}, if approved`, v.cal(e.affirm.pShort)],
    ['Split Pay, standard dates', v.plans.splitStandard.debits.map((d) => fmt(d.day)).join(', '), v.cal(e.splitStandard.pShort)],
    ['Split Pay, Paycheck Fit', v.plans.splitFit.debits.map((d) => fmt(d.day)).join(', '), v.cal(e.splitFit.pShort)],
  ];
  const best = Math.min(...opts.map((o) => o[2]));
  $('screen-dates').innerHTML = `${statusBar()}<div class="scroll">
    <div class="sub-head"><span class="back">${icon('chevron-left')}</span><div><h2>Pick your dates</h2><p>Your balance through December</p></div></div>
    <div class="chart">${chart(v, cur)}</div>
    <div class="cal-legend"><span><i style="background:#13322b;border-radius:50%"></i>Median</span><span><i style="background:#def8c2"></i>8 in 10 outcomes</span><span><i style="background:#008f34;border-radius:50%"></i>Paycheck</span></div>
    <div class="sec-h" style="padding-top:12px"><h3>Payment 1 date</h3><span style="font-size:12px;color:#718480">chance short</span></div>
    <div class="cal"><div class="dow">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((s) => `<span>${s}</span>`).join('')}</div><div class="grid">${cells}</div></div>
    <div class="sec-h"><h3>Compare options</h3></div>
    <div class="opts">${opts.map((o) => `<div class="opt"><div><div class="${o[2] === best ? 'on' : ''}">${o[0]}</div><div class="k">${o[1]}</div></div><span class="pct ${tone(o[2])}">${pct(o[2])}</span></div>`).join('')}</div>
  </div>`;
}

function team() {
  const t = EVAL.test;
  const c = t.calibration;
  const m = t.missed;
  const bins = (arr, color, r) => arr.map((b) => `<circle cx="${40 + b.pred * 250}" cy="${190 - b.obs * 170}" r="${r}" fill="${color}"/>`).join('');
  const line = (arr, color) => arr.map((b, i) => `${i ? 'L' : 'M'}${40 + b.pred * 250},${190 - b.obs * 170}`).join('');
  const rel = `<svg width="100%" viewBox="0 0 300 214" font-family="DM Sans" font-size="10" fill="#718480">
    ${[0, 0.25, 0.5, 0.75, 1].map((g) => `<line x1="40" x2="290" y1="${190 - g * 170}" y2="${190 - g * 170}" stroke="#eef0ef"/><text x="34" y="${193 - g * 170}" text-anchor="end">${g * 100}%</text><text x="${40 + g * 250}" y="206" text-anchor="middle">${g * 100}%</text>`).join('')}
    <line x1="40" y1="190" x2="290" y2="20" stroke="#b9c2c0" stroke-dasharray="4 4"/>
    <path d="${line(c.binsRaw)}" fill="none" stroke="#a1adaa" stroke-width="1.5"/>${bins(c.binsRaw, '#a1adaa', 3.5)}
    <path d="${line(c.binsCalibrated)}" fill="none" stroke="#008f34" stroke-width="2"/>${bins(c.binsCalibrated, '#008f34', 4)}
    <circle cx="52" cy="26" r="4" fill="#008f34"/><text x="60" y="29.5" fill="#008f34" font-weight="600">calibrated</text>
    <circle cx="52" cy="41" r="3.5" fill="#a1adaa"/><text x="60" y="44.5">raw simulation</text><text x="168" y="29.5">dashed: perfect</text></svg>`;
  const arch = Object.entries(t.byArchetype).filter(([, a]) => a.renters >= 5).map(([k, a]) => `<tr><td>${{ biweekly: 'Every other week', weekly: 'Weekly', semimonthly: '15th and last day', gig: 'Gig, daily', mixed: 'Paycheck plus gig' }[k]}</td><td class="num">${a.renters}</td><td class="num">${pct1(a.standard)}</td><td class="num"><b>${pct1(a.fit)}</b></td></tr>`).join('');
  $('team').innerHTML = `<div class="dash">
    <div class="dash-h"><h2>Data Insights For Esusu Pay: <em>Paycheck Fit backtest</em></h2><span class="upd">Last Updated on ${EVAL.generated}</span></div>
    <div class="dash-banner">${icon('sparkles')}The model learned only from Feb 1 to Nov 9 transactions. Every plan was then scored on ${EVAL.config.futures} December futures per renter that it never saw.</div>
    <div class="dash-grid">
      <div class="panel"><h4>Split Pay renters tested: ${EVAL.population.testRenters}</h4><div class="stat-tiles">
        <div class="stat"><b>${(m.splitStandard.rate * 100).toFixed(1)}%</b><span>payments came up short on standard dates</span></div>
        <div class="stat"><b>${(m.splitFit.rate * 100).toFixed(1)}%</b><span>came up short with Paycheck Fit</span></div>
        <div class="stat"><b>${Math.round(t.relativeReduction * 100)}%</b><span>fewer short payments</span></div>
        <div class="stat"><b>${(c.eceCalibrated * 100).toFixed(1)}%</b><span>calibration error, was ${(c.eceRaw * 100).toFixed(1)}% raw</span></div>
      </div></div>
      <div class="panel"><h4>Predicted vs. actual chance of a short payment</h4>${rel}</div>
      <div class="panel"><h4>By pay pattern (5+ renters)</h4><table class="ptable"><thead><tr><th>Pay pattern</th><th class="num">Renters</th><th class="num">Standard</th><th class="num">Fit</th></tr></thead><tbody>${arch}</tbody></table>
        <div class="method"><b>Installments only:</b> ${pct1(t.installments.splitStandard.rate)} to ${pct1(t.installments.splitFit.rate)} of renter-months. <b>Any overdraft in the cycle:</b> ${pct1(t.overdraft.splitStandard.rate)} to ${pct1(t.overdraft.splitFit.rate)}. <b>Pay in full on Dec 1:</b> ${pct1(t.missed.full.rate)} short.</div></div>
    </div>
    <p class="method"><b>How it works.</b> Paychecks are found by testing each recurring deposit against weekly, every-other-week and 15th/last-day calendars (with bank-holiday shifts); bills by day-of-month regularity; everything else is resampled in whole weeks. ${EVAL.config.paths} simulated Decembers score each of the allowed Split Pay schedules on the same paths, and the safest one wins. Raw probabilities are recalibrated with isotonic regression fit on a separate ${EVAL.population.calibrationRenters} renters, including the optimizer's own picks, so the winner's-curse optimism is corrected. Population: ${EVAL.population.candidates} Split Pay candidates (paying in full looked at least ${EVAL.config.candidateMin * 100}% risky) out of ${EVAL.population.renters.toLocaleString()} synthetic renters.</p>
  </div>`;
}

function personas() {
  $('personas').innerHTML = PERSONAS.map((p, i) => `<button class="persona ${i === state.idx ? 'on' : ''}" data-p="${i}" title="${p.note}"><span class="av">${p.initials}</span>${p.name}</button>`).join('');
}

function render() {
  $('screen-home').classList.add('home-bg');
  const v = view();
  const cur = current(v);
  personas();
  home(v, cur);
  planScreen(v, cur);
  datesScreen(v, cur);
  if (window.lucide) window.lucide.createIcons();
}

document.addEventListener('click', (ev) => {
  const p = ev.target.closest('[data-p]');
  if (p) { state.idx = Number(p.dataset.p); state.mode = 'fit'; state.first = null; render(); return; }
  const m = ev.target.closest('[data-mode]');
  if (m) { state.mode = m.dataset.mode; render(); return; }
  const d = ev.target.closest('[data-day]');
  if (d) { state.mode = 'custom'; state.first = Number(d.dataset.day); render(); }
});

team();
render();
window.__ready = true;
