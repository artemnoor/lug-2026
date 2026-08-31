let capFile = null;
let joinFile = null;

function switchAuthTab(tab) {
  const forms = { login: 'loginForm', create_team: 'createTeamForm', join_team: 'joinTeamForm' };
  const buttons = { login: 'tabLoginBtn', create_team: 'tabCreateTeamBtn', join_team: 'tabJoinTeamBtn' };
  Object.entries(forms).forEach(([key, id]) => document.getElementById(id).style.display = key === tab ? 'block' : 'none');
  Object.entries(buttons).forEach(([key, id]) => document.getElementById(id).classList.toggle('active', key === tab));
}

function showError(id, error) {
  const node = document.getElementById(id);
  node.textContent = error.message || error;
  node.style.display = 'block';
}

function handleFileSelect(input, previewId) {
  const file = input.files?.[0];
  if (!file) return;
  if (input.id === 'capStudentCardFile') capFile = file;
  if (input.id === 'joinStudentCardFile') joinFile = file;
  const preview = document.getElementById(previewId);
  preview.textContent = `✓ ${file.name} · ${Math.ceil(file.size / 1024)} КБ`;
  preview.style.display = 'inline-flex';
}

async function checkInviteCode() {
  const code = document.getElementById('joinInviteCode').value.trim();
  const status = document.getElementById('inviteCodeStatus');
  if (!code) { status.textContent = ''; return; }
  status.textContent = 'Проверяем приглашение…';
  try {
    const { team } = await window.lugStore.invite(code);
    document.getElementById('joinTeamNameDisplay').value = team.name;
    document.getElementById('joinGroupDisplay').value = team.group;
    status.textContent = `✓ Приглашение активно до ${new Date(team.inviteExpiresAt).toLocaleDateString('ru-RU')}`;
    status.className = 'form-help is-success';
  } catch (error) {
    document.getElementById('joinTeamNameDisplay').value = '';
    document.getElementById('joinGroupDisplay').value = '';
    status.textContent = error.message;
    status.className = 'form-help is-error';
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  try {
    const result = await window.lugStore.login(document.getElementById('loginEmail').value.trim(), document.getElementById('loginPassword').value);
    window.location.href = result.user.role === 'admin' ? 'admin.html' : 'cabinet.html';
  } catch (error) { showError('loginError', error); }
}

async function handleCreateTeamSubmit(event) {
  event.preventDefault();
  const errorId = 'createTeamError'; document.getElementById(errorId).style.display = 'none';
  if (!capFile) return showError(errorId, 'Загрузите скриншот личного кабинета студента.');
  if (capFile.size > 5 * 1024 * 1024) return showError(errorId, 'Размер файла не должен превышать 5 МБ.');
  const password = document.getElementById('capPassword').value;
  if (password !== document.getElementById('capPasswordConfirm').value) return showError(errorId, 'Введённые пароли не совпадают.');
  try {
    const card = await window.lugStore.uploadRegistrationCard(capFile);
    const result = await window.lugStore.registerCaptain({
      fio: document.getElementById('capFio').value, group: document.getElementById('capGroup').value,
      teamName: document.getElementById('capTeamName').value, totalStudentsInGroup: document.getElementById('capGroupSize').value,
      email: document.getElementById('capEmail').value, messenger: document.getElementById('capMessenger').value,
      messengerContact: document.getElementById('capMessengerContact').value, telegramAccount: document.getElementById('capTelegram').value,
      password, studentCardFile: card.url, studentCardFileName: capFile.name,
      studentCardUploadToken: card.registrationToken, studentCardSize: card.size,
      studentCardType: card.type, consent: document.getElementById('capConsent').checked
    });
    sessionStorage.setItem('lug-welcome-guide', result.user.role);
    window.location.href = 'cabinet.html?welcome=1';
  } catch (error) { showError(errorId, error); }
}

async function handleJoinTeamSubmit(event) {
  event.preventDefault();
  const errorId = 'joinTeamError'; document.getElementById(errorId).style.display = 'none';
  if (!joinFile) return showError(errorId, 'Загрузите скриншот личного кабинета студента.');
  if (joinFile.size > 5 * 1024 * 1024) return showError(errorId, 'Размер файла не должен превышать 5 МБ.');
  const password = document.getElementById('joinPassword').value;
  if (password !== document.getElementById('joinPasswordConfirm').value) return showError(errorId, 'Введённые пароли не совпадают.');
  try {
    const card = await window.lugStore.uploadRegistrationCard(joinFile);
    const result = await window.lugStore.registerParticipant({
      inviteCode: document.getElementById('joinInviteCode').value, fio: document.getElementById('joinFio').value,
      email: document.getElementById('joinEmail').value, messenger: document.getElementById('joinMessenger').value,
      messengerContact: document.getElementById('joinMessengerContact').value, telegramAccount: document.getElementById('joinTelegram').value,
      password, studentCardFile: card.url, studentCardFileName: joinFile.name,
      studentCardUploadToken: card.registrationToken, studentCardSize: card.size,
      studentCardType: card.type, consent: document.getElementById('joinConsent').checked
    });
    sessionStorage.setItem('lug-welcome-guide', result.user.role);
    window.location.href = 'cabinet.html?welcome=1';
  } catch (error) { showError(errorId, error); }
}

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('invite')) { switchAuthTab('join_team'); document.getElementById('joinInviteCode').value = params.get('invite'); checkInviteCode(); }
  if (params.get('action') === 'register') switchAuthTab('create_team');
  if (params.get('action') === 'join') switchAuthTab('join_team');
});
