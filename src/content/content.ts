import type { AppSettings, Folder, PanelState, QuickMemo } from '../types';
import { INBOX_FOLDER_ID, LIMITS, MessageType } from '../types';
import { escapeHtml, focusMemoTextarea, getTextarea } from './panelDom';
import { createPanelActions } from './panelActions';
import { getPanelHtml } from './panelTemplate';
import type { Pane, TabInfo } from './panelTypes';
import { createPanelView } from './panelView';

let panel: HTMLElement | null = null;
let panelState: PanelState = {
  isVisible: false,
  width: LIMITS.DEFAULT_PANEL_WIDTH,
  height: LIMITS.DEFAULT_PANEL_HEIGHT,
  currentFolderId: INBOX_FOLDER_ID,
  currentNoteId: null,
  searchQuery: '',
  openTabs: [],
  activeTabId: null,
  splitEnabled: false,
  rightTabId: null,
  lastFocusedPane: 'left'
};

let appSettings: AppSettings = getDefaultSettings();

let folders: Folder[] = [];
let draftMemo: QuickMemo = { content: '', updatedAt: Date.now() };

const timers = { autosaveTimer: null as number | null };

const tabInfoMap: Record<string, TabInfo> = {};
const tabContentCache: Record<string, string> = {};
const tabUnsavedMap: Record<string, boolean> = {};

const view = createPanelView(
  {
    getPanel: () => panel,
    panelState,
    draftMemo,
    tabInfoMap,
    tabContentCache,
    tabUnsavedMap
  },
  {
    escapeHtml,
    focusMemoTextarea: (pane) => focusMemoTextarea(panel, pane)
  }
);

const actions = createPanelActions(
  {
    getPanel: () => panel,
    panelState,
    folders,
    draftMemo,
    tabInfoMap,
    tabContentCache,
    tabUnsavedMap,
    timers
  },
  {
    view,
    getTextarea: (pane) => getTextarea(panel, pane),
    escapeHtml
  }
);

function getDefaultSettings(): AppSettings {
  return {
    shortcutGuideShown: false,
    memoFontSize: LIMITS.DEFAULT_MEMO_FONT_SIZE,
    panelLastWidth: LIMITS.DEFAULT_PANEL_WIDTH,
    panelLastHeight: LIMITS.DEFAULT_PANEL_HEIGHT
  };
}

async function loadSettings() {
  try {
    const response = await chrome.runtime.sendMessage({ type: MessageType.GET_SETTINGS });
    if (response.success) {
      appSettings = { ...getDefaultSettings(), ...(response.data as AppSettings) };
    }
  } catch (error) {
    console.error('[Content] Error loading settings:', error);
  }
}

async function updateSettings(updates: Partial<AppSettings>) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.UPDATE_SETTINGS,
      updates
    });
    if (response.success) {
      appSettings = { ...appSettings, ...(response.data as AppSettings) };
    }
  } catch (error) {
    console.error('[Content] Error updating settings:', error);
  }
}

function applyMemoFontSize(fontSize: number) {
  if (!panel) return;
  panel.style.setProperty('--memo-font-size', `${fontSize}px`);
}

function clampPanelSize(width: number, height: number) {
  return {
    width: Math.max(LIMITS.MIN_PANEL_WIDTH, Math.min(LIMITS.MAX_PANEL_WIDTH, width)),
    height: Math.max(LIMITS.MIN_PANEL_HEIGHT, Math.min(LIMITS.MAX_PANEL_HEIGHT, height))
  };
}

function applyPanelSize(width: number, height: number) {
  if (!panel) return;
  const clamped = clampPanelSize(width, height);
  panel.style.width = `${clamped.width}px`;
  panel.style.height = `${clamped.height}px`;
  panelState.width = clamped.width;
  panelState.height = clamped.height;
}

function init() {
  console.log('[Content] Initializing...');

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message);
    sendResponse({ success: true });
  });

  console.log('[Content] Initialized');
}

function handleMessage(message: any) {
  console.log('[Content] Message received:', message);

  switch (message.type) {
    case MessageType.TOGGLE_PANEL:
      void togglePanel();
      break;
    case MessageType.OPEN_PANEL:
      void openPanel(message.noteId);
      break;
    case MessageType.CLOSE_PANEL:
      closePanel();
      break;
    default:
      console.warn('[Content] Unknown message type:', message.type);
  }
}

async function togglePanel() {
  if (panelState.isVisible) {
    closePanel();
  } else {
    await openPanel();
  }
}

