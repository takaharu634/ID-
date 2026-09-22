# NEWS更新

「NEWS更新」の作業は、公開情報の新着探索、出典確認、既存URL・見出し重複確認、選手名マスター照合、カテゴリ分類、事実要約、ID東都で見るポイント作成、検証、`news_feed`更新、プレビューの順で行う。

更新候補は `data/news_inbox.json` に配列で置き、次を実行する。

`node scripts/update-news.mjs data/news_inbox.json`

必須項目は `team`、`publishedAt`、`category`、`headline`、`fact`、`savant`、`sourceName`、`sourceUrl`。`fact` と `savant` を混ぜず、トレーニングと成績変化の因果は断定しない。本人SNSは公開投稿のみを対象とし、自動スクレイピングを前提にしない。

ChatGPT Site内では常時バックグラウンド実行を前提にしない。外部へ移行する場合は、このスクリプトをGitHub ActionsまたはVercel Cronから呼び、候補収集処理と検証済みJSONの生成を前段に置く。
