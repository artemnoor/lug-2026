export const messengerMeta = {
  telegram: { label: 'Telegram', contactLabel: 'Никнейм или ID Telegram', placeholder: '@username или 123456789', test: (value) => /^@?[a-zA-Z0-9_]{4,32}$/.test(value) || /^(?:https?:\/\/)?t\.me\/[a-zA-Z0-9_]{4,32}$/i.test(value) },
  vk: { label: 'VK', contactLabel: 'Ссылка или ID VK', placeholder: 'vk.com/username или ID', test: (value) => /^(?:(?:https?:\/\/)?(?:www\.)?vk\.com\/)?[a-zA-Z0-9_.-]{2,64}$/.test(value) },
  max: { label: 'MAX', contactLabel: 'Номер телефона или никнейм MAX', placeholder: '+7 999 000-00-00 или @username', test: (value) => /^(?:\+?\d[\d\s()-]{8,}|@?[a-zA-Z0-9_.-]{3,64})$/.test(value) },
};

export const isStrongPassword = (value) => /[a-zа-яё]/.test(value) && /[A-ZА-ЯЁ]/.test(value) && /\d/.test(value) && /[^A-Za-zА-Яа-яЁё\d\s]/.test(value) && value.length >= 8;

export const isAllowedFile = (file) => file && (/^image\//i.test(file.type) || /^application\/pdf$/i.test(file.type) || /\.(png|jpe?g|webp|gif|avif|heic|heif|tiff?|bmp|pdf)$/i.test(file.name));

export function getFio(dialog, owner) {
  const prefix = owner === 'captain' ? 'siteCap' : 'siteJoin';
  return ['Surname', 'Name', 'Patronymic'].map((part) => dialog.querySelector(`#${prefix}${part}`)?.value.trim()).filter(Boolean).join(' ');
}

export function getMessengerContacts(dialog, selections, owner) {
  const contacts = {};
  selections[owner].forEach((key) => {
    const input = dialog.querySelector(`[data-messenger-contact="${owner}-${key}"]`);
    const value = input?.value.trim();
    if (value) contacts[key] = value;
  });
  return contacts;
}

export function renderMessengerContacts({ dialog, selections, owner, syncDisabledFields }) {
  const container = dialog.querySelector(`[data-messenger-contacts="${owner}"]`);
  const status = dialog.querySelector(`[data-messenger-status="${owner}"]`);
  if (!container || !status) return;
  const previousValues = Object.fromEntries([...container.querySelectorAll('[data-messenger-contact]')].map((input) => [input.dataset.messengerContact, input.value]));
  container.innerHTML = [...selections[owner]].map((key) => {
    const meta = messengerMeta[key];
    return `<label class="site-auth-dialog__messenger-contact"><span>${meta.contactLabel}</span><input data-auth-field="${owner}" data-messenger-contact="${owner}-${key}" type="text" autocomplete="off" placeholder="${meta.placeholder}" required><small data-messenger-error="${owner}-${key}" role="alert"></small></label>`;
  }).join('');
  container.querySelectorAll('[data-messenger-contact]').forEach((input) => { if (previousValues[input.dataset.messengerContact] !== undefined) input.value = previousValues[input.dataset.messengerContact]; });
  status.textContent = selections[owner].size ? `Выбрано способов связи: ${selections[owner].size}` : 'Способ связи ещё не выбран';
  dialog.querySelectorAll(`.site-auth-dialog__messenger-option[data-messenger-owner="${owner}"]`).forEach((button) => {
    const active = selections[owner].has(button.dataset.messenger);
    button.classList.toggle('is-selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
  syncDisabledFields();
}
