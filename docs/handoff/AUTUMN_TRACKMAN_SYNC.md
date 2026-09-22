# 2026秋 TrackMan 自動反映（2026-09-11）

## 対象と運用
- 対象はユーザー指定の秋フォルダ https://drive.google.com/drive/folders/1eQhb4GYv3zlP-74BAK3g8xzkO3htUCr6 のCSV。
- LabとSavantの2026秋に反映。初回の既定表示は2026秋。保存済みのシーズン選択は維持する。利用者はページを再読み込みし、上部で「2026年 秋季リーグ」を選ぶ。
- ChatGPTの定期タスクで、日本時間8:30・16:30・22:30に確認する。即時通知型の同期ではない。2026年末まで有効。
- タスクID: 6aa37473fde0819188299002345e1b6b。enabledを確認済み。将来の定刻実行そのものはまだ観測していない。
- Drive接続・Sitesアクセス・タスク実行が有効なことに依存する。アカウントの定期タスクとして実行される。「利用量が増えない」とは断定しない。
- 更新なしならメタデータと公開statusのハッシュ比較で終了し、CSV取得・集計・公開を繰り返さない。
- ユーザーの「これから公開の許可はいらないよ」および今回の自動反映の依頼に基づき、現行の公開範囲へ反映する。共有設定や管理者権限は変えない。

## 再現可能な取り込み
両repoで node scripts/sync-autumn-data.mjs [--check] <batch.json> を使用する。
batchにはfolderIdと全CSVのfilesを入れる。各fileはDriveのid、titleをnameに、modified_timeをmodifiedTimeに、Number(size)をsizeにする。変更があるCSVのみ、原本を取得したローカル絶対pathを付ける。

認証済みGoogle Drive fetchのdownload_raw_file=true / include_base64=falseを使用。file_uriを正しいfile_id/file_nameでlibrary prepare_materializeに渡して展開する。要約本文や切れたテキストからCSVを再構成しない。共有権限を広げない。

data/trackman/2026-fall/に原本とmanifestを保持する。これはprivate source用でpublicフォルダではない。既存の各サイトのcsv-analyticsを使い、球種分類・単位・集計式を勝手に統一しない。Savantの走者状況は既存どおり推定であることを明記する。Labの手入力走者情報には触れない。

厳密なCSV構文・列数・UTF-8・サイズ・日付/年季・試合ID・PitchUIDを検証する。同一PitchUIDの同一内容は1球にまとめ、内容競合は止める。改訂CSVによって旧投球が消える場合も止める。Driveからファイルが消えても原本と公開済み投球を自動削除しない。全検証が終わるまで出力に書かない。公開はSitesの完成した版として切り替え、ローカル失敗で現行サイトを置き換えない。

## 生成物と読取り
- public/data/season-2026-fall.json: 秋の分析データ。
- Labのみpublic/data/season-2026-fall.csv: 既存管理機能と同じ形式の同梱CSV。
- lib/generated/autumn-data-status.json: Labのシーズン件数を自動生成。
- public/data/trackman-2026-fall-status.json: 小さな更新確認用status。DriveのファイルIDや認証情報は公開しない。
- listingFingerprint: idをASCII順に並べた[id,name,modifiedTime,size]配列のJSON（空白なし、UTF-8）をSHA-256化。公開statusとDrive一覧を照合して未変更なら終了できる。
- sourceFingerprint: 保存原本のIDとSHA-256から作成。両サイトで同じ値になる。球数・試合数とともに公開後に照合する。
- public/data/spin-2026-fall.jsonを同じ取り込みで生成する。回転数・回転軸・変化量の実測値と、9Pからの3D参考推定を区別する。推定不可はnullを保ち、計測された軸・回転数による平面アニメーションを表示する。計測自体がない投球を作らない。
- 開きっぱなしの旧画面には、再読み込みして新しい公開版を取得する。Labの秋同梱データはService Workerのオフライン準備にも含める。

