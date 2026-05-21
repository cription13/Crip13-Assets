const ACCESS_CODE = 'VG2026';
const STORAGE_KEY = 'vgAdminState';
const UNLOCK_KEY = 'vgAdminUnlocked';

const refs = {
  loginForm: document.getElementById('loginForm'),
  passwordInput: document.getElementById('passwordInput'),
  loginStatus: document.getElementById('loginStatus'),
  adminContent: document.getElementById('adminContent'),
  adminLogo: document.querySelector('.admin-logo'),
  heroTitle: document.getElementById('heroTitle'),
  heroSubtitle: document.getElementById('heroSubtitle'),
  heroCta: document.getElementById('heroCta'),
  announcementText: document.getElementById('announcementText'),
  clearAnnouncement: document.getElementById('clearAnnouncement'),
  taskForm: document.getElementById('taskForm'),
  taskTitle: document.getElementById('taskTitle'),
  taskDetails: document.getElementById('taskDetails'),
  taskList: document.getElementById('taskList'),
  eventEnabled: document.getElementById('eventEnabled'),
  goldenChance: document.getElementById('goldenChance'),
  goldenChanceLabel: document.getElementById('goldenChanceLabel'),
  rewardsEnabled: document.getElementById('rewardsEnabled'),
  maintenanceMode: document.getElementById('maintenanceMode'),
  showSections: document.getElementById('showSections'),
  popupsActive: document.getElementById('popupsActive'),
  bannerText: document.getElementById('bannerText'),
  notesText: document.getElementById('notesText'),
  saveNotes: document.getElementById('saveNotes'),
  statsTaskCount: document.getElementById('statsTaskCount'),
  statsAnnouncementCount: document.getElementById('statsAnnouncementCount'),
  statsEventStatus: document.getElementById('statsEventStatus'),
  statsLastUpdated: document.getElementById('statsLastUpdated')
};

const defaultState = {
  hero: {
    title: 'Welcome to Velvet Grid',
    subtitle: 'Craft premium poster systems that feel elegant, modern, and unforgettable.',
    cta: 'Start your project'
  },
  announcement: '',
  tasks: [],
  event: {
    enabled: false,
    goldenChance: 18,
    rewardsEnabled: true
  },
  website: {
    maintenanceMode: false,
    showSections: true,
    popupsActive: true,
    bannerText: ''
  },
  notes: '',
  lastUpdated: null
};

let state = loadState();
let tapCount = 0;
let tapTimer = null;

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : { ...defaultState };
  } catch (error) {
    console.warn('Failed to load admin state:', error);
    return { ...defaultState };
  }
}

function saveState(updatedState) {
  state = { ...state, ...updatedState };
  state.lastUpdated = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderState();
}

function mergeState(updatedState) {
  state = {
    ...state,
    ...updatedState,
    hero: { ...state.hero, ...(updatedState.hero || {}) },
    event: { ...state.event, ...(updatedState.event || {}) },
    website: { ...state.website, ...(updatedState.website || {}) }
  };
  state.lastUpdated = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderState();
}

function isUnlocked() {
  return sessionStorage.getItem(UNLOCK_KEY) === 'true';
}

function showAdmin() {
  refs.adminContent.classList.add('visible');
  refs.adminContent.classList.remove('hidden');
}

function hideAdmin() {
  refs.adminContent.classList.add('hidden');
  refs.adminContent.classList.remove('visible');
}

function updateStats() {
  refs.statsTaskCount.textContent = state.tasks.length;
  refs.statsAnnouncementCount.textContent = state.announcement ? '1' : '0';
  refs.statsEventStatus.textContent = state.event.enabled ? 'Enabled' : 'Disabled';
  refs.statsLastUpdated.textContent = state.lastUpdated ? new Date(state.lastUpdated).toLocaleString() : '—';
}

function renderTasks() {
  if (!state.tasks.length) {
    refs.taskList.innerHTML = '<p class="field-note">No tasks yet. Add one to begin.</p>';
    return;
  }
  refs.taskList.innerHTML = state.tasks
    .map(task => `
      <div class="task-row">
        <div class="task-meta">
          <strong>${escapeHtml(task.title)}</strong>
          <span>${task.active ? 'Active' : 'Inactive'}</span>
        </div>
        <p>${escapeHtml(task.details)}</p>
        <div class="task-actions">
          <button class="button secondary" type="button" data-action="toggle" data-id="${task.id}">${task.active ? 'Disable' : 'Enable'}</button>
          <button class="button secondary" type="button" data-action="edit" data-id="${task.id}">Edit</button>
          <button class="button secondary" type="button" data-action="delete" data-id="${task.id}">Delete</button>
        </div>
      </div>
    `)
    .join('');
}

