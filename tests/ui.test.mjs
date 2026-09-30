import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import * as THREE from 'three';
import {createCanvas} from '@napi-rs/canvas';
const root=path.resolve('dist');

async function loadApp(xrMock=null){
 const {window}=parseHTML(await fs.readFile(path.join(root,'index.html'),'utf8')),document=window.document;
 const canvasMap=new WeakMap();window.HTMLCanvasElement.prototype.getContext=function(kind){if(kind!=='2d')return null;let c=canvasMap.get(this);if(!c){c=createCanvas(this.width||1440,this.height||880);canvasMap.set(this,c);}return c.getContext('2d');};
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.getAttribute('value')||this.querySelector('option')?.getAttribute('value')||'';},set(v){for(const o of this.querySelectorAll('option')){if(o.getAttribute('value')===String(v))o.setAttribute('selected','');else o.removeAttribute('selected');}}});
 window.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,top:0,left:0,width:1100,height:650,bottom:650,right:1100});
 document.fonts={load:async()=>[]};document.hidden=false;
 let animation,renderer,now=0;const controllers=[];const pose={transform:{position:{x:0,y:1.65,z:0},orientation:{x:0,y:0,z:0,w:1}}};
 class FakeRenderer{
  constructor(){renderer=this;this.xrCamera=new THREE.PerspectiveCamera();this.xr={enabled:false,isPresenting:false,setFramebufferScaleFactor(){},setFoveation(){},getController(){const c=new THREE.Group();c.visible=false;controllers.push(c);return c;},getCamera:()=>this.xrCamera,updateCamera:()=>{const rig=this.camera?.parent;if(rig){rig.updateMatrixWorld(true);this.xrCamera.position.set(0,1.65,0).applyMatrix4(rig.matrixWorld);this.xrCamera.quaternion.copy(rig.quaternion);this.xrCamera.updateMatrixWorld(true);}},setReferenceSpaceType(){},getReferenceSpace:()=>new EventTarget(),setSession:async(session)=>{this.xr.isPresenting=true;session.addEventListener('end',()=>{this.xr.isPresenting=false;});}};}
  setPixelRatio(){}setSize(){}setAnimationLoop(f){animation=f;}render(scene,camera){this.scene=scene;this.camera=camera;scene.updateMatrixWorld(true);}
 }
 const location=new URL('https://test.example/?season=2026-spring'),errors=[];
 const context=vm.createContext({window,document,location,history:{replaceState(a,b,url){location.href=url.toString();}},navigator:{xr:xrMock},console:{...console,error:e=>errors.push(e)},URL,URLSearchParams,setTimeout,clearTimeout,performance:{now:()=>now},devicePixelRatio:1,ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>{fn(now);return 1;},fetch:async url=>{
  const target=new URL(url,location);try{return{ok:true,json:async()=>JSON.parse(await fs.readFile(path.join(root,target.pathname),'utf8'))};}catch{return{ok:false};}
 }});
 window.isSecureContext=true;
 vm.runInContext(await fs.readFile(path.join(root,'baseball.js'),'utf8'),context);
 context.drawSpinningBaseball=window.drawSpinningBaseball;
 const modules=new Map();
 const vendor=new vm.SyntheticModule(Object.keys(THREE),function(){for(const key of Object.keys(THREE))this.setExport(key,key==='WebGLRenderer'?FakeRenderer:THREE[key]);},{context});
 async function moduleFor(file){if(modules.has(file))return modules.get(file);const mod=new vm.SourceTextModule(await fs.readFile(file,'utf8'),{context,identifier:file});modules.set(file,mod);await mod.link(async(spec,parent)=>spec.includes('vendor/three.module.js')?vendor:moduleFor(path.resolve(path.dirname(parent.identifier),spec)));return mod;}
 await (await moduleFor(path.join(root,'app.mjs'))).evaluate();
 const ready=async()=>{for(let i=0;i<250;i++){await new Promise(r=>setTimeout(r,10));if(document.getElementById('loading').hidden&&document.getElementById('pitcherName').textContent!=='投手を読み込み中')break;}assert.equal(errors.length,0,errors.map(e=>String(e)).join('\n'));};
 await ready();return {document,renderer,location,ready,errors,controllers,pose,step(t){now=t;animation(now,renderer.xr.isPresenting?{getViewerPose:()=>pose}:undefined);},click(id){return document.getElementById(id).onclick();}};
}

