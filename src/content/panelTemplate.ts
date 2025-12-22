import { DRAFT_PLACEHOLDER } from './panelTypes';

export function getPanelHtml(): string {
  return `
    <div class="panel-header">
      <div class="header-left">
        <h2 id="memo-title">メモ</h2>
        <button class="header-btn" id="new-note-btn" title="新規メモ">➕</button>
        <button class="header-btn" id="save-as-btn" title="名前を付けて保存">💾</button>
        <button class="header-btn" id="save-btn" title="上書き保存" style="display: none;">📥</button>
        <button class="header-btn" id="open-file-btn" title="ファイルを開く">📂</button>
        <button class="header-btn" id="split-view-btn" title="スプリットビュー">⇔</button>
        <button class="header-btn" id="export-data-btn" title="メモをエクスポート">📤</button>
        <div class="font-size-control" id="font-size-control">
          <button class="header-btn" id="font-size-btn" title="フォントサイズ">🔠</button>
          <div class="font-size-menu" id="font-size-menu">
            <label>文字サイズ</label>
            <div class="font-size-options" id="font-size-options"></div>
          </div>
        </div>
        <button class="header-btn" id="auth-btn" title="同期 / サインイン">👤</button>
        <span class="memo-current-label" id="memo-current-label"></span>
      </div>
      <div class="header-right">
        <button class="header-btn" id="toggle-panel-size-btn" title="パネルサイズ切り替え">⤢</button>
        <button class="close-btn" id="close-panel-btn">×</button>
      </div>
    </div>

    <div class="panel-content">
      <!-- タブバー -->
      <div class="tab-bar">
        <div class="tab-list" id="tab-list"></div>
      </div>

      <!-- メモテキストエリア -->
      <div class="memo-split" id="memo-split">
        <div class="memo-pane left" data-pane="left">
          <textarea
            class="memo-textarea"
            id="memo-textarea-left"
            placeholder="${DRAFT_PLACEHOLDER}"
          ></textarea>
        </div>
        <div class="memo-pane right" data-pane="right">
          <textarea
            class="memo-textarea"
            id="memo-textarea-right"
            placeholder="${DRAFT_PLACEHOLDER}"
          ></textarea>
        </div>
      </div>
    </div>

    <!-- ファイル選択モーダル -->
    <div class="file-modal" id="file-modal" style="display: none;">
      <div class="file-modal-content">
        <div class="file-modal-header">
          <h3>メモを開く</h3>
          <button class="close-modal-btn" id="close-file-modal-btn">×</button>
        </div>
        <div class="file-modal-body">
          <div class="folder-tabs" id="modal-folder-tabs"></div>
          <div class="file-list" id="file-list"></div>
        </div>
      </div>
    </div>

    <!-- 保存モーダル -->
    <div class="save-modal" id="save-modal" style="display: none;">
      <div class="save-modal-content">
        <div class="save-modal-header">
          <h3>メモを保存</h3>
          <button class="close-modal-btn" id="close-save-modal-btn">×</button>
        </div>
        <div class="save-modal-body">
          <div class="form-group">
            <label for="save-title">タイトル:</label>
            <input type="text" id="save-title" class="save-input" placeholder="タイトルを入力">
          </div>
          <div class="form-group">
            <label for="save-folder">保存先フォルダ:</label>
            <select id="save-folder" class="save-select"></select>
          </div>
          <div class="form-group" id="new-folder-group" style="display: none;">
            <label for="new-folder-name">新規フォルダ名:</label>
            <input type="text" id="new-folder-name" class="save-input" placeholder="フォルダ名を入力">
          </div>
          <div class="save-modal-actions">
            <button class="btn-primary" id="confirm-save-btn">保存</button>
            <button class="btn-secondary" id="cancel-save-btn">キャンセル</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 認証モーダル -->
    <div class="auth-modal" id="auth-modal" style="display: none;">
      <div class="auth-modal-content">
        <div class="auth-modal-header">
          <h3>同期</h3>
          <button class="close-modal-btn" id="close-auth-modal-btn">×</button>
        </div>
        <div class="auth-modal-body">
          <div id="auth-modal-signed-out">
            <p>サインインすると、複数のデバイス間でメモを同期できます</p>
            <button class="btn-primary" id="auth-sign-in-btn">Googleでサインイン</button>
            <p id="auth-modal-error" class="auth-error" style="display: none;"></p>
          </div>
          <div id="auth-modal-signed-in" style="display: none;">
            <p>サインイン中: <span id="auth-user-email"></span></p>
            <div class="auth-actions">
              <button class="btn-secondary" id="auth-sync-now-btn">今すぐ同期</button>
              <button class="btn-secondary" id="auth-sign-out-btn">サインアウト</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- スプリット選択モーダル -->
    <div class="split-modal" id="split-modal" style="display: none;">
      <div class="split-modal-content">
        <div class="split-modal-header">
          <h3>右側に表示するメモを選択</h3>
          <button class="close-modal-btn" id="close-split-modal-btn">×</button>
        </div>
        <div class="split-modal-body">
          <div class="split-section">
            <div class="split-section-title">開いているメモ</div>
            <div class="split-tab-list" id="split-tab-list"></div>
          </div>
          <div class="split-section">
            <div class="split-section-title">フォルダのメモ</div>
            <div class="folder-tabs" id="split-folder-tabs"></div>
            <div class="file-list" id="split-file-list"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- リサイズハンドル -->
    <div class="resize-handle" id="resize-handle"></div>
  `;
}
