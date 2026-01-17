# リサーチレポート

## 0. まず結論（要約）
- 「timedtext の baseUrl 直叩きが空になる」現象は、YouTube 側が字幕URLの直接取得を制限する方向に変化しており、`INNERTUBE_API_KEY` を使って `youtubei/v1/player` から `captionTracks` を再取得 → その `baseUrl` を叩く手順が現実的な回避策として複数ライブラリで採用されています。citeturn10view0
- 公式の YouTube Data API で字幕を取得するには OAuth が必要で、`captions.download` は「その動画の編集権限があるユーザー」前提のため、一般ユーザーの任意動画を対象とする拡張機能には適合しません。citeturn0search2turn0search3turn0search4
- YouTube は「PO Token」「Visitor Data」「Cookie」などの検証を強めており、クライアント種別やトークン不足で機能が欠落するケースが報告されています。字幕取得も影響を受ける可能性が高いため、安定化にはトークン/クライアントの再現が鍵です。citeturn11view0
- Chrome 拡張で MAIN world で実行できても、サーバー側の検証を省略できるわけではないため、認証/トークン/クライアント情報の整合が必要です。citeturn0search1

## 1. 調査対象（テーマ）
- Chrome 拡張で YouTube 字幕取得が常に空になる問題の原因候補と、確実性が高い取得方式の整理。citeturn10view0turn0search4

## 2. 前提 / 解釈（曖昧さがある場合）
- 仮定: 取得対象は「自分の所有動画」ではなく、一般ユーザーが閲覧できる任意動画。
- 仮定: 拡張の目的は YouTube ページ上での即時要約であり、外部サーバーでの重い処理は避けたい。

## 3. 調査方法（どう調べたか）
- 公式ドキュメント: YouTube Data API（captions.list / captions.download）と Chrome 拡張の実行コンテキスト仕様を確認。citeturn0search1turn0search2turn0search3turn0search4
- OSS 実装: YouTube 字幕取得ライブラリの README/実装方針から、現在の取得手順と回避策を確認。citeturn10view0
- 運用リスク: yt-dlp Wiki の最新運用注意（PO Token/Visitor Data/Rate limit）を確認。citeturn11view0

## 4. 調査結果（詳細）
### 4.1 重要ポイント
- 公式 API は OAuth と編集権限が必須で、任意動画の字幕取得用途に使えない。citeturn0search2turn0search3turn0search4
- 主要 OSS ライブラリは「`captionTracks` の `baseUrl` を使う」方式を継続しているが、直接 URL を叩くのはブロックされることがあるため、`youtubei/v1/player` 経由で `captionTracks` を再取得する手順を採用している。citeturn10view0
- YouTube 側の検証強化（PO Token / Visitor Data / Cookie / rate limit）が進んでおり、トークン不足やクライアント種別の違いが取得失敗の要因になり得る。citeturn11view0

### 4.2 根拠つき解説（段落ごとに引用）
公式 API の `captions.list` は字幕トラックの一覧のみで、実字幕の取得は `captions.download` を使う必要があります。さらに `captions.download` は「その動画を編集できるユーザー」向けで、OAuth 認可も必須です。したがって、一般ユーザーの任意動画に対して字幕を取得する用途には適合しません。citeturn0search2turn0search3turn0search4

非公式ですが、複数 OSS ライブラリは「動画ページ内の JSON に `captionTracks` と `baseUrl` がある」前提で字幕を取得しています。ただし YouTube が “ページ内に埋め込まれた URL 直叩き” を制限したため、`INNERTUBE_API_KEY` を使って `youtubei/v1/player` を呼び、そこで得られる `captionTracks` から `baseUrl` を再取得する方式に移行しています。これは現在最も再現性が高い手順です。citeturn10view0

同じ README は「この API は undocumented で壊れる可能性がある」ことを明言しており、安定運用には YouTube の変更への追随が必要です。また、YouTube がクラウド IP をブロックする傾向や、リクエスト量によるブロックの可能性にも言及されています。citeturn9view0

yt-dlp の運用ガイドでは、YouTube が PO Token を段階的に要求し始めていること、Visitor Data の取り扱いが不安定であること、Cookie を使う場合も注意が必要であることが明記されています。字幕取得でも同種の検証が通らないと空レスポンスになる可能性があるため、トークンやクライアント情報の整合性が重要と考えられます（推測）。citeturn11view0

Chrome 拡張の `scripting.executeScript` で MAIN world を使える点は有効ですが、これは「ページの JS と同じ実行環境でコードが動く」だけであり、サーバー側の認証/トークン要件を回避できる仕組みではありません。従って、正しい API key / client 情報 / token を揃える方が根本解決に近いです。citeturn0search1

## 5. 高リスク領域の注意（該当する場合のみ）
- 字幕取得のために Cookie やアカウントを使う場合、アカウント制限や一時停止のリスクがある旨が OSS 側ガイドで警告されています。運用時は最小権限・最小頻度が推奨されます。citeturn11view0

## 6. 限界 / 未検証 / TODO
- 本件ログ（200で空文字）と完全一致する再現ケースの公式説明は見つかりませんでした。
- 今回の調査は「一般公開情報＋OSS 実装方針」に基づくため、YouTube 内部仕様の変更で再び破綻する可能性があります。citeturn9view0
- TODO: 実際の `ytcfg` から `INNERTUBE_API_KEY` / `clientName` / `clientVersion` を取得して `youtubei/v1/player` を呼び、`captionTracks` の `baseUrl` が生きているかを検証。

## 7. 参考文献（リンク）
- YouTube Data API（Captions）公式ドキュメント citeturn0search0turn0search2turn0search3turn0search4
- Chrome Extensions `scripting` API（ExecutionWorld / MAIN） citeturn0search1
- youtube-transcript-api（trldvix）README / How it works citeturn10view0turn9view0
- yt-dlp Wiki（Extractors / PO Token / Visitor Data / rate limit） citeturn11view0
