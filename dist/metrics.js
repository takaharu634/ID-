(function () {
  'use strict';
  const COLORS = {Fastball:'#d92d20',FourSeamFastball:'#d92d20',Slider:'#9746aa',Sinker:'#4086eb',Curveball:'#42a878',Cutter:'#6546ed',Splitter:'#fb8500',Changeup:'#d7a500',ChangeUp:'#d7a500',Sweeper:'#59a7c7',Knuckleball:'#777e8b',Other:'#7f8795',Undefined:'#7f8795'};
  const NAMES = {Fastball:'ストレート',FourSeamFastball:'ストレート',Slider:'スライダー',Sinker:'シンカー',Curveball:'カーブ',Cutter:'カットボール',Splitter:'スプリット',Changeup:'チェンジアップ',ChangeUp:'チェンジアップ',Sweeper:'スイーパー',Knuckleball:'ナックル',Other:'その他',Undefined:'未分類'};
  const SHORT = {Fastball:'FB',FourSeamFastball:'FB',Slider:'SL',Sinker:'SI',Curveball:'CB',Cutter:'CT',Splitter:'SP',Changeup:'CH',ChangeUp:'CH',Sweeper:'SW',Knuckleball:'KN',Other:'OTH',Undefined:'—'};
  const ink='#232b36', muted='#7e8693', line='#e6e9ee', accent='#ce2938';
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const color = t => COLORS[t] || '#7f8795';
  const name = t => NAMES[t] || t || '—';
  const short = t => SHORT[t] || (t ? t.slice(0,3).toUpperCase() : '—');
  const fmt = (n,d=1,plus=false) => finite(n) ? ((plus&&n>0)?'+':'')+n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
  function tiltValue(v) {
    if (typeof v === 'string' && /\d+:\d+/.test(v)) return v;
    if (!finite(v)) return '—';
    let minutes=Math.round((((v%360)+360)%360)*2)%720;
    return String(Math.floor(minutes/60)||12).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
  }
  function rounded(ctx,x,y,w,h,r=14){ctx.beginPath();if(typeof ctx.roundRect==='function'){ctx.roundRect(x,y,w,h,r);return;}r=Math.min(r,w/2,h/2);ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();}
  function hull(points){
    if(points.length<3)return points;
    const p=points.slice().sort((a,b)=>a.x-b.x||a.y-b.y), cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
    const lo=[],hi=[];for(const a of p){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],a)<=0)lo.pop();lo.push(a);}for(let i=p.length-1;i>=0;i--){const a=p[i];while(hi.length>=2&&cross(hi[hi.length-2],hi[hi.length-1],a)<=0)hi.pop();hi.push(a);}return lo.slice(0,-1).concat(hi.slice(0,-1));
  }
  window.drawMetrics = function(canvas,pitcher,activeType,selectedPitch=null) {
    if(!canvas || !pitcher) return;
    canvas.width=1800;canvas.height=1100;
    const ctx=canvas.getContext('2d');
    const summaries=pitcher.summary||[];
    const selected=summaries.find(s=>s.type===activeType)||summaries[0]||{type:activeType,n:0,metrics:{}};
    activeType=selected.type;
    const metric=selectedPitch||selected.metrics||{};
    const pitches=(pitcher.pitches||[]).filter(p=>p.type===activeType);
    const reportColor=color(activeType);
    const text=(v,x,y,size=22,weight=400,c=ink,align='left')=>{ctx.fillStyle=c;ctx.font=`${weight} ${size}px NotoLocal, 'Noto Sans CJK JP', sans-serif`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(String(v),x,y);};
    const clipped=(v,x,y,max,size=22,weight=400,c=ink)=>{ctx.save();ctx.beginPath();ctx.rect(x,y-size,max,size*2);ctx.clip();text(v,x,y,size,weight,c);ctx.restore();};
    const panel=(x,y,w,h,r=14,bg='#fff')=>{rounded(ctx,x,y,w,h,r);ctx.fillStyle=bg;ctx.fill();ctx.strokeStyle=line;ctx.lineWidth=1;ctx.stroke();};
    const dot=(x,y,r,c)=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=c;ctx.fill();};
    const card=(x,y,w,h,label,value,unit='',opts={})=>{
      panel(x,y,w,h,12);
      ctx.save();rounded(ctx,x+1,y+1,w-2,37,11);ctx.clip();ctx.fillStyle='#f5f6f8';ctx.fillRect(x+1,y+1,w-2,37);ctx.restore();
      text(label,x+w/2,y+20,18,500,muted,'center');
      const valueY=opts.note?y+78:y+81;
      const vs=opts.small?43:47;
      ctx.font=`600 ${vs}px NotoLocal, sans-serif`; const vw=ctx.measureText(value).width;
      ctx.font='500 16px NotoLocal, sans-serif'; const uw=unit?ctx.measureText(unit).width:0;
      const start=x+(w-vw-(unit?uw+8:0))/2;
      text(value,start,valueY,vs,600,opts.missing?'#a5adb8':ink,'left');
      if(unit)text(unit,start+vw+8,valueY+13,16,500,muted,'left');
      if(opts.note)text(opts.note,x+w/2,y+h-17,14,400,muted,'center');
    };
    ctx.fillStyle='#f5f6f8';ctx.fillRect(0,0,1800,1100);
    ctx.fillStyle='#fff';ctx.fillRect(0,0,1800,118);
    ctx.fillStyle=accent;ctx.fillRect(28,28,5,63);
    text('ID東都',49,37,20,700,accent);
    text('PITCH REPORT',138,37,17,600,muted);
    const playerName=pitcher.name||pitcher.id||'投手';
    text(playerName,49,78,37,700);
    ctx.font="700 37px NotoLocal, sans-serif";const nw=ctx.measureText(playerName).width;
    const throwName=/Left|左/i.test(pitcher.throws||'')?'左投':'右投';
    text(`${pitcher.team||''}  /  ${throwName}`,65+nw,83,18,500,muted);
    text(pitcher.seasonLabel||'2026春',1768,36,21,600,ink,'right');
    text('TrackMan 測定値',1768,69,18,400,muted,'right');
    const mode=selectedPitch?'1球の測定値':'球種別平均';
    panel(1326,79,442,25,9,'#f9f0f1');
    text(`${name(activeType)}  ·  ${mode}`,1547,92,15,600,accent,'center');

    // Pitch selector. Active pitch retains the red/white hierarchy of the supplied reference.
    panel(28,140,95,640,14);
    const selectorH=Math.min(93,626/Math.max(1,summaries.length));
    summaries.forEach((s,i)=>{
      const y=147+i*selectorH,active=s.type===activeType;
      if(active){rounded(ctx,34,y,83,selectorH-5,10);ctx.fillStyle=color(s.type);ctx.fill();}
      text(short(s.type),75.5,y+selectorH*.34,25,700,active?'#fff':ink,'center');
      const sn=name(s.type),fs=sn.length>6?11:12;
      text(sn,75.5,y+selectorH*.65,fs,500,active?'#fff':muted,'center');
    });

    card(141,140,246,118,'投球数',fmt(selected.n,0),'球');
    card(400,140,246,118,selectedPitch?'球速':'平均球速',fmt(metric.velocity,1),'km/h');
    card(659,140,246,118,selectedPitch?'回転数':'平均回転数',fmt(metric.spin,0),'rpm');
    panel(141,274,764,506,16);
    text('球種別の縦横変化量',163,301,22,600);
    text('投手視点 / cm',883,301,15,500,muted,'right');
    const plot={x:196,y:351,w:377,h:342};
    const allMv=summaries.filter(s=>finite(s.metrics?.hb)&&finite(s.metrics?.ivb));
    const extent=Math.max(70,...allMv.flatMap(s=>[Math.abs(s.metrics.hb)+10,Math.abs(s.metrics.ivb)+10]),...(selectedPitch?[metric.hb,metric.ivb].filter(finite).map(v=>Math.abs(v)+10):[]));
    const limit=Math.ceil(extent/10)*10, mapX=n=>plot.x+(n+limit)/(2*limit)*plot.w,mapY=n=>plot.y+(limit-n)/(2*limit)*plot.h;
    // Equal units on x/y are preserved using a square physical plotting region.
    plot.w=342;
    const qticks=[-limit,-limit/2,0,limit/2,limit];
    qticks.forEach(v=>{
      ctx.beginPath();ctx.moveTo(mapX(v),plot.y);ctx.lineTo(mapX(v),plot.y+plot.h);ctx.moveTo(plot.x,mapY(v));ctx.lineTo(plot.x+plot.w,mapY(v));ctx.strokeStyle=v===0?'#c6ccd5':'#e9ecf0';ctx.lineWidth=v===0?1.4:1;ctx.stroke();
      text(fmt(v,0),mapX(v),plot.y+plot.h+22,15,400,muted,'center');
      text(fmt(v,0),plot.x-13,mapY(v),15,400,muted,'right');
    });
    text('横変化',plot.x+plot.w/2,plot.y+plot.h+50,16,500,muted,'center');
    ctx.save();ctx.translate(160,plot.y+plot.h/2);ctx.rotate(-Math.PI/2);text('縦変化',0,0,16,500,muted,'center');ctx.restore();
    const meanPts=allMv.map(s=>({x:mapX(s.metrics.hb),y:mapY(s.metrics.ivb),s}));
    const polygon=hull(meanPts);if(polygon.length>=3){ctx.beginPath();polygon.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle='#3341550c';ctx.fill();ctx.strokeStyle='#b6bcc580';ctx.lineWidth=1.2;ctx.stroke();}
    ctx.save();ctx.beginPath();ctx.rect(plot.x,plot.y,plot.w,plot.h);ctx.clip();
    const stride=Math.max(1,Math.ceil(pitches.length/450));pitches.forEach((p,i)=>{if(i%stride===0&&finite(p.hb)&&finite(p.ivb))dot(mapX(p.hb),mapY(p.ivb),2.4,reportColor+'24');});
    ctx.restore();
    const placed=[];
    meanPts.forEach(p=>{
      if(p.s.type===activeType){ctx.beginPath();ctx.arc(p.x,p.y,12,0,Math.PI*2);ctx.strokeStyle=color(p.s.type)+'66';ctx.lineWidth=6;ctx.stroke();}
      dot(p.x,p.y,7.4,color(p.s.type));
      const label=short(p.s.type);ctx.font='700 17px NotoLocal,sans-serif';const lw=ctx.measureText(label).width;
      const candidates=[[12,-14],[12,18],[-lw-12,-14],[-lw-12,18],[0,-30],[0,32]];
      const score=(dx,dy)=>{const b={x:p.x+dx-3,y:p.y+dy-12,w:lw+6,h:24};let v=0;for(const a of placed)if(b.x<a.x+a.w&&b.x+b.w>a.x&&b.y<a.y+a.h&&b.y+b.h>a.y)v+=100;for(const q of meanPts)if(q!==p&&q.x>b.x-5&&q.x<b.x+b.w+5&&q.y>b.y-5&&q.y<b.y+b.h+5)v+=20;if(b.x<plot.x||b.x+b.w>plot.x+plot.w||b.y<plot.y||b.y+b.h>plot.y+plot.h)v+=100;return [v,b];};
      const chosen=candidates.map(([dx,dy],i)=>({dx,dy,i,sc:score(dx,dy)})).sort((a,b)=>a.sc[0]-b.sc[0]||a.i-b.i)[0];placed.push(chosen.sc[1]);
      ctx.textAlign='left';ctx.textBaseline='middle';ctx.lineWidth=4;ctx.strokeStyle='#fff';ctx.strokeText(label,p.x+chosen.dx,p.y+chosen.dy);text(label,p.x+chosen.dx,p.y+chosen.dy,17,700,color(p.s.type),'left');
    });
    if(selectedPitch&&finite(metric.hb)&&finite(metric.ivb)){
      const px=mapX(metric.hb),py=mapY(metric.ivb);ctx.beginPath();ctx.arc(px,py,11,0,Math.PI*2);ctx.strokeStyle=ink;ctx.lineWidth=2;ctx.stroke();ctx.beginPath();ctx.moveTo(px-15,py);ctx.lineTo(px+15,py);ctx.moveTo(px,py-15);ctx.lineTo(px,py+15);ctx.stroke();
    }
    // Catcher-facing plate chart, separate from pitcher-facing movement chart.
    ctx.beginPath();ctx.moveTo(590,327);ctx.lineTo(590,756);ctx.strokeStyle=line;ctx.lineWidth=1;ctx.stroke();
    text('投球位置',744,344,20,600,ink,'center');
    text('捕手視点',744,371,14,500,muted,'center');
    const zone={x:653.375,y:408,w:180.25,h:206};
    const zx=v=>zone.x+zone.w/2+v/0.7*(zone.w/2),zy=v=>zone.y+zone.h-v/1.6*zone.h;
    ctx.strokeStyle='#d6dbe3';ctx.lineWidth=1;ctx.strokeRect(zone.x,zone.y,zone.w,zone.h);
    [0.5,1,1.5].forEach(v=>{ctx.beginPath();ctx.moveTo(zone.x,zy(v));ctx.lineTo(zone.x+zone.w,zy(v));ctx.strokeStyle='#edf0f3';ctx.stroke();});
    ctx.beginPath();ctx.moveTo(zx(0),zone.y);ctx.lineTo(zx(0),zone.y+zone.h);ctx.setLineDash([3,4]);ctx.strokeStyle='#d4d9e1';ctx.stroke();ctx.setLineDash([]);
    const zLeft=zx(-0.2159),zRight=zx(0.2159),zTop=zy(1.10),zBottom=zy(0.50);
    ctx.fillStyle='#e8ebef88';ctx.fillRect(zLeft,zTop,zRight-zLeft,zBottom-zTop);ctx.strokeStyle='#666f7d';ctx.lineWidth=1.8;ctx.strokeRect(zLeft,zTop,zRight-zLeft,zBottom-zTop);
    for(let i=1;i<3;i++){ctx.beginPath();ctx.moveTo(zLeft+(zRight-zLeft)*i/3,zTop);ctx.lineTo(zLeft+(zRight-zLeft)*i/3,zBottom);ctx.moveTo(zLeft,zTop+(zBottom-zTop)*i/3);ctx.lineTo(zRight,zTop+(zBottom-zTop)*i/3);ctx.strokeStyle='#8d95a2';ctx.lineWidth=1;ctx.stroke();}
    ctx.save();ctx.beginPath();ctx.rect(zone.x,zone.y,zone.w,zone.h);ctx.clip();pitches.forEach((p,i)=>{if(i%stride===0&&finite(p.plateSide)&&finite(p.plateHeight))dot(zx(-p.plateSide),zy(p.plateHeight),3.2,reportColor+'45');});
    if(selectedPitch&&finite(metric.plateSide)&&finite(metric.plateHeight)){dot(zx(-metric.plateSide),zy(metric.plateHeight),7,reportColor);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();}ctx.restore();
    ctx.beginPath();ctx.moveTo(729,624);ctx.lineTo(759,624);ctx.lineTo(764,637);ctx.lineTo(744,648);ctx.lineTo(724,637);ctx.closePath();ctx.fillStyle=accent;ctx.fill();
    text('参考ゾーン：高さ 0.50–1.10 m',744,666,12,400,muted,'center');
    const smallStat=(cx,label,value)=>{text(label,cx,701,15,500,muted,'center');text(value,cx,736,31,700,ink,'center');};
    smallStat(670,'横変化 / cm',fmt(metric.hb,1,true));smallStat(812,'縦変化 / cm',fmt(metric.ivb,1,true));

    text('投球データ',934,147,20,700,accent);
    text(selectedPitch?'選択した投球':'選択した球種の平均',1768,147,15,400,muted,'right');
    const gx=929,gy=177,gw=839,gap=12,cw=(gw-gap*2)/3,ch=141;
    const cards=[
      ['最高球速',fmt(selected.maxVelocity,1),'km/h'],
      ['回転方向',tiltValue(selectedPitch?metric.tilt:(selected.tilt??metric.tilt)),'',{small:true}],
      ['縦の入射角 / VAA',fmt(metric.vaa,1),'°'],
      ['ジャイロ角','—','',{missing:true,note:'CSV未収録'}],
      ['回転効率','—','',{missing:true,note:'CSV未収録'}],
      ['トゥルースピン','—','',{missing:true,note:'CSV未収録'}],
      ['横のリリース角度',fmt(metric.horzRelAngle,1),'°'],
      ['縦のリリース角度',fmt(metric.vertRelAngle,1),'°'],
      ['リリース高さ',fmt(metric.releaseHeight,2),'m'],
      ['リリースサイド',fmt(metric.releaseSide,2,true),'m'],
      ['エクステンション',fmt(metric.extension,2),'m'],
      ['横の入射角 / HAA',fmt(metric.haa,1),'°']
    ];
    cards.forEach((a,i)=>card(gx+(i%3)*(cw+gap),gy+Math.floor(i/3)*(ch+gap),cw,ch,...a));

    // Table: values always show pitch-type means; selected single pitch does not change these rows.
    text('球種別サマリー',29,812,22,700);
    text('変化量：cm  /  リリース・Ext：m  /  角度：°',1768,812,15,400,muted,'right');
    const tx=28,ty=836,tw=1740,tableHeight=224;
    panel(tx,ty,tw,tableHeight,13);
    const weights=[177,66,128,128,137,131,131,112,126,126,126,116,116],sum=weights.reduce((a,b)=>a+b,0),ws=weights.map(w=>w/sum*tw);
    const labels=['球種','球数','平均球速','最高球速','回転数','縦変化','横変化','回転方向','高さ','横位置','Ext','VAA','HAA'];
    const nrows=Math.max(1,summaries.length),rh=(tableHeight-38)/nrows;
    ctx.save();rounded(ctx,tx,ty,tw,tableHeight,13);ctx.clip();ctx.fillStyle='#eceff3';ctx.fillRect(tx,ty,tw,38);
    let cx=tx;labels.forEach((s,i)=>{text(s,i===0?cx+20:cx+ws[i]/2,ty+19,16,600,muted,i===0?'left':'center');cx+=ws[i];});
    summaries.forEach((s,i)=>{
      const yy=ty+38+i*rh,active=s.type===activeType,m=s.metrics||{};
      if(active){ctx.fillStyle=color(s.type)+'0b';ctx.fillRect(tx,yy,tw,rh);}else if(i%2){ctx.fillStyle='#fafbfc';ctx.fillRect(tx,yy,tw,rh);}
      ctx.fillStyle=color(s.type);ctx.fillRect(tx,yy,5,rh);
      const vals=[`${short(s.type)}  ${name(s.type)}`,fmt(s.n,0),fmt(m.velocity,1),fmt(s.maxVelocity,1),fmt(m.spin,0),fmt(m.ivb,1,true),fmt(m.hb,1,true),tiltValue(s.tilt??m.tilt),fmt(m.releaseHeight,2),fmt(m.releaseSide,2,true),fmt(m.extension,2),fmt(m.vaa,1),fmt(m.haa,1)];
      let xx=tx;vals.forEach((v,j)=>{const fontSize=Math.min(j===0?16:18,rh*.62);text(v,j===0?xx+20:xx+ws[j]/2,yy+rh/2,fontSize,j===0||active?600:500,j===0?color(s.type):ink,j===0?'left':'center');xx+=ws[j];});
      ctx.beginPath();ctx.moveTo(tx,yy+rh);ctx.lineTo(tx+tw,yy+rh);ctx.strokeStyle=line;ctx.lineWidth=1;ctx.stroke();
    });ctx.restore();
    text('回転方向：TrackMan Tilt（平均は循環平均）',29,1081,13,400,muted);
    text('ID東都  |  TRACKMAN PITCHING',1768,1081,13,600,muted,'right');
  };
  window.drawMovementChart = function(canvas,pitcher) {
    canvas.width=1500;canvas.height=1300;const ctx=canvas.getContext('2d');
    const text=(v,x,y,size=24,weight=400,c=ink,align='left')=>{ctx.fillStyle=c;ctx.font=`${weight} ${size}px NotoLocal, sans-serif`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(String(v),x,y);};
    const summary=pitcher.summary||[],valid=summary.filter(s=>finite(s.metrics?.hb)&&finite(s.metrics?.ivb));
    ctx.fillStyle='#fff';ctx.fillRect(0,0,1500,1300);
    ctx.fillStyle=accent;ctx.fillRect(48,42,6,78);text('ID東都  /  '+(pitcher.seasonLabel||'2026春'),74,56,20,700,accent);text(`${pitcher.name}  球種別変化量`,74,101,38,700);text(`${pitcher.team} · 投手視点`,1446,99,22,500,muted,'right');
    const plot={x:151,y:210,w:940,h:940},limit=Math.ceil(Math.max(70,...valid.flatMap(s=>[Math.abs(s.metrics.hb)+10,Math.abs(s.metrics.ivb)+10]))/10)*10;
    const x=v=>plot.x+(v+limit)/(limit*2)*plot.w,y=v=>plot.y+(limit-v)/(limit*2)*plot.h;
    [-limit,-limit*.75,-limit/2,-limit*.25,0,limit*.25,limit/2,limit*.75,limit].forEach(v=>{ctx.beginPath();ctx.moveTo(x(v),plot.y);ctx.lineTo(x(v),plot.y+plot.h);ctx.moveTo(plot.x,y(v));ctx.lineTo(plot.x+plot.w,y(v));ctx.strokeStyle=v===0?'#aeb6c3':'#e8ebef';ctx.lineWidth=v===0?2:1;ctx.stroke();if(v===0||Math.abs(v)===limit||Math.abs(v)===limit/2){text(fmt(v,0),x(v),plot.y+plot.h+35,24,500,muted,'center');text(fmt(v,0),plot.x-23,y(v),24,500,muted,'right');}});
    text('横の変化量（cm）',plot.x+plot.w/2,1232,26,600,muted,'center');ctx.save();ctx.translate(53,plot.y+plot.h/2);ctx.rotate(-Math.PI/2);text('縦の変化量（cm）',0,0,26,600,muted,'center');ctx.restore();
    const pts=valid.map(s=>({x:x(s.metrics.hb),y:y(s.metrics.ivb),s}));const poly=hull(pts);if(poly.length>=3){ctx.beginPath();poly.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle='#63718515';ctx.fill();ctx.strokeStyle='#b1bac5';ctx.lineWidth=2;ctx.stroke();}
    const placed=[];pts.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,13,0,Math.PI*2);ctx.fillStyle=color(p.s.type);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();
      const label=p.s.type==='Undefined'?'未分類':short(p.s.type);ctx.font='700 25px NotoLocal,sans-serif';const lw=ctx.measureText(label).width;const candidates=[[20,-20],[20,26],[-lw-20,-20],[-lw-20,26],[0,-46],[0,48]];const score=(dx,dy)=>{const b={x:p.x+dx-5,y:p.y+dy-18,w:lw+10,h:36};let v=0;for(const a of placed)if(b.x<a.x+a.w&&b.x+b.w>a.x&&b.y<a.y+a.h&&b.y+b.h>a.y)v+=100;for(const q of pts)if(q!==p&&q.x>b.x-10&&q.x<b.x+b.w+10&&q.y>b.y-10&&q.y<b.y+b.h+10)v+=30;if(b.x<plot.x||b.x+b.w>plot.x+plot.w||b.y<plot.y||b.y+b.h>plot.y+plot.h)v+=100;return[v,b];};const chosen=candidates.map(([dx,dy],i)=>({dx,dy,i,sc:score(dx,dy)})).sort((a,b)=>a.sc[0]-b.sc[0]||a.i-b.i)[0];placed.push(chosen.sc[1]);ctx.textAlign='left';ctx.textBaseline='middle';ctx.lineWidth=6;ctx.strokeStyle='#fff';ctx.strokeText(label,p.x+chosen.dx,p.y+chosen.dy);text(label,p.x+chosen.dx,p.y+chosen.dy,25,700,color(p.s.type));
    });
    text('球種別平均',1158,222,23,700);summary.forEach((s,i)=>{const yy=277+i*88;ctx.beginPath();ctx.arc(1170,yy,9,0,Math.PI*2);ctx.fillStyle=color(s.type);ctx.fill();text(`${short(s.type)}  ${name(s.type)}`,1190,yy,18,600);text(`縦 ${fmt(s.metrics?.ivb,1,true)}  /  横 ${fmt(s.metrics?.hb,1,true)}`,1190,yy+29,17,400,muted);});
    text('縦変化量：InducedVertBreak   横変化量：HorzBreak',74,1273,16,400,muted);text('TrackMan / CSV収録球種',1446,1273,16,400,muted,'right');
  };
})();
