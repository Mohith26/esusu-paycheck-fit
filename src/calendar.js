// Date helpers on integer day numbers (days since 1970-01-01, UTC) so nothing depends on local time zones.

const MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function day(y, m, d) {
  return Math.round(Date.UTC(y, m - 1, d) / MS);
}

export function parts(n) {
  const dt = new Date(n * MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay() };
}

export function dow(n) {
  return ((n % 7) + 7 + 4) % 7; // 1970-01-01 was a Thursday
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Federal Reserve bank holidays (ACH does not settle) for the demo window.
const HOLIDAYS = new Set([
  day(2026, 1, 1), day(2026, 1, 19), day(2026, 2, 16), day(2026, 5, 25), day(2026, 6, 19),
  day(2026, 7, 3), day(2026, 9, 7), day(2026, 10, 12), day(2026, 11, 11), day(2026, 11, 26),
  day(2026, 12, 25), day(2027, 1, 1), day(2027, 1, 18), day(2027, 2, 15),
]);

export function isBusinessDay(n) {
  const w = dow(n);
  return w !== 0 && w !== 6 && !HOLIDAYS.has(n);
}

export function isHoliday(n) {
  return HOLIDAYS.has(n);
}

// Payroll convention: if payday is not a business day, pay on the prior business day.
export function prevBusinessDay(n) {
  let x = n;
  while (!isBusinessDay(x)) x--;
  return x;
}

// Bill/ACH-debit convention: if the due day is not a business day, it posts the next business day.
export function nextBusinessDay(n) {
  let x = n;
  while (!isBusinessDay(x)) x++;
  return x;
}

export function addBusinessDays(n, k) {
  let x = n;
  let left = k;
  const step = k >= 0 ? 1 : -1;
  while (left !== 0) {
    x += step;
    if (isBusinessDay(x)) left -= step;
  }
  return x;
}

export function fmt(n, style = 'short') {
  const p = parts(n);
  if (style === 'short') return `${MONTHS[p.m - 1]} ${p.d}`;
  if (style === 'dm') return `${p.d} ${MONTHS[p.m - 1]}`;
  if (style === 'dow') return `${DOW[p.dow]}, ${MONTHS[p.m - 1]} ${p.d}`;
  if (style === 'iso') return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  return `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}

export const DOW_NAMES = DOW;
export const MONTH_NAMES = MONTHS;
