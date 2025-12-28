# 引継書：Chrome拡張への「YouTube字幕（タイムスタンプ付き）取得」組み込み

目的：このリポジトリ（`youtube_tr`）で実装している「YouTubeの既存字幕（キャプション）を取得して `{ time, text }[]` に整形する」仕組みを、別リポジトリのChrome拡張機能に移植するための一次情報をまとめる。

---

## 1. まず結論（このアプリの方式）

- **音声認識はしていない**（Whisper等は不使用）。
- **YouTubeに元から付いている字幕**（手動字幕/自動生成字幕）を取得して整形している。
- そのため「速さ」は出やすく、「精度」は基本的に **YouTube字幕の品質に依存**する。

参照（元実装）：
- 字幕取得（フォールバック側・XML取得とパース）: `src/lib/transcript/extract.ts:106`
- タイムスタンプ整形（秒→`MM:SS`/`HH:MM:SS`）: `src/lib/transcript/extract.ts:317`
- 言語優先（日本語系）: `src/lib/transcript/extract.ts:10`

---

## 2. データフロー（このアプリの実コード）

サーバAPI（Next.js）：

1) クライアントが `POST /api/transcript` に `{ url, extractComments }` を送る  
2) サーバが `extractTranscriptAndMetadata(url, extractComments)` を呼ぶ  
3) 字幕取得に成功すると `[{ time, text }]` を含むJSONを返す

参照：
- API入口: `src/app/api/transcript/route.ts:34`
- 中核関数: `src/lib/transcript/extract.ts:270`

※Chrome拡張へ移植する場合、上記APIやメタ情報/コメント取得は不要（「字幕だけ」なら切り捨て可能）。

---

## 3. 字幕取得アルゴリズム（このアプリの要点）

### 3.1 取得の優先順位

- 言語優先は `['ja', 'ja-Hans', 'ja-Hant']`（日本語/日本語系）  
  参照: `src/lib/transcript/extract.ts:10`

### 3.2 取得手段（2段フォールバック）

このアプリでは以下の順で試す：

1) `youtube-caption-extractor` で字幕を取得（タイムアウトあり）  
2) 0件なら `youtubei.js` 経由で `caption_tracks[].base_url` を取得し、**そのURLからXML字幕を取得してパース**

参照：
- 1) 側: `src/lib/transcript/extract.ts:84`
- 2) 側（重要）: `src/lib/transcript/extract.ts:106`

Chrome拡張では **Node向け依存（`youtubei.js` / `@distube/ytdl-core` / `youtube-caption-extractor`）を持ち込まず**、
YouTube視聴ページ上で `captionTracks`（字幕トラック）を見つけて、その `baseUrl` を `fetch` する方式が最小。

---

## 4. Chrome拡張（MV3想定）に移植する最小構成

### 4.1 推奨構成（責務分離）

- **content script（または page world 注入）**：視聴ページから `captionTracks`（字幕トラック一覧）を取得
- **service worker**：選んだ字幕トラックの `baseUrl` を `fetch` してXMLをパースし、`[{ time, text }]` を返す

理由：
- MV3のcontent scriptは「隔離された実行環境」で、ページ側のJS変数（例：`window.ytInitialPlayerResponse`）が直接読めない場合がある
- `fetch(baseUrl)` は拡張側（service worker）で行う方が、CORSや権限の制御がしやすい

### 4.2 ページ側で探すべきデータ

YouTubeのプレイヤーレスポンス内に、字幕トラックが入る（例）：

- `captions.playerCaptionsTracklistRenderer.captionTracks`

この配列の各要素で見るべきキー（実際のキー名はキャメルケースになることが多い）：

- `languageCode`（このアプリでは `language_code` 相当）
- `baseUrl`（このアプリでは `base_url` 相当）

### 4.3 トラック選択ルール（このアプリ互換）

1) `languageCode` が `ja / ja-Hans / ja-Hant` のものを優先  
2) 無ければ「先頭」を使う（※要件次第で“無しなら失敗”にしてもよい）

参照（優先順の考え方）：
- `src/lib/transcript/extract.ts:115`

---

## 5. XML字幕のパース仕様（このアプリ互換）

このアプリはXMLを文字列で読み、以下を抽出している：

- `<text start="(秒.小数)">字幕テキスト</text>`

参照：
- 正規表現での抽出: `src/lib/transcript/extract.ts:133`
- 最低限のエンティティデコード: `src/lib/transcript/extract.ts:138`

出力（中間）は `{ start: number, text: string }[]`、最終は `{ time: string, text: string }[]`。

---

## 6. タイムスタンプの整形（秒→`MM:SS` / `HH:MM:SS`）

仕様（このアプリと同じ）：

- `start` 秒を切り捨て（`Math.floor`）
- 1時間未満：`MM:SS`
- 1時間以上：`HH:MM:SS`

参照：
- `src/lib/transcript/extract.ts:317`

---

## 7. 権限・既知の制約

### 7.1 権限（目安）

- `host_permissions` に `https://www.youtube.com/*`（`baseUrl` が `youtube.com` の `timedtext` になることが多いため）

### 7.2 制約

- 字幕が無い動画は取得できない（エラー扱い）
- YouTube側のレスポンス構造が変わると壊れる可能性がある（`captionTracks` の場所/キー名）
- 自動翻訳字幕（例：外国語音声→日本語翻訳）を対象にするかは要件次第（現時点は未確定）

---

## 8. 受け入れ確認（最低限）

- 日本語字幕あり動画で、`[{ time, text }]` が取得できる
- 字幕なし動画で、失敗が明示できる（空配列にしない/ユーザーに理由が出る）
- `ja` が無いが `ja-Hans` がある等でも、優先順で正しいトラックが選べる