function renderState() {
  refs.heroTitle.value = state.hero.title;
  refs.heroSubtitle.value = state.hero.subtitle;
  refs.heroCta.value = state.hero.cta;
  refs.announcementText.value = state.announcement;
  refs.eventEnabled.checked = state.event.enabled;
  refs.goldenChance.value = state.event.goldenChance;
  refs.goldenChanceLabel.textContent = `${state.event.goldenChance}%`;
  refs.rewardsEnabled.checked = state.event.rewardsEnabled;
  refs.maintenanceMode.checked = state.website.maintenanceMode;
  refs.showSections.checked = state.website.showSections;
  refs.popupsActive.checked = state.website.popupsActive;
  refs.bannerText.value = state.website.bannerText;
  refs.notesText.value = state.notes;

  renderTasks();
  updateStats();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function handleLogin(event) {
  event.preventDefault();
  const value = refs.passwordInput.value.trim();
  if (value === ACCESS_CODE) {
    sessionStorage.setItem(UNLOCK_KEY, 'true');
    refs.loginStatus.classList.add('hidden');
    showAdmin();
    refs.passwordInput.value = '';
    refs.loginStatus.textContent = 'Access granted.';
  } else {
    refs.loginStatus.textContent = 'Incorrect password. Try again.';
    refs.loginStatus.classList.remove('hidden');
  }
}

function openLoginHint() {
  refs.passwordInput.focus();
}

function handleLogoTap() {
  tapCount += 1;
  if (tapTimer) {
    window.clearTimeout(tapTimer);
  }
  tapTimer = window.setTimeout(() => {
    tapCount = 0;
  }, 1000);

  if (tapCount >= 7) {
    tapCount = 0;
    openLoginHint();
  }
}

function handleTaskAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const id = Number(button.dataset.id);
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;

  if (button.dataset.action === 'toggle') {
    mergeState({ tasks: state.tasks.map(item => item.id === id ? { ...item, active: !item.active } : item) });
    return;
  }

  if (button.dataset.action === 'edit') {
    const title = prompt('Edit task title', task.title);
    if (title === null) return;
    const details = prompt('Edit task details', task.details);
    if (details === null) return;
    mergeState({ tasks: state.tasks.map(item => item.id === id ? { ...item, title: title.trim() || item.title, details: details.trim() || item.details } : item) });
    return;
  }

  if (button.dataset.action === 'delete') {
    const confirmed = confirm('Delete this task?');
    if (!confirmed) return;
    mergeState({ tasks: state.tasks.filter(item => item.id !== id) });
  }
}

function init() {
  if (isUnlocked()) {
    showAdmin();
  } else {
    hideAdmin();
  }

  renderState();

  refs.loginForm.addEventListener('submit', handleLogin);

  refs.heroTitle.addEventListener('input', () => {
    mergeState({ hero: { title: refs.heroTitle.value } });
  });

  refs.heroSubtitle.addEventListener('input', () => {
    mergeState({ hero: { subtitle: refs.heroSubtitle.value } });
  });

  refs.heroCta.addEventListener('input', () => {
    mergeState({ hero: { cta: refs.heroCta.value } });
  });

  refs.announcementText.addEventListener('input', () => {
    mergeState({ announcement: refs.announcementText.value });
  });

  refs.clearAnnouncement.addEventListener('click', () => {
    refs.announcementText.value = '';
    mergeState({ announcement: '' });
  });

  refs.taskForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = refs.taskTitle.value.trim();
    const details = refs.taskDetails.value.trim();
    if (!title) return;
    mergeState({ tasks: [{ id: Date.now(), title, details, active: true }, ...state.tasks] });
    refs.taskTitle.value = '';
    refs.taskDetails.value = '';
  });

  refs.taskList.addEventListener('click', handleTaskAction);

  refs.eventEnabled.addEventListener('change', () => {
    mergeState({ event: { enabled: refs.eventEnabled.checked } });
  });

  refs.goldenChance.addEventListener('input', () => {
    refs.goldenChanceLabel.textContent = `${refs.goldenChance.value}%`;
    mergeState({ event: { goldenChance: Number(refs.goldenChance.value) } });
  });

  refs.rewardsEnabled.addEventListener('change', () => {
    mergeState({ event: { rewardsEnabled: refs.rewardsEnabled.checked } });
  });

  refs.maintenanceMode.addEventListener('change', () => {
    mergeState({ website: { maintenanceMode: refs.maintenanceMode.checked } });
  });

  refs.showSections.addEventListener('change', () => {
    mergeState({ website: { showSections: refs.showSections.checked } });
  });

  refs.popupsActive.addEventListener('change', () => {
    mergeState({ website: { popupsActive: refs.popupsActive.checked } });
  });

  refs.bannerText.addEventListener('input', () => {
    mergeState({ website: { bannerText: refs.bannerText.value } });
  });

  refs.saveNotes.addEventListener('click', () => {
    mergeState({ notes: refs.notesText.value });
  });

  refs.adminLogo.addEventListener('click', handleLogoTap);

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      if (!isUnlocked()) {
        openLoginHint();
      } else {
        showAdmin();
      }
    }
  });
}

init();
