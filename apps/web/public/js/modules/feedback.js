export function createFeedback({ getNode, escapeHtml }) {
  function showToast(title, text, type = 'info', timeout = 5000) {
    const stack = getNode('adminToastStack');
    if (!stack) return;
    while (stack.children.length >= 4) stack.firstElementChild.remove();
    const toast = document.createElement('div');
    toast.className = `admin-toast admin-toast--${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.innerHTML = `<div class="admin-toast__body"><span class="admin-toast__title">${escapeHtml(title)}</span>${text ? `<p class="admin-toast__text">${escapeHtml(text)}</p>` : ''}</div><button class="admin-toast__close" type="button" aria-label="Закрыть уведомление"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg></button>`;
    const remove = () => {
      if (!toast.isConnected) return;
      toast.classList.add('is-hiding');
      setTimeout(() => toast.remove(), 200);
    };
    toast.querySelector('.admin-toast__close').addEventListener('click', remove);
    stack.append(toast);
    if (timeout) setTimeout(remove, timeout);
  }

  function showError(message) {
    showToast('Ошибка', message || 'Не удалось выполнить действие.', 'error');
  }

  async function run(action) {
    try {
      return await action();
    } catch (error) {
      showError(error.message);
      throw error;
    }
  }

  async function busy(button, action) {
    if (button) {
      if (button.disabled) return;
      button.disabled = true;
    }
    try {
      return await action();
    } finally {
      if (button) button.disabled = false;
    }
  }

  return { showToast, showError, run, busy };
}
