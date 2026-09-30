import * as THREE from './vendor/three.module.js';
import {BALL_RADIUS,RUBBER_FRONT,pitchPosition,atTime,endTime,typeColor} from './model.mjs';

export function buildWorld(scene) {
  const world=new THREE.Group();world.rotation.y=Math.PI;scene.add(world);
  scene.background=new THREE.Color('#8fb5cf');scene.fog=new THREE.Fog('#8fb5cf',48,120);
  scene.add(new THREE.HemisphereLight('#ffffff','#70835b',2.6));
  const sun=new THREE.DirectionalLight('#fff7df',2.1);sun.position.set(-15,30,10);scene.add(sun);
  const mat=color=>new THREE.MeshLambertMaterial({color});
  const grass=mat('#79945e'),grass2=mat('#829e66'),dirt=mat('#bb9f7c'),white=mat('#faf8ed');
  function box(w,h,d,x,y,z,material){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y,z);world.add(m);return m;}
  box(170,.1,180,0,-.08,30,grass);
  for(let z=-20;z<95;z+=8)box(160,.003,4,0,-.025,z,grass2);
  const circle=(radius,x,z,y,material)=>{const m=new THREE.Mesh(new THREE.CircleGeometry(radius,64),material);m.rotation.x=-Math.PI/2;m.position.set(x,y,z);world.add(m);return m;};
  circle(5.6,0,0,.002,dirt);circle(2.7,0,18,.004,dirt);
  const plate=new THREE.BufferGeometry();plate.setAttribute('position',new THREE.Float32BufferAttribute([-.216,.012,0,.216,.012,0,.216,.012,-.216,-.216,.012,0,.216,.012,-.216,0,.012,-.432,-.216,.012,0,0,.012,-.432,-.216,.012,-.216],3));plate.computeVertexNormals();
  const plateMat=white.clone();plateMat.side=THREE.DoubleSide;world.add(new THREE.Mesh(plate,plateMat));
  box(.6096,.02,.1524,0,.02,RUBBER_FRONT+.0762,white);
  // Batter-box outlines, ordinary field markers at actual metre scale.
  const lineMat=new THREE.LineBasicMaterial({color:'#fffdf3'});
  function polyline(points,material=lineMat){const m=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),material);world.add(m);return m;}
  for(const s of [-1,1])polyline([[s*.368,.015,-1.13],[s*1.588,.015,-1.13],[s*1.588,.015,.70],[s*.368,.015,.70],[s*.368,.015,-1.13]]);
  for(const s of [-1,1])polyline([[0,.01,-.432],[s*48,.01,47.568]]);
  box(105,3,.3,0,1.5,66,mat('#304a43'));
  const zone=new THREE.Group();world.add(zone);const zm=new THREE.LineBasicMaterial({color:'#345562',transparent:true,opacity:.75});
  for(let i=0;i<=3;i++){const x=-.216+i*.144,y=.5+i*.2;for(const points of [[[x,.5,0],[x,1.1,0]],[[-.216,y,0],[.216,y,0]]])zone.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),zm));}zone.visible=false;
  const balls=new THREE.Group(),paths=new THREE.Group();paths.visible=false;world.add(balls,paths);
  const original=globalThis.drawSpinningBaseball;
  if(!original?.geometry)throw new Error('ボール形状の準備に失敗しました');
  const geometry=original.geometry;
  class SeamCurve extends THREE.Curve{getPoint(t,target=new THREE.Vector3()){return target.fromArray(geometry.seamPoint(t*4*Math.PI)).multiplyScalar(1.002);}}
  const sphereGeo=new THREE.SphereGeometry(1,32,24),sphereMat=new THREE.MeshStandardMaterial({color:'#f5f0e3',roughness:.82});
  const seamGeo=new THREE.TubeGeometry(new SeamCurve(),320,.006,4,true),seamMat=new THREE.MeshLambertMaterial({color:'#aa5448'});
  const stitchGeo=new THREE.CylinderGeometry(.009,.009,1,4),stitchMat=new THREE.MeshLambertMaterial({color:'#c31d2c'});
  const matrices=geometry.stitches.flatMap(stitch=>stitch.segments).map(([a,b])=>{
    const va=new THREE.Vector3(...a).multiplyScalar(1.006),vb=new THREE.Vector3(...b).multiplyScalar(1.006),delta=vb.clone().sub(va);
    return new THREE.Matrix4().compose(va.add(vb).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.clone().normalize()),new THREE.Vector3(1,delta.length(),1));
  });
  let entries=[];
  function setPitches(pitches){
    for(const entry of entries)entry.stitches.dispose();balls.clear();for(const p of [...paths.children]){p.geometry.dispose();p.material.dispose();}paths.clear();
    entries=pitches.map(p=>{
      const group=new THREE.Group();group.scale.setScalar(BALL_RADIUS);group.add(new THREE.Mesh(sphereGeo,sphereMat),new THREE.Mesh(seamGeo,seamMat));
      const stitches=new THREE.InstancedMesh(stitchGeo,stitchMat,matrices.length);matrices.forEach((m,i)=>stitches.setMatrixAt(i,m));stitches.instanceMatrix.needsUpdate=true;group.add(stitches);balls.add(group);
      const state=original.spinState(p,0),basis=[[1,0,0],[0,1,0],[0,0,1]].map(v=>new THREE.Vector3(...geometry.initialPose(v,state.axis,state.seamPlacement)));
      const initial=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(...basis));
      const points=Array.from({length:161},(_,i)=>new THREE.Vector3(...pitchPosition(p,endTime(p)*i/160)));
      const path=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:typeColor(p.type),transparent:true,opacity:.8}));paths.add(path);
      return {p,group,initial,axis:new THREE.Vector3(...state.axis),hasSpin:state.available,rpm:state.rpm,stitches};
    });update(0);
  }
  const rotation=new THREE.Quaternion();
  function update(time){for(const {p,group,initial,axis,hasSpin,rpm} of entries){const t=Math.min(time,endTime(p));group.position.fromArray(atTime(p,t));rotation.setFromAxisAngle(axis,hasSpin?-((rpm*t/60)%1)*Math.PI*2:0);group.quaternion.copy(rotation).multiply(initial);}}
  function dispose(){scene.traverse(o=>{o.geometry?.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];for(const m of materials)m?.dispose();});}
  return {root:world,zone,paths,balls,setPitches,update,dispose,get entries(){return entries;}};
}
