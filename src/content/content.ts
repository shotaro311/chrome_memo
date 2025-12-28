import type { AppSettings, Folder, Note, PanelState, QuickMemo, TranscriptItem } from '../types';
import { INBOX_FOLDER_ID, LIMITS, MessageType } from '../types';
import { escapeHtml, focusMemoTextarea, getTextarea } from './panelDom';
import { createPanelActions } from './panelActions';
import { getPanelHtml } from './panelTemplate';
import { DRAFT_TAB_ID, type Pane, type TabInfo } from './panelTypes';
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

const GEMINI_CUSTOM_PROMPT_KEY = 'geminiCustomPrompt';
const GEMINI_SUMMARY_PROMPT_KEY = 'geminiSummaryPrompt';

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

  setupYoutubeOverlay();

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
        void refreshGeminiCustomPromptUI();
        void refreshGeminiSummaryPromptUI();
        break;
      case 'ai-btn':
        openAiModal();
        break;
      case 'ai-settings-btn':
        toggleAiSettings();
        break;
      case 'close-file-modal-btn':
        e.stopPropagation();
        actions.closeFileModal();
        break;
      case 'close-save-modal-btn':
        e.stopPropagation();
        actions.closeSaveModal();
        break;
      case 'close-move-note-modal-btn':
        e.stopPropagation();
        actions.closeMoveNoteModal();
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
      case 'folder-context-rename':
        e.stopPropagation();
        void actions.handleFolderContextRename();
        break;
      case 'folder-context-delete':
        e.stopPropagation();
        void actions.handleFolderContextDelete();
        break;
      case 'confirm-save-btn':
        void actions.handleConfirmSave();
        break;
      case 'cancel-save-btn':
        actions.closeSaveModal();
        break;
      case 'confirm-move-note-btn':
        void actions.handleConfirmMoveNote();
        break;
      case 'cancel-move-note-btn':
        actions.closeMoveNoteModal();
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
      case 'save-gemini-custom-prompt-btn':
        void handleSaveGeminiCustomPrompt();
        break;
      case 'clear-gemini-custom-prompt-btn':
        void handleClearGeminiCustomPrompt();
        break;
      case 'save-gemini-summary-prompt-btn':
        void handleSaveGeminiSummaryPrompt();
        break;
      case 'clear-gemini-summary-prompt-btn':
        void handleClearGeminiSummaryPrompt();
        break;
	      case 'export-data-btn':
	        void handleExportData();
	        break;
	      case 'import-data-btn':
	        void handleImportData();
	        break;
	      case 'font-size-btn':
	        toggleFontSizeMenu();
	        break;
	      case 'toggle-panel-size-btn':
	        handleTogglePanelSize();
        break;
    }
  });
  const aiPromptInput = panel.querySelector('#ai-prompt-input') as HTMLTextAreaElement | null;
  aiPromptInput?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    void handleAiRun();
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
	    fileModal.addEventListener('pointerleave', (e) => {
	      if (panel?.hasAttribute('data-suspend-file-modal-hover-close')) {
	        return;
	      }
	      const related = (e as PointerEvent).relatedTarget as Node | null;
	      const contextMenu = panel?.querySelector('#folder-context-menu') as HTMLElement | null;
	      if (related && (fileModal.contains(related) || contextMenu?.contains(related))) {
	        return;
      }
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

  tabList?.addEventListener('contextmenu', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const tabEl = target.closest('.tab-item') as HTMLElement | null;
    if (!tabEl) return;
    const tabId = tabEl.getAttribute('data-tab-id');
    if (!tabId || tabId === DRAFT_TAB_ID) return;
    e.preventDefault();
    void openTabThumbnailMenu(tabId, e.clientX, e.clientY);
  });

	  const tabThumbnailDeleteBtn = panel.querySelector('#tab-thumbnail-delete-btn') as HTMLButtonElement | null;
	  tabThumbnailDeleteBtn?.addEventListener('click', () => {
	    void handleDeleteTabThumbnail();
	  });

	  const tabThumbnailImg = panel.querySelector('#tab-thumbnail-img') as HTMLImageElement | null;
	  tabThumbnailImg?.addEventListener('click', (e) => {
	    e.stopPropagation();
	    const src = tabThumbnailImg.src;
	    if (!src) return;
	    openThumbnailZoomOverlay(src);
	  });

	  const zoomOverlay = panel.querySelector('#thumbnail-zoom-overlay') as HTMLElement | null;
	  const zoomImg = panel.querySelector('#thumbnail-zoom-img') as HTMLImageElement | null;
	  zoomOverlay?.addEventListener('click', (e) => {
	    e.stopPropagation();
	    closeThumbnailZoomOverlay();
	  });
	  zoomImg?.addEventListener('click', (e) => {
	    e.stopPropagation();
	    closeThumbnailZoomOverlay();
	  });
	}

