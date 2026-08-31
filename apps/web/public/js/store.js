/* Client gateway. No contest data is stored in the browser. */
(function (window) {
  'use strict';

  const ERROR_MESSAGES = {
    CAPTAIN_REQUIRED: 'Это действие доступно только капитану команды.',
    REGISTRATION_CLOSED: 'Редактирование команды сейчас закрыто.',
    PORTFOLIO_CLOSED: 'Период подачи достижений сейчас закрыт.',
    VIDEO_CLOSED: 'Период подачи видео сейчас закрыт.',
    UPLOAD_NOT_OWNED: 'Сначала загрузите файл через форму.',
    ACHIEVEMENT_FIELDS_INVALID: 'Заполните обязательные поля достижения и прикрепите документ.',
    TEAM_DESCRIPTION_TOO_LONG: 'Описание команды слишком длинное.',
    TEAM_CAPACITY_REACHED: 'В команде достигнута заявленная вместимость.',
    HTTP_401: 'Требуется войти в личный кабинет.',
    HTTP_403: 'Недостаточно прав для выполнения действия.',
    HTTP_429: 'Слишком много запросов. Повторите позже.',
    HTTP_413: 'Размер или количество файлов превышает лимит.'
  };

  async function request(path, options = {}) {
    if (window.location.protocol === 'file:') {
      throw new Error('Сайт открыт как файл. Запустите приложение и откройте http://localhost:4173, чтобы работали вход и данные кабинета.');
    }
    if (window.location.protocol === 'http:' && !isLocalDevelopmentHost(window.location.hostname)) {
      const secureUrl = new URL(window.location.href);
      secureUrl.protocol = 'https:';
      if (secureUrl.port === '80') secureUrl.port = '';
      window.location.replace(secureUrl.toString());
      throw new Error('Перенаправление на защищённое HTTPS-соединение.');
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
    if (!response.ok) {
      const error = new Error(payload.error || 'Не удалось выполнить запрос.');
      error.code = payload.code || 'HTTP_ERROR';
      error.status = response.status;
      error.userMessage = ERROR_MESSAGES[error.code] || error.message;
      throw error;
    }
    return payload;
  }

  function isLocalDevelopmentHost(hostname) {
    return new Set(['localhost', '127.0.0.1', '::1', '[::1]']).has(String(hostname || '').toLowerCase());
  }

  async function uploadMultipart(file, kind = 'attachment') {
    const intent = await request('/api/uploads/intent', {
      method: 'POST',
      body: JSON.stringify({ name: file.name, contentType: file.type, size: file.size, kind })
    });
    const completedParts = [];
    for (const part of intent.parts || []) {
      const start = (part.partNumber - 1) * intent.partSize;
      const response = await fetch(part.url, { method: 'PUT', body: file.slice(start, start + intent.partSize) });
      if (!response.ok) throw new Error('Не удалось загрузить часть файла.');
      const etag = response.headers.get('ETag');
      if (!etag) throw new Error('Object storage не вернул ETag части файла.');
      completedParts.push({ partNumber: part.partNumber, etag });
    }
    return request('/api/uploads/complete', {
      method: 'POST',
      body: JSON.stringify({ uploadId: intent.uploadId, key: intent.key, name: file.name, contentType: file.type, kind, parts: completedParts })
    });
  }

  async function uploadStream(file, kind = 'attachment') {
    return request('/api/uploads/stream', {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': file.type, 'X-Upload-Name': file.name, 'X-Upload-Kind': kind }
    });
  }

  async function uploadRegistrationCard(file) {
    try {
      return await request('/api/auth/student-card/stream', {
        method: 'POST', body: file,
        headers: { 'Content-Type': file.type, 'X-Upload-Name': file.name }
      });
    } catch (error) {
      if ((error.status ?? error.status_code) !== 501) throw error;
    }
    const intent = await request('/api/auth/student-card/intent', {
      method: 'POST',
      body: JSON.stringify({ name: file.name, contentType: file.type, size: file.size, kind: 'student-card' })
    });
    const completedParts = [];
    for (const part of intent.parts || []) {
      const start = (part.partNumber - 1) * intent.partSize;
      const response = await fetch(part.url, { method: 'PUT', body: file.slice(start, start + intent.partSize) });
      if (!response.ok) throw new Error('Не удалось загрузить часть файла.');
      const etag = response.headers.get('ETag');
      if (!etag) throw new Error('Object storage не вернул ETag части файла.');
      completedParts.push({ partNumber: part.partNumber, etag });
    }
    return request('/api/auth/student-card/complete', {
      method: 'POST',
      body: JSON.stringify({ uploadId: intent.uploadId, key: intent.key, name: file.name,
        contentType: file.type, kind: 'student-card', parts: completedParts,
        registrationToken: intent.registrationToken })
    });
  }

  window.lugStore = {
    request,
    uploadStream,
    uploadRegistrationCard,
    uploadMultipart,
    session: () => request('/api/session'),
    dashboard: () => request('/api/dashboard'),
    login: (email, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    requestPasswordReset: email => request('/api/auth/request-password-reset', { method: 'POST', body: JSON.stringify({ email }) }),
    resetPassword: (email, code, password) => request('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, code, password }) }),
    verifyEmail: (verificationId, code) => request('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ verificationId, code }) }),
    resendEmailCode: verificationId => request('/api/auth/resend-email-code', { method: 'POST', body: JSON.stringify({ verificationId }) }),
    logout: () => request('/api/auth/logout', { method: 'POST', body: '{}' }),
    registerCaptain: (data) => request('/api/auth/register-team', { method: 'POST', body: JSON.stringify(data) }),
    registerParticipant: (data) => request('/api/auth/join-team', { method: 'POST', body: JSON.stringify(data) }),
    invite: (code) => request(`/api/invites/${encodeURIComponent(code)}`),
    updateProfile: (data) => request('/api/me', { method: 'PATCH', body: JSON.stringify(data) }),
    upload: async (file, kind = 'attachment') => {
      if (window.location.hostname === 'localhost') {
        try { return await uploadStream(file, kind); }
        catch (error) {
          if ((error.status ?? error.status_code) !== 501) throw error;
        }
      }
      return uploadMultipart(file, kind);
    },
    addAchievement: (data) => request('/api/achievements', { method: 'POST', body: JSON.stringify(data) }),
    deleteAchievement: (id) => request(`/api/achievements/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    updateTeam: (data) => request('/api/team', { method: 'PATCH', body: JSON.stringify(data) }),
    rotateInvite: () => request('/api/team/invite', { method: 'POST', body: '{}' }),
    updateVideo: async ({ url = '', file } = {}) => {
      if (file) {
        const uploaded = await window.lugStore.upload(file, 'video');
        url = uploaded.url;
      }
      return request('/api/team/video', { method: 'PATCH', body: JSON.stringify({ url }) });
    },
    readNotification: (id) => request(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH', body: '{}' }),
    adminOverview: () => request('/api/admin/overview'),
    adminCollection: (resource, { limit = 100, offset = 0, query = '', status = 'all' } = {}) => {
      const params = new URLSearchParams({ limit, offset, query, status });
      return request(`/api/admin/collections/${encodeURIComponent(resource)}?${params}`);
    },
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
