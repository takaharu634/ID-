# TrackMan Drive追加通知による反映

> 2026-09-28更新：現行仕様は [長期運用基盤](LONG_TERM_20260928.md) を参照。以下は9月26日時点の記録です。

ユーザー依頼：定期的なCSV確認やAIタスクを使わず、指定Driveフォルダへの追加通知でID東都を更新する。

## 対象と構成

- 対象は2026秋、フォルダ `1eQhb4GYv3zlP-74BAK3g8xzkO3htUCr6`。初期基準はmanifestの14ファイル・14試合・4,134球。
- Drive `files.watch` のフォルダ通知 → Sites `/api/trackman/notify` → 署名付きGoogle Apps Script実行 → 新規CSV取得・検証・既存エンジンによる集計 → R2保存版を切り替え。
- AI API、ChatGPT定時タスク、定期的なCSV一覧取得を使用しない。旧TrackMan定期タスクは停止したまま。
- Google Apps Scriptの12時間トリガーは23時間で失効する通知登録の延長専用。CSV一覧取得・集計・反映は呼ばない。
- 重い集計はApps Script側。Sites Workerには集計処理を追加しない。

## 初回接続

1. Sitesのsecret環境変数 `TRACKMAN_SYNC_SECRET` を設定して公開する。既存 `ADMIN_EMAILS` は変更しない。
2. 管理画面「Driveから自動反映」から連携コードとappsscript.jsonを取得する。コードの接続キーは管理者だけが取得でき、応答はno-store。
3. 対象フォルダを読めるGoogleアカウントのApps Scriptプロジェクトへ2ファイルを設定。Drive v3高度なサービスはmanifestに記載。
4. ウェブアプリを「自分として実行」「全員がアクセス」でデプロイ。公開入口では署名が一致した呼び出しだけ処理する。
5. `setup` を一度実行し、Googleの権限許可を完了。通知登録後、初回だけ未取り込み分を確認する。
6. 管理画面で有効な通知期限とエラーの有無を確認する。

Google権限はDrive読み取り・外部リクエスト・スクリプトのトリガー管理。Driveへの書き込みや他ユーザーへの共有変更は行わない。Googleの許可画面ではDrive全体の読み取りとして表示されるが、実装の対象は上記フォルダに固定。

## 保護と停止

- サーバー・Apps Script間はHMAC-SHA256と5分の時刻制限。Drive通知は登録済みID・ランダムtoken・resourceId・期限を検証。
- 取得前後のCSVサイズ・更新日時・親フォルダ、UTF-8バイト、季節、PitchUID、重複矛盾、打撃集計、選手表記を検証。警告があれば公開を保留する。
- 既知のファイルIDの改訂だけでは取り込まない。既存CSVがフォルダ一覧から消えていた場合も保留する。
- R2オブジェクトはサイズとSHA-256照合、上書き禁止。公開切替はETag条件付き。初回切替前のデータを保存し、既存管理画面から復元可能。
- 通知重複は処理済みファイルIDで排除。Apps Script内のlockで並行集計を抑制。失敗時は5xxを返しGoogleの通知再試行に委ね、定期監視は追加しない。
- 管理画面の「自動反映を停止」で通知処理と公開を停止。再開はGoogle側の`setup`実行。「未反映データを再試行」は管理者の手動操作。
- 通知の到達や即時性は保証しない。通知欠落・Google停止・未知の選手名などは管理画面から確認・再試行する。
- 集計エンジンや補正ルールを変更した公開後は、管理画面から最新コードを取得してApps Scriptのデプロイも更新する。旧コードはバージョン照合で止まる。
- R2の保存版が有効なシーズンは同梱の静的JSONより優先される。今後ソース側のCSV更新だけで本番更新したと誤認しないこと。

## 検証

- `npm run test:drive-push`：3件。実データの既存集計との一致、異常CSV、通知延長でCSVを読まないこと、署名、D1登録、R2保存/破損拒否、競合、重複通知、停止、元CSVのバイト単位復元を隔離環境で確認。
- `node --test tests/drive-push-runtime.test.mjs tests/import-runtime.test.mjs`：2件。ビルド済みWorkerの管理者認証、キーを含む設定コードの保護、UTF-8ストリーム保存、既存取り込みと復元を確認。
- `build-site.mjs`：型検査・ビルド・成果物検証成功。
- 本番への試験用CSV投入はしていない。Googleアカウントの初回接続と実際のDrive通知による端から端までの確認は別工程。未接続の段階を「稼働済み」と説明しない。

参考：Google Drive公式push通知ドキュメント https://developers.google.com/workspace/drive/api/guides/push