function handleDocumentClick(e: MouseEvent) {
  if (!panel) return;
  const target = e.target as HTMLElement;
  const menu = panel.querySelector('#font-size-menu') as HTMLElement | null;
  if (menu && !target.closest('#font-size-control')) {
    closeFontSizeMenu();
  }
  if (!target.closest('#tab-thumbnail-menu')) {
    closeTabThumbnailMenu();
  }
  actions.closeFolderContextMenu();
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
  const info = getFocusedTextareaInfo();
  if (!info) return;

  const hasSelection = info.start !== info.end;
  const fullLength = info.textarea.value.length;
  let selectionState = 'カーソル挿入';
  if (hasSelection) {
    selectionState = info.start === 0 && info.end === fullLength && fullLength > 0 ? '全文選択' : '一部選択';
  }
  if (statusEl) {
    statusEl.textContent = selectionState;
  }
  if (paneEl) {
    paneEl.textContent = info.pane === 'right' ? '右' : '左';
  }

  if (hasSelection) {
    if (previewEl) {
      previewEl.style.display = 'block';
      previewEl.textContent = formatSelectionPreview(info.text);
    }
  } else {
    if (previewEl) {
      previewEl.style.display = 'none';
      previewEl.textContent = '';
    }
  }
}

function updateAiModalContextIfOpen() {
  if (!panel) return;
  const modal = panel.querySelector('#ai-modal') as HTMLElement | null;
  if (modal?.style.display !== 'flex') return;
  updateAiModalContext();
}

function toggleAiSettings() {
  if (!panel) return;
  const settings = panel.querySelector('#ai-settings') as HTMLElement | null;
  if (!settings) return;
  const nextVisible = settings.style.display !== 'block';
  settings.style.display = nextVisible ? 'block' : 'none';
  if (nextVisible) {
    void refreshGeminiCustomPromptUI();
    const input = panel.querySelector('#gemini-custom-prompt-input') as HTMLTextAreaElement | null;
    input?.focus();
  }
}

