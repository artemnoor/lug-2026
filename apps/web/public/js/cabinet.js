import { escapeHtml as esc, formatDate as date, phaseOpen } from './modules/dom.js';
import { parseVideoUrl, videoProviderMeta } from './modules/video.js';
import { messengerLabels, nameInitial, plural } from './modules/cabinet-utils.js';
import { cabinetApi } from './modules/cabinet-api.js';
import { bindCabinetEvents } from './modules/cabinet-events.js';
import { renderDashboard, renderNotifications, renderOverview, renderPortfolioSummary, renderProfile, renderTeam as renderTeamView, renderVideo as renderVideoView } from './modules/cabinet-renderers.js';

(() => {
  'use strict';

  let state = null;
  let direction = 'science';
  let selectedMaterialId = null;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  function setVideoFeedback(message = '', type = 'error') {
    const feedback = $('#videoFeedback');
    if (!feedback) return;
    feedback.hidden = !message;
    feedback.className = `video-feedback${message ? ` is-${type}` : ''}`;
    feedback.textContent = message;
  }

  function renderVideoPreview(parsed) {
    const preview = $('#videoPreview');
    const frame = $('#videoPreviewFrame');
    const title = $('#videoPreviewTitle');
    const meta = $('#videoPreviewMeta');
    const open = $('#videoPreviewOpen');
    if (!preview || !frame || !title || !meta || !open) return;
    frame.replaceChildren();
    if (!parsed?.valid) { preview.hidden = true; return; }
    preview.hidden = false;
    title.textContent = parsed.title;
    meta.textContent = parsed.embedUrl ? 'Проверьте, что видео открывается без авторизации и звук включается по нажатию.' : 'Для этого сервиса показываем карточку ссылки. Откройте её, чтобы проверить доступ к видео.';
    open.href = parsed.url;
    if (parsed.provider === 'file') {
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.src = parsed.url;
      video.setAttribute('aria-label', parsed.title);
      frame.append(video);
    } else if (parsed.embedUrl) {
      const iframe = document.createElement('iframe');
      iframe.title = parsed.title;
      iframe.src = parsed.embedUrl;
      iframe.loading = 'lazy';
      iframe.allow = 'autoplay; fullscreen; picture-in-picture';
      iframe.referrerPolicy = 'no-referrer';
      frame.append(iframe);
    } else {
      frame.innerHTML = `<div class="video-preview__placeholder"><span aria-hidden="true">▶</span><strong>${esc(parsed.label)}</strong><small>Предпросмотр откроется на странице сервиса.</small></div>`;
    }
  }

  function setVideoUrlState(value, { showInvalid = false } = {}) {
    const input = $('#videoUrl');
    const hint = $('#videoUrlHint');
    const parsed = parseVideoUrl(value);
    const hasValue = String(value).trim().length > 0;
    if (input) input.setAttribute('aria-invalid', String(Boolean(hasValue && !parsed.valid && showInvalid)));
    if (parsed.valid) {
      if (hint) hint.textContent = `${parsed.label}. Ссылка распознана, можно проверить предпросмотр.`;
      setVideoFeedback('');
      renderVideoPreview(parsed);
    } else {
      if (hint) hint.textContent = 'Ссылка должна открываться без входа в аккаунт.';
      renderVideoPreview(null);
      if (showInvalid && hasValue) setVideoFeedback(parsed.message, 'error');
      else if (!hasValue) setVideoFeedback('');
    }
    return parsed;
  }

  async function refresh() {
    state = await cabinetApi.dashboard();
    render();
  }

  function identityMeta() {
    const status = state.user.identityStatus;
    if (status === 'approved') return { className: 'is-approved', title: 'Данные проверены' };
    if (status === 'rejected') return { className: 'is-rejected', title: 'Нужно уточнить данные' };
    return { className: 'is-pending', title: 'Проверяем заявку' };
  }

  function renderPortfolioSummaryView() {
    renderPortfolioSummary({
      state,
      $,
      $$,
      esc,
      date,
      direction,
      selectedMaterialId,
      setSelectedMaterialId: (value) => { selectedMaterialId = value; },
      rerender: renderPortfolioSummaryView,
    });
  }

  function render() {
    const { user, team, achievements, notifications } = state;
    const identity = identityMeta();
    const profileReady = Boolean(user.fio && user.email && user.emailVerified && Object.keys(user.messengerContacts || {}).length);
    const hasVideo = Boolean(team?.videoCard?.url);
    const score = [profileReady, achievements.length > 0, Boolean(team?.description), hasVideo].filter(Boolean).length * 25;
    const initial = nameInitial(user.fio);
    if ($('#dropdownAvatar')) $('#dropdownAvatar').textContent = initial;
    if ($('#topbarUserName')) $('#topbarUserName').textContent = (user.fio.split(' ')[0] || user.fio).toUpperCase();
    $('#cabinet-title').textContent = user.fio;
    $('#cabinet-subtitle').textContent = `${user.role === 'captain' ? 'Капитан' : 'Участник'} · ${user.group}`;
    $('#identityBadge').className = `cabinet-status ${identity.className}`;
    $('#identityBadge').textContent = identity.title;
    $('#completionText').textContent = `${score}%`;
    $('#completionBar').style.width = `${score}%`;
    $('#teamNavigation').hidden = !team;
    renderDashboard({ state, $, $$, esc, identity, switchView });
    renderPortfolioSummaryView();
    renderOverview({ state, $, esc, profileReady, hasVideo });
    renderTeamView({ state, $, $$, esc, date, phaseOpen });
    renderVideoView({ state, $, parseVideoUrl, phaseOpen, setVideoUrlState });
    renderNotifications({ items: notifications, state, $, $$, esc, date, readNotification: cabinetApi.readNotification, refresh });
    renderProfile({ state, $, nameInitial, messengerLabels, identityMeta });
    const portfolioActive = phaseOpen(state.settings?.portfolioStart, state.settings?.portfolioDeadline);
    const addAchievement = $('#openAchievement');
    if (addAchievement) {
      addAchievement.disabled = !portfolioActive;
      addAchievement.title = portfolioActive ? '' : 'Приём достижений откроется в установленный срок.';
    }
    if ($('#portfolioPhaseHint')) $('#portfolioPhaseHint').textContent = portfolioActive ? '' : 'Приём достижений пока закрыт по календарю конкурса.';
  }

  function setMobileNavOpen(open) {
    const toggles = $$('.cabinet-mobile-nav-toggle');
    const panel = $('#cabinetMobileNavPanel');
    const sidebar = document.querySelector('.cabinet-sidebar');
    if (!toggles.length || !panel) return;
    const isCompact = matchMedia('(max-width: 1100px)').matches;
    const shouldOpen = isCompact && open;
    panel.hidden = isCompact ? !shouldOpen : false;
    toggles.forEach((toggle) => toggle.setAttribute('aria-expanded', String(shouldOpen)));
    sidebar?.classList.toggle('is-nav-open', shouldOpen);
  }
  function getCompactNavToggle() {
    return matchMedia('(max-width: 620px)').matches
      ? $('#cabinetMobileNavToggle')
      : $('#cabinetTabletNavToggle');
  }
  function updateMobileNavLabel(view) {
    const current = $(`#${view}-tab`);
    const label = current?.querySelector('.cabinet-nav__lead > span:last-child')?.textContent;
    if (label && $('#cabinetMobileNavCurrent')) $('#cabinetMobileNavCurrent').textContent = label;
  }
  function switchView(view, { focus = false } = {}) {
    $$('.cabinet-nav').forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) {
        if (matchMedia('(max-width: 1100px)').matches) getCompactNavToggle()?.focus();
        else button.focus();
      }
    });
    $$('[data-view-panel]').forEach((panel) => {
      const active = panel.dataset.viewPanel === view;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    updateMobileNavLabel(view);
    setMobileNavOpen(false);
  }
  async function removeAchievement(id) { if (!confirm('Удалить это достижение из портфолио?')) return; try { await cabinetApi.deleteAchievement(id); await refresh(); } catch (error) { alert(error.message); } }

  async function saveAchievement(event) {
    if (event.submitter?.value === 'cancel') {
      event.preventDefault();
      event.currentTarget.reset();
      $('#achievementFileName').textContent = 'Изображение или документ, до 5 МБ';
      $('#achievementError').textContent = '';
      $('#achievementDialog').close('cancel');
      return;
    }
    event.preventDefault();
    const error = $('#achievementError'); const file = $('#achievementFile').files?.[0]; error.textContent = '';
    if (!file) { error.textContent = 'Прикрепите подтверждающий документ.'; return; }
    try {
      $('#saveAchievement').disabled = true;
      const uploaded = await cabinetApi.upload(file);
      await cabinetApi.addAchievement({ direction: $('#achievementDirection').value, category: $('#achievementCategory').value, title: $('#achievementTitle').value, details: $('#achievementDetails').value, fileUrl: uploaded.url, fileName: uploaded.name });
      $('#achievementDialog').close(); event.target.reset(); direction = $('#achievementDirection').value; await refresh(); switchView('portfolio');
    } catch (reason) { error.textContent = reason.message; } finally { $('#saveAchievement').disabled = false; }
  }

  const bind = () => bindCabinetEvents({
    $, $$, getState: () => state, getDirection: () => direction,
    setDirection: (value) => { direction = value; },
    clearSelection: () => { selectedMaterialId = null; },
    setMobileNavOpen, getCompactNavToggle, updateMobileNavLabel, switchView,
    renderPortfolioSummary: renderPortfolioSummaryView, saveAchievement, refresh, setVideoFeedback,
    setVideoUrlState, cabinetApi,
  });
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const { user } = await cabinetApi.session();
      if (!user) { window.location.href = 'register.html'; return; }
      if (user.role === 'admin') { window.location.href = 'admin.html'; return; }
      bind(); await refresh();
      setInterval(() => {
        if (document.hidden) return;
        refresh().catch(() => {});
      }, 15000);
    } catch (error) {
      window.location.href = 'register.html';
    }
  });
})();
