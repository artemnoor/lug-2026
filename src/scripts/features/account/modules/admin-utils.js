export const dateLabel = (value) => value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
export const shortDateLabel = (value) => value ? new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '—';
export const rangeLabel = (start, end) => {
  const s = start ? new Date(start).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
  const e = end ? new Date(end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
  return s || e ? `${s || '?'} — ${e || '?'}` : 'Сроки не заданы';
};
export const localDateValue = (value) => {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
export const isoDateValue = (value) => value ? new Date(value).toISOString() : undefined;
export const initials = (fio) => String(fio || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || '?';
export function plural(value, one, few, many = `${one}ов`) {
  const number = Math.abs(Number(value)) % 100;
  if (number >= 11 && number <= 19) return many;
  const last = number % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