function openAiModal() {
  if (!panel) return;
  const settings = panel.querySelector('#ai-settings') as HTMLElement | null;
  if (settings) {
    settings.style.display = 'none';
  }
  const loading = panel.querySelector('#ai-loading') as HTMLElement | null;
  if (loading) {
    loading.style.display = 'none';
  }
  updateAiModalContext();
  const modal = panel.querySelector('#ai-modal') as HTMLElement | null;
  if (modal) {
    modal.style.display = 'flex';
  }
  void refreshGeminiCustomPromptUI();
  const promptInput = panel.querySelector('#ai-prompt-input') as HTMLTextAreaElement | null;
  promptInput?.focus();
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

function buildGeminiPrompt(params: {
  instruction: string;
  mode: string;
  text: string;
  context: string;
  customPrompt?: string;
}) {
  const lines = [
    'あなたは文章編集アシスタントです。',
    '次の「指示」と「対象/文脈」を元に、文章を生成または編集してください。',
    '出力は結果テキストのみ（余計な説明は不要）で返してください。',
    '',
    ...(params.customPrompt?.trim()
      ? ['# 常に適用するプロンプト', params.customPrompt.trim(), '']
      : []),
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

function getAiApplyMode(info: { start: number; end: number; textarea: HTMLTextAreaElement }) {
  if (info.start === info.end) {
    return 'insert-cursor';
  }
  const fullLength = info.textarea.value.length;
  if (info.start === 0 && info.end === fullLength) {
    return 'replace-all';
  }
  return 'replace-selection';
}

async function handleAiRun() {
  if (!panel) return;
  const promptEl = panel.querySelector('#ai-prompt-input') as HTMLTextAreaElement | null;
  if (!promptEl) return;
  const loading = panel.querySelector('#ai-loading') as HTMLElement | null;

  const instruction = promptEl.value.trim();
  if (!instruction) {
    alert('指示を入力してください');
    return;
  }

  const info = getFocusedTextareaInfo();
  if (!info) return;

  const { pane, textarea, start, end } = info;
  const mode = getAiApplyMode(info);

  const fullText = textarea.value;
  const selectionText = fullText.slice(start, end);

  const targetText = mode === 'replace-all' ? fullText : mode === 'replace-selection' ? selectionText : '';
  const context = mode === 'insert-cursor' ? getCursorContext(fullText, start) : '';

  const customPrompt = await loadGeminiCustomPrompt();
  const prompt = buildGeminiPrompt({
    instruction,
    mode,
    text: targetText,
    context,
    customPrompt: customPrompt || undefined
  });

  const wasDisabled = promptEl.disabled;
  promptEl.disabled = true;
  if (loading) {
    loading.style.display = 'flex';
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
    closeAiModal();
  } catch (error) {
    alert(`AIの実行に失敗しました: ${String(error)}`);
  } finally {
    promptEl.disabled = wasDisabled;
    if (loading) {
      loading.style.display = 'none';
    }
  }
}

async function loadGeminiApiKey() {
  const result = await chrome.storage.local.get('geminiApiKey');
  return typeof result.geminiApiKey === 'string' ? result.geminiApiKey : null;
}

async function loadGeminiCustomPrompt() {
  const result = await chrome.storage.local.get(GEMINI_CUSTOM_PROMPT_KEY);
  const value = result[GEMINI_CUSTOM_PROMPT_KEY];
  return typeof value === 'string' ? value : null;
}

async function loadGeminiSummaryPrompt() {
  const result = await chrome.storage.local.get(GEMINI_SUMMARY_PROMPT_KEY);
  const value = result[GEMINI_SUMMARY_PROMPT_KEY];
  return typeof value === 'string' ? value : null;
}

async function refreshGeminiCustomPromptUI() {
  if (!panel) return;
  const input = panel.querySelector('#gemini-custom-prompt-input') as HTMLTextAreaElement | null;
  const status = panel.querySelector('#gemini-custom-prompt-status') as HTMLElement | null;
  if (!input || !status) return;

  const prompt = await loadGeminiCustomPrompt();
  input.value = prompt || '';
  status.textContent = prompt ? '保存済み' : '未保存';
}

async function handleSaveGeminiCustomPrompt() {
  if (!panel) return;
  const input = panel.querySelector('#gemini-custom-prompt-input') as HTMLTextAreaElement | null;
  const status = panel.querySelector('#gemini-custom-prompt-status') as HTMLElement | null;
  if (!input || !status) return;

  const prompt = input.value.trim();
  if (!prompt) {
    alert('プロンプトを入力してください');
    return;
  }

  await chrome.storage.local.set({ [GEMINI_CUSTOM_PROMPT_KEY]: prompt });
  status.textContent = '保存済み';
}

async function handleClearGeminiCustomPrompt() {
  if (!panel) return;
  const input = panel.querySelector('#gemini-custom-prompt-input') as HTMLTextAreaElement | null;
  const status = panel.querySelector('#gemini-custom-prompt-status') as HTMLElement | null;
  if (!input || !status) return;

  const ok = confirm('保存済みのカスタムプロンプトをクリアしますか？');
  if (!ok) return;

  await chrome.storage.local.remove(GEMINI_CUSTOM_PROMPT_KEY);
  input.value = '';
  status.textContent = '未保存';
}

async function refreshGeminiSummaryPromptUI() {
  if (!panel) return;
  const input = panel.querySelector('#gemini-summary-prompt-input') as HTMLTextAreaElement | null;
  const status = panel.querySelector('#gemini-summary-prompt-status') as HTMLElement | null;
  if (!input || !status) return;

  const prompt = await loadGeminiSummaryPrompt();
  input.value = prompt || '';
  status.textContent = prompt ? '保存済み' : '未保存';
}

async function handleSaveGeminiSummaryPrompt() {
  if (!panel) return;
  const input = panel.querySelector('#gemini-summary-prompt-input') as HTMLTextAreaElement | null;
  const status = panel.querySelector('#gemini-summary-prompt-status') as HTMLElement | null;
  if (!input || !status) return;

  const prompt = input.value.trim();
  if (!prompt) {
    alert('プロンプトを入力してください');
    return;
  }

  await chrome.storage.local.set({ [GEMINI_SUMMARY_PROMPT_KEY]: prompt });
  status.textContent = '保存済み';
}

async function handleClearGeminiSummaryPrompt() {
  if (!panel) return;
  const input = panel.querySelector('#gemini-summary-prompt-input') as HTMLTextAreaElement | null;
  const status = panel.querySelector('#gemini-summary-prompt-status') as HTMLElement | null;
  if (!input || !status) return;

  const ok = confirm('保存済みの要約プロンプトをクリアしますか？');
  if (!ok) return;

  await chrome.storage.local.remove(GEMINI_SUMMARY_PROMPT_KEY);
  input.value = '';
  status.textContent = '未保存';
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

// ========================================
// YouTube要約オーバーレイ
// ========================================

type YoutubeVideoInfo = {
  videoId: string;
  url: string;
  title: string;
};

const YOUTUBE_OVERLAY_ATTR = 'data-chrome-memo-yt-overlay';
const YOUTUBE_OVERLAY_LAYER_CLASS = 'chrome-memo-yt-overlay-layer';
const YOUTUBE_OVERLAY_BTN_CLASS = 'chrome-memo-yt-overlay-btn';
const YOUTUBE_SCAN_DELAY_MS = 300;
let youtubeObserver: MutationObserver | null = null;
let youtubeScanTimer: number | null = null;
const youtubeInFlight = new Set<string>();

// アイコンURLをキャッシュ（コンテキスト無効化対策）
let cachedIconUrl: string | null = null;

function isExtensionContextValid(): boolean {
  try {
    // chrome.runtimeが存在し、idが取得できればコンテキストは有効
    return !!(chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function getCachedIconUrl(): string | null {
  if (cachedIconUrl) return cachedIconUrl;
  if (!isExtensionContextValid()) return null;
  try {
    cachedIconUrl = chrome.runtime.getURL('icons/icon16.png');
    return cachedIconUrl;
  } catch {
    return null;
  }
}

function cleanupYoutubeOverlay() {
  if (youtubeObserver) {
    youtubeObserver.disconnect();
    youtubeObserver = null;
  }
  if (youtubeScanTimer) {
    clearTimeout(youtubeScanTimer);
    youtubeScanTimer = null;
  }
  console.log('[YouTube Overlay] Cleaned up due to context invalidation');
}

function setupYoutubeOverlay() {
  console.log('[YouTube Overlay] Setup called, hostname:', location.hostname);
  if (!isYoutubeHost()) {
    console.log('[YouTube Overlay] Not YouTube host, skipping');
    return;
  }

  // コンテキストチェックとアイコンURLの事前キャッシュ
  if (!isExtensionContextValid()) {
    console.log('[YouTube Overlay] Extension context invalid, skipping');
    return;
  }

  // アイコンURLを事前にキャッシュ
  const iconUrl = getCachedIconUrl();
  if (!iconUrl) {
    console.log('[YouTube Overlay] Failed to cache icon URL');
    return;
  }

  console.log('[YouTube Overlay] YouTube detected, initializing overlay system');

  // 初回スキャンを少し遅延させてDOMの準備を待つ
  setTimeout(() => {
    if (isExtensionContextValid()) {
      scheduleYoutubeScan();
    }
  }, 500);

  if (!youtubeObserver) {
    youtubeObserver = new MutationObserver(() => {
      // コンテキストが無効になったらクリーンアップ
      if (!isExtensionContextValid()) {
        cleanupYoutubeOverlay();
        return;
      }
      scheduleYoutubeScan();
    });
    youtubeObserver.observe(document.body, { childList: true, subtree: true });
    console.log('[YouTube Overlay] MutationObserver attached');
  }

  // YouTubeのSPA遷移イベントをリッスン
  document.addEventListener('yt-navigate-finish', () => {
    if (!isExtensionContextValid()) return;
    console.log('[YouTube Overlay] yt-navigate-finish event fired');
    scheduleYoutubeScan();
  });

  // 追加: ページ遷移検知用のイベント
  document.addEventListener('yt-page-data-updated', () => {
    if (!isExtensionContextValid()) return;
    console.log('[YouTube Overlay] yt-page-data-updated event fired');
    scheduleYoutubeScan();
  });
}

function isYoutubeHost() {
  return /(^|\.)youtube\.com$/.test(location.hostname);
}

function scheduleYoutubeScan() {
  if (youtubeScanTimer) return;
  youtubeScanTimer = window.setTimeout(() => {
    youtubeScanTimer = null;
    scanYoutubeThumbnails();
  }, YOUTUBE_SCAN_DELAY_MS);
}

function scanYoutubeThumbnails() {
  // コンテキストチェック
  if (!isExtensionContextValid()) {
    cleanupYoutubeOverlay();
    return;
  }

  // 複数のセレクタに対応（YouTubeのDOM構造変更に対応）
  const containerSelectors = [
    'ytd-thumbnail:not([data-chrome-memo-yt-overlay])',
    'yt-thumbnail-view-model:not([data-chrome-memo-yt-overlay])',
    'ytd-playlist-thumbnail:not([data-chrome-memo-yt-overlay])'
  ];

  const containers = document.querySelectorAll(containerSelectors.join(', '));
  console.log(`[YouTube Overlay] Found ${containers.length} thumbnail containers`);

  containers.forEach((container, index) => {
    const element = container as HTMLElement;

    // 複数のアンカーセレクタを試す
    const anchorSelectors = [
      'a#thumbnail',
      'a[href*="/watch"]',
      'a[href*="/shorts/"]',
      'a.yt-simple-endpoint[href*="/watch"]'
    ];

    let anchor: HTMLElement | null = null;

    // 1. まず要素内部を探す
    for (const selector of anchorSelectors) {
      anchor = element.querySelector(selector) as HTMLElement | null;
      if (anchor) break;
    }

    // 2. 親要素から探す（各種レンダラー）
    if (!anchor) {
      const parentSelectors = [
        'ytd-rich-item-renderer',
        'ytd-video-renderer',
        'ytd-grid-video-renderer',
        'ytd-compact-video-renderer',
        'ytd-reel-item-renderer',
        'ytd-rich-grid-media'
      ];
      for (const parentSelector of parentSelectors) {
        const parent = element.closest(parentSelector);
        if (parent) {
          for (const selector of anchorSelectors) {
            anchor = parent.querySelector(selector) as HTMLElement | null;
            if (anchor) break;
          }
          if (anchor) break;
        }
      }
    }

    // 3. 兄弟要素を探す（yt-thumbnail-view-model用）
    if (!anchor && element.parentElement) {
      for (const selector of anchorSelectors) {
        anchor = element.parentElement.querySelector(selector) as HTMLElement | null;
        if (anchor) break;
      }
    }

    // 4. 要素自体がリンク内にある場合
    if (!anchor) {
      const closestAnchor = element.closest('a[href*="/watch"], a[href*="/shorts/"]') as HTMLElement | null;
      if (closestAnchor) {
        anchor = closestAnchor;
      }
    }

    if (!anchor) {
      if (index < 3) {
        console.log(`[YouTube Overlay] No anchor found for container ${index}:`, element.tagName, element.className);
      }
      return;
    }

    const info = extractYoutubeVideoInfo(anchor);
    if (!info) {
      if (index < 3) {
        console.log(`[YouTube Overlay] No video info extracted for container ${index}, href:`, anchor.getAttribute('href'));
      }
      return;
    }

    element.classList.add('chrome-memo-yt-thumb');
    const computed = getComputedStyle(element);
    if (computed.position === 'static') {
      element.style.position = 'relative';
    }

    const existingButton = element.querySelector(
      `.${YOUTUBE_OVERLAY_BTN_CLASS}`
    ) as HTMLButtonElement | null;
    if (existingButton) {
      updateYoutubeOverlayButton(existingButton, info);
      element.setAttribute(YOUTUBE_OVERLAY_ATTR, 'true');
      return;
    }

    const layer = createYoutubeOverlayLayer(info);
    if (!layer) {
      console.log(`[YouTube Overlay] Failed to create layer for video: ${info.videoId}`);
      return;
    }
    element.appendChild(layer);
    element.setAttribute(YOUTUBE_OVERLAY_ATTR, 'true');
    console.log(`[YouTube Overlay] Added overlay for video: ${info.videoId}`);
  });
}

function extractYoutubeVideoInfo(anchor: Element): YoutubeVideoInfo | null {
  const href = anchor.getAttribute('href') || (anchor as HTMLAnchorElement).href || '';
  const videoId = extractYoutubeVideoId(href);
  if (!videoId) return null;

  const url = new URL(href, location.origin).toString();
  const title = extractYoutubeVideoTitle(anchor);
  return { videoId, url, title };
}

function extractYoutubeVideoId(href: string) {
  try {
    // 空のhrefを除外
    if (!href || href === '#') return null;

    const url = new URL(href, location.origin);

    // /watch?v=xxx 形式
    if (url.pathname === '/watch') {
      return url.searchParams.get('v');
    }

    // /shorts/xxx 形式（ショート動画）
    const shortsMatch = url.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) {
      return shortsMatch[1];
    }

    // /embed/xxx 形式
    const embedMatch = url.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) {
      return embedMatch[1];
    }

    // hrefにvパラメータが含まれている場合（相対URL等）
    const vParam = url.searchParams.get('v');
    if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
      return vParam;
    }

    return null;
  } catch {
    // URLパース失敗時は正規表現でv=を探す
    const match = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }
}

function extractYoutubeVideoTitle(anchor: Element) {
  const container = anchor.closest(
    'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-playlist-renderer'
  );
  const titleElement = container?.querySelector('#video-title') as HTMLElement | null;
  const rawTitle =
    titleElement?.getAttribute('title') ||
    titleElement?.textContent ||
    anchor.getAttribute('title') ||
    anchor.getAttribute('aria-label') ||
    '';
  return rawTitle.trim();
}

function createYoutubeOverlayButton(info: YoutubeVideoInfo): HTMLButtonElement | null {
  // キャッシュされたアイコンURLを使用
  const iconUrl = getCachedIconUrl();
  if (!iconUrl) {
    console.log('[YouTube Overlay] Cannot create button: icon URL not available');
    return null;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = YOUTUBE_OVERLAY_BTN_CLASS;
  button.title = '字幕を要約してクイックメモに保存';
  button.setAttribute('aria-label', '字幕を要約してクイックメモに保存');
  updateYoutubeOverlayButton(button, info);

  const icon = document.createElement('img');
  icon.className = 'chrome-memo-yt-overlay-icon';
  icon.src = iconUrl;
  icon.alt = '';

  const spinner = document.createElement('span');
  spinner.className = 'chrome-memo-yt-overlay-spinner';

  button.appendChild(icon);
  button.appendChild(spinner);

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void handleYoutubeOverlayClick(button);
  });

  return button;
}

function updateYoutubeOverlayButton(button: HTMLButtonElement, info: YoutubeVideoInfo) {
  button.dataset.videoId = info.videoId;
  button.dataset.videoUrl = info.url;
  button.dataset.videoTitle = info.title;
}

function createYoutubeOverlayLayer(info: YoutubeVideoInfo): HTMLDivElement | null {
  const button = createYoutubeOverlayButton(info);
  if (!button) return null;

  const layer = document.createElement('div');
  layer.className = YOUTUBE_OVERLAY_LAYER_CLASS;
  layer.appendChild(button);
  return layer;
}

function setYoutubeOverlayLoading(button: HTMLButtonElement, loading: boolean) {
  button.classList.toggle('is-loading', loading);
  button.disabled = loading;
}

function setYoutubeOverlayError(button: HTMLButtonElement) {
  button.classList.add('is-error');
  window.setTimeout(() => button.classList.remove('is-error'), 2000);
}

async function handleYoutubeOverlayClick(button: HTMLButtonElement) {
  const videoId = button.dataset.videoId || '';
  if (!videoId) return;
  if (youtubeInFlight.has(videoId)) return;

  youtubeInFlight.add(videoId);
  setYoutubeOverlayLoading(button, true);

  try {
    const transcript = await requestYoutubeTranscript(videoId);
    const summary = await summarizeYoutubeTranscript({
      transcript,
      title: button.dataset.videoTitle || '',
      url: button.dataset.videoUrl || ''
    });
    await updateQuickMemoFromSummary(summary);
  } catch (error) {
    console.error('[Content] YouTube summary failed:', error);
    alert(typeof error === 'string' ? error : String(error ?? '要約に失敗しました'));
    setYoutubeOverlayError(button);
  } finally {
    setYoutubeOverlayLoading(button, false);
    youtubeInFlight.delete(videoId);
  }
}


// YouTube字幕取得（Background経由でMAINワールドで実行、CORS回避）
async function requestYoutubeTranscript(videoId: string): Promise<TranscriptItem[]> {
  console.log('[Content] Fetching transcript for video:', videoId);

  // Background.tsのFETCH_TRANSCRIPT_MAIN_WORLDを使用してMAINワールドで取得
  const response = await chrome.runtime.sendMessage({
    type: MessageType.FETCH_TRANSCRIPT_MAIN_WORLD,
    videoId
  });

  if (!response?.success) {
    throw new Error(response?.error || '字幕の取得に失敗しました');
  }

  const items = response.data as TranscriptItem[];
  console.log('[Content] Received transcript:', items.length, 'items');

  if (!items || items.length === 0) {
    throw new Error('字幕が空でした');
  }

  return items;
}


function buildTranscriptText(items: TranscriptItem[]) {
  return items
    .map((item) => (item.time ? `[${item.time}] ${item.text}` : item.text))
    .join('\n');
}

function buildYoutubeSummaryPrompt(params: {
  transcript: string;
  title: string;
  url: string;
  customPrompt?: string;
}) {
  const instruction =
    params.customPrompt?.trim() || '日本語で要約し、重要ポイントを箇条書きでまとめてください。';

  const lines = [
    'あなたはYouTube動画の字幕を要約するアシスタントです。',
    '出力は要約結果のみ（余計な説明は不要）で返してください。',
    '',
    '# 指示',
    instruction,
    '',
    '# 動画情報',
    params.title ? `タイトル: ${params.title}` : 'タイトル: （不明）',
    params.url ? `URL: ${params.url}` : 'URL: （不明）',
    '',
    '# 字幕',
    params.transcript
  ];

  return lines.join('\n');
}

async function summarizeYoutubeTranscript(params: {
  transcript: TranscriptItem[];
  title: string;
  url: string;
}) {
  const transcriptText = buildTranscriptText(params.transcript);
  if (!transcriptText.trim()) {
    throw new Error('字幕が空でした');
  }

  const customPrompt = await loadGeminiSummaryPrompt();
  const prompt = buildYoutubeSummaryPrompt({
    transcript: transcriptText,
    title: params.title,
    url: params.url,
    customPrompt: customPrompt || undefined
  });

  const response = await chrome.runtime.sendMessage({
    type: MessageType.GEMINI_GENERATE,
    prompt
  });

  if (!response?.success) {
    throw new Error(response?.error || '要約の生成に失敗しました');
  }

  const summary = typeof response.data === 'string' ? response.data.trim() : String(response.data ?? '').trim();
  if (!summary) {
    throw new Error('要約結果が空でした');
  }
  return summary;
}

async function updateQuickMemoFromSummary(summary: string) {
  const response = await chrome.runtime.sendMessage({
    type: MessageType.UPDATE_QUICK_MEMO,
    content: summary
  });

  if (!response?.success) {
    throw new Error(response?.error || 'クイックメモの更新に失敗しました');
  }

  await actions.loadData();
  view.renderAll();
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

	async function handleImportData() {
	  if (!panel) return;
	  const input = panel.querySelector('#import-data-input') as HTMLInputElement | null;
	  if (!input) return;

	  input.value = '';
	  input.onchange = async () => {
	    const file = input.files?.[0];
	    if (!file) return;

	    const ok = confirm('バックアップをインポートします。\nフォルダ/メモは追加で取り込みます。\n下書きメモと設定はバックアップの内容で上書きされます。\nよろしいですか？');
	    if (!ok) {
	      input.value = '';
	      return;
	    }

	    try {
	      const text = await file.text();
	      const data = JSON.parse(text);

	      const response = await chrome.runtime.sendMessage({
	        type: MessageType.IMPORT_BACKUP_DATA,
	        data
	      });

	      if (!response?.success) {
	        alert(response?.error || 'インポートに失敗しました');
	        return;
	      }

	      await loadSettings();
	      applyMemoFontSize(appSettings.memoFontSize);
	      await actions.loadData();
	      view.renderAll();

	      const summary = response.data as {
	        addedFolders: number;
	        addedNotes: number;
	        restoredThumbnails: number;
	        sync?: { success: boolean; error?: string };
	      };
	      const syncText = summary.sync?.success ? '同期: OK' : `同期: 失敗（${summary.sync?.error || '不明'}）`;
	      alert(`インポートしました（追加フォルダ: ${summary.addedFolders} / 追加メモ: ${summary.addedNotes} / サムネ復元: ${summary.restoredThumbnails} / ${syncText}）`);
	    } catch (error) {
	      console.error('[Content] Error importing data:', error);
	      alert('インポートに失敗しました');
	    } finally {
	      input.value = '';
	    }
	  };

	  input.click();
	}

	function getPaneTabId(pane: Pane) {
	  return pane === 'left' ? panelState.activeTabId : panelState.rightTabId;
	}

async function convertImageToWebpThumbnail(file: File) {
  const bitmap = await createImageBitmap(file);
  const targetWidth = Math.max(1, Math.floor(bitmap.width / 2));
  const targetHeight = Math.max(1, Math.floor(bitmap.height / 2));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Canvas context is not available');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error('Failed to convert to WebP'));
          return;
        }
        resolve(result);
      },
      'image/webp',
      0.7
    );
  });

  return await blob.arrayBuffer();
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function handleSetThumbnailFromFile(file: File, pane: Pane) {
  const noteId = getPaneTabId(pane);
  if (!noteId) return;
  if (noteId === DRAFT_TAB_ID) {
    alert('下書きにはサムネを設定できません');
    return;
  }

  const current = tabInfoMap[noteId];
  if (current?.thumbnailPath) {
    const ok = confirm('既存のサムネがあります。上書きしますか？');
    if (!ok) return;
  }

  try {
    const data = await convertImageToWebpThumbnail(file);
    const dataBase64 = arrayBufferToBase64(data);
    const response = await chrome.runtime.sendMessage({
      type: MessageType.SET_NOTE_THUMBNAIL,
      noteId,
      data: dataBase64
    });
    if (!response.success) {
      alert(`サムネ設定に失敗しました: ${response.error}`);
      return;
    }
    const updatedNote = response.data as Note;
    if (tabInfoMap[noteId]) {
      tabInfoMap[noteId].thumbnailPath = updatedNote.thumbnailPath;
    }
  } catch (error) {
    console.error('[Content] Failed to set thumbnail:', error);
    alert('サムネ画像の設定に失敗しました');
  }
	}

	function openThumbnailZoomOverlay(src: string) {
	  if (!panel) return;
	  if (!src) return;
	  const overlay = panel.querySelector('#thumbnail-zoom-overlay') as HTMLElement | null;
	  const img = panel.querySelector('#thumbnail-zoom-img') as HTMLImageElement | null;
	  if (!overlay || !img) return;
	  img.src = src;
	  overlay.style.display = 'flex';
	}

	function closeThumbnailZoomOverlay() {
	  if (!panel) return;
	  const overlay = panel.querySelector('#thumbnail-zoom-overlay') as HTMLElement | null;
	  const img = panel.querySelector('#thumbnail-zoom-img') as HTMLImageElement | null;
	  if (img) {
	    img.src = '';
	  }
	  if (overlay) {
	    overlay.style.display = 'none';
	  }
	}

	function closeTabThumbnailMenu() {
	  if (!panel) return;
	  closeThumbnailZoomOverlay();
	  const menu = panel.querySelector('#tab-thumbnail-menu') as HTMLElement | null;
	  if (!menu) return;
	  menu.style.display = 'none';
	  menu.removeAttribute('data-note-id');

  const loading = menu.querySelector('#tab-thumbnail-loading') as HTMLElement | null;
  const img = menu.querySelector('#tab-thumbnail-img') as HTMLImageElement | null;
  const preview = menu.querySelector('.tab-thumbnail-preview') as HTMLElement | null;
  if (loading) {
    loading.textContent = '';
    loading.style.display = 'none';
  }
  if (img) {
    img.src = '';
    img.style.display = 'none';
    img.classList.remove('is-zoomed');
  }
  if (preview) {
    preview.classList.remove('is-zoomed');
  }
}

