# ID東都

東都大学野球のTrackManデータを使う投球検索・選手分析サイト。React / Vinext / Cloudflare Workersで動作します。

## 開発と検証

Node.js 22.13以上、Linux（flock / curl / GNU timeout）が必要です。依存関係はpackage-lock.jsonに固定しています。

```sh
npm run install:ci
npm run prepare:data
npm run dev
```

- `npm run typecheck`: strict設定の型検査。
- `npm run test:unit`: 実データの指標・分類・走者推定・API集計・読み込み・印刷判定・キャッシュの回帰テスト。
- `npm run build`: 軽量配信データ生成、型検査、時間制限付きビルド、公開用成果物の検査。
- `npm test`: 型検査、ビルド、単体テスト、ビルド後のHTML・印刷仕様テスト。
- `node scripts/print-fixtures.mjs`: 実コンポーネントと既存データから一時的な印刷確認画面を生成。

印刷確認後は `public/print-qa` を削除してください。この確認画面が残った状態では公開用ビルドが停止します。`npm run validate:artifact` はビルド済み成果物を再検査します。

## 主要な実装

| 対象 | ファイル |
| --- | --- |
| 画面・検索・画面遷移 | app/savant-app.tsx |
| 指標説明 | lib/metric-definitions.ts |
| 共通データ型 | lib/dataset-types.ts |
| データ取得・重複排除・再試行 | lib/dataset-loader.ts |
| 配信形式と可逆変換 | lib/dataset-transport.js |
| 回転分析 / バレルゾーン | app/pitch-spin-profile.tsx / app/barrel-zone.tsx |
| 指標定義・打者分析 | lib/scouting-analytics.ts / lib/batter-profile.ts |
| 印刷用ページ / プレビュー | app/print-document.ts / app/print-report.ts |
| 印刷専用CSS / 操作UI | app/report-print.css / app/print-preview.css |
| オフラインキャッシュ | public/sw.js |
| 管理者限定の元CSV取得 | app/api/dataset/route.ts / server/csv-download.ts |

## データの保持と公開範囲

元CSVは `data/raw` に保持し、公開アセットへ直接コピーしません。管理画面の元CSV取得は既存の管理者認証を通します。初期CSVはサーバー専用モジュールに圧縮して収録し、取得時に元のバイト列へ復元します。アップロード済みCSVがある場合は従来どおりR2の最新版を返します。

**分析用JSON・読み取りAPI・画面からの検索結果CSVは公開のままです。元CSVの直URL配信を止めても、公開分析データ全体が秘密になるわけではありません。** サイトの閲覧対象・管理者設定・保存先・データベース構造は、この改善で変更していません。

`public/data` の元JSONは維持します。`npm run prepare:data` が `public/data/compact` に列形式JSONを生成します。全項目・投球順序・数値精度・null・欠損キーを保持し、元JSONとの完全一致をテストします。生成物はGit管理対象外です。

画面間で静的データの取得結果と処理中リクエストを共有します。失敗したリクエストは再試行できます。アップロードデータは別途最新を確認し、取得失敗時は既に表示した当該シーズンのデータを保持します。初回表示などで同梱データへ戻る場合は、その旨と再読み込みボタンを表示します。

オフライン保存はアプリ本体と閲覧した静的データが対象です。管理画面・API・認証経路・元CSVは保存しません。未閲覧シーズンを自動的にすべて取得する動作は止めています。初回インストール前に完了した通信や未閲覧画面のオフライン利用は保証しません。

## 管理と公開

`.openai/hosting.json` の既存プロジェクトとD1 / R2設定を使います。管理者の判定は `app/admin-auth.ts`、ChatGPT認証の補助関数は `app/chatgpt-auth.ts` にあります。認証用の予約経路やヘッダーをアプリ側で偽装しないでください。資格情報をGitに保存しないでください。

ソースの同じ確定状態からビルド・保存・公開を行います。データ更新と表示修正は分けて検証し、既存の指標定義や生データを無断で変更しません。

- [今回の改善・検証記録](docs/IMPROVEMENTS_20260906.md)
- [印刷仕様と過去の検証記録](docs/printing/REBUILD_20260905.md)
- [作業運用](AGENTS.md)
