export const statusLabel = { pending: 'На проверке', approved: 'Принято', rejected: 'Доработка', none: 'Не отправлено' };
export const directionLabels = { science: 'Наука', public: 'Общество', sport: 'Спорт', culture: 'Творчество' };
export const directionIcons = {
  science: '<svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v5.5L4.2 18a2 2 0 0 0 1.7 3h12.2a2 2 0 0 0 1.7-3L14 8.5V3"/><path d="M7 14h10"/></svg>',
  public: '<svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 5 3.5 8 8 9 4.5-1 8-4 8-9V7l-8-4Z"/></svg>',
  sport: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18"/><path d="M3.5 9h17M3.5 15h17"/></svg>',
  culture: '<svg viewBox="0 0 24 24"><path d="m12 3 2.4 5.4 5.6.6-4.2 3.9 1.2 5.6L12 15.6l-5 2.9 1.2-5.6L4 9l5.6-.6L12 3Z"/></svg>'
};
export const workflowMeta = {
  new: { label: 'Новая заявка', className: 'admin-status--new', note: 'Заявка ещё не рассматривалась' },
  review: { label: 'На проверке', className: 'admin-status--pending', note: 'Есть решения в очереди' },
  'needs-work': { label: 'Доработка', className: 'admin-status--danger', note: 'Есть материалы с замечаниями' },
  ready: { label: 'Готово', className: 'admin-status--ready', note: 'Все данные и участники подтверждены' }
};
export const viewTitles = { overview: 'Обзор', teams: 'Команды', users: 'Участники', achievements: 'Достижения', rating: 'Рейтинг групп', deadlines: 'Сроки', broadcast: 'Рассылка' };