Labは/api/dataset?season=2026-fallが同梱版へ向くことを確認する。D1のdataset_headsに手動importがあれば自動処理で解除しない。2026-09-11時点でdataset_headsは空を読取り確認済み。公開ポインタ、手入力試合、名簿、アカウント、D1/R2 migrationは変更していない。

## 更新時の公開手順
1. 現行公開statusをDrive全CSVメタデータと照合する。
2. 不一致のSiteだけ最新ソースを取得してAGENTS.mdを読む。NEWS定期更新も同じSavantを編集するので、remote HEAD・未コミット差分を確認し、force pushしない。
3. 差分CSVだけ取得し、--check、sync、npm run test:autumnを実行。年・季節・件数・元PitchUID集合が一致することを確認。
4. 必要な静的検査・標準Sitesビルドを実行。旧シーズンのデータを変更していないことを確認。
5. push成功後の完全なHEADでSitesの版を保存して公開する。ローカルビルド済みarchiveが作れる時はそれを使い、ローカルビルド不能時のみSitesが許容するremote buildを使う。
6. ターミナルの公開成功後、各Siteのstatusと秋datasetのsourceFingerprint・球数を照合。保存だけ/片方だけ/公開失敗を両方成功と報告しない。
7. 前回push済みでも公開が未完了なら、同じソースの保存版とdeployment状態を先に照合し、重複版を作らず再開する。

## 今回の検証
- 原本8 CSV、2026-09-08〜10、8試合、6大学、2,364球。PitchUIDの重複0。
- 両サイトの秋元PitchUID集合と生成後のPitchUID集合が一致。
- 再実行で生成物が変わらないこと、競合・別季・切断CSV・投球消失を止めて直前出力を残すことを自動検査。
- 2026春、2025秋、initial-dataは以前のGit版とバイト単位で同一。
- Lab: 取り込み・CSV・公開境界・Service Workerの42テスト成功。手入力関連と引継ぎの45テスト成功。Reactを使う描画テストは依存取得未完了により実行不能。ローカル依存取得は「network approval was cancelled before a decision was returned」で終了し、ローカルbuildもvinext不在で停止。remote buildの成否は公開後の追記を参照。
- Savant: typecheckと標準build成功、既存unit 46件成功、秋を含むloader/import 8件成功、rendered HTML 12件成功。全体lintは既存のany型5件とwarning3件が残る。今回追加の取り込みコードに由来するlintエラーではない。
- 実ブラウザ・実機PWA・実印刷・定刻自動実行の確認は未実施。以前の運用受入判定を今回のデータ取り込みだけでPASSへ置き換えない。

## 復旧
取り込み失敗は既存公開版を維持する。ローカル書込み失敗の作業ツリーは上書きせず隔離し、最新の正常Git版から再実行する。公開後に問題があれば両サイトそれぞれ直前の保存版に戻す（Labは今回以前の公開56、Savantは90）。D1/R2や手入力試合の削除を復旧手段にしない。


## 公開完了の追記（2026-09-11）
- Lab: Sites公開57、source b78d4c04382457642b74956906dae2ce56079a6c。remote build後のdeployment appgdep_6aa37587b40881919528a4020960021f が03:32:22 UTCにsucceeded。https://tohto-pitch-analysis-lab.nbdn87qjxf.chatgpt.site
- Savant: Sites公開91、source 18cb0e251bf0c0e2f6a7148abd8b7642b7866607。検証済みローカルarchiveでdeployment appgdep_6aa3758e72a88191ab23f7c187971462 が03:29:42 UTCにsucceeded。https://tohto-baseball-savant.nbdn87qjxf.chatgpt.site
- 本番読取り確認: 両サイトのstatus HTTP 200、Savantの秋JSON HTTP 200（4,023,640 bytes）、Labの/api/dataset?season=2026-fall HTTP 200（3,477,964 bytes）。それぞれローカル生成JSONと完全一致。8試合・2,364球・一意PitchUID 2,364、2026年秋季。
- 両サイトのsourceFingerprint: 43c7c26dbd0d12bd1e1fc150f0e4c7d1fa7dde134cdbed591be98fc6ccfc507e。
- 両サイトのlistingFingerprint: 951fee058fbcb5dc6158abbe766bed29336a6a267c67435eeefa7c1647a1cdfb。Pythonによる別実装のメタデータハッシュとも一致。
- 隔離環境で2試合目の追加と同一ファイルの球速訂正を実行し、旧試合・PitchUIDを保持したまま反映されることを確認。
- タスクはDTSTART;TZID=Asia/Tokyo:20260911T163000、DAILYの8/16/22時30分、COUNT=335。最初の予定は9/11 16:30、最後は12/31 22:30（日本時間）。標準RRULE解釈で確認済み。将来の定刻実行はまだ観測していない。
- この追記は公開後の記録のみ。公開時のビルド/データ/権限を変更しない。


