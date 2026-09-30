export const BALL_RADIUS = .0366;
export const RUBBER_FRONT = 18.4404 - .432;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const poly = (c, t) => c[0] + c[1] * t + c[2] * t * t;
export const validPitch = p => p?.validTrajectory === true && Number.isFinite(p.time) && p.time > 0 && Array.isArray(p.c) && p.c.length === 3 && p.c.every(c => Array.isArray(c) && c.length === 3 && c.every(Number.isFinite));
// Original Studio coordinates; home FRONT edge is z=0. No new forces.
export const pitchPosition = (p, t) => [-poly(p.c[2], t), poly(p.c[1], t), poly(p.c[0], t) - poly(p.c[0], p.time)];
// A proper 180-degree Y rotation, never a reflection of only one axis.
export const toXR = p => [-p[0], p[1], -p[2]];
export const endTime = p => Math.max(0, Math.min(p.time, Number.isFinite(p.flightEndTime) ? p.flightEndTime : p.time));
export const atTime = (p,t) => pitchPosition(p,clamp(t,0,endTime(p)));
export function positionAtDistance(p, distance) {
  if (!validPitch(p) || distance < 0 || distance > pitchPosition(p,0)[2]) return null;
  let lo = 0, hi = p.time;
  for (let i=0;i<45;i++) { const mid=(lo+hi)/2; if(pitchPosition(p,mid)[2]>distance)lo=mid;else hi=mid; }
  const t=(lo+hi)/2; return t>endTime(p)+1e-6?null:pitchPosition(p,t);
}
export const pitchTypes = {Fastball:['ストレート','#e94f45'],Sinker:['シンカー','#479af8'],Slider:['スライダー','#b08bea'],Cutter:['カットボール','#8874f5'],Curveball:['カーブ','#52bc87'],Splitter:['スプリット','#ef9b3f'],Changeup:['チェンジアップ','#d9b52b'],ChangeUp:['チェンジアップ','#d9b52b'],Knuckleball:['ナックル','#94a3b8'],Other:['その他','#94a3b8'],Undefined:['未分類','#94a3b8']};
export const typeLabel = t => pitchTypes[t]?.[0] || t;
export const typeColor = t => pitchTypes[t]?.[1] || '#94a3b8';
export function viewpoint(view, side=.34, forward=.25) {
  return view === 'catcher' ? [0,1.5,1.75] : [view==='left'?side:-side,1.5,-forward];
}
// Horizontal recenter only. Floor-based head height is never added twice.
export function calibrateRig(position, orientation, target, floor=true, heightOffset=0) {
  const {x,y,z,w}=orientation;
  const fx=-2*(x*z+w*y), fz=-(1-2*(x*x+y*y));
  const yaw=Math.atan2(-fx,-fz), rotation=-yaw, c=Math.cos(rotation),s=Math.sin(rotation);
  return {yaw:rotation, position:[target[0]-(c*position.x+s*position.z),(floor?0:target[1]-position.y)+heightOffset,target[2]-(-s*position.x+c*position.z)]};
}
export class PitchClock {
  constructor() {this.time=0;this.duration=.5;this.speed=1;this.playing=false;this.last=null;this.waitUntil=null;this.countdownUntil=null;this.loop=false;}
  setPitches(pitches) {this.duration=Math.max(.01,...pitches.map(endTime));this.reset();}
  reset() {this.time=0;this.playing=false;this.last=null;this.waitUntil=null;this.countdownUntil=null;}
  play(countdown=0) {if(this.time>=this.duration)this.time=0;this.playing=true;this.last=null;this.waitUntil=null;this.countdownUntil=countdown>0?-countdown:null;}
  pause() {this.playing=false;this.last=null;this.waitUntil=null;this.countdownUntil=null;}
  seek(time) {this.pause();this.time=clamp(time,0,this.duration);}
  tick(now,visible=true) {
    if(!visible){this.pause();return this.time;}
    if(!this.playing){this.last=null;return this.time;}
    if(this.countdownUntil!==null){if(this.countdownUntil<0)this.countdownUntil=now-this.countdownUntil;if(now<this.countdownUntil){this.last=now;return this.time;}this.last=this.countdownUntil;this.countdownUntil=null;}
    if(this.waitUntil!==null){if(now<this.waitUntil){this.last=now;return this.time;}this.time=0;this.last=this.waitUntil;this.waitUntil=null;}
    if(this.last!==null)this.time=Math.min(this.duration,this.time+Math.max(0,now-this.last)*.001*this.speed);
    this.last=now;
    if(this.time>=this.duration){if(this.loop)this.waitUntil=now+1400;else this.pause();}
    return this.time;
  }
}
