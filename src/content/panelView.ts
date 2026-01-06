import type { Note, PanelState, QuickMemo } from '../types';
import {
  DRAFT_PLACEHOLDER,
  DRAFT_TAB_ID,
  DRAFT_TAB_LABEL,
  NOTE_PLACEHOLDER,
  type Pane,
  type TabInfo
} from './panelTypes';

export interface PanelViewState {
  getPanel: () => HTMLElement | null;
  panelState: PanelState;
  draftMemo: QuickMemo;
  tabInfoMap: Record<string, TabInfo>;
  tabContentCache: Record<string, string>;
  tabUnsavedMap: Record<string, boolean>;
}

export interface PanelViewDeps {
  escapeHtml: (text: string) => string;
  focusMemoTextarea: (pane: Pane) => void;
}

export function createPanelView(state: PanelViewState, deps: PanelViewDeps) {
  const { getPanel, panelState, draftMemo, tabInfoMap, tabContentCache, tabUnsavedMap } = state;

  function renderAll() {
    renderTabs();
    renderPanes();
    updateHeaderState();
  }

  function renderTabs() {
    const panel = getPanel();
    if (!panel) return;

    const tabList = panel.querySelector('#tab-list') as HTMLElement | null;
    if (!tabList) return;

    tabList.innerHTML = panelState.openTabs
      .map(tabId => {
        if (tabId === DRAFT_TAB_ID && !tabInfoMap[DRAFT_TAB_ID]) {
          tabInfoMap[DRAFT_TAB_ID] = {
            id: DRAFT_TAB_ID,
            kind: 'draft',
            title: DRAFT_TAB_LABEL
          };
        }
        const tab = tabInfoMap[tabId];
        if (!tab) return '';
        const title = tab.kind === 'draft' ? DRAFT_TAB_LABEL : (tab.title || '無題のメモ');
        const isActive = tabId === panelState.activeTabId;
        return `
        <button class="tab-item ${isActive ? 'active' : ''}" data-tab-id="${tabId}">
          <span class="tab-title">${deps.escapeHtml(title)}</span>
          <span class="tab-close" data-tab-id="${tabId}">×</span>
        </button>
      `;
      })
      .join('');

    tabList.querySelectorAll('.tab-item').forEach(tabEl => {
      tabEl.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('tab-close')) {
          e.stopPropagation();
          const tabId = target.getAttribute('data-tab-id');
          if (tabId) {
            closeTab(tabId);
          }
          return;
        }

        const tabId = (tabEl as HTMLElement).getAttribute('data-tab-id');
        if (tabId) {
          setActiveTab(tabId);
        }
      });
    });
  }

  function renderPanes() {
    const panel = getPanel();
    if (!panel) return;

    panel.classList.toggle('is-split', panelState.splitEnabled);
    renderPane('left');
    renderPane('right');
  }

  function renderPane(pane: Pane) {
    const panel = getPanel();
    if (!panel) return;

    const paneTabId = getPaneTabId(pane);
    const textarea = panel.querySelector(`#memo-textarea-${pane}`) as HTMLTextAreaElement | null;
    const paneContainer = panel.querySelector(`.memo-pane.${pane}`) as HTMLElement | null;

    if (!textarea || !paneContainer) return;

    if (!paneTabId) {
      textarea.value = '';
      textarea.placeholder = '';
      paneContainer.style.display = 'none';
      return;
    }

    paneContainer.style.display = 'flex';
    textarea.value = getTabContent(paneTabId);
    textarea.placeholder = getTabPlaceholder(paneTabId);
  }

  function updateHeaderState() {
    const panel = getPanel();
    if (!panel) return;

    const currentLabel = panel.querySelector('#memo-current-label') as HTMLElement | null;
    const saveBtn = panel.querySelector('#save-btn') as HTMLButtonElement | null;

    const leftTabId = panelState.activeTabId;
    const rightTabId = panelState.splitEnabled ? panelState.rightTabId : null;
    const leftLabel = leftTabId ? getTabTitle(leftTabId) : '';
    const rightLabel = rightTabId ? getTabTitle(rightTabId) : '';

    if (currentLabel) {
      if (panelState.splitEnabled && rightLabel) {
        currentLabel.textContent = `左: ${leftLabel} / 右: ${rightLabel}`;
        currentLabel.title = currentLabel.textContent;
      } else {
        currentLabel.textContent = leftLabel;
        currentLabel.title = leftLabel;
      }
    }

    let focusedTab = getFocusedTabInfo();
    if (!focusedTab && panelState.activeTabId) {
      panelState.lastFocusedPane = 'left';
      focusedTab = getFocusedTabInfo();
    }
    if (saveBtn) {
      saveBtn.style.display = focusedTab?.kind === 'note' ? 'inline-flex' : 'none';
    }
  }

  function initializeTabsIfNeeded() {
    if (panelState.openTabs.length === 0) {
      openDraftTab();
      return;
    }

    if (!panelState.activeTabId) {
      panelState.activeTabId = panelState.openTabs[0] || null;
    }
    if (panelState.activeTabId && !panelState.openTabs.includes(panelState.activeTabId)) {
      panelState.activeTabId = panelState.openTabs[0] || null;
    }

    const missingDraft = panelState.openTabs.includes(DRAFT_TAB_ID) && !tabInfoMap[DRAFT_TAB_ID];
    if (missingDraft) {
      tabInfoMap[DRAFT_TAB_ID] = {
        id: DRAFT_TAB_ID,
        kind: 'draft',
        title: DRAFT_TAB_LABEL
      };
    }
  }

  function openDraftTab() {
    if (!tabInfoMap[DRAFT_TAB_ID]) {
      tabInfoMap[DRAFT_TAB_ID] = {
        id: DRAFT_TAB_ID,
        kind: 'draft',
        title: DRAFT_TAB_LABEL
      };
    }

    if (!panelState.openTabs.includes(DRAFT_TAB_ID)) {
      panelState.openTabs.push(DRAFT_TAB_ID);
    }

    tabContentCache[DRAFT_TAB_ID] = draftMemo.content || '';
    setActiveTab(DRAFT_TAB_ID);
  }

  function openNoteTab(note: Note, contentOverride?: string, options?: { activate?: boolean }) {
    const exists = panelState.openTabs.includes(note.id);
    tabInfoMap[note.id] = {
      id: note.id,
      kind: 'note',
      title: note.title,
      thumbnailPath: note.thumbnailPath
    };

    tabContentCache[note.id] = contentOverride ?? note.content;
    tabUnsavedMap[note.id] = false;

    if (!exists) {
      panelState.openTabs.push(note.id);
    }

    panelState.currentFolderId = note.folderId;
    if (options?.activate === false) {
      renderAll();
      return;
    }
    setActiveTab(note.id);
  }

  function closeTab(tabId: string) {
    const index = panelState.openTabs.indexOf(tabId);
    if (index === -1) return;

    panelState.openTabs.splice(index, 1);

    if (tabId !== DRAFT_TAB_ID) {
      delete tabInfoMap[tabId];
      delete tabContentCache[tabId];
      delete tabUnsavedMap[tabId];
    }

    if (panelState.splitEnabled && panelState.rightTabId === tabId) {
      panelState.splitEnabled = false;
      panelState.rightTabId = null;
    }

    if (panelState.activeTabId === tabId) {
      const nextTabId = panelState.openTabs[index] || panelState.openTabs[index - 1] || null;
      if (nextTabId) {
        setActiveTab(nextTabId);
      } else {
        openDraftTab();
      }
    } else {
      renderAll();
    }
  }

  function setActiveTab(tabId: string) {
    if (!panelState.openTabs.includes(tabId)) return;
    panelState.activeTabId = tabId;
    panelState.lastFocusedPane = 'left';
    renderAll();
    deps.focusMemoTextarea('left');
  }

  function setRightTab(tabId: string) {
    if (!panelState.openTabs.includes(tabId)) return;
    panelState.rightTabId = tabId;
    renderAll();
  }

  function getFocusedTabInfo(): TabInfo | null {
    const tabId = getPaneTabId(panelState.lastFocusedPane);
    if (!tabId) return null;
    return tabInfoMap[tabId] || null;
  }

  function getPaneTabId(pane: Pane): string | null {
    if (pane === 'left') {
      return panelState.activeTabId;
    }
    if (!panelState.splitEnabled) return null;
    return panelState.rightTabId;
  }

  function getTabTitle(tabId: string): string {
    if (tabId === DRAFT_TAB_ID) return DRAFT_TAB_LABEL;
    return tabInfoMap[tabId]?.title || '無題のメモ';
  }

  function getTabContent(tabId: string): string {
    if (tabId === DRAFT_TAB_ID) {
      return draftMemo.content || '';
    }
    return tabContentCache[tabId] ?? '';
  }

  function getTabPlaceholder(tabId: string): string {
    if (tabId === DRAFT_TAB_ID) {
      return DRAFT_PLACEHOLDER;
    }
    return NOTE_PLACEHOLDER;
  }

  return {
    closeTab,
    getFocusedTabInfo,
    getPaneTabId,
    getTabContent,
    getTabPlaceholder,
    getTabTitle,
    initializeTabsIfNeeded,
    openDraftTab,
    openNoteTab,
    renderAll,
    renderTabs,
    setActiveTab,
    setRightTab,
    updateHeaderState
  };
}
