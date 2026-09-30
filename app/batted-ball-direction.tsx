import type { Row } from '../lib/dataset-types';
import { fieldSector, sprayPoint } from '../lib/chart-geometry';
import { drawableBattedBall, reportBattedShape, reportLineDash, reportHit } from '../lib/opponent-report';

export function BattedDirectionLegend() {
  return <div className="direction-legend">{['ゴロ','ライナー','フライ'].map(shape => <span key={shape}><svg viewBox="0 0 40 12" aria-hidden="true"><line x1="1" y1="6" x2="39" y2="6" stroke="#111" strokeWidth="1.6" strokeDasharray={reportLineDash(shape)} strokeLinecap="round"/></svg>{shape}</span>)}<span className="direction-out">凡打</span><span className="direction-hit">安打（本塁打含む）</span></div>;
}
export function BattedBallDirectionChart({ rows, maxDistance, compact=false }: { rows: Row[]; maxDistance?: number; compact?: boolean }) {
  const valid = rows.filter(drawableBattedBall);
  const max = Math.max(120, maxDistance ?? 0, ...valid.map(p => p.distance));
  const home = {x:150,y:compact?205:188}, radius=150, scale=radius/max;
  return <svg className="batted-direction-chart" viewBox={`0 0 300 ${compact?225:215}`} role="img" aria-label="捕手視点の打球方向・凡打は黒、安打は赤">
    <path d={fieldSector(home.x,home.y,radius)} fill="#fff" stroke="#99aaad"/>
    {[30,60,90].filter(m=>m<max).map(m => <path key={m} d={fieldSector(home.x,home.y,m*scale)} fill="none" stroke="#dde4e5" strokeWidth=".7"/>)}
    {valid.map((p,i) => { const point=sprayPoint(p.sprayAngle??p.direction,p.distance,home.x,home.y,scale),shape=reportBattedShape(p),color=reportHit(p)?'#cf202f':'#111111';
      return <g key={p.id??i}><title>{`${shape??'打球種別不明'}・${p.playResult||'結果不明'}・${p.distance.toFixed(1)}m`}</title>{shape&&<line x1={home.x} y1={home.y} x2={point.x} y2={point.y} stroke={color} strokeWidth="1.4" strokeDasharray={reportLineDash(shape)} strokeLinecap="round"/>}<circle cx={point.x} cy={point.y} r="2.3" fill={color}/></g>;})}
    <text x="150" y="18" textAnchor="middle" fontSize="12">{Math.ceil(max)}m</text>
    <text x="150" y={compact?222:210} textAnchor="middle" fontSize="12">{valid.length ? `${valid.length}打球` : '打球データなし'}</text>
  </svg>;
}