async function openTabThumbnailMenu(noteId: string, clientX: number, clientY: number) {
  if (!panel) return;
  const menu = panel.querySelector('#tab-thumbnail-menu') as HTMLElement | null;
  if (!menu) return;

  actions.closeFolderContextMenu();
  closeTabThumbnailMenu();
  menu.setAttribute('data-note-id', noteId);
  menu.style.display = 'block';
  menu.style.left = '0px';
  menu.style.top = '0px';

  const panelRect = panel.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let left = clientX - panelRect.left;
  let top = clientY - panelRect.top;
  const maxLeft = Math.max(8, panelRect.width - menuRect.width - 8);
  const maxTop = Math.max(8, panelRect.height - menuRect.height - 8);
  left = Math.min(Math.max(8, left), maxLeft);
  top = Math.min(Math.max(8, top), maxTop);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const deleteBtn = menu.querySelector('#tab-thumbnail-delete-btn') as HTMLButtonElement | null;
  const loading = menu.querySelector('#tab-thumbnail-loading') as HTMLElement | null;
  const img = menu.querySelector('#tab-thumbnail-img') as HTMLImageElement | null;
  const preview = menu.querySelector('.tab-thumbnail-preview') as HTMLElement | null;

  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.style.display = 'none';
  }
  if (img) {
    img.src = '';
    img.style.display = 'none';
    img.classList.remove('is-zoomed');
  }
  if (preview) {
    preview.classList.remove('is-zoomed');
  }
  if (loading) {
    loading.textContent = '読み込み中...';
    loading.style.display = 'block';
  }

  const tab = tabInfoMap[noteId];
  if (!tab?.thumbnailPath) {
    if (loading) loading.textContent = 'サムネが設定されていません';
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_NOTE_THUMBNAIL_URL,
      noteId
    });

    if (menu.getAttribute('data-note-id') !== noteId) return;

    if (!response.success) {
      if (loading) loading.textContent = `表示に失敗しました: ${response.error}`;
      return;
    }

    const url = response.data as string;
    if (loading) loading.style.display = 'none';
    if (img) {
      img.src = url;
      img.style.display = 'block';
    }
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.style.display = 'inline-block';
    }
  } catch (error) {
    console.error('[Content] Failed to load thumbnail URL:', error);
    if (menu.getAttribute('data-note-id') !== noteId) return;
    if (loading) loading.textContent = '表示に失敗しました';
  }
}

