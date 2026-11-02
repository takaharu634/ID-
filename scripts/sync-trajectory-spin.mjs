import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
// Reuse the exact existing spin-profile estimate, rather than a second estimator.
// Older feeds have no PitchUID. Only an unambiguous pitcher/date/pitchNo match
// with compatible measured RPM is accepted; ambiguous/missing rows stay unknown.
export async function syncTrajectorySpin(){
 let html=await readFile('public/trajectory-studio/index.html','utf8');
 const match=html.match(/<script>const DATA=([\s\S]*?);<\/script>/);if(!match)throw new Error('軌道目録がありません');
 const catalog=JSON.parse(match[1]);let matched=0,unknown=0;
 for(const season of catalog.seasons){
  const feed=JSON.parse(await readFile(`public/data/spin-${season.id}.json`,'utf8'));
  const byId=new Map(),legacy=new Map();
  for(const row of feed){
   if(row.pitchId)byId.set(row.pitchId,row);
   else{const id=row.pitcherId?.match(/:id:([^|]+)/)?.[1],key=[id,row.date,row.pitchNo].join('|');if(!legacy.has(key))legacy.set(key,[]);legacy.get(key).push(row);}
  }
  for(const pitcher of season.pitchers){
   const filename=pitcher.dataUrl.split('?')[0],path='public/trajectory-studio/'+filename,payload=JSON.parse(await readFile(path,'utf8'));
   for(const p of payload.pitches){
    const candidates=legacy.get([pitcher.id,p.date,p.pitchNo].join('|'))||[];
    const row=byId.get(p.id)||(candidates.length===1&&Math.abs(candidates[0].spinRate-p.spin)<2?candidates[0]:null);
    p.gyroAngle=row&&Number.isFinite(row.gyroAngle)?row.gyroAngle:null;
    p.spinEfficiency=row&&Number.isFinite(row.spinEfficiency)?row.spinEfficiency:null;
    p.activeSpin=row&&Number.isFinite(row.activeSpin)?row.activeSpin:null;
    p.estimateMethod=row?(row.estimateMethod||'spin-profile-existing-estimate'):null;
    p.estimateReason=p.gyroAngle===null?'回転プロファイルの有効な推定値なし':null;
    p.gyroAngle===null?unknown++:matched++;
   }
   const data=JSON.stringify(payload);if(data!==await readFile(path,'utf8'))await writeFile(path,data);
   pitcher.dataUrl=filename+'?v='+createHash('sha256').update(data).digest('hex').slice(0,12);
  }
 }
 html=html.replace(match[0],'<script>const DATA='+JSON.stringify(catalog)+';</script>');
 for(const script of [...html.matchAll(/<script defer src="\.\/([^"?]+)(?:\?[^"]*)?"/g)]){const bytes=await readFile('public/trajectory-studio/'+script[1]);html=html.replace(script[0],'<script defer src="./'+script[1]+'?v='+createHash('sha256').update(bytes).digest('hex').slice(0,16)+'"');}
 const manifest=JSON.parse(await readFile('lib/generated/trajectory-studio.json','utf8'));manifest.renderRevision=createHash('sha256').update(html).digest('hex').slice(0,16);manifest.source='ID東都 投球軌道表示改善 2026-10-02';await writeFile('lib/generated/trajectory-studio.json',JSON.stringify(manifest,null,2)+'\n');
 if(html!==await readFile('public/trajectory-studio/index.html','utf8'))await writeFile('public/trajectory-studio/index.html',html);
 console.log(`trajectory spin: ${matched} shared estimates, ${unknown} unknown`);
}
if(process.argv[1]?.endsWith('/sync-trajectory-spin.mjs'))await syncTrajectorySpin();
