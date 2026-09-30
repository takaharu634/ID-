import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import * as THREE from '../node_modules/three/build/three.module.js';
import {pitchPosition,toXR,calibrateRig,viewpoint,PitchClock,validPitch,endTime,RUBBER_FRONT,BALL_RADIUS} from '../src/model.mjs';
import {isZonePitch,chooseInitialPitches} from '../src/selection.mjs';
import {XRSessionFlow} from '../src/xr-session.mjs';
import {buildWorld} from '../dist/world.mjs';

const catalog=JSON.parse(fs.readFileSync(new URL('../public/catalog.json',import.meta.url)));
const snapshot=JSON.parse(fs.readFileSync(new URL('./source-snapshot.json',import.meta.url)));
vm.runInThisContext(fs.readFileSync(new URL('../public/baseball.js',import.meta.url),'utf8'));
const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const dataFor=meta=>JSON.parse(fs.readFileSync(new URL(`../public/${meta.dataUrl}`,import.meta.url)));

test('all 24,854 source records are unchanged and all valid pitch coordinates match original Studio',()=>{
  let count=0,valid=0;
  for(const season of catalog.seasons)for(const meta of season.pitchers){
    const file=dataFor(meta),bytes=fs.readFileSync(new URL(`../public/${meta.dataUrl}`,import.meta.url));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),snapshot.files[meta.dataUrl]);
    assert.equal(file.seasonId,season.id);count+=file.pitches.length;
    for(const p of file.pitches.filter(validPitch)){
      valid++;
      for(const t of [0,p.time*.25,p.time*.7,endTime(p)]){
        const actual=pitchPosition(p,t);assert.ok(actual.every(Number.isFinite));
        const xr=toXR(actual);near(Math.hypot(...xr),Math.hypot(...actual));near(xr[1],actual[1]);
      }
      near(pitchPosition(p,p.time)[2],0);assert.ok(toXR(pitchPosition(p,0))[2]<0);
    }
  }
  assert.equal(count,24854);assert.ok(valid>24000);
  for(const entry of snapshot.points){const p=dataFor({dataUrl:entry.file}).pitches.find(p=>p.id===entry.id);pitchPosition(p,entry.t).forEach((v,i)=>near(v,entry.position[i]));}
});

test('all 163 pitcher selections choose at most 3 distinct real zone pitches, leaving 2 empty slots',()=>{
  let count=0,empty=0;
  for(const season of catalog.seasons)for(const meta of season.pitchers){
    const p={...meta,...dataFor(meta),summary:[]};p.pitches=p.pitches.filter(validPitch);const initial=chooseInitialPitches(p);
    assert.ok(initial.length<=3);assert.equal(new Set(initial.map(p=>p.type)).size,initial.length);
    for(const pitch of initial){assert.ok(isZonePitch(pitch));assert.ok(p.pitches.includes(pitch));}
    if(!initial.length){empty++;assert.ok(!p.pitches.some(isZonePitch));}count++;
  }
  assert.equal(count,163);assert.equal(empty,3);
});

test('XR recenter preserves actual height, horizon, left/right and ignores pitch/roll',()=>{
  for(const yaw of [-2.4,-.5,0,.7,2.9])for(const pitch of [-.4,0,.45]){
    const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch,yaw,.17,'YXZ')),pos={x:2,y:1.74,z:-3};
    for(const view of ['right','left','catcher']){
      const target=viewpoint(view),cal=calibrateRig(pos,q,target,true),rot=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),cal.yaw);
      const eye=new THREE.Vector3(pos.x,pos.y,pos.z).applyQuaternion(rot).add(new THREE.Vector3(...cal.position));
      near(eye.x,target[0]);near(eye.z,target[2]);near(eye.y,1.74);
      const f=new THREE.Vector3(0,0,-1).applyQuaternion(q).applyQuaternion(rot);near(f.x,0);assert.ok(f.z<0);
      const up=new THREE.Vector3(0,1,0).applyQuaternion(rot);near(up.y,1);
      const local=calibrateRig(pos,q,target,false);near(pos.y+local.position[1],1.5);
    }
  }
  assert.ok(viewpoint('right')[0]<0);assert.ok(viewpoint('left')[0]>0);near(RUBBER_FRONT,18.0084);near(BALL_RADIUS,.0366);
});

