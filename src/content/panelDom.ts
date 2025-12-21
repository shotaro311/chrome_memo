import type { Pane } from './panelTypes';

export function getTextarea(panel: HTMLElement | null, pane: Pane): HTMLTextAreaElement | null {
  if (!panel) return null;
  return panel.querySelector(`#memo-textarea-${pane}`) as HTMLTextAreaElement | null;
}

export function focusMemoTextarea(panel: HTMLElement | null, pane: Pane) {
  const textarea = getTextarea(panel, pane);
  if (!textarea) return;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

