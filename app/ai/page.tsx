import Link from "next/link";

export const metadata = {
  title: "AI向けデータ案内 | ID東都",
  description: "ChatGPTなどからID東都の公開集計データを参照するための案内。",
};

export default function AiGuidePage() {
  return <main style={{ maxWidth: 920, margin: "0 auto", padding: "32px 20px 64px", fontFamily: "system-ui, sans-serif", lineHeight: 1.75, color: "#17383b" }}>
    <p style={{ fontWeight: 800, color: "#337f80" }}>ID東都 / AI DATA GUIDE</p>
    <h1>AI向け公開データ案内</h1>
    <p>ID東都で公開している選手・投手・球種の集計値を、ChatGPTなどのAIから読み取るための読み取り専用APIです。更新・編集・管理機能には接続できません。</p>
    <h2>利用できるデータ</h2>
    <ul><li>選手名・所属大学・投打区分</li><li>投手の球種別球数、平均球速、IVB、横変化量、回転数、VAA、Extension、Whiff%、CSW%</li><li>投手のカウント別・対左右別スカウティング集計</li><li>打者の初球Swing%、First Strike Swing%、追込前／2ストライク時Chase%、Expansion</li><li>打者プロファイル（球種グループ、コース、対投手左右の打球方向、横・上下変化、直球球速帯、シーズン別の強い打球基準）</li><li>大学・球種・最低球数を指定した投手ランキング</li></ul>
    <h2>AIへの質問例</h2>
    <ul><li>このサイトを使って、鈴木泰成の球種別平均球速、IVB、横変化量を教えて。</li><li>中央大学投手のストレートを最低20球で絞り、IVB順に並べて。</li><li>青山学院大学で平均球速145km/h以上、IVB40cm以上のストレートを投げる投手は？</li></ul>
    <h2>公開エンドポイント</h2>
    <ul>
      <li><a href="/api/public">API入口</a></li>
      <li><a href="/api/public/metadata">データ範囲・単位・指標定義</a></li>
      <li><a href="/api/public/players?q=鈴木泰成&role=投手">選手検索の例</a></li>
      <li><a href="/api/public/arsenal?player=鈴木泰成&team=青山学院大学&minPitches=5">鈴木泰成の球種別集計</a></li>
      <li><a href="/api/public/rankings/pitchers?team=中央大学&pitchType=ストレート&metric=avgIvb&minPitches=20">中央大学・ストレートIVBランキング</a></li>
      <li><a href="/api/public/scouting/pitcher?player=鈴木泰成&team=青山学院大学&minSample=5">投手のカウント別・左右別資料</a></li>
      <li><a href="/api/public/scouting/batter?player=渡部海&team=青山学院大学&minSample=5">打者アプローチ指標</a></li>
      <li><a href="/api/public/scouting/batter-profile?player=渡部海&team=青山学院大学">打者プロファイル</a></li>
      <li><a href="/openapi.json">OpenAPI仕様</a>／<a href="/llms.txt">llms.txt</a></li>
    </ul>
    <h2>注意</h2>
    <p>球種別集計とランキングは対象シーズンのTrackMan計測データを使用します。少数標本を避ける場合はminPitchesまたはminSampleを指定してください。割合は分子・分母と定義バージョンを併記します。横変化量は投手視点の符号を含むため、投手の左右と併せて解釈してください。</p>
    <p><Link href="/">ID東都へ戻る</Link></p>
  </main>;
}
