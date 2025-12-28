# リサーチレポート

## 0. まず結論（要約）
- クラウド環境からの字幕取得が失敗しやすいのは、YouTube側がクラウドIP（AWS/GCP/Azure等）をブロックする傾向があるためで、これは複数の字幕取得ライブラリ側で明示的に警告されています。対策は「ユーザー端末での取得」「プロキシ（特に回転型レジデンシャル）」「公式API（ただし制約大）」のどれかに寄ります。([YouTube Transcript API (Java)](https://github.com/trldvix/youtube-transcript-api), [YouTube Transcript API (Python)](https://github.com/jdepoix/youtube-transcript-api))
- 字幕は基本的に「動画ページ内のJSONから`captionTracks.baseUrl`を取り、`/api/timedtext`系URLからXMLを取得する」方式で取得されますが、YouTube側の変更で直接URLが使えなくなったり、内部API（Innertube）経由の取得が必要になるケースがあります。([YouTube Transcript API (Java)](https://github.com/trldvix/youtube-transcript-api))
- 公式のYouTube Data APIで字幕をダウンロードする方法は、**動画の編集権限が必要**なため、一般の公開動画を広く扱う用途には適しません。([YouTube Data API captions.download](https://developers.google.com/youtube/v3/docs/captions/download))
- サーバー側実装を継続するなら、**回転型レジデンシャルプロキシ**の導入が現実的な回避策とされますが、運用コスト・規約リスクが上がります。([YouTube Transcript API (Python)](https://github.com/jdepoix/youtube-transcript-api))
- 代替案として、字幕取得をユーザー端末（拡張機能/ローカル常駐）に寄せる、または`yt-dlp`で字幕ファイルを取得して処理する方式も検討対象です。([yt-dlp README](https://github.com/yt-dlp/yt-dlp))

## 1. 調査対象（テーマ）
- YouTube字幕取得がクラウド環境でブロックされる場合の**別手段/回避策**の調査

## 2. 前提 / 解釈（曖昧さがある場合）
- 仮定: 取得対象は「一般公開のYouTube動画」で、必ずしも投稿者権限は持たない。
- 仮定: 既存実装は`/api/timedtext`や`youtubei.js`等の**非公式・内部API**を利用している。

## 3. 調査方法（どう調べたか）
- 公式ドキュメント（YouTube Data API / YouTube利用規約）と、主要ライブラリの一次情報（GitHub README、公式ドキュメント）を中心に調査。
- 特に「字幕取得の仕組み」「クラウドIPブロック」「回避策（プロキシ/クライアント移行/公式API）」に関する記述を裏取り。

## 4. 調査結果（詳細）
### 4.1 重要ポイント
- **字幕取得の根本ロジック**は、動画ページ内のJSONに含まれる`captionTracks.baseUrl`から`/api/timedtext`を叩く流れで、YouTube側の変更で直接叩けなくなることがある。([YouTube Transcript API (Java)](https://github.com/trldvix/youtube-transcript-api))
- **クラウドIPブロックは実在**し、AWS/GCP/Azure等のIPはブロックされやすく、回避には回転型レジデンシャルプロキシが推奨されている。([YouTube Transcript API (Java)](https://github.com/trldvix/youtube-transcript-api), [YouTube Transcript API (Python)](https://github.com/jdepoix/youtube-transcript-api))
- **公式APIで字幕ダウンロードは可能だが**「動画編集権限必須」で、一般動画には使えない。([YouTube Data API captions.download](https://developers.google.com/youtube/v3/docs/captions/download))
- **サーバー側字幕取得を続ける場合**、プロキシ運用やレート制御が必要になりやすい。([YouTube Transcript API (Python)](https://github.com/jdepoix/youtube-transcript-api))
- **クライアント寄せ/ローカル取得**や`yt-dlp`の字幕出力は、クラウドIPブロックを回避しやすい別案になり得る。([yt-dlp README](https://github.com/yt-dlp/yt-dlp))

### 4.2 根拠つき解説（段落ごとに引用）
**A. 字幕取得の仕組み（timedtext + baseUrl）**
YouTube字幕の典型的な取得フローは、動画ページ内JSON（`playerCaptionsTracklistRenderer.captionTracks`）に埋め込まれた`baseUrl`を取得し、そのURL（`/api/timedtext`）を叩いてXML字幕を取得するものです。ライブラリ側の説明でもこの構造が明示されており、またYouTube側の変更で「HTML内のURLを直接叩けない→Innertube API経由で再取得」という回避が必要になった例が示されています。([YouTube Transcript API (Java)](https://github.com/trldvix/youtube-transcript-api))

**B. クラウドIPブロックとプロキシ回避**
字幕取得ライブラリのREADMEでは、**AWS/GCP/Azure等のクラウドIPがYouTubeにブロックされやすい**ことが明記され、回避策として「回転型レジデンシャルプロキシ」が推奨されています。これは「Render等のクラウド環境で字幕取得が空/タイムアウトになる」現象と一致しやすく、**運用レイヤーの問題**である可能性が高いことを示します。([YouTube Transcript API (Java)](https://github.com/trldvix/youtube-transcript-api), [YouTube Transcript API (Python)](https://github.com/jdepoix/youtube-transcript-api))

**C. サーバーレス/エッジ向けの字幕取得実装**
`youtube-caption-extractor`は、サーバーレス環境に最適化した字幕抽出（環境検知・エンゲージメントパネルAPI利用・XML/JSONの二系統フォールバック）を明記しており、**「CORS回避のためサーバーAPIを立てる」**運用を推奨しています。つまり、**仕組みとしては同じでも実装戦略（環境適応・API選択）が重要**であることを示唆します。([youtube-caption-extractor](https://github.com/devhims/youtube-caption-extractor))

**D. 公式API路線の制約**
YouTube Data APIの`captions.download`は字幕のダウンロードを提供しますが、**「動画の編集権限が必要」**で、OAuthスコープも要求されます。つまり、**自分の動画/権限付き動画以外では使えない**ため、「一般動画の字幕取得」に対しては実運用上の制約が大きいです。([YouTube Data API captions.download](https://developers.google.com/youtube/v3/docs/captions/download))

**E. クライアント寄せ・ローカル取得という回避策（推論）**
上記のIPブロック記述から逆算すると、**ユーザー端末上（ブラウザ拡張/ローカル常駐）で字幕取得**できれば、クラウドIPブロックの影響を回避できる可能性が高いです。これは確定情報ではなく推論ですが、「クラウドIPがブロックされやすい」という一次情報が裏付けになります。([YouTube Transcript API (Python)](https://github.com/jdepoix/youtube-transcript-api))

**F. `yt-dlp`を使った字幕取得**
`yt-dlp`は字幕の書き出し（手動字幕・自動字幕）を公式オプションとして提供しており、`--write-subs`/`--write-auto-subs`/`--sub-langs`などで制御できます。**ローカル環境で実行すればクラウドIP問題を回避しやすい**ため、ローカル常駐またはユーザー端末実行を含めた設計が候補になります。([yt-dlp README](https://github.com/yt-dlp/yt-dlp))

**G. 利用規約上の注意**
YouTubeの利用規約では、**自動化された手段（robot/bot/scraper）でのアクセスは禁止**されており、例外はYouTubeの事前許可や法的に許される場合に限られます。字幕取得の自動化は規約に抵触するリスクがあるため、設計時は規約確認とリスク評価が必要です。([YouTube Terms of Service](https://www.youtube.com/t/terms))

## 5. 高リスク領域の注意（該当する場合のみ）
- 自動化された字幕取得は、YouTubeの利用規約上の制限に抵触する可能性があります。運用前に規約確認とリスク評価が必要です。([YouTube Terms of Service](https://www.youtube.com/t/terms))

## 6. 限界 / 未検証 / TODO
- 本レポートは公開ドキュメントの記載をもとに整理しており、**特定動画・特定IPでの実測は含まれていません**。
- 実際の回避策（プロキシ導入、ローカル実行、公式APIなど）の**コスト/規約/安定性は別途検証が必要**です。

## 7. 参考文献（リンク）
- YouTube Transcript API (Java): https://github.com/trldvix/youtube-transcript-api
- YouTube Transcript API (Python): https://github.com/jdepoix/youtube-transcript-api
- youtube-caption-extractor: https://github.com/devhims/youtube-caption-extractor
- YouTube Data API captions.download: https://developers.google.com/youtube/v3/docs/captions/download
- yt-dlp README: https://github.com/yt-dlp/yt-dlp
- YouTube Terms of Service: https://www.youtube.com/t/terms
