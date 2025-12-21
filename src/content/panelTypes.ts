export type TabKind = 'draft' | 'note';
export type Pane = 'left' | 'right';

export interface TabInfo {
  id: string;
  kind: TabKind;
  title: string;
}

export const DRAFT_TAB_ID = '__draft__';
export const DRAFT_TAB_LABEL = '下書き';
export const DRAFT_PLACEHOLDER = 'ここにメモを入力...（下書きは自動保存されます）';
export const NOTE_PLACEHOLDER = 'ここにメモを入力...（保存ボタンで保存してください）';

