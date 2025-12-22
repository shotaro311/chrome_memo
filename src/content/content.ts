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

type AiUndoEntry = {
  beforeValue: string;
  afterValue: string;
  beforeSelectionStart: number;
  beforeSelectionEnd: number;
};

const aiUndoStacks: Record<Pane, AiUndoEntry[]> = {
  left: [],
  right: []
};

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
    const fontSizeOption = target.closest('.font-size-option') as HTMLElement | null;
    if (fontSizeOption) {
      const nextSize = Number(fontSizeOption.getAttribute('data-size'));
      if (!Number.isNaN(nextSize)) {
        applyMemoFontSize(nextSize);
        appSettings.memoFontSize = nextSize;
        void updateSettings({ memoFontSize: nextSize });
      }
      closeFontSizeMenu();
      return;
    }
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
        void refreshGeminiApiKeyUI();
        break;
      case 'ai-btn':
        openAiModal();
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
      case 'close-ai-modal-btn':
        e.stopPropagation();
        closeAiModal();
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
      case 'save-gemini-api-key-btn':
        void handleSaveGeminiApiKey();
        break;
      case 'delete-gemini-api-key-btn':
        void handleDeleteGeminiApiKey();
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
      case 'ai-run-btn':
        void handleAiRun();
        break;
    }
  });

  panel.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;
    if (target?.id === 'ai-apply-mode') {
      target.setAttribute('data-user-changed', 'true');
    }
  });

  const memoTextareaLeft = panel.querySelector('#memo-textarea-left') as HTMLTextAreaElement;
  const memoTextareaRight = panel.querySelector('#memo-textarea-right') as HTMLTextAreaElement;
  setupTextareaEvents(memoTextareaLeft, 'left');
  setupTextareaEvents(memoTextareaRight, 'right');

  const openFileBtn = panel.querySelector('#open-file-btn') as HTMLButtonElement | null;
  let openFileHoverTimer: number | null = null;
  openFileBtn?.addEventListener('pointerenter', () => {
    if (openFileHoverTimer) {
      clearTimeout(openFileHoverTimer);
    }
    openFileHoverTimer = window.setTimeout(() => {
      void actions.handleOpenFile();
    }, 500);
  });
  openFileBtn?.addEventListener('pointerleave', () => {
    if (!openFileHoverTimer) return;
    clearTimeout(openFileHoverTimer);
    openFileHoverTimer = null;
  });

  const fileModal = panel.querySelector('#file-modal') as HTMLElement | null;
  if (fileModal && !fileModal.hasAttribute('data-hover-close')) {
    fileModal.setAttribute('data-hover-close', 'true');
    fileModal.addEventListener('pointerleave', () => {
      actions.closeFileModal();
    });
  }

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
  closeFontSizeMenu();
}

function toggleFontSizeMenu() {
  if (!panel) return;
  const menu = panel.querySelector('#font-size-menu') as HTMLElement | null;
  const optionsEl = panel.querySelector('#font-size-options') as HTMLElement | null;
  if (!menu || !optionsEl) return;

  const isOpen = menu.classList.contains('is-open');
  if (isOpen) {
    closeFontSizeMenu();
    return;
  }

  const baseSize = appSettings.memoFontSize;
  const options = Array.from({ length: 7 }, (_, index) => baseSize - 3 + index);
  optionsEl.innerHTML = options
    .map(size => {
      const activeClass = size === baseSize ? 'is-active' : '';
      return `<button class="font-size-option ${activeClass}" data-size="${size}">${size}pt</button>`;
    })
    .join('');
  menu.classList.add('is-open');
}

function closeFontSizeMenu() {
  if (!panel) return;
  const menu = panel.querySelector('#font-size-menu') as HTMLElement | null;
  if (!menu) return;
  menu.classList.remove('is-open');
}

function getFocusedTextareaInfo() {
  if (!panel) return null;
  const pane = panelState.lastFocusedPane;
  const textarea = getTextarea(panel, pane);
  if (!textarea) return null;
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const text = textarea.value.slice(start, end);
  return { pane, textarea, start, end, text };
}

