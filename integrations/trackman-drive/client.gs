// ID東都: Drive change events. No recurring CSV polling and no AI execution.
const ID_TOHTO_BASE = '__BASE_URL__';
const ID_TOHTO_KEY = '__SYNC_SECRET__';
const ID_TOHTO_ENGINE = '__ENGINE_VERSION__';
function tohtoHex(bytes) { return bytes.map(b => (b & 255).toString(16).padStart(2, '0')).join(''); }
function tohtoHash(s) { return tohtoHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function tohtoHmac(s) { return tohtoHex(Utilities.computeHmacSha256Signature(s, ID_TOHTO_KEY, Utilities.Charset.UTF_8)); }
function tohtoCall(action, fields) {
  const body = JSON.stringify(Object.assign({ action: action, engineVersion: ID_TOHTO_ENGINE }, fields || {})), time = String(Date.now());
  const response = UrlFetchApp.fetch(ID_TOHTO_BASE + '/api/trackman/bridge', {method:'post',contentType:'application/json',payload:body,muteHttpExceptions:true,
    headers:{'x-trackman-time':time,'x-trackman-signature':tohtoHmac(time+'\n'+tohtoHash(body))}});
  const value=JSON.parse(response.getContentText());
  if(response.getResponseCode()!==200) throw new Error(value.error || 'ID東都に接続できません。');
  return value;
}
function tohtoGet(key) {
  const time=String(Date.now()), hash=tohtoHash('');
  const r=UrlFetchApp.fetch(ID_TOHTO_BASE+'/api/trackman/storage?key='+encodeURIComponent(key),{muteHttpExceptions:true,headers:{'x-trackman-time':time,'x-trackman-signature':tohtoHmac(time+'\n'+key+'\n'+hash),'x-content-sha256':hash}});
  if(r.getResponseCode()!==200)throw new Error('保存済みデータを取得できません。');
  return r.getContentText('UTF-8');
}
function tohtoPut(key,value) {
  const hash=tohtoHash(value),time=String(Date.now());
  const r=UrlFetchApp.fetch(ID_TOHTO_BASE+'/api/trackman/storage?key='+encodeURIComponent(key),{method:'put',contentType:'text/plain; charset=utf-8',payload:value,muteHttpExceptions:true,
    headers:{'x-trackman-time':time,'x-trackman-signature':tohtoHmac(time+'\n'+key+'\n'+hash),'x-content-sha256':hash,'x-content-bytes':String(Utilities.newBlob(value).getBytes().length)}});
  if(r.getResponseCode()!==200)throw new Error('検証済みデータを保存できません。');
  return {key:key,sha256:hash,bytes:Utilities.newBlob(value).getBytes().length};
}
let tohtoDeadline=Infinity,tohtoJob=null;
function tohtoCheckpoint() {if(Date.now()>tohtoDeadline)throw new Error('__TOHTO_YIELD__');}
function tohtoSaveJob() {PropertiesService.getScriptProperties().setProperty('job',JSON.stringify(tohtoJob));}
function tohtoUpload(season,id,kind,value) {
  const progressKey=id+':'+kind,progress=tohtoJob?(tohtoJob.progress[progressKey]||0):0;
  let index=0;
  const extension=['raw','input'].includes(kind)?'csv':'json',key='datasets/v2/'+season+'/versions/'+id+'/'+kind+'.'+extension;
  if(value.length<TohtoImport.BLOCK_CHARS*2){tohtoCheckpoint();return tohtoPut(key,value);}
  const parts=[];let bytes=0;
  for(const raw of TohtoImport.objectSegments(value,kind)) {
    const packed=Utilities.gzip(Utilities.newBlob(raw,'text/plain')).getBytes();for(let i=4;i<8;i++)packed[i]=0;
    const compressed=Utilities.base64Encode(packed),hash=tohtoHash(compressed);
    tohtoCheckpoint();
    const blockKey='datasets/v3/'+season+'/blocks/'+hash+'.gz.b64';
    const ref=index<progress?{key:blockKey,sha256:hash,bytes:Utilities.newBlob(compressed).getBytes().length}:tohtoPut(blockKey,compressed);
    if(index>=progress) {
    const restored=Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(tohtoGet(ref.key)))).getDataAsString('UTF-8');
    if(tohtoHash(restored)!==tohtoHash(raw))throw new Error('バックアップの復元照合に失敗しました。');
    if(tohtoJob){tohtoJob.progress[progressKey]=index+1;tohtoSaveJob();}
    }
    index++;
    const count=Utilities.newBlob(raw).getBytes().length;bytes+=count;parts.push(Object.assign(ref,{rawSha256:tohtoHash(raw),rawBytes:count}));
  }
  const manifest={format:'tohto-chunks-v1',kind:kind,season:season,bytes:bytes,parts:parts};
  return Object.assign(tohtoPut(key+'.manifest.json',JSON.stringify(manifest)),{format:manifest.format,contentBytes:bytes});
}
function tohtoRead(value) {
  if(Object.prototype.hasOwnProperty.call(value,'value'))return value.value;
  const ref=value.ref,text=tohtoGet(ref.key);
  if(tohtoHash(text)!==ref.sha256)throw new Error('保存版が破損しています。');
  if(ref.format!=='tohto-chunks-v1')return text;
  const m=JSON.parse(text),out=[];let bytes=0;
  for(const p of m.parts) {
    tohtoCheckpoint();
    const compressed=tohtoGet(p.key);if(tohtoHash(compressed)!==p.sha256)throw new Error('分割データが破損しています。');
    const raw=Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(compressed))).getDataAsString('UTF-8');
    if(tohtoHash(raw)!==p.rawSha256||Utilities.newBlob(raw).getBytes().length!==p.rawBytes)throw new Error('復元したデータが一致しません。');
    out.push(raw);bytes+=p.rawBytes;
  }
  if(bytes!==m.bytes)throw new Error('保存版の容量が一致しません。');return out.join('');
}
function tohtoSchedule(delay) {
  const props=PropertiesService.getScriptProperties();props.setProperty('requested',String(Date.now()));
  if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='tohtoProcessQueue'))ScriptApp.newTrigger('tohtoProcessQueue').timeBased().after(delay||1000).create();
}
function setup() {
  const url=ScriptApp.getService().getUrl();if(!url||!url.endsWith('/exec'))throw new Error('先にウェブアプリとしてデプロイしてください。');
  tohtoCall('connect',{scriptUrl:url});
  const settings=tohtoCall('configuration'),props=PropertiesService.getScriptProperties();
  for(const source of settings.sources) {const f=Drive.Files.get(source.id,{fields:'id,mimeType',supportsAllDrives:true});if(f.mimeType!=='application/vnd.google-apps.folder')throw new Error('対象フォルダにアクセスできません。');}
  if(!props.getProperty('cursor'))props.setProperty('cursor',Drive.Changes.getStartPageToken({supportsAllDrives:true}).startPageToken);
  // Only initial setup/manual recovery scans the configured folder tree.
  props.setProperty('bootstrap',JSON.stringify(settings.sources.map(s=>({id:s.id,recursive:s.recursive,pageToken:null}))));
  props.setProperty('retry','0');renewNotification();
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='renewNotification').forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('renewNotification').timeBased().everyHours(12).create();
  tohtoSchedule();
}
function renewNotification() {
  const state=tohtoCall('configuration');if(!state.enabled)return;
  const props=PropertiesService.getScriptProperties(),previous=props.getProperty('channel'),cursor=props.getProperty('cursor');
  if(!cursor)throw new Error('setupを実行してください。');
  const id=Utilities.getUuid(),token=Utilities.getUuid()+Utilities.getUuid(),expiration=Date.now()+6*86400000;
  tohtoCall('register',{id:id,token:token,expiration:expiration});
  const channel=Drive.Changes.watch({id:id,type:'web_hook',address:ID_TOHTO_BASE+'/api/trackman/notify',token:token,expiration:String(expiration)},cursor,{supportsAllDrives:true,includeItemsFromAllDrives:true});
  tohtoCall('registered',{id:id,resourceId:channel.resourceId,expiration:Number(channel.expiration)});
  props.setProperty('channel',JSON.stringify({id:id,resourceId:channel.resourceId}));
  if(previous){try{Drive.Channels.stop(JSON.parse(previous));}catch(e){console.log('旧通知は期限切れまで保持します。');}}
}
function tohtoInSources(file,sources) {
  let parents=file.parents||[],seen={};
  for(let depth=0;parents.length&&depth<40;depth++) {
    const next=[];
    for(const id of parents) {
      if(sources.some(s=>s.id===id&&(depth===0||s.recursive)))return true;
      if(seen[id])continue;seen[id]=true;
      const folder=Drive.Files.get(id,{fields:'parents',supportsAllDrives:true});(folder.parents||[]).forEach(p=>next.push(p));
    }
    parents=next;
  }
  return false;
}
function tohtoProcessFile(f,sources) {
  if(f.trashed||!(/\.csv$/i).test(f.name)||!tohtoInSources(f,sources))return;
  const file={id:f.id,name:f.name,size:Number(f.size),modifiedTime:f.modifiedTime};
  let plan=tohtoCall('plan',{files:[file],incremental:true});if(!plan.files.length)return;
  const r=UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(f.id)+'?alt=media&supportsAllDrives=true',{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
  if(r.getResponseCode()!==200||r.getBlob().getBytes().length!==file.size)throw new Error(f.name+': CSVを完全に取得できません。');
  const latest=Drive.Files.get(f.id,{fields:'id,name,size,modifiedTime,parents,trashed',supportsAllDrives:true});
  if(latest.trashed||!tohtoInSources(latest,sources)||Number(latest.size)!==file.size||latest.modifiedTime!==file.modifiedTime)throw new Error(f.name+': 取得中に変更されました。');
  const input=r.getContentText('UTF-8');
  if(tohtoHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,r.getBlob().getBytes()))!==tohtoHash(input))throw new Error(f.name+': UTF-8として読み取れません。');
  const season=TohtoImport.inputSeason(input);plan=tohtoCall('plan',{files:[file],incremental:true,season:season});if(!plan.files.length)return;
  const props=PropertiesService.getScriptProperties(),token=file.id+'|'+file.modifiedTime+'|'+file.size;
  tohtoJob=JSON.parse(props.getProperty('job')||'null');
  if(!tohtoJob||tohtoJob.token!==token||tohtoJob.baseEtag!==plan.baseEtag) {tohtoJob={token:token,baseEtag:plan.baseEtag,id:Utilities.getUuid(),previousId:Utilities.getUuid(),createdAt:new Date().toISOString(),progress:{}};tohtoSaveJob();}
  const base={};for(const kind of (plan.active?['raw']:['raw','summary','spin']))base[kind]=tohtoRead(tohtoCall('baseline',{baseEtag:plan.baseEtag,kind:kind,season:season,reference:true}));
  const payload=TohtoImport.buildPayload(base,input,tohtoJob.createdAt);
  if(payload.unchanged)return tohtoCall('publish',{season:season,baseEtag:plan.baseEtag,files:[file],unchanged:true,report:payload.report});
  const id=tohtoJob.id,objects={};
  for(const kind of ['raw','input','summary','spin'])objects[kind]=tohtoUpload(season,id,kind,payload[kind]);
  objects.report=tohtoUpload(season,id,'report',JSON.stringify(payload.report));
  const data=JSON.parse(payload.summary);
  const body={season:season,baseEtag:plan.baseEtag,files:[file],snapshot:{id:id,season:season,objects:objects,pitchCount:data.pitches.length,gameCount:data.games.length,report:payload.report}};
  if(!plan.active&&base.raw) {
    const old=JSON.parse(base.summary),previousObjects={};
    for(const kind of ['raw','summary','spin'])previousObjects[kind]=tohtoUpload(season,tohtoJob.previousId,kind,base[kind]);
    body.previousSnapshot={id:tohtoJob.previousId,season:season,createdAt:tohtoJob.createdAt,fileName:'自動連携開始前のデータ',pitchCount:old.pitches.length,gameCount:old.games.length,report:{warnings:[]},objects:previousObjects};
  }
  for(;;){tohtoCheckpoint();const result=tohtoCall('publish',body);if(!result.verifying){props.deleteProperty('job');tohtoJob=null;return result;}}

}
function tohtoSync() {
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000)){tohtoSchedule(60000);return {ok:true,queued:true};}
  const props=PropertiesService.getScriptProperties(),started=Date.now(),requested=props.getProperty('requested');
  tohtoDeadline=started+220000;
  try {
    const settings=tohtoCall('configuration');if(!settings.enabled)return {ok:true,paused:true};
    while(Date.now()-started<240000) {
      const initial=JSON.parse(props.getProperty('bootstrap')||'[]');
      if(initial.length) {
        const folder=initial[0],page=Drive.Files.list({q:"'"+folder.id+"' in parents and trashed=false",pageSize:50,pageToken:folder.pageToken||undefined,supportsAllDrives:true,includeItemsFromAllDrives:true,fields:'nextPageToken,files(id,name,size,modifiedTime,mimeType,parents,trashed)'});
        for(const f of page.files||[]) {
          tohtoCheckpoint();
          if(f.mimeType==='application/vnd.google-apps.folder'&&folder.recursive&&!initial.some(x=>x.id===f.id))initial.push({id:f.id,recursive:true,pageToken:null});
          else tohtoProcessFile(f,settings.sources);
        }
        if(page.nextPageToken)folder.pageToken=page.nextPageToken;else initial.shift();
        props.setProperty('bootstrap',JSON.stringify(initial));continue;
      }
      const cursor=props.getProperty('cursor');if(!cursor)throw new Error('通知の開始位置がありません。setupを実行してください。');
      const page=Drive.Changes.list(cursor,{pageSize:50,supportsAllDrives:true,includeItemsFromAllDrives:true,fields:'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,size,modifiedTime,mimeType,parents,trashed))'});
      for(const change of page.changes||[]){tohtoCheckpoint();if(change.file&&!change.removed)tohtoProcessFile(change.file,settings.sources);}
      const next=page.nextPageToken||page.newStartPageToken;if(!next)throw new Error('変更履歴の続きがありません。');
      props.setProperty('cursor',next);props.setProperty('retry','0');
      if(!page.nextPageToken) {if(props.getProperty('requested')!==requested)tohtoSchedule();return {ok:true};}
    }
    tohtoSchedule(1000);return {ok:true,queued:true};
  } catch(e) {
    if(e.message==='__TOHTO_YIELD__'){tohtoSchedule(1000);return {ok:true,queued:true};}
    const message=String(e.message||e).slice(0,1000);try{tohtoCall('failure',{message:message});}catch(_){}
    const retry=Number(props.getProperty('retry')||0)+1;props.setProperty('retry',String(retry));
    if(retry<=5)tohtoSchedule(Math.min(900000,60000*Math.pow(2,retry-1)));
    return {ok:false,error:message,retry:retry};
  } finally {lock.releaseLock();}
}
function tohtoProcessQueue() {
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='tohtoProcessQueue').forEach(t=>ScriptApp.deleteTrigger(t));
  return tohtoSync();
}
function doPost(e) {
  let result;
  try {
    const body=JSON.parse(e.postData.contents),time=String(body.time);
    if(!Number.isFinite(Number(time))||Math.abs(Date.now()-Number(time))>300000||body.signature!==tohtoHmac('notify\n'+time+'\n'+String(body.channelId)))throw new Error('通知の認証に失敗しました。');
    if(body.channelId==='manual-retry')PropertiesService.getScriptProperties().setProperty('retry','0');
    tohtoSchedule();result={ok:true,queued:true};
  }catch(_){result={ok:false,error:'通知を受け付けられません。'};}
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
