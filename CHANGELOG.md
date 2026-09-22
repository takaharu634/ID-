## 2026-09-21 試合スコアボード

- 試合一覧からイニング別得点・安打・四死球と内訳を表示。全失策は未収録のため欠測表示、失策出塁を別表示。未収録回を0やXと推定しない。
- PC・モバイルのメニューでランキングを可視化の次へ移動し、バレルゾーンと交換。
- 3シーズンの全試合得点整合、重複投球、四死球、延長・欠測、React出力を確認。

## 2026-09-21 ID東都への名称統一

- 画面、タブ、PWA名、CSV出力名、印刷用説明、API案内の表示名をID東都へ統一。
- PWAのアプリ表示を更新。既存オフラインデータ、保存キー、URL、指標定義は維持。

## 2026-09-20 審判ヒートマップの表示整理

- セル内の n=球数・参考ラベルを削除し、期待率との差だけをpt付きで表示。集計・配色・詳細情報は維持。

# CHANGELOG

## 2026-09-17 日常分析の軽量化公開

- 既存の圧縮転送を維持し、選手・球種集計、守備シフト集約、選手詳細の条件変更で重複する計算を削減。同一条件の指標定義、元CSV/JSON、試合入力、保存・復旧、認証、D1/R2は変更しない。migrationなし。
- 依存監査の指摘解消のためNext/eslint-config-next 16.3.5へ互換更新。オンラインproduction監査0件。typecheck、lint（エラー0）、標準本番build、artifact検証成功。Nextの新ルールによる既存の全ページ遷移への助言は4件残す。認証・復旧の遷移方式は維持。
- unit 51件、autumn 24件、打者レポート5件、rendered HTML 12件成功。3季節・21分析画面のReact出力と全打者球種集計が変更前と一致。円グラフの処理整理は329選手・季節レポートのReact出力完全一致を確認。実ファイルPDF・実機PWAの未実施項目をPASSに変更しない。
- 依存更新後の監督付きブラウザ確認：秋ホーム2,364球/8試合。石野蓮授の左投手条件40球・平均打球速度133.8・有効5打球→リセット57球・141.7・9打球へ復元。
- 公開：Sites 102、Git `fb264c5648d63cd2c7123fe6fffc4aec73479dde`、deployment `appgdep_6aabc9ca39d4819191b0b8c4c13abce9`。2026-09-17T11:07:11.890241+00:00に`succeeded`。URL: https://tohto-baseball-savant.nbdn87qjxf.chatgpt.site
- ロールバック：Sites 101、Git `cc00755623907327491111cc481fff558a6249d0`。旧QAブランチは混入させず保存。
- 公開後の認証付き読取り：秋status/season/spin、3季節のcompact JSON、45本のclient JS、SWの計52ファイルが検証済みローカル版とバイト単位一致。秋は2,364球/8試合、sourceFingerprint一致。現在のserver/manifestは今回のsavant-app-BziRojvg.jsを参照し、同ファイルの配信一致も確認。実機PWAの操作試験ではない。


## 2026-09-17 — 審判分析
- New lazy-loaded `表示=umpires` view in desktop/mobile navigation; season/card/umpire/hand/count/pitch type/perspective controls. No new dataset download or change to existing datasets, Lab, auth, storage, or scheduled imports.
- User's Sep 17 autumn plate-umpire memo bound to eight exact GameUID/date/team tuples (岩崎・吉田・大槻・福壽・寺尾・川合・石丸・熊倉). Unknown/future games remain unassigned; metadata mismatch is excluded and reported.
- 2,364 original pitches; 1,161 located called-strike/ball decisions, one missing location. League comparison uses other games only, same batting side and 2-strike/3-ball state, local Gaussian kernel (8.5/9.5cm), >=2 reference games and effective n>=5. Unsupported estimates null. Called Strike% uses all located takes; comparison rates and residual use the supported subset explicitly.
- 7×7 residual heatmap with actual locations, cell counts, low-sample fading, selectable comparison detail. Eight nonoverlapping edge/corner regions; same fixed display zone as existing analysis. CM width is a supported local 50% contour difference, never pt converted to cm; no extrapolated/ambiguous crossing.
- Added catcher × umpire breakdown and a separately labeled reference correction using other catchers' residuals (minimum20, n/(n+50) shrinkage). Does not replace existing framing metrics. Each current umpire has one game: no claim of isolated umpire skill or joint pitcher/batter/catcher/game causal adjustment. Sample bins are count categories, not validated confidence levels.
- Validation: nine analytics/real-data React cases passed; eighteen existing batting/SW cases passed; focused ESLint zero errors/warnings after dependency cleanup; typecheck and official build/artifact passed. User data is read-only and regression tests check immutability, self-game exclusion, exact mapping, null handling, handedness, corrected catcher peer exclusion and contour recovery.
- Internal browser desktop: loaded all eight umpires; 川合179 takes/147 compared; left+2-strikes13/7; +straight11/5; unrelated card0/0; spring unregistered state; returned to autumn; cell17 detail42.9% actual/60.8% expected/-18.0pt,n7; position overlay toggle and visual inspection. One label locator retry used observed combobox role. Scroll command timed out but screenshot confirmed scrolling. No mobile-device, print-PDF, or live production browser result claimed.
- Future umpire entries require confirmed memo and exact match; CSV additions do not guess umpire rotation. Rollback: previous live Sites102, source fb264c5648d63cd2c7123fe6fffc4aec73479dde.
- Publication confirmed: Sites103, source `9c3b387fb6ccad6d862d9c87133b07303bc5e0e9`, deployment `appgdep_6aabe2dfc6d481919d96bb1029c77740` succeeded at 2026-09-17T12:54:09.496564+00:00. Existing public audience preserved. URL https://tohto-baseball-savant.nbdn87qjxf.chatgpt.site . No production-browser QA claimed.