function formatSelectionPreview(text: string) {
  const maxLength = 2000;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n…`;
}

function updateAiModalContext() {
  if (!panel) return;
  const statusEl = panel.querySelector('#ai-selection-status') as HTMLElement | null;
  const paneEl = panel.querySelector('#ai-target-pane') as HTMLElement | null;
  const previewEl = panel.querySelector('#ai-selection-preview') as HTMLElement | null;
  const applySelect = panel.querySelector('#ai-apply-mode') as HTMLSelectElement | null;
  const info = getFocusedTextareaInfo();
  if (!statusEl || !paneEl || !previewEl || !applySelect || !info) return;

  const hasSelection = info.start !== info.end;
  const selectionCount = Math.max(0, info.end - info.start);
  statusEl.textContent = hasSelection ? `あり（${selectionCount}文字）` : 'なし';
  paneEl.textContent = info.pane === 'right' ? '右' : '左';

  if (hasSelection) {
    previewEl.style.display = 'block';
    previewEl.textContent = formatSelectionPreview(info.text);
  } else {
    previewEl.style.display = 'none';
    previewEl.textContent = '';
  }

  if (applySelect.getAttribute('data-user-changed') !== 'true') {
    applySelect.value = hasSelection ? 'replace-selection' : 'insert-cursor';
  }
}

function updateAiModalContextIfOpen() {
  if (!panel) return;
  const modal = panel.querySelector('#ai-modal') as HTMLElement | null;
  if (modal?.style.display !== 'flex') return;
  updateAiModalContext();
}

function openAiModal() {
  if (!panel) return;
  const applySelect = panel.querySelector('#ai-apply-mode') as HTMLSelectElement | null;
  applySelect?.removeAttribute('data-user-changed');
  updateAiModalContext();
  const modal = panel.querySelector('#ai-modal') as HTMLElement | null;
  if (modal) {
    modal.style.display = 'flex';
  }
}

function closeAiModal() {
  if (!panel) return;
  const modal = panel.querySelector('#ai-modal') as HTMLElement | null;
  if (modal) {
    modal.style.display = 'none';
  }
}

function pushAiUndo(pane: Pane, entry: AiUndoEntry) {
  const stack = aiUndoStacks[pane];
  stack.push(entry);
  const maxEntries = 20;
  if (stack.length > maxEntries) {
    stack.shift();
  }
}

function tryUndoAi(pane: Pane, textarea: HTMLTextAreaElement) {
  const stack = aiUndoStacks[pane];
  if (stack.length === 0) return false;

  const last = stack[stack.length - 1];
  if (textarea.value !== last.afterValue) {
    return false;
  }

  textarea.value = last.beforeValue;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
  textarea.setSelectionRange(last.beforeSelectionStart, last.beforeSelectionEnd);
  stack.pop();
  updateAiModalContextIfOpen();
  return true;
}

function applyAiText(params: {
  pane: Pane;
  textarea: HTMLTextAreaElement;
  start: number;
  end: number;
  mode: string;
  insertText: string;
}) {
  const { pane, textarea, start, end, mode, insertText } = params;

  const beforeValue = textarea.value;
  const beforeSelectionStart = start;
  const beforeSelectionEnd = end;

  let nextValue = beforeValue;
  let nextCursor = start;

  if (mode === 'replace-all') {
    nextValue = insertText;
    nextCursor = insertText.length;
  } else {
    const sliceEnd = mode === 'insert-cursor' ? start : end;
    nextValue = beforeValue.slice(0, start) + insertText + beforeValue.slice(sliceEnd);
    nextCursor = start + insertText.length;
  }

  pushAiUndo(pane, {
    beforeValue,
    afterValue: nextValue,
    beforeSelectionStart,
    beforeSelectionEnd
  });

  textarea.value = nextValue;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
  textarea.setSelectionRange(nextCursor, nextCursor);
  updateAiModalContextIfOpen();
}

function buildGeminiPrompt(params: { instruction: string; mode: string; text: string; context: string }) {
  const lines = [
    'あなたは文章編集アシスタントです。',
    '次の「指示」と「対象/文脈」を元に、文章を生成または編集してください。',
    '出力は結果テキストのみ（余計な説明は不要）で返してください。',
    '',
    '# 指示',
    params.instruction,
    '',
    '# 適用モード',
    params.mode,
    '',
    '# 対象',
    params.text,
    ''
  ];

  const trimmedContext = params.context.trim();
  if (trimmedContext) {
    lines.push('# 文脈（参考）', trimmedContext, '');
  }

  return lines.join('\n');
}

function getCursorContext(value: string, cursor: number) {
  const windowSize = 1200;
  const start = Math.max(0, cursor - windowSize);
  const end = Math.min(value.length, cursor + windowSize);
  const prefix = value.slice(start, cursor);
  const suffix = value.slice(cursor, end);
  const omittedPrefix = start > 0 ? '…' : '';
  const omittedSuffix = end < value.length ? '…' : '';
  return `${omittedPrefix}${prefix}⟂${suffix}${omittedSuffix}`;
}

async function handleAiRun() {
  if (!panel) return;
  const promptEl = panel.querySelector('#ai-prompt-input') as HTMLTextAreaElement | null;
  const applySelect = panel.querySelector('#ai-apply-mode') as HTMLSelectElement | null;
  const runBtn = panel.querySelector('#ai-run-btn') as HTMLButtonElement | null;
  if (!promptEl || !applySelect) return;

  const instruction = promptEl.value.trim();
  if (!instruction) {
    alert('指示を入力してください');
    return;
  }

  const info = getFocusedTextareaInfo();
  if (!info) return;

  const { pane, textarea, start, end } = info;
  const mode = applySelect.value;

  if (mode === 'replace-selection' && start === end) {
    alert('選択範囲がありません（適用先を変更するか、テキストを選択してください）');
    return;
  }

  const fullText = textarea.value;
  const selectionText = fullText.slice(start, end);

  const targetText = mode === 'replace-all' ? fullText : mode === 'replace-selection' ? selectionText : '';
  const context = mode === 'insert-cursor' ? getCursorContext(fullText, start) : '';

  const prompt = buildGeminiPrompt({
    instruction,
    mode,
    text: targetText,
    context
  });

  const prevText = runBtn?.textContent;
  if (runBtn) {
    runBtn.disabled = true;
    runBtn.textContent = '実行中...';
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GEMINI_GENERATE,
      prompt
    });

    if (!response?.success) {
      alert(response?.error || 'AIの実行に失敗しました');
      return;
    }

    const generated = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    applyAiText({ pane, textarea, start, end, mode, insertText: generated });
  } catch (error) {
    alert(`AIの実行に失敗しました: ${String(error)}`);
  } finally {
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.textContent = prevText || '実行';
    }
  }
}

async function loadGeminiApiKey() {
  const result = await chrome.storage.local.get('geminiApiKey');
  return typeof result.geminiApiKey === 'string' ? result.geminiApiKey : null;
}

async function refreshGeminiApiKeyUI() {
  if (!panel) return;
  const input = panel.querySelector('#gemini-api-key-input') as HTMLInputElement | null;
  const status = panel.querySelector('#gemini-api-key-status') as HTMLElement | null;
  if (!input || !status) return;

  const key = await loadGeminiApiKey();
  input.value = key || '';
  status.textContent = key ? '保存済み' : '未保存';
}

async function handleSaveGeminiApiKey() {
  if (!panel) return;
  const input = panel.querySelector('#gemini-api-key-input') as HTMLInputElement | null;
  const status = panel.querySelector('#gemini-api-key-status') as HTMLElement | null;
  if (!input || !status) return;

  const key = input.value.trim();
  if (!key) {
    alert('APIキーを入力してください');
    return;
  }

  await chrome.storage.local.set({ geminiApiKey: key });
  status.textContent = '保存済み';
}

async function handleDeleteGeminiApiKey() {
  if (!panel) return;
  const input = panel.querySelector('#gemini-api-key-input') as HTMLInputElement | null;
  const status = panel.querySelector('#gemini-api-key-status') as HTMLElement | null;
  if (!input || !status) return;

  const ok = confirm('保存済みのAPIキーを削除しますか？');
  if (!ok) return;

  await chrome.storage.local.remove('geminiApiKey');
  input.value = '';
  status.textContent = '未保存';
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
    updateAiModalContextIfOpen();
  });
  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    const isUndoKey = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z';
    if (isUndoKey) {
      panelState.lastFocusedPane = pane;
      const current = e.currentTarget as HTMLTextAreaElement;
      const undone = tryUndoAi(pane, current);
      if (undone) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
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
    updateAiModalContextIfOpen();
    e.stopPropagation();
  });
  textarea.addEventListener('mouseup', () => {
    updateAiModalContextIfOpen();
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
  let startRight = 0;

  resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
    if (!panel) return;
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startWidth = panelState.width;
    startHeight = panelState.height;
    const rect = panel.getBoundingClientRect();
    startRight = rect.right;

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

    if (!panel) return;
    panel.style.width = `${newWidth}px`;
    panel.style.height = `${newHeight}px`;
    panel.style.left = `${startRight - newWidth}px`;
    panel.style.right = 'auto';

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
