import type { Folder, PanelState, QuickMemo } from '../types';
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
  if (!panel) {
    createPanel();
  }

  if (!panel) return;

  panel.classList.remove('is-hidden');
  panel.style.removeProperty('display');
  panelState.isVisible = true;

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

  panel = document.createElement('div');
  panel.id = 'chrome-memo-panel';
  panel.className = 'chrome-memo-panel';
  panel.style.width = `${panelState.width}px`;
  panel.style.height = `${panelState.height}px`;
  panel.innerHTML = getPanelHtml();

  setupEventListeners();
  setupResize();
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
    }
  });

  const memoTextareaLeft = panel.querySelector('#memo-textarea-left') as HTMLTextAreaElement;
  const memoTextareaRight = panel.querySelector('#memo-textarea-right') as HTMLTextAreaElement;
  setupTextareaEvents(memoTextareaLeft, 'left');
  setupTextareaEvents(memoTextareaRight, 'right');

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
    isResizing = false;
  });
}

init();

