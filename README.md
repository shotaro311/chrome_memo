# Chrome拡張メモアプリ

ブラウザ右上に表示される**ダークモード**の軽量なメモパネル（オーバーレイ）。
下書きメモと、フォルダ分けできる「メモ」を扱えるChrome拡張機能です。

## 主な機能

### メモ
- **下書きメモ**（自動保存・1件）
- **メモ（通常メモ）**：名前を付けて保存、上書き保存、フォルダ分け
- **下書きメモ作成**（➕）
- **メモを開く**（📂）：一覧から開く / 名前変更 / 削除
- **ダークモード** + **等幅フォント**

### 快適な操作
- **ツールバーアイコンクリック** - メモパネルが開く
- **ショートカット対応** - キーボードで素早く操作
- **リサイズ可能** - 自分の好みのサイズに調整可能
- **タブ切り替え** - 複数メモを同時に開ける
- **スプリットビュー** - 2つのメモを並べて表示

### 同期（任意）
- 👤から **Googleでサインイン** すると、複数デバイス間で同期できます（Supabase）
- サインアウト / 手動同期（今すぐ同期）も可能

### ショートカットキー
- `Cmd+Shift+M` (Mac) / `Ctrl+Shift+M` (Windows): メモパネルを開閉

## 使い方（パネル上部のアイコン）

- `➕` 下書きメモを開く（タブ）
- `💾` 名前を付けて保存（下書きメモをフォルダ保存）
- `📥` 上書き保存（通常メモのときだけ表示）
- `📂` メモを開く（一覧）
- `⇔` スプリットビュー
- `👤` 同期 / サインイン
- 右側の小さい表示：開いているメモ名

## セットアップ

### 依存関係のインストール

```bash
npm install
```

### ビルド

#### 開発ビルド（ウォッチモード）
```bash
npm run dev
```

#### 本番ビルド
```bash
npm run build
```

### Chromeへのインストール

1. Chromeを開き、`chrome://extensions/` にアクセス
2. 右上の「デベロッパーモード」を有効にする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. プロジェクトの `dist` フォルダを選択

## プロジェクト構造

```
chrome_memo/
├── src/
│   ├── background/          # Background script
│   │   └── background.ts
│   ├── content/            # Content script（パネル）
│   │   └── content.ts
│   ├── lib/                # Supabase / 同期
│   ├── auth/               # 認証関連
│   ├── popup/              # 旧Popup（現状は未使用）
│   │   ├── popup.html
│   │   ├── popup.ts
│   │   └── popup.css
│   ├── types/              # 型定義
│   │   └── index.ts
│   ├── utils/              # ユーティリティ
│   │   └── storage.ts
│   └── styles/             # スタイル
│       └── panel.css
├── public/
│   ├── manifest.json       # 拡張機能の設定
│   └── icons/              # アイコン画像
├── dist/                   # ビルド出力
├── package.json
├── tsconfig.json
└── webpack.config.js
```

## データ保存

- **下書きメモ**: `chrome.storage.local`
- **通常メモ**: 本文は `chrome.storage.local`、メタデータは `chrome.storage.sync`
- **自動保存**: 下書きメモは入力から約800ms後に保存
- **同期（任意）**: サインイン時にSupabaseへ同期
- **文字数制限**: 1メモあたり最大20,000文字

## 技術スタック

- TypeScript
- Webpack
- Chrome Extension Manifest V3
- Chrome Storage API

## ライセンス

MIT
