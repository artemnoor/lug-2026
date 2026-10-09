import { escapeHtml as esc, formatDate as date, phaseOpen } from './modules/dom.js?v=20261008-3';
import { messengerLabels, nameInitial, plural } from './modules/cabinet-utils.js?v=20261008-3';
import { cabinetApi } from './modules/cabinet-api.js?v=20261008-3';
import { bindCabinetEvents } from './modules/cabinet-events.js?v=20261009-5';
import { renderDashboard, renderNotifications, renderOverview, renderPortfolioSummary, renderProfile, renderTeam as renderTeamView } from './modules/cabinet-renderers.js?v=20261009-4';

(() => {
  'use strict';

  let state = null;
  let direction = 'science';
  let selectedMaterialId = null;
  let mobileNavCloseTimer = null;
  let mobileNavScrollY = 0;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const mobileNavPanel = $('#cabinetMobileNavPanel');
  if (mobileNavPanel && mobileNavPanel.parentElement !== document.body) document.body.append(mobileNavPanel);

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
    const profileReady = Boolean(user.fio && user.email && Object.keys(user.messengerContacts || {}).length);
    const score = Math.round(([profileReady, achievements.length > 0, Boolean(team?.description)].filter(Boolean).length / 3) * 100);
    const fioParts = String(user.fio || '').trim().split(/\s+/).filter(Boolean);
    const firstName = fioParts[1] || fioParts[0] || 'Участник';
    const initial = nameInitial(firstName);
    if ($('#dropdownAvatar')) $('#dropdownAvatar').textContent = initial;
    if ($('#topbarUserName')) $('#topbarUserName').textContent = firstName.toUpperCase();
    $('#cabinet-title').textContent = user.fio;
    $('#cabinet-subtitle').textContent = `${user.role === 'captain' ? 'Капитан' : 'Участник'} · ${user.group}`;
    $('#identityBadge').className = `cabinet-status ${identity.className}`;
    $('#identityBadge').textContent = identity.title;
    $('#completionText').textContent = `${score}%`;
    $('#completionBar').style.width = `${score}%`;
    $('#teamNavigation').hidden = !team;
    renderDashboard({ state, $, $$, esc, identity, switchView });
    renderPortfolioSummaryView();
    renderOverview({ state, $, esc, profileReady });
    renderTeamView({ state, $, $$, esc, date, phaseOpen });
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
    if (!toggles.length || !panel) return;
    const shouldOpen = Boolean(open);
    const wasOpen = panel.dataset.navOpen === 'true';

    clearTimeout(mobileNavCloseTimer);
    toggles.forEach((toggle) => toggle.setAttribute('aria-expanded', String(shouldOpen)));
    const headerToggle = $('#cabinetMobileNavToggle');
    if (headerToggle) headerToggle.setAttribute('aria-label', shouldOpen ? 'Закрыть разделы кабинета' : 'Открыть разделы кабинета');
    panel.dataset.navOpen = String(shouldOpen);
    if (shouldOpen) {
      if (!wasOpen) {
        mobileNavScrollY = window.scrollY;
        document.documentElement.classList.add('cabinet-mobile-nav-scroll-locked');
        document.body.style.setProperty('--cabinet-scroll-lock-top', `-${mobileNavScrollY}px`);
        document.body.classList.add('cabinet-mobile-nav-scroll-locked');
      }
      panel.hidden = false;
      panel.inert = false;
      const userDropdown = $('#userDropdown');
      if (userDropdown && !userDropdown.hidden) {
        userDropdown.hidden = true;
        $('#userMenuBtn')?.setAttribute('aria-expanded', 'false');
      }
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', 'Разделы личного кабинета');
      panel.setAttribute('aria-hidden', 'false');
      panel.classList.remove('is-closing');
      document.body.classList.add('cabinet-mobile-nav-open');
      requestAnimationFrame(() => {
        if (panel.dataset.navOpen === 'true') panel.classList.add('is-open');
      });
      $('#cabinetMobileNavClose')?.focus({ preventScroll: true });
      return;
    }

    panel.classList.remove('is-open');
    panel.inert = true;
    panel.setAttribute('aria-hidden', 'true');
    const wasScrollLocked = document.documentElement.classList.contains('cabinet-mobile-nav-scroll-locked');
    document.body.classList.remove('cabinet-mobile-nav-open');
    document.body.classList.remove('cabinet-mobile-nav-scroll-locked');
    document.documentElement.classList.remove('cabinet-mobile-nav-scroll-locked');
    document.body.style.removeProperty('--cabinet-scroll-lock-top');
    if (wasScrollLocked) window.scrollTo(0, mobileNavScrollY);
    if (panel.contains(document.activeElement)) headerToggle?.focus({ preventScroll: true });
    if (!wasOpen || panel.hidden) {
      panel.hidden = true;
      panel.classList.remove('is-closing');
    } else {
      panel.classList.add('is-closing');
      const closeDelay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
      mobileNavCloseTimer = window.setTimeout(() => {
        if (panel.dataset.navOpen !== 'true') {
          panel.hidden = true;
          panel.classList.remove('is-closing');
        }
      }, closeDelay);
    }
  }
  function getCompactNavToggle() { return $('#cabinetMobileNavToggle'); }
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
        getCompactNavToggle()?.focus();
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
    renderPortfolioSummary: renderPortfolioSummaryView, saveAchievement, refresh, cabinetApi,
  });
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const { user } = await cabinetApi.session();
      if (!user) { window.location.href = '/?action=choice'; return; }
      if (user.role === 'admin') { window.location.href = '/account/admin.html'; return; }
      bind(); await refresh();
      setInterval(() => {
        if (document.hidden) return;
        refresh().catch(() => {});
      }, 15000);
    } catch (error) {
      window.location.href = '/?action=choice';
    }
  });
})();
