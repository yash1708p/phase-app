import type { ISODate } from '../types';

/** Local-calendar date helpers. All math is done on Y/M/D, never on instants. */

const pad = (n: number) => String(n).padStart(2, '0');

export const toISO = (d: Date): ISODate =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseISO = (iso: ISODate): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const todayISO = (): ISODate => toISO(new Date());

const utcDay = (iso: ISODate) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** a − b in whole days. */
export const diffDays = (a: ISODate, b: ISODate): number => Math.round(utcDay(a) - utcDay(b));

export const addDays = (iso: ISODate, n: number): ISODate => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};

export const isBetween = (iso: ISODate, start: ISODate, end: ISODate) => iso >= start && iso <= end;

export const startOfMonth = (iso: ISODate): ISODate => `${iso.slice(0, 7)}-01`;

export const addMonths = (iso: ISODate, n: number): ISODate => {
  const d = parseISO(startOfMonth(iso));
  d.setMonth(d.getMonth() + n);
  return toISO(d);
};

export const endOfMonth = (iso: ISODate): ISODate => addDays(addMonths(iso, 1), -1);

export const sameMonth = (a: ISODate, b: ISODate) => a.slice(0, 7) === b.slice(0, 7);

export const isValidISO = (s: string): s is ISODate =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && toISO(parseISO(s)) === s;

export const formatDay = (iso: ISODate, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
  parseISO(iso).toLocaleDateString(undefined, opts);

export const formatRange = (a: ISODate, b: ISODate) =>
  sameMonth(a, b)
    ? `${formatDay(a)}–${parseISO(b).getDate()}`
    : `${formatDay(a)} – ${formatDay(b)}`;

export const monthLabel = (iso: ISODate) =>
  parseISO(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/** Days of the month laid out in weeks (Sunday first), padded with nulls. */
export const monthGrid = (monthStart: ISODate): (ISODate | null)[] => {
  const first = parseISO(monthStart);
  const days = diffDays(endOfMonth(monthStart), monthStart) + 1;
  const cells: (ISODate | null)[] = Array(first.getDay()).fill(null);
  for (let i = 0; i < days; i++) cells.push(addDays(monthStart, i));
  while (cells.length % 7) cells.push(null);
  return cells;
};

export const relativeDays = (n: number) =>
  n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`;
