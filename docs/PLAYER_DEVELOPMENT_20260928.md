# 選手指標追加 2026-09-28

## 範囲と並行開発への引継ぎ

開始時のSitesソースは `9d7cd8d4eb99db530b7375c98524bab6d1c81c61`（公開134）。
長期保存・年度自動対応の別作業とは独立した指標追加。
新メニューなし。保存方式、認証、容量、年度登録、Drive通知、既存PITCHスコア、QAB、球種補正を変更しない。

- 新しい計算: `lib/development-metrics.ts`
- 表示: `app/player-development.tsx` / CSS。`app/savant-app.tsx`には表示呼出しと古い計測値補充のみ。
- CSV追加列: `lib/development-measurements.mjs` を `lib/csv-analytics.js` の列選択・投球行に追加。
- 古い公開/R2スナップショット用: `lib/development-enrichment.ts` と `public/data/development-*.json`。一致するPitchUIDの未定義フィールドのみ補充し、現データのnullや値を上書きしない。
- 既存の3シーズンJSONとinitial-dataは、全元フィールドが開始時ソースとdeepEqualになることを確認。新計測フィールドのみ追加。
- 別作業がJSONを再生成した場合は `python scripts/enrich-development-measurements.py` で追加列と補充ファイルを再作成可能。データ本体は再計算しない。将来CSVは取り込み時点で追加列を保存する。

並行作業との統合時は `savant-app.tsx` の表示呼出し・enrichDevelopmentDataset呼出し、CSVのDEVELOPMENT_COLUMNS/developmentMeasurementsを残す。最新の保存基盤に古いファイル全体をかぶせない。

## 表示場所

- 投手「概要」: 球質SD・リリースSD、VAA差、EffectiveVelo差、PutAway%、Heart/Edge/Chase/Waste。
- 投手「試合推移」: 自投手全球の15球区間、61球目以降/1〜15球目の同球種維持率、登板のリリース平均/SD/過去平均との差。
- 打者「概要」: タイプ別EV、Pull Air%、角度SD、2ストライクContact%、ゾーン/Heart Damage、Good Decision%。
- 捕手「概要」: 同じ二塁送球サンプルでPop=Exchange+TimeToBase、平均/最高送球速度。
- ランキングの既存カテゴリ内「表示指標」: 上記指標を選択。大学・名前・最低件数・列の並べ替えに対応。基本指標の保存条件/URLは既存scopeを保つ。

## 定義

SDはn−1、回転軸のみ循環SD。品質Lowは項目別に除外。欠測は0にしない。
リリース差は同シーズン・同球種・過去登板のみ。現登板3計測以上、過去10計測以上。
VAA差は正規化ストレート100球/3投手以上のVAA~PlateLocHeight回帰残差。年/春秋を混ぜず、外挿しない。
Effective Veloは元CSVのEffectiveVeloを使い、Extensionだけから再現しない。
PutAwayは2S条件を分子の三振にも適用。
Heart/Edge/Chase/Wasteは既存固定ゾーンと境界8.5/17cmの距離分類。MLBの個別打者ゾーンとの同一性は主張しない。
Good DecisionはHeartスイング+Chase/Waste見送りを同領域の判定可能球で割る。Edge・死球・敬遠・不明・記録済みバントを除外。カウント別最適判断ではない。
打球は非バントのインプレー。タイプはTaggedHitType優先、不明時のみ角度10/25/50度で分類。PullAirは引っ張ったライナー/フライ÷方向/角度の有効な全非バント打球、境界±15度。
DamageのxSLGは対象領域で打数終了した期待値計測済み打球+三振を分母とし、犠打飛・未計測打球を除外。他の打撃指標/公式打数を書き換えない。
Pop分解はX35〜43m/|Z|<=5m、Pop1.6〜2.5秒、3捕手品質Low以外、Exchange+TimeToBaseがPopと0.03秒以内で一致。速度は速度計測サンプルで別集計。
Blast%/Bat Speedは元データ不足のため数値を生成しない。

## 検証

- 追加13ケース: 欠損、循環角、VAA季節分離/15万球、球種絞込後の登板球数、未来を含めない過去基準、PutAway、判断除外、打球分母、左右引っ張り、捕手同一送球、CSV列保存、品質Low、旧保存補充。
- 関連既存テストと合わせ125件成功。型検査成功。
- 春捕手: 51送球、Pop 1.9925023725、Exchange 0.7219190392、飛行 1.2705835098秒、速度127.5563923529km/h。
- 春/秋2026、秋2025の全元フィールドは変更なし。
- 個人ページ/追加ランキングは同じ計算を使用。UI切替時に最低件数とソートが旧指標から漏れないことを実画面で確認。

参考: MLB公式 PutAway glossary / Pop Time glossary / Catcher Framing glossary、TrackMan Radar Glossary of V3 Terms。独自指標の詳細はUIの折りたたみ計算方法で表示。
