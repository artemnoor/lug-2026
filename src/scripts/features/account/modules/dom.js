export function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

export function phaseOpen(start, end) {
  const from = new Date(start || '').getTime();
  const to = new Date(end || '').getTime();
  return Number.isFinite(from) && Number.isFinite(to) && Date.now() >= from && Date.now() <= to;
}

export function formatDate(value) {
  return value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(value)) : '—';
}

export function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function publicDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '';
}