test('actual application loads, changes seasons/pitchers, operates 5 slots and retains desktop fallback',async()=>{
 const app=await loadApp(),d=app.document;
 assert.match(d.getElementById('pitcherName').textContent,/子安/);assert.equal(d.querySelectorAll('#slots .slot').length,5);
 assert.equal(d.getElementById('enterVR').disabled,true);assert.match(d.getElementById('xrStatus').textContent,/対応VR/);
 assert.equal(d.querySelectorAll('#slots .slot select:first-of-type')[3].value,'');assert.equal(d.querySelectorAll('#slots .slot select:first-of-type')[4].value,'');
 app.click('replay');app.step(1000);app.step(1200);assert.equal(d.getElementById('time').value,'0.200 s');
 d.getElementById('speed').value='0.75';d.getElementById('speed').onchange();app.step(1201);app.step(1301);assert.equal(d.getElementById('time').value,'0.275 s');
 app.click('pause');app.step(3000);assert.equal(d.getElementById('time').value,'0.275 s');
 const left=d.querySelector('[data-view="left"]');left.onclick();app.step(3001);assert.ok(app.renderer.camera.position.x>0);
 const fourth=d.querySelectorAll('#slots .slot select:first-of-type')[3];fourth.value='Fastball';fourth.onchange();assert.equal(d.querySelectorAll('#slots .slot select:last-of-type')[3].disabled,false);
 for(const season of ['2026-fall','2025-fall']){d.getElementById('season').value=season;d.getElementById('season').onchange();await app.ready();assert.equal(new URL(app.location).searchParams.get('season'),season);assert.equal(d.querySelectorAll('#slots .slot').length,5);}
 app.click('settingsButton');assert.equal(d.getElementById('settings').hidden,false);app.click('closeSettings');assert.equal(d.getElementById('settings').hidden,true);
 assert.equal(app.errors.length,0);
});

test('actual app enters XR, ray-selects playback, clears panel during flight and restores desktop on exit',async()=>{
 let session,starts=0;
 const xr={isSessionSupported:async()=>true,addEventListener(){},requestSession:async()=>{starts++;session=new EventTarget();session.visibilityState='visible';session.requestReferenceSpace=async()=>new EventTarget();session.end=async()=>session.dispatchEvent(new Event('end'));return session;}};
 const app=await loadApp(xr),d=app.document;app.step(1);assert.equal(d.getElementById('enterVR').disabled,false);
 await Promise.all([app.click('enterVR'),app.click('enterVR')]);assert.equal(starts,1);assert.ok(d.body.classList.contains('xr-active'));app.step(1000);
 const panel=app.renderer.scene.children.find(o=>o.geometry?.parameters?.width===1.44);assert.ok(panel);assert.equal(panel.visible,true);
 const controller=app.controllers[0];controller.visible=true;controller.dispatchEvent({type:'connected',data:{targetRayMode:'tracked-pointer'}});
 const localPoint=new THREE.Vector3((195/1440-.5)*1.44,(.5-263.5/880)*.88,0),point=panel.localToWorld(localPoint);
 const rayOrigin=point.clone().add(new THREE.Vector3(0,0,.4).applyQuaternion(panel.quaternion));controller.position.copy(controller.parent.worldToLocal(rayOrigin));controller.quaternion.copy(controller.parent.quaternion.clone().invert()).multiply(panel.quaternion);controller.updateMatrixWorld(true);
 controller.dispatchEvent({type:'select'});app.step(1100);assert.equal(d.getElementById('time').value,'0.000 s');app.step(4200);assert.equal(d.getElementById('time').value,'0.100 s');assert.equal(panel.visible,false);
 controller.dispatchEvent({type:'select'});app.step(4250);assert.equal(d.getElementById('time').value,'0.100 s');assert.equal(panel.visible,true);
 await session.end();assert.equal(d.body.classList.contains('xr-active'),false);app.step(5000);assert.equal(app.renderer.xr.isPresenting,false);assert.equal(d.getElementById('enterVR').disabled,false);
 await app.click('enterVR');app.step(6000);assert.equal(starts,2);assert.ok(d.body.classList.contains('xr-active'));await session.end();assert.equal(app.errors.length,0);
});