## 2026-09-11 打者項目が空になる不具合の修正

- 原因：開幕8試合の全82打者が20打席未満で、打者一覧・ホーム・比較候補の20打席条件が全員を除外していた。秋CSVの打者・打球データ自体は存在する。
- 表示対象：20打席到達者がいないシーズンは1打席から表示し、少数データの参考値であることを明記。リーグ内パーセンタイルの評価条件は20打席を維持。未算出を50として表示しない。
- 打撃7一覧、ホームの最高打球速度・打撃成績、選手比較候補、選手詳細の有効打球数を修正。シーズン変更時は分析画面の絞り込み状態をリセットする。
- 打球速度の画面内集計は既存CSV指標と同じ対象（計測のあるインプレー、バント除外）に統一。打球方向図には引き続き計測された方向・距離を使用する。
- 自動取り込みに `validateAutumnBatting` を追加。投球ごとの打球速度・角度・方向・距離、打者と選手詳細の対応、打者別有効打球数・平均/最高打球速度を元CSVと照合し、不一致ならファイル書込み前に停止する。
- `npm run test:batting`：17件成功。実データからReactで7種類の打撃表、ホーム、打者詳細、打球方向SVGを生成して値を検査。小標本と欠測値、春季の規定条件、破損時に直前データを保持する回帰も含む。ブラウザでの操作・PC/スマホ実画面・印刷は今回実施していない。
- 今回の照合対象：8試合、2,364球、82打者、有効打球381。既存季節データ・登録選手・試合保存・認証・D1/R2の変更なし。
- Savant：型検査・ローカル本番ビルド成功、関連回帰50件成功。変更対象lintはエラー0（既存の未使用引数警告1件）。


## 2026-09-11 秋の未接続機能を修正（公開前検証）
- 両サイト：秋の回転アニメーション用データが空、比較期間が2025秋→2026春に固定、初回表示が春だった箇所を修正。春→秋の比較を初期選択とし、旧期間も選択可能。対象者がいない場合は説明を表示し、読み込み中のままにしない。
- Savant：ゾーン別打球分析に2026秋と全6大学を接続。選択シーズンの既読データを即時利用し、別大学のデータが混ざらないようにする。
- Lab：公開識別子をautumn-analysis-2026-09-11へ更新。オフライン準備に全3シーズンの回転JSONを追加。新規データ公開時も識別子更新とSW検査を継続する。
- 回転データ：2,363球の実測情報を収録、うち2,135球に参考推定あり。推定不可228球は平面表示。計測不足1球は生成対象外。PitchUIDで分析の絞り込みと対応させる。
- 新規CSVから打撃・回転を同じ検証済みスナップショットとして生成する。既存更新タスクをこの処理へ更新し、未変更時は再計算・公開を省略。新しい即時通知の仕組みを作ったとは説明しない。
- 取り込みモデル変更の再生成は --rebuild-derived を使用。今回、投球・選手・集計値はGit直前版とJSON全体で同一（metadata.trackmanSyncの追加だけを除外して照合）。過去シーズンのデータ、保存試合、名簿、認証、D1/R2の変更なし。
- 検査：Savant test:autumn 24件、Lab 23件成功。元CSV再生成、打者の実React表示、回転の実Canvas描画関数で回転・停止・欠測値を検査。新CSVで打撃と回転を同時反映し、未変更再実行で全生成物が同一であることを確認。
- Savant：typecheck成功、unit 51件成功。変更コードのlintはエラー0、既存navigate未使用warning 1件。全体lint成功とはしない。
- Lab：同じ固定バージョンのインストール済み依存を使った本番分析コンポーネントのTypeScript検査0件、PWA回帰25件成功。環境の依存取得が中断されたため、Lab全体の本番ビルドはSites remote buildの終端成功で確認する。
- ブラウザ操作、実機PWA、実印刷、将来の定刻タスク実行は未検証。React/Canvasの自動検査をそれらのPASSと同一視しない。