async function handleDeleteTabThumbnail() {
  if (!panel) return;
  const menu = panel.querySelector('#tab-thumbnail-menu') as HTMLElement | null;
  if (!menu) return;
  const noteId = menu.getAttribute('data-note-id');
  if (!noteId) return;

  const ok = confirm('サムネを削除しますか？');
  if (!ok) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.DELETE_NOTE_THUMBNAIL,
      noteId
    });
    if (!response.success) {
      alert(`サムネ削除に失敗しました: ${response.error}`);
      return;
    }
    if (tabInfoMap[noteId]) {
      delete tabInfoMap[noteId].thumbnailPath;
    }
    closeTabThumbnailMenu();
  } catch (error) {
    console.error('[Content] Failed to delete thumbnail:', error);
    alert('サムネ削除に失敗しました');
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

  textarea.addEventListener('paste', (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const item = Array.from(items).find(entry => entry.kind === 'file' && entry.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    e.preventDefault();
    void handleSetThumbnailFromFile(file, pane);
  });

  textarea.addEventListener('dragover', (e: DragEvent) => {
    const items = e.dataTransfer?.items;
    if (!items) return;
    const hasImage = Array.from(items).some(entry => entry.kind === 'file' && entry.type.startsWith('image/'));
    if (!hasImage) return;
    e.preventDefault();
  });

  textarea.addEventListener('drop', (e: DragEvent) => {
    const files = e.dataTransfer?.files;
    if (!files) return;
    const imageFile = Array.from(files).find(file => file.type.startsWith('image/'));
    if (!imageFile) return;
    e.preventDefault();
    e.stopPropagation();
    void handleSetThumbnailFromFile(imageFile, pane);
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
