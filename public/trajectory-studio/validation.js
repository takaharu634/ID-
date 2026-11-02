(function(root){
 'use strict';
 if(new URLSearchParams(location.search).get('validation')!=='1')return;
 const $=id=>document.getElementById(id);let videoTime=0,legacyReady=false,blind=false,trial=null,raf=null,video=null,videoUrl=null,videoCamera=null,videoPitch=null,videoRaf=null,release=null,firstVisible=null,cleanConfirmed=false,mode='reconstruction',seamExposure=0,seamVariant=0,answers=[];
 const panel=document.createElement('details');panel.id='validationPanel';panel.style.cssText='position:fixed;bottom:8px;left:8px;max-width:450px;max-height:85vh;overflow:auto;z-index:1000;background:white;border:1px solid #bbc5cf;padding:10px;border-radius:8px';
 panel.innerHTML=`<summary>開発用の検証</summary><p>通常メニューには表示しません。記録はこの端末からJSONで保存できます。</p><label>縫い目の時間平均 <select id="seamExposure"><option value="0">なし（本番）</option><option value="0.004166667">1/240秒</option><option value="0.008333333">1/120秒</option></select></label><label>例示姿勢 <input id="seamVariant" type="number" min="0" max="9" value="0"></label><button id="exportFrames">直近再生の検査記録</button><hr><label>遮断 <select id="trialCut"><option value=".1">100ms</option><option value=".15" selected>150ms</option><option value=".2">200ms</option></select></label><button id="blindStart">条件を伏せて比較（18回）</button><button id="exportTrials">回答記録を保存</button><hr><label>投手動画 <input id="videoFile" type="file" accept="video/*"></label><video id="referenceVideo" controls playsinline style="width:100%"></video><label>記録fps <input id="videoFps" type="number" min="1" max="240" value="60"></label><button id="videoPrevious">1コマ戻す</button><button id="videoNext">1コマ進める</button><button id="markRelease">この時刻をリリースに</button><button id="markVisible">この時刻を最初の可視球に</button><p id="videoMarks"></p><label>対応する実投球 <select id="videoPitch"></select></label><button id="refreshVideoPitches">選択投手の全投球を表示</button><label>撮影カメラと独立した6点以上の対応点JSON<textarea id="videoCalibration" rows="5" style="width:100%" placeholder='{"eye":[0,1.5,-2],"target":[0,1.8,16],"focal":1000,"width":1920,"height":1080,"principalPoint":[960,540],"checks":[{"world":[0,0,0],"pixel":[960,900]}]}'></textarea></label><button id="applyVideoCamera">対応点の誤差を検査</button><label><input id="cleanConfirmed" type="checkbox">元映像の実球を処理済み、二重表示がないことを確認</label><label>表示 <select id="videoMode"><option value="reconstruction">再現表示</option><option value="source">元映像</option><option value="composite">同期した合成</option></select></label><button id="playSynced">元のテンポで同期再生</button><button id="detachVideo">動画を解除</button><button id="exportVideo">同期設定を保存</button><p id="validationStatus" role="status"></p>`;
 document.body.append(panel);video=$('referenceVideo');
 const status=t=>$('validationStatus').textContent=t;
 const save=(data,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const loadScript=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.append(s);});
 async function legacy(){if(legacyReady)return;await loadScript('validation/legacy-baseball.js?v=baseline-v3');await loadScript('validation/legacy-scene.js?v=baseline-v3');legacyReady=true;}
 function shuffle(items){const data=items.slice();for(let i=data.length-1;i>0;i--){const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);const j=bytes[0]%(i+1);[data[i],data[j]]=[data[j],data[i]];}return data;}
 const screen=document.createElement('div');screen.id='blindScreen';screen.hidden=true;screen.style.cssText='position:fixed;inset:0;z-index:2000;background:#1a1e22;display:none;align-items:center;justify-content:center;flex-direction:column;color:white;';
 screen.innerHTML='<canvas id="trialCanvas"></canvas><form id="trialAnswer" hidden><label>球種の予測 <input id="answerType" required autocomplete="off"></label><label>到達位置の予測 <input id="answerLocation" required autocomplete="off" placeholder="例：外角低め"></label><button>回答を確定</button></form><p id="trialStatus"></p><button id="cancelTrials">比較を中断</button>';
 document.body.append(screen);
 function cancelTrials(reason='比較を中断しました'){
  if(raf!==null)cancelAnimationFrame(raf);raf=null;trial=null;blind=false;screen.hidden=true;screen.style.display='none';document.querySelectorAll('[data-blind-inert]').forEach(e=>{e.inert=false;e.style.visibility='';delete e.dataset.blindInert;});status(reason);
 }
 function nextTrial(queue,options){
  if(!queue.length){cancelTrials('比較終了。回答記録を保存すると条件と正解を確認できます。');return;}
  const entry=queue.shift(),canvas=$('trialCanvas');trial={...entry};$('trialAnswer').hidden=true;$('trialStatus').textContent='準備中';canvas.hidden=true;
  const render=entry.condition==='baseline'?root.drawLegacyTrajectory:root.drawTrajectory;
  const settings={...options,seamExposure:entry.condition==='filtered'?1/240:0,seamVariant:entry.variant,progress:0};
  const diag=root.createPitchDiagnostics({pitchId:entry.pitch.id,condition:entry.condition,variant:entry.variant,cut:entry.cut,settings});
  render(canvas,entry.pitcher,[entry.pitch],settings);let start=null;
  raf=requestAnimationFrame(function frame(now){
   if(!blind)return;if(document.hidden){cancelTrials('タブが非表示になったため比較を中断しました');return;}
   if(start===null){start=now;canvas.hidden=false;}const elapsed=Math.min(entry.cut,(now-start)/1000),before=performance.now();
   const result=render(canvas,entry.pitcher,[entry.pitch],{...settings,progress:elapsed/(entry.pitch.flightEndTime??entry.pitch.time)});
   diag.record(result,now,performance.now()-before,false);$('trialStatus').textContent='';
   if(elapsed<entry.cut){raf=requestAnimationFrame(frame);return;}
   raf=null;canvas.hidden=true;$('trialAnswer').hidden=false;$('trialStatus').textContent='見えた球の球種と到達位置を回答してください';$('answerType').value='';$('answerLocation').value='';$('answerType').focus();
   $('trialAnswer').onsubmit=event=>{event.preventDefault();const report=diag.report();answers.push({pitchId:entry.pitch.id,condition:entry.condition,variant:entry.variant,cut:entry.cut,cohort:entry.cohort,answerType:$('answerType').value,answerLocation:$('answerLocation').value,actual:{type:entry.pitch.type,velocity:entry.pitch.velocity,plate:root.pitchPosition(entry.pitch,entry.pitch.time)},quality:report,completed:true});nextTrial(queue,options);};
  });
 }
 root.StudioValidation={
  isBlind:()=>blind,transportLocked:()=>mode!=='reconstruction',
  renderer:()=>null,
  renderOptions:()=>({seamExposure,seamVariant,...(mode!=='reconstruction'&&videoCamera&&video.readyState>=2?{videoCamera,videoFrame:video,foregroundMasks:(videoCamera.occlusionMasks||[]).filter(m=>m.pitchId===videoPitch&&videoTime>=m.start&&videoTime<=m.end&&m.ballBehindBodyConfirmed===true),isOccluded:(p,t)=>mode==='source'||p.id!==videoPitch||firstVisible===null||videoTime<firstVisible||t<firstVisible-release}: {})}),
  afterRender:()=>{},
 };
 $('seamExposure').onchange=()=>{root.StudioAdapter.stop();seamExposure=Number($('seamExposure').value);root.StudioAdapter.repaint();};
 $('seamVariant').onchange=()=>{root.StudioAdapter.stop();seamVariant=Math.max(0,Math.min(9,Math.round(Number($('seamVariant').value)||0)));root.StudioAdapter.repaint();};
 $('exportFrames').onclick=()=>save(root.StudioAdapter.diagnostics()||{error:'先に投球を再生してください'},'trajectory-frames.json');
 $('exportTrials').onclick=()=>save({version:1,trials:answers,interpretation:'描画間隔の不良は比較から除外。見え方が肉眼と一致したことの証明ではありません。'},'trajectory-trials.json');
 $('cancelTrials').onclick=()=>cancelTrials();
 $('blindStart').onclick=async()=>{
  try{
   root.StudioAdapter.stop();if(mode!=='reconstruction')throw new Error('動画を解除してから表示条件を比較してください');await legacy();
   const state=root.StudioAdapter.getState();if(!state.current)throw new Error('投手を選んでください');
   const cut=Number($('trialCut').value),pool=shuffle(state.current.pitches.filter(p=>p.validTrajectory&&(p.flightEndTime??p.time)>cut));
   if(pool.length<10)throw new Error('同一球の比較と未見球を使うため、10球以上の軌道が必要です');
   const conditions=['baseline','improved','filtered'];
   const options={...root.StudioAdapter.renderOptions(),realism:true,showPaths:false,ballSizeAid:false,gazeMode:'release',compact:true};
   const original=$('trajectory'),canvas=$('trialCanvas');canvas.width=original.width;canvas.height=original.height;canvas.style.cssText=`width:${state.result.width}px;height:${state.result.height}px;`;
   options.pixelRatio=original.width/state.result.width;
   const paired=pool.slice(0,4).flatMap((pitch,i)=>conditions.map(condition=>({condition,pitch,pitcher:state.current,cut,variant:i%2,cohort:'paired'})));
   const holdout=pool.slice(4,10).map((pitch,i)=>({condition:conditions[i%3],pitch,pitcher:state.current,cut,variant:i%2,cohort:'holdout'}));
   const queue=shuffle([...paired,...holdout]);
   blind=true;document.querySelectorAll('body > :not(#blindScreen):not(script)').forEach(e=>{e.inert=true;e.dataset.blindInert='1';e.style.visibility='hidden';});screen.hidden=false;screen.style.display='flex';nextTrial(queue,options);
  }catch(error){status(error.message);}
 };
 function stopVideo(){video.pause();if(videoRaf!==null){if(video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(videoRaf);else cancelAnimationFrame(videoRaf);}videoRaf=null;}
 function detach(){stopVideo();mode='reconstruction';$('videoMode').value=mode;video.removeAttribute('src');video.load();if(videoUrl)URL.revokeObjectURL(videoUrl);videoUrl=null;videoCamera=null;release=null;firstVisible=null;videoPitch=null;cleanConfirmed=false;$('cleanConfirmed').checked=false;root.StudioAdapter.repaint();}
 $('videoFile').onchange=()=>{detach();const file=$('videoFile').files[0];if(!file)return;videoUrl=URL.createObjectURL(file);video.src=videoUrl;status('元映像を確認し、実投球・リリース・最初の可視球・撮影カメラを指定してください。自動抽出は行いません。');};
 for(const [id,sign]of [['videoPrevious',-1],['videoNext',1]])$(id).onclick=()=>{stopVideo();const fps=Number($('videoFps').value);if(fps>0)video.currentTime=Math.max(0,Math.min(video.duration||0,video.currentTime+sign/fps));};
 const marks=()=>$('videoMarks').textContent=`リリース ${release===null?'未設定':release.toFixed(4)+'s'} / 初めて見える球 ${firstVisible===null?'未設定':firstVisible.toFixed(4)+'s'}`;
 $('markRelease').onclick=()=>{stopVideo();release=video.currentTime;marks();};$('markVisible').onclick=()=>{stopVideo();firstVisible=video.currentTime;marks();};
 $('refreshVideoPitches').onclick=()=>{const ps=root.StudioAdapter.getState().current?.pitches||[];$('videoPitch').replaceChildren();for(const p of ps.filter(p=>p.validTrajectory)){const o=document.createElement('option');o.value=p.id;o.textContent=`${p.date} #${p.pitchNo} ${p.type} ${p.velocity?.toFixed(1)}km/h`;$('videoPitch').append(o);}videoPitch=$('videoPitch').value;};$('videoPitch').onchange=()=>videoPitch=$('videoPitch').value;
 $('applyVideoCamera').onclick=()=>{try{const calibration=root.validateVideoCalibration(JSON.parse($('videoCalibration').value));if(Math.abs(calibration.width/calibration.height-video.videoWidth/video.videoHeight)>.001)throw new Error('撮影カメラの映像寸法と元動画の比率が一致しません');if(calibration.reprojectionMaxPx>3)throw new Error(`対応点の最大誤差 ${calibration.reprojectionMaxPx.toFixed(2)}px。同期表示の基準3pxを超えています。撮影カメラを再校正してください`);videoCamera=calibration;status(`対応点のRMS誤差 ${calibration.reprojectionRmsPx.toFixed(2)}px、最大 ${calibration.reprojectionMaxPx.toFixed(2)}px。単眼の位置合わせであり、肉眼一致の証明ではありません。`);}catch(error){videoCamera=null;status(error.message);}};
 $('cleanConfirmed').onchange=()=>{cleanConfirmed=$('cleanConfirmed').checked;if(!cleanConfirmed&&mode==='composite'){mode='reconstruction';$('videoMode').value=mode;stopVideo();root.StudioAdapter.repaint();}};
 $('videoMode').onchange=()=>{stopVideo();const requested=$('videoMode').value;if(requested!=='reconstruction'&&(!videoCamera||release===null||firstVisible===null||firstVisible<release||!videoPitch)||(requested==='composite'&&!cleanConfirmed)){mode='reconstruction';$('videoMode').value=mode;status('実投球、撮影カメラ、リリースと可視時刻を確認してください。合成には元映像の実球の処理確認も必要です。');return;}mode=requested;root.StudioAdapter.repaint();};
 $('playSynced').onclick=async()=>{try{
  stopVideo();root.StudioAdapter.stop();if(mode==='reconstruction'||!videoCamera||release===null||firstVisible===null)throw new Error('同期表示の設定を先に確認してください');
  const p=root.StudioAdapter.getState().current?.pitches.find(p=>p.id===videoPitch);if(!p)throw new Error('対応する投球が見つかりません');
  root.StudioAdapter.selectOnly(p);root.StudioAdapter.setRealism();video.playbackRate=1;video.currentTime=Math.max(0,release-1.5);
  const sync=(_now,metadata)=>{const mediaTime=metadata?.mediaTime??video.currentTime,t=mediaTime-release;videoTime=mediaTime;root.StudioAdapter.renderAt(Math.max(0,t));if(t>=(p.flightEndTime??p.time)){stopVideo();status('測定区間終了。元動画のテンポは変更していません。');return;}videoRaf=video.requestVideoFrameCallback?video.requestVideoFrameCallback(sync):requestAnimationFrame(sync);};
  await video.play();videoRaf=video.requestVideoFrameCallback?video.requestVideoFrameCallback(sync):requestAnimationFrame(sync);
 }catch(error){status(error.message);}};
 $('detachVideo').onclick=detach;
 $('exportVideo').onclick=()=>save({pitchId:videoPitch,releaseTime:release,firstVisibleTime:firstVisible,fps:Number($('videoFps').value),releaseUncertaintySeconds:1/Number($('videoFps').value),camera:videoCamera,cleanBallConfirmed:cleanConfirmed,playbackRate:1,note:'可視時刻は元映像の確認値。身体マスクは撮影カメラJSONのocclusionMasksに実測区間・polygon・pitchId・ballBehindBodyConfirmed:trueを記録した場合のみ利用。元の実球除去・自動抽出は未実装。動画は送信せずこの端末内で使用。'},'trajectory-video-sync.json');
 document.addEventListener('visibilitychange',()=>{if(document.hidden){stopVideo();if(blind)cancelTrials('タブが非表示になったため比較を中断しました');}});
 window.addEventListener('pagehide',()=>{stopVideo();if(videoUrl)URL.revokeObjectURL(videoUrl);});
})(window);