### 回転の参考推定の定義
lib/trackman-spin.mjsのnathan-2020-b-standard-air-v1を唯一の生成実装とする。元の旧シーズン推定スクリプトは未発見であり、同じ式を復元できたとはしない。
出典：[Nathan 2020 equations 2, 7–9](https://baseball.physics.illinois.edu/trackman/SpinAxis.pdf)、[Addendum prescription b](https://baseball.physics.illinois.edu/trackman/SpinAxisAddendum.pdf)。
SI単位の9Pからリリース〜本塁前端の中間時刻の速度を計算し、重力と速度方向成分を除いた加速度からCLを得る。K=0.005356/0.3048、半径0.0366m、重力9.80665m/s²、A=0.336、B=6.041。S=-log(1-CL/A)/B、activeRpm=S*v/r*60/(2π)、efficiency=activeRpm/SpinRate、gyro=acos(efficiency)。CL>=Aやefficiency>1等は推定不可にして100%へ切り詰めない。
標準大気を仮定し、気象・縫い目の空気力は未計測。軸の前後向き・縫い目位相は表示上の仮定。実測の3D姿勢や精度保証として表示しない。公開画面にも推定条件と出典を示す。


## 秋の分析完成版：公開記録（2026-09-11）
- lab: version 59、source c667b90eb2ee1cd93885d7a394b9d34bf827d77e、deployment appgdep_6aa38202bbe88191a6deefc8efa3bd51。2026-09-11T04:24:47.438327+00:00 に succeeded。https://tohto-pitch-analysis-lab.nbdn87qjxf.chatgpt.site
- savant: version 93、source bb3a3c6fc4145d53bb7877bf9710d1dd1b4b3c77、deployment appgdep_6aa3825056d881918fcaacf6e4e3e1be。2026-09-11T04:24:25.055669+00:00 に succeeded。https://tohto-baseball-savant.nbdn87qjxf.chatgpt.site
- LabはSites remote buildが成功。Savantは標準本番build・独立したgzip/tar検査・Worker/manifest/秋データの原本一致を通したarchiveを使用。
- 直前の打者修正のみのLab 58は公開済み。Savant 92は保存のみで公開せず、今回の完成版93に含めて公開した。
- 公開後のHTTP読取り：両サイトの秋status・dataset・spin JSONが検証済みローカル生成物と完全一致。2,364球、82打者、有効打球381、回転計測2,363球、3D参考推定2,135球、最新試合日2026-09-10。rootもHTTP 200。
- Lab：/api/dataset?season=2026-fallも同じdataset。配信sw.jsはローカルと完全一致、autumn-analysis-2026-09-11と回転JSONのオフライン準備を確認。配信JS 7本から打者の最低1打席表示・秋の回転表示・春秋比較コードを確認。
- Savant：本体savant-app-CNnGEjS4.jsと遅延読込みpitch-spin-profile-DB_MFrFi.jsが公開ビルドとバイト単位で一致。root→本体→回転チャンクの参照も確認。初回の検証器はバッククォートの遅延importを追えていなかったため、配信ファイルの参照と内容を直接照合して解消した（アプリ側の公開欠落ではない）。
- 既存更新タスクのプロンプトを打撃・回転の一括生成とtest:autumn/公開照合へ更新。enabledと既存の8:30/16:30/22:30 Asia/Tokyoの予定を確認。即時プッシュ型のDrive監視や将来の実行成功は未確認。
- この公開記録の追記はドキュメントのみ。保存済み公開版のソースSHAは上記のとおりで、記録を追加したHEADと区別する。
