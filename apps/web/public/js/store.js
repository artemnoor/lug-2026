/* Client gateway. No contest data is stored in the browser. */
(function (window) {
  'use strict';

  async function request(path, options = {}) {
    if (window.location.protocol === 'file:') {
      throw new Error('Сайт открыт как файл. Запустите приложение и откройте http://localhost:4173, чтобы работали вход и данные кабинета.');
    }
    let response;
    try {
      const method = String(options.method || 'GET').toUpperCase();
      const csrf = document.cookie.split(';').map((part) => part.trim().split('='))
        .find(([key]) => key === 'lug_csrf')?.[1] || '';
      response = await fetch(path, {
        credentials: 'same-origin',
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}),
          ...(options.headers || {})
        }
      });
    } catch {
      throw new Error('Не удалось подключиться к серверу приложения. Откройте сайт через http://localhost:4173.');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Не удалось выполнить запрос.');
    return payload;
  }

  async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
      reader.readAsDataURL(file);
    });
  }

  window.lugStore = {
    request,
    fileToDataUrl,
    session: () => request('/api/session'),
    dashboard: () => request('/api/dashboard'),
    login: (email, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    verifyEmail: (verificationId, code) => request('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ verificationId, code }) }),
    resendEmailCode: verificationId => request('/api/auth/resend-email-code', { method: 'POST', body: JSON.stringify({ verificationId }) }),
    logout: () => request('/api/auth/logout', { method: 'POST', body: '{}' }),
    registerCaptain: (data) => request('/api/auth/register-team', { method: 'POST', body: JSON.stringify(data) }),
    registerParticipant: (data) => request('/api/auth/join-team', { method: 'POST', body: JSON.stringify(data) }),
    invite: (code) => request(`/api/invites/${encodeURIComponent(code)}`),
    updateProfile: (data) => request('/api/me', { method: 'PATCH', body: JSON.stringify(data) }),
    upload: async (file) => request('/api/uploads', { method: 'POST', body: JSON.stringify({ name: file.name, data: await fileToDataUrl(file) }) }),
    addAchievement: (data) => request('/api/achievements', { method: 'POST', body: JSON.stringify(data) }),
    deleteAchievement: (id) => request(`/api/achievements/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    updateTeam: (data) => request('/api/team', { method: 'PATCH', body: JSON.stringify(data) }),
    rotateInvite: () => request('/api/team/invite', { method: 'POST', body: '{}' }),
    updateVideo: async ({ url = '', file } = {}) => request('/api/team/video', { method: 'PATCH', body: JSON.stringify({ url, fileName: file?.name, fileData: file ? await fileToDataUrl(file) : undefined }) }),
    readNotification: (id) => request(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH', body: '{}' }),
    adminOverview: () => request('/api/admin/overview'),
    adminAudit: () => request('/api/admin/audit'),
    adminUpdateQuota: (teamId, confirmed) => request(`/api/admin/teams/${encodeURIComponent(teamId)}/quota`, { method: 'PATCH', body: JSON.stringify({ confirmed }) }),
    adminReviewTeamField: (teamId, field, status, comment = '') => request(`/api/admin/teams/${encodeURIComponent(teamId)}/review`, { method: 'PATCH', body: JSON.stringify({ field, status, comment }) }),
    adminRemoveMember: (teamId, userId) => request(`/api/admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    adminReviewIdentity: (userId, status, comment = '') => request(`/api/admin/users/${encodeURIComponent(userId)}/identity`, { method: 'PATCH', body: JSON.stringify({ status, comment }) }),
    adminReviewAchievement: (achievementId, data) => request(`/api/admin/achievements/${encodeURIComponent(achievementId)}/review`, { method: 'PATCH', body: JSON.stringify(data) }),
    adminReviewVideo: (teamId, data) => request(`/api/admin/videos/${encodeURIComponent(teamId)}/review`, { method: 'PATCH', body: JSON.stringify(data) }),
    adminUpdateSettings: (data) => request('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(data) }),
    adminBroadcast: (data) => request('/api/admin/notifications/broadcast', { method: 'POST', body: JSON.stringify(data) })
  };
})(window);
