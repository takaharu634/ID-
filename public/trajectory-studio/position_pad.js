(function(){
  'use strict';
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const rounded=value=>Math.round(value*100)/100;
  const sign=view=>view==='left'?-1:1;
  const safe=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
  const normalized=(settings,view)=>({
    side:clamp(safe(settings?.side,.5),view==='catcher'?-2:0,2),
    forward:clamp(safe(settings?.forward,-.1),-3,view==='catcher'?-.5:2)
  });
  function geometry(width,height){
    const scale=Math.max(1,Math.min((width-88)/4,(height-34)/5));
    const top=(height-5*scale)/2;
    return {scale,centerX:width/2,homeY:top+2*scale,top,bottom:top+5*scale};
  }
  function positionToPoint(settings,view,width=260,height=130){
    const p=normalized(settings,view),g=geometry(width,height);
    // +world X is the right-handed batter's side. In this top view, the
    // pitcher is above the plate, so +world X is on the screen's left.
    return {x:g.centerX-sign(view)*p.side*g.scale,y:g.homeY-p.forward*g.scale};
  }
  function pointToPosition(point,view,width=260,height=130){
    const g=geometry(width,height);
    return {
      side:rounded(clamp(sign(view)*(g.centerX-point.x)/g.scale,view==='catcher'?-2:0,2)),
      forward:rounded(clamp((g.homeY-point.y)/g.scale,-3,view==='catcher'?-.5:2))
    };
  }
  // Pure helpers allow numerical checks without a browser or canvas.
  window.positionPadMapping={positionToPoint,pointToPosition};
  window.createPositionPad=function(canvas,options){
    if(!canvas||typeof canvas.getContext!=='function')throw new TypeError('A canvas is required.');
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('2D canvas is unavailable.');
    const getSettings=options?.getSettings||(()=>({side:.5,forward:-.1}));
    const getView=options?.getView||(()=> 'right');
    const isDisabled=options?.isDisabled||(()=>false);
    const onChange=options?.onChange||(()=>{});
    let width=260,height=130,activePointer=null,destroyed=false,dragOffset={x:0,y:0};
    const original={touchAction:canvas.style.touchAction,userSelect:canvas.style.userSelect,cursor:canvas.style.cursor,
      tabindex:canvas.getAttribute('tabindex'),role:canvas.getAttribute('role'),label:canvas.getAttribute('aria-label'),disabled:canvas.getAttribute('aria-disabled')};
    canvas.style.touchAction='none';
    canvas.style.userSelect='none';
    canvas.tabIndex=0;
    canvas.setAttribute('role','application');
    function draw(){
      if(destroyed)return;
      const rect=canvas.getBoundingClientRect();
      width=rect.width>0?rect.width:260;
      height=rect.height>0?rect.height:130;
      const dpr=Math.min(3,Math.max(1,safe(window.devicePixelRatio,1)));
      const backingWidth=Math.round(width*dpr),backingHeight=Math.round(height*dpr);
      if(canvas.width!==backingWidth)canvas.width=backingWidth;
      if(canvas.height!==backingHeight)canvas.height=backingHeight;
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,width,height);
      const g=geometry(width,height),view=getView(),disabled=!!isDisabled(),settings=normalized(getSettings(),getView());
      const xy=(worldX,forward)=>[g.centerX-worldX*g.scale,g.homeY-forward*g.scale];
      const line=(a,b,color,width=1)=>{ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();};
      const text=(value,x,y,color='#718194',align='left')=>{ctx.fillStyle=color;ctx.font='10px NotoLocal, sans-serif';ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(value,x,y);};
      ctx.fillStyle='#f3f6fa';ctx.fillRect(0,0,width,height);
      const left=g.centerX-2*g.scale,right=g.centerX+2*g.scale;
      if(!disabled){ctx.fillStyle='#e8efff';ctx.fillRect(view==='left'?g.centerX:left,g.top,(view==='catcher'?4:2)*g.scale,5*g.scale);}
      for(let x=-2;x<=2;x++)line(xy(x,-3),xy(x,2),x===0?'#9eb0c2':'#dce5ee',x===0?1.2:1);
      for(let z=-3;z<=2;z++)line(xy(-2,z),xy(2,z),z===0?'#9eb0c2':'#dce5ee',z===0?1.2:1);
      for(const z of [-2,-1,0,1])text(z===0?'0':(z>0?'+':'')+z+'m',right+7,g.homeY-z*g.scale);
      text('投手側 ↑',g.centerX,8,'#607286','center');
      text('捕手側 ↓',g.centerX,height-7,'#607286','center');
      text('右打席',Math.max(4,left-7),g.top+8,view==='right'&&!disabled?'#2758bd':'#94a1b0','right');
      text('左打席',Math.min(width-4,right+7),g.top+8,view==='left'&&!disabled?'#2758bd':'#94a1b0','left');
      // The front edge is z=0; the point of the plate extends catcherward.
      const plate=[[-.216,0],[.216,0],[.216,-.216],[0,-.432],[-.216,-.216]];
      ctx.beginPath();plate.forEach(([x,z],i)=>{const p=xy(x,z);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.closePath();
      ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle='#7e8d9d';ctx.lineWidth=1.2;ctx.stroke();
      if(!disabled){
        const p=positionToPoint(settings,view,width,height);
        // The short heading indicator identifies the marker as an eye position.
        line([p.x,p.y-5],[p.x,p.y-13],'#3266d1',2);
        ctx.beginPath();ctx.arc(p.x,p.y,7,0,Math.PI*2);ctx.fillStyle='#3266d1';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
        ctx.beginPath();ctx.arc(p.x,p.y,2,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();
      }
      canvas.style.cursor=disabled?'default':activePointer!==null?'grabbing':'grab';
      canvas.setAttribute('aria-disabled',String(disabled));
      canvas.setAttribute('aria-label',disabled?'打者の立ち位置。右打者か左打者を選ぶと調整できます。':
        `${view==='catcher'?'捕手の目の位置':view==='left'?'左打者の立ち位置':'右打者の立ち位置'}。ホーム中心から横${Math.round(settings.side*100)}センチ、前縁から${settings.forward<0?'捕手':'投手'}側${Math.round(Math.abs(settings.forward)*100)}センチ。ドラッグまたは矢印キーで調整。シフトと矢印キーは5センチ。`);
    }
    function commit(position){onChange(position);draw();}
    function updateFromPointer(event){
      const rect=canvas.getBoundingClientRect();
      if(rect.width<=0||rect.height<=0)return;
      commit(pointToPosition({x:(event.clientX-rect.left)*width/rect.width-dragOffset.x,y:(event.clientY-rect.top)*height/rect.height-dragOffset.y},getView(),width,height));
    }
    function pointerDown(event){
      if(destroyed||isDisabled()||(event.button!==undefined&&event.button!==0)||activePointer!==null)return;
      event.preventDefault();canvas.focus({preventScroll:true});activePointer=event.pointerId;
      const rect=canvas.getBoundingClientRect(),marker=positionToPoint(getSettings(),getView(),width,height);
      const x=(event.clientX-rect.left)*width/(rect.width||width),y=(event.clientY-rect.top)*height/(rect.height||height);
      // Picking up the marker should not jump the eye to the pointer's edge.
      dragOffset=Math.hypot(x-marker.x,y-marker.y)<=14?{x:x-marker.x,y:y-marker.y}:{x:0,y:0};
      try{canvas.setPointerCapture(event.pointerId);}catch{}
      updateFromPointer(event);
    }
    function pointerMove(event){if(activePointer===event.pointerId&&!isDisabled()){event.preventDefault();updateFromPointer(event);}}
    function pointerEnd(event){
      if(activePointer!==event.pointerId)return;
      const id=activePointer;activePointer=null;dragOffset={x:0,y:0};
      try{if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}catch{}
      draw();
    }
    function keyDown(event){
      if(destroyed||isDisabled()||event.ctrlKey||event.metaKey||event.altKey)return;
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();const p=normalized(getSettings(),getView()),step=event.shiftKey?.05:.01;
      if(event.key==='ArrowUp')p.forward+=step;
      if(event.key==='ArrowDown')p.forward-=step;
      if(event.key==='ArrowLeft')p.side+=sign(getView())*step;
      if(event.key==='ArrowRight')p.side-=sign(getView())*step;
      const bounded=normalized(p,getView());commit({side:rounded(bounded.side),forward:rounded(bounded.forward)});
    }
    const listeners={pointerdown:pointerDown,pointermove:pointerMove,pointerup:pointerEnd,pointercancel:pointerEnd,lostpointercapture:pointerEnd,keydown:keyDown};
    for(const [name,handler]of Object.entries(listeners))canvas.addEventListener(name,handler);
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(draw):null;
    observer?.observe(canvas);draw();
    return {draw,destroy(){
      if(destroyed)return;
      destroyed=true;observer?.disconnect();
      for(const [name,handler]of Object.entries(listeners))canvas.removeEventListener(name,handler);
      if(activePointer!==null){try{canvas.releasePointerCapture(activePointer);}catch{}activePointer=null;}
      canvas.style.touchAction=original.touchAction;canvas.style.userSelect=original.userSelect;canvas.style.cursor=original.cursor;
      for(const [name,value]of [['tabindex',original.tabindex],['role',original.role],['aria-label',original.label],['aria-disabled',original.disabled]]){
        if(value===null)canvas.removeAttribute(name);else canvas.setAttribute(name,value);
      }
    }};
  };
})();