async function openPanel(noteId?: string) {
  await loadSettings();
  if (!panel) {
    createPanel();
  }

  if (!panel) return;

  panel.classList.remove('is-hidden');
  panel.style.removeProperty('display');
  panelState.isVisible = true;

  applyMemoFontSize(appSettings.memoFontSize);

  await actions.loadData();
  await actions.refreshAuthButton();

  view.initializeTabsIfNeeded();
  if (noteId) {
    await actions.loadNoteFromFile(noteId);
  }
  view.renderAll();
}

function closePanel() {
  if (!panel) return;

  panel.classList.add('is-hidden');
  panel.style.removeProperty('display');
  panelState.isVisible = false;
  actions.flushDraftSave();
}

function createPanel() {
  const existingPanel = document.getElementById('chrome-memo-panel');
  if (existingPanel) {
    existingPanel.remove();
  }

  const panelSize = clampPanelSize(appSettings.panelLastWidth, appSettings.panelLastHeight);
  panelState.width = panelSize.width;
  panelState.height = panelSize.height;

  panel = document.createElement('div');
  panel.id = 'chrome-memo-panel';
  panel.className = 'chrome-memo-panel';
  panel.style.width = `${panelState.width}px`;
  panel.style.height = `${panelState.height}px`;
  panel.innerHTML = getPanelHtml();

  setupEventListeners();
  setupResize();
  setupDrag();
  document.body.appendChild(panel);
}

function setupEventListeners() {
  if (!panel) return;

  panel.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const id = target.id || target.closest('button')?.id;

    switch (id) {
      case 'close-panel-btn':
        e.stopPropagation();
        e.preventDefault();
        closePanel();
        break;
      case 'new-note-btn':
        void actions.handleNewNote();
        break;
      case 'save-as-btn':
        void actions.handleSaveAs();
        break;
      case 'save-btn':
        void actions.handleSave();
        break;
      case 'open-file-btn':
        void actions.handleOpenFile();
        break;
      case 'split-view-btn':
        void actions.handleSplitViewToggle();
        break;
      case 'auth-btn':
        void actions.openAuthModal();
        break;
      case 'close-file-modal-btn':
        e.stopPropagation();
        actions.closeFileModal();
        break;
      case 'close-save-modal-btn':
        e.stopPropagation();
        actions.closeSaveModal();
        break;
      case 'close-auth-modal-btn':
        e.stopPropagation();
        actions.closeAuthModal();
        break;
      case 'close-split-modal-btn':
        e.stopPropagation();
        actions.closeSplitModal();
        break;
      case 'confirm-save-btn':
        void actions.handleConfirmSave();
        break;
      case 'cancel-save-btn':
        actions.closeSaveModal();
        break;
      case 'auth-sign-in-btn':
        void actions.handleAuthSignIn();
        break;
      case 'auth-sync-now-btn':
        void actions.handleAuthSyncNow();
        break;
      case 'auth-sign-out-btn':
        void actions.handleAuthSignOut();
        break;
      case 'export-data-btn':
        void handleExportData();
        break;
      case 'font-size-btn':
        toggleFontSizeMenu();
        break;
      case 'toggle-panel-size-btn':
        handleTogglePanelSize();
        break;
    }
  });

  const memoTextareaLeft = panel.querySelector('#memo-textarea-left') as HTMLTextAreaElement;
  const memoTextareaRight = panel.querySelector('#memo-textarea-right') as HTMLTextAreaElement;
  setupTextareaEvents(memoTextareaLeft, 'left');
  setupTextareaEvents(memoTextareaRight, 'right');

  const fontSizeSelect = panel.querySelector('#font-size-select') as HTMLSelectElement | null;
  fontSizeSelect?.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    const nextSize = Number(target.value);
    if (!Number.isNaN(nextSize)) {
      applyMemoFontSize(nextSize);
      appSettings.memoFontSize = nextSize;
      void updateSettings({ memoFontSize: nextSize });
    }
  });

  document.addEventListener('click', handleDocumentClick);

  const tabList = panel.querySelector('#tab-list') as HTMLElement | null;
  tabList?.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      tabList.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false }
  );
}

function handleDocumentClick(e: MouseEvent) {
  if (!panel) return;
  const target = e.target as HTMLElement;
  const menu = panel.querySelector('#font-size-menu') as HTMLElement | null;
  if (!menu) return;
  if (target.closest('#font-size-control')) {
    return;
  }
  menu.classList.remove('is-open');
}

