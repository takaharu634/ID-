# 外部バックアップと復旧

日次 GitHub Actions は AI を実行せず、CSV の追加確認も行いません。毎日 03:17 JST と手動実行、およびバックアップ実装の main 更新時に動きます。GitHub のスケジュール遅延・停止や契約上限は保証できないため、Actions の実行履歴を確認してください。

## 保存するもの

- R2 の `datasets/` 以下を全件保存します。原本 CSV、分割 gzip、集計、回転データ、公開 head、履歴、検証用記録が対象です。
- D1 は `data_imports` と `trackman_push_files` の既知の列だけを保存します。
- GitHub の private リポジトリに、毎回単独で復旧できる artifact を作成します。前回と ETag/サイズが同じデータは前回 artifact のバイト列を再検証してコピーします。前回分を削除しても今回分は復旧できます。
- `objects/<SHA-256>.gz`、元データの SHA-256、gzip の SHA-256、manifest の SHA-256 を照合します。公開 head・過去の保存版・分割 manifest が参照する全オブジェクトの存在とハッシュも検査します。
- 取得前後の R2 inventory が変化した場合は再取得します。D1 と R2 を跨ぐトランザクションではありません。D1 は補助履歴で、公開版は検証済み R2 snapshot から復元します。

**保存しないもの:** 環境変数、認証秘密、Drive channel token、`trackman_push_state`、`trackman_push_channels`、未完了の `import-jobs/`。未完了ジョブはサーバーで保持し、容量だけを外部バックアップ時に監視します。同梱データ・コード・DB schema は GitHub ソース側に保存されています。

## 初期設定（公開前に設定）

Sites の環境変数:

```text
BACKUP_OIDC_ENABLED=true
BACKUP_GITHUB_REPOSITORY_ID=1380720373
BACKUP_GITHUB_OWNER_ID=319011362
BACKUP_GITHUB_BRANCH=main
BACKUP_OIDC_AUDIENCE=https://tohto-baseball-savant.nbdn87qjxf.chatgpt.site/api/backup/export
BACKUP_OIDC_SUBJECT=repo:takaharu634@319011362/ID-touto-@1380720373:ref:refs/heads/main
```

これらは認証先を制限する非秘密設定です。長期 API token は作成しません。GitHub 発行 RS256 token の署名・issuer・期限・数値 repository/owner ID・repository 名・private・main・workflow_ref・audience・subject・GitHub hosted runner をすべて照合します。鍵は固定された GitHub JWKS URL のみから取得し、未知の kid では再取得します。バックアップ workflow 以外から export できず、同じ token で復元・公開 API を操作することもできません。

新規 repository の subject には immutable ID が含まれます。リポジトリ名変更などで一致しなくなった場合は、公式 GitHub OIDC 設定の非秘密 claim を確認して、完全一致する設定に更新してください。`sub` 検証を削除したり、ワイルドカードに緩めないでください。

参考: <https://docs.github.com/en/actions/reference/security/oidc>

## 容量警告と保持期間

GitHub Repository Variables は設定なしで動作します。必要時は次を変更します。以下は運用上の警告予算であり、契約容量の表示ではありません。

| 設定 | 初期値 | 対象 |
| --- | ---: | --- |
| BACKUP_R2_WARN_BYTES | 1 GiB | datasets/ と import-jobs/ の合計実測 |
| BACKUP_ARTIFACT_WARN_BYTES | 200 MiB | 1 回分の gzip オブジェクト合計 |
| BACKUP_RETAINED_WARN_BYTES | 400 MiB | この GitHub repository に残る全 artifact の API 報告サイズ |
| BACKUP_RETENTION_DAYS | 30 日 | 新しく作る backup artifact の保持期間 |

実測には上記以外の R2 prefix と D1 の物理容量は含めません。manifest・ZIP 等の付加容量は GitHub artifact 実測側で監視します。変更前の原本と履歴は自動削除しません。容量増加時はバックアップを保存した後で workflow を失敗状態にし、警告を実行概要に残します。前回あったオブジェクトの消失も警告します。通信・認証・照合・アップロード失敗でも workflow は失敗します。メールやアプリ通知の配信は GitHub アカウントの Actions 通知設定に従います。

GitHub artifact は永久保存ではありません。保持期間、契約上限、アカウント停止は別途管理が必要です。必要な時点の artifact はダウンロードし、独立した保管先にも保存できます。失敗したバックアップを「保存成功」と扱いません。

## 復旧手順

1. private GitHub repository の Actions → **ID Tohto daily data backup** → 対象実行 → `id-tohto-data-...` artifact をダウンロードして展開します。
2. このソースと Node.js 22.13 以上を用意します。依存パッケージのインストールは不要です。
3. 検証または抽出を行います。出力先は新規フォルダーにします。

```bash
node tools/backup/restore.mjs verify /path/to/artifact
node tools/backup/restore.mjs extract /path/to/artifact /path/to/recovered
```

4. 管理者で ID東都 の `/admin/recovery` を開き、抽出した `recovered` フォルダーを選択します。「不足分を復旧」で immutable データをアップロードします。SHA-256 とサイズをサーバーで照合し、同じ内容はスキップします。既存の内容が異なる場合は停止し、上書きしません。中断したら同じフォルダーで再開できます。
5. 復旧画面で公開するシーズン・保存版を選び、「照合してこの版を公開」を実行します。公開中の版を直前に読み、既存の `/api/upload` 復元処理で参照を分割検証してから切り替えます。途中で別更新が入ると停止します。

全損で head がない場合も、CLI は head 内の直近保存版を immutable `versions` / `history` 記述子へ変換します。復旧候補はバックアップから提示するため、公開 catalog にまだ存在しない将来シーズンも復元できます。`head.json` を直接アップロードせず、選択・検証した版だけを公開します。

D1 が失われた場合は `database-missing-only.sql` を確認して DB 管理機能で実行します。`INSERT OR IGNORE` のみで既存行を変更せず、`data_imports.is_active` は 0 に固定します。文字列は UTF-8 hex literal として保存するため、引用符や改行、NUL が SQL 文に混入しません。公開 snapshot の復元にこの補助 SQL は必須ではありません。旧形式の `datasets/current.csv` 等も抽出されますが、現行の immutable 保存版がない場合は、その原本 CSV を通常の CSV 管理から検証して再取り込みします。

復旧 API は既存の管理者認証が必須です。OIDC export token に書き込み権限は与えません。既存データの破損は missing-only 復旧では上書きせず停止します。その場合は抽出原本を新しい snapshot として通常取り込みし、破損した版を保存したまま復旧します。

## 確認済みの自動試験

`node --test tests/longevity/external-backup.test.mjs`

- 正しい RS256 と全 trust claim、改ざん署名、期限、別 repo/owner/workflow/branch、public、pull_request、self hosted runner、無効化、鍵変更。
- export の許可 prefix・許可 DB 列、ETag 競合、no-store、管理者認証と別 origin の拒否。
- 復元の SHA/サイズ照合、head 書き込み拒否、既存内容の競合、冪等再開。
- 前回 artifact を削除した後の独立復元、未来シーズンの head 記述子再構成、SQL の inactive/missing-only、安全な文字列、既存抽出先拒否。
- 更新中の不整合、gzip 破損、参照オブジェクト欠損の検出。

実際の production export・初回 artifact upload・実画面は公開後の確認項目です。単体試験や build だけでこれらの成功を代用しません。