test('real-time and .75 playback share one physical clock; countdown, hidden session and loop do not jump',()=>{
  for(const speed of [1,.75,.5,.25]){
    const c=new PitchClock();c.setPitches([{time:.6},{time:.5}]);c.speed=speed;c.play();c.tick(1000);c.tick(1200);near(c.time,.2*speed);c.tick(1200+.4/speed*1000);near(c.time,Math.min(.6,.2*speed+.4));
  }
  const c=new PitchClock();c.duration=.5;c.play(3000);c.tick(100);c.tick(3099);near(c.time,0);c.tick(3200);near(c.time,.1);c.tick(3500,false);near(c.time,.1);assert.equal(c.playing,false);c.tick(20000,true);near(c.time,.1);
  c.reset();c.loop=true;c.play();c.tick(0);c.tick(500);near(c.time,.5);c.tick(1900);near(c.time,0);c.tick(2000);near(c.time,.1);
});

test('actual Three.js balls and world preserve spin handedness and polynomial positions',()=>{
  const scene=new THREE.Scene(),w=buildWorld(scene),meta=catalog.seasons[1].pitchers.find(p=>p.name.includes('子安')),p=dataFor(meta).pitches.find(p=>validPitch(p)&&p.spin>0);
  assert.equal(w.paths.visible,false);assert.equal(w.zone.visible,false);w.setPitches([p]);
  for(const time of [0,.137,endTime(p),10]){
    w.update(time);scene.updateMatrixWorld(true);const ball=w.entries[0].group,pos=ball.getWorldPosition(new THREE.Vector3()),expected=toXR(pitchPosition(p,Math.min(time,endTime(p))));pos.toArray().forEach((v,i)=>near(v,expected[i]));
    near(ball.scale.x,BALL_RADIUS);near(ball.quaternion.length(),1);
    const state=globalThis.drawSpinningBaseball.spinState(p,Math.min(time,endTime(p))),basis=[[1,0,0],[0,1,0],[0,0,1]];
    for(const axis of basis){const g=globalThis.drawSpinningBaseball.geometry,expectedVector=toXR(g.rotate(g.initialPose(axis,state.axis,state.seamPlacement),state.axis,state.angle)),actual=new THREE.Vector3(...axis).applyQuaternion(ball.getWorldQuaternion(new THREE.Quaternion()));actual.toArray().forEach((v,i)=>near(v,expectedVector[i]));}
  }
  const omega=new THREE.Vector3(-1,0,0),velocity=new THREE.Vector3(0,0,1);assert.ok(omega.cross(velocity).y>0);
  w.setPitches([]);assert.equal(w.entries.length,0);
});

class Session extends EventTarget{
  constructor(floor=true){super();this.floor=floor;this.visibilityState='visible';this.ended=false;}
  async requestReferenceSpace(type){if(type==='local-floor'&&!this.floor)throw Error('unsupported');return {};}
  async end(){this.ended=true;this.dispatchEvent(new Event('end'));}
}
test('XR session supports floor fallback, denied retry, double click, exit and reentry',async()=>{
  let starts=0,ends=0,floors=[],sessions=[];
  const xr={isSessionSupported:async()=>true,requestSession:async()=>{starts++;const s=new Session(starts!==1);sessions.push(s);return s;}};
  const flow=new XRSessionFlow({xr,initialize:async(s,floor)=>{floors.push(floor);},onEnd:()=>ends++});
  assert.equal(await flow.probe(),true);await Promise.all([flow.enter(),flow.enter()]);assert.equal(starts,1);assert.deepEqual(floors,[false]);assert.equal(flow.state,'active');await flow.exit();assert.equal(flow.state,'idle');assert.equal(ends,1);await flow.enter();assert.equal(flow.state,'active');assert.deepEqual(floors,[false,true]);await flow.exit();assert.equal(ends,2);
  let denied=true;xr.requestSession=async()=>{if(denied)throw Object.assign(new Error('denied'),{name:'NotAllowedError'});return new Session();};assert.equal(await flow.enter(),false);assert.equal(flow.state,'idle');denied=false;assert.equal(await flow.enter(),true);await flow.exit();
});
test('XR unavailable, insecure, failed initialization and tracking visibility remain recoverable',async()=>{
  let init=0,visible=null;
  for(const args of [{xr:null},{xr:{isSessionSupported:async()=>false}},{secure:false,xr:{isSessionSupported:async()=>true}},{xr:{isSessionSupported:async()=>{throw Error();}}}]){const flow=new XRSessionFlow({...args,initialize:async()=>init++});assert.equal(await flow.probe(),false);assert.equal(await flow.enter(),false);}
  assert.equal(init,0);
  let s;const xr={isSessionSupported:async()=>true,requestSession:async()=>s=new Session()};const flow=new XRSessionFlow({xr,initialize:async()=>{throw Error('renderer');}});await flow.probe();assert.equal(await flow.enter(),false);assert.equal(flow.state,'idle');assert.equal(s.ended,true);
  flow.initialize=async()=>{};flow.onVisibility=v=>visible=v;await flow.enter();s.visibilityState='hidden';s.dispatchEvent(new Event('visibilitychange'));assert.equal(visible,false);await flow.exit();
});