function toggleFontSizeMenu() {
  if (!panel) return;
  const menu = panel.querySelector('#font-size-menu') as HTMLElement | null;
  const select = panel.querySelector('#font-size-select') as HTMLSelectElement | null;
  if (!menu || !select) return;

  const isOpen = menu.classList.contains('is-open');
  if (isOpen) {
    menu.classList.remove('is-open');
    return;
  }

  const baseSize = appSettings.memoFontSize;
  const options = Array.from({ length: 7 }, (_, index) => baseSize - 3 + index);
  select.innerHTML = options
    .map(size => `<option value="${size}">${size}pt</option>`)
    .join('');
  select.value = String(baseSize);
  menu.classList.add('is-open');
}

function handleTogglePanelSize() {
  const isDefaultSize =
    panelState.width === LIMITS.DEFAULT_PANEL_WIDTH &&
    panelState.height === LIMITS.DEFAULT_PANEL_HEIGHT;

  if (isDefaultSize) {
    applyPanelSize(appSettings.panelLastWidth, appSettings.panelLastHeight);
  } else {
    applyPanelSize(LIMITS.DEFAULT_PANEL_WIDTH, LIMITS.DEFAULT_PANEL_HEIGHT);
  }
}

async function handleExportData() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_EXPORT_DATA
    });
    if (!response.success) {
      alert(`エクスポートに失敗しました: ${response.error}`);
      return;
    }

    const exported = response.data;
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `chrome-memo-backup-${timestamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('[Content] Error exporting data:', error);
    alert('エクスポートに失敗しました');
  }
}

function setupTextareaEvents(textarea: HTMLTextAreaElement | null, pane: Pane) {
  if (!textarea) return;

  textarea.addEventListener('input', (e) => actions.handleMemoInput(e, pane));
  textarea.addEventListener('focus', () => {
    panelState.lastFocusedPane = pane;
    view.updateHeaderState();
  });
  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.defaultPrevented && !e.isComposing) {
      const current = e.currentTarget as HTMLTextAreaElement;
      const start = current.selectionStart ?? current.value.length;
      const end = current.selectionEnd ?? current.value.length;
      const nextValue = current.value.slice(0, start) + '\n' + current.value.slice(end);
      current.value = nextValue;
      const nextPos = start + 1;
      current.setSelectionRange(nextPos, nextPos);
      current.dispatchEvent(new Event('input', { bubbles: true }));
    }
    e.stopPropagation();
  });
  textarea.addEventListener('keyup', (e: KeyboardEvent) => {
    e.stopPropagation();
  });
}

function setupResize() {
  if (!panel) return;

  const resizeHandle = panel.querySelector('#resize-handle') as HTMLElement;
  if (!resizeHandle) return;

  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startWidth = panelState.width;
    startHeight = panelState.height;

    e.preventDefault();
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isResizing || !panel) return;

    const deltaX = startX - e.clientX;
    const deltaY = e.clientY - startY;

    let newWidth = startWidth + deltaX;
    let newHeight = startHeight + deltaY;

    newWidth = Math.max(LIMITS.MIN_PANEL_WIDTH, Math.min(LIMITS.MAX_PANEL_WIDTH, newWidth));
    newHeight = Math.max(LIMITS.MIN_PANEL_HEIGHT, Math.min(LIMITS.MAX_PANEL_HEIGHT, newHeight));

    panel.style.width = `${newWidth}px`;
    panel.style.height = `${newHeight}px`;

    panelState.width = newWidth;
    panelState.height = newHeight;
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    void updateSettings({
      panelLastWidth: panelState.width,
      panelLastHeight: panelState.height
    });
  });
}

function setupDrag() {
  if (!panel) return;
  const header = panel.querySelector('.panel-header') as HTMLElement | null;
  if (!header) return;

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  header.addEventListener('mousedown', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('select') || target.closest('input')) {
      return;
    }
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    panel.classList.add('is-dragging');
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isDragging || !panel) return;
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    const rect = panel.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const maxLeft = Math.max(0, window.innerWidth - width);
    const maxTop = Math.max(0, window.innerHeight - height);

    const nextLeft = Math.min(Math.max(0, startLeft + deltaX), maxLeft);
    const nextTop = Math.min(Math.max(0, startTop + deltaY), maxTop);

    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
    panel.style.right = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    panel?.classList.remove('is-dragging');
    document.body.style.removeProperty('user-select');
  });
}

init();
