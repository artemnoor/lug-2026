(() => {
  const container = document.getElementById('apiEndpoints');
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  fetch('/api/openapi.json', { credentials: 'same-origin' }).then((response) => { if (!response.ok) throw new Error('contract unavailable'); return response.json(); }).then((spec) => {
    const rows = Object.entries(spec.paths || {}).flatMap(([path, methods]) => Object.entries(methods).map(([method, operation]) => ({ path, method, operation })));
    container.innerHTML = rows.map(({ path, method, operation }) => `<details class="api-endpoint"><summary><span class="api-method">${esc(method.toUpperCase())}</span><span class="api-path">${esc(path)}</span><span class="api-summary">${esc(operation.summary || '')}</span></summary><div class="api-endpoint__body"><p>${esc(operation.description || 'JSON endpoint')}</p>${operation.security ? '<p class="api-endpoint__security">Требуются session cookie и CSRF header для мутаций.</p>' : ''}</div></details>`).join('') || '<p>В контракте пока нет маршрутов.</p>';
  }).catch(() => { container.innerHTML = '<p role="alert">Не удалось загрузить контракт API.</p>'; });
})();
