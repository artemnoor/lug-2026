export function workflow(team) {
  return team?.workflow || { key: 'new', label: 'Новая заявка', reason: 'Состав ещё не подтверждён' };
}

export function workflowPresentation(team, workflowMeta) {
  const current = workflow(team);
  return { ...current, ...(workflowMeta[current.key] || workflowMeta.new) };
}

export function teamSearchText(team) {
  const notifications = (team.notifications || []).map((item) => `${item.title} ${item.message}`).join(' ');
  const members = (team.members || []).map((member) => `${member.fio} ${member.phone}`).join(' ');
  return `${team.name || ''} ${team.group || ''} ${members} ${notifications}`.toLowerCase();
}

export function teamMatches(team, query, status = 'all') {
  const textMatches = !query || teamSearchText(team).includes(query.trim().toLowerCase());
  const statusMatches = status === 'all' || workflow(team).key === status;
  return textMatches && statusMatches;
}

export function pendingForTeam(team) {
  const identity = (team.members || []).filter((member) => member.identityStatus === 'pending').length;
  const achievements = (team.achievements || []).filter((item) => item.status === 'pending').length;
  const video = team.videoCard?.status === 'pending' ? 1 : 0;
  return { identity, achievements, video, total: identity + achievements + video };
}

export function phaseState(settings, startKey, endKey) {
  const start = new Date(settings?.[startKey] || '').getTime();
  const end = new Date(settings?.[endKey] || '').getTime();
  const now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'none';
  if (now > end) return 'done';
  if (now < start) return 'upcoming';
  return 'active';
}

export const phaseKeys = [
  { key: 'registration', start: 'registrationStart', end: 'registrationDeadline', label: 'Регистрация' },
  { key: 'portfolio', start: 'portfolioStart', end: 'portfolioDeadline', label: 'Портфолио' },
  { key: 'video', start: 'videoStart', end: 'videoDeadline', label: 'Видео' },
  { key: 'results', start: 'resultsStart', end: 'resultsDeadline', label: 'Результаты' },
];
