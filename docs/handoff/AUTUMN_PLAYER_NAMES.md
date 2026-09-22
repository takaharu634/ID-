# 2026秋 選手名の漢字対応（2026-09-11）

## 対応内容
秋8試合の119選手中、未照合だった13選手を公式名簿の漢字・読みと照合。新規10選手、既存3選手の別綴り。既存Excel由来のマスターを保ち、lib/player-master-autumn.jsに出典付きの追補を置く。次回のCSV取り込みも同じ追補を使用する。
同じ大学・漢字名は既存行へ別綴りを統合し、既存の正規ローマ字名を維持する。漢字から別人のIDを推測・作成しない。異なるTrackMan IDの統合は今回の対象外。

| 大学 | 秋CSV表記 | 正式な漢字 | 対応 |
|---|---|---|---|
| 中央 | Hirayama, Soshi | 平山 颯士 | Soushiの別綴り |
| 中央 | Matsushima, Shoto | 松嶋 祥斗 | 追加 |
| 中央 | Shimoyama, Taira | 下山 大楽 | 追加 |
| 中央 | Yamada, Kotaro | 山田 晃太郎 | 追加 |
| 中央 | Yokoya, Rui | 横谷 塁 | 追加 |
| 青山学院 | Kanemoto, Kanta | 金本 貫汰 | 追加 |
| 青山学院 | Murakami, Kosei | 村上 洸星 | 追加 |
| 國學院 | Nakamura, Yuto | 中村 祐斗 | 追加 |
| 國學院 | Sasamoto, Kenshin | 篠本 賢伸 | 追加 |
| 東洋 | Okido, Riku | 大城戸 陸琥 | Ohkidoの別綴り |
| 東洋 | Otsubo, Ren | 大坪 廉 | Ohtsuboの別綴り |
| 東洋 | Yamaki, Yuma | 八巻 弓真 | 追加 |
| 立正 | Miura, Tento | 三浦 天和 | 追加 |

## 出典と照合
- 中央：[投手](https://chuobaseballteam.wixsite.com/chuobaseball/複製-投手紹介)、[捕手](https://chuobaseballteam.wixsite.com/chuobaseball/複製-捕手紹介)、[外野手](https://chuobaseballteam.wixsite.com/chuobaseball/複製-外野手紹介)。漢字とローマ字を直接確認。
- 青山学院：[金本](https://www.agubbc.com/member/金本貫汰)、[村上](https://www.agubbc.com/member/村上%E3%80%80洸星)。漢字とふりがなを確認。
- 國學院：[篠本を含むメンバー](https://kokugakuin-baseball.com/member/)、[中村の公式検索](https://kokugakuin-baseball.com/?post_type=member&s=中村)。中村祐斗は公式HTMLの検索結果で「なかむらゆうと」、外野手・左投左打を確認。
- 東洋：[大城戸](https://toyouniv.wixsite.com/tohto/複製-新しいページ-1)、[大坪](https://toyouniv.wixsite.com/tohto/大坪廉)、[八巻](https://toyouniv.wixsite.com/tohto/複製-複製-長島-光来)。個人ページの英字と名簿の漢字を対応。
- 立正：[公式名簿](https://www.ris.ac.jp/sports/baseball/memberlist/index.html)が読み込む[公式JSON](https://www.ris.ac.jp/sports/baseball/memberlist/baseball.json)に三浦天和・2年・東邦を確認。「てんと」の読みは既存確認済み名簿と高校時の記事とも整合。
- 9/7の確認済み選手名簿も補助照合に使用。元Excel・元CSV・端末名簿のファイルは書き換えていない。

## 検証
- 両サイトとも秋の漢字未設定0、選手119人、ID重複0。更新前後で選手ID集合・全2,364球のPitchUIDと順序が一致。
- JSONを全項目照合し、変化したのは氏名・漢字・別綴り・出典だけ。成績・球速・打球・回転・状況・チーム・試合数は不変。
- 春/2025秋・秋のspin JSON・更新statusはGit直前版とバイト単位で一致。
- masterの大学＋漢字重複0、正規化した大学＋英字別名の別人衝突0。13人すべて一意に照合。
- test:autumn：Savant 24件、Lab 23件成功。Lab PWA shell 25件成功。Labの公開識別子はautumn-kanji-2026-09-11。
- 保存・Undo・認証・DB・手入力チーム/選手・旧シーズンの変更なし。実機/ブラウザ/印刷の検査は今回の氏名データ変更では実施していない。
- Labのローカル依存取得は既知の環境制限で未完了。Sites remote buildの終端結果と公開APIの内容で検証する。旧受入判定をPASSへ書き換えない。

## 公開結果
- Savant Sites 94、Git `27e0cc1c8642d76b8e2dab6dc66c3935afcf200c`。deployment `appgdep_6aa3951e8798819192477bb5d65747e2` は2026-09-11 05:44:20 UTCに`succeeded`。ロールバック先はSites 93、Git `bb3a3c6fc4145d53bb7877bf9710d1dd1b4b3c77`。
- URL: https://tohto-baseball-savant.nbdn87qjxf.chatgpt.site/
- 標準helperのビルド・型検査・パッケージ作成が成功。圧縮全体・tar内のhosting設定・Worker・秋JSONを検証した同一ソースのarchiveを公開。
- 公開後のHTTP確認：トップ200、秋JSONと実際の画面が取得するcompact版JSONがそれぞれ検証済みローカルとバイト一致。119選手全員の漢字、修正13名、2,364球・8試合を確認。実ブラウザ操作の検査とは区別する。
- 既存の定期更新タスク `6aa37473fde0819188299002345e1b6b` に、公式名簿による新規名の照合・出典保存・別綴り統合・重複検査を追記。既存の実行時刻と有効状態を維持し、重複タスクは作成していない。即時イベント更新とは説明しない。
