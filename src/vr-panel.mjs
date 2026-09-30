import * as THREE from './vendor/three.module.js';
export class VRPanel {
  constructor(scene,onAction){
    this.onAction=onAction;this.canvas=document.createElement('canvas');this.canvas.width=1440;this.canvas.height=880;this.ctx=this.canvas.getContext('2d');
    this.texture=new THREE.CanvasTexture(this.canvas);this.texture.colorSpace=THREE.SRGBColorSpace;this.texture.minFilter=THREE.LinearFilter;
    this.mesh=new THREE.Mesh(new THREE.PlaneGeometry(1.44,.88),new THREE.MeshBasicMaterial({map:this.texture,transparent:true,side:THREE.DoubleSide,depthTest:false}));this.mesh.renderOrder=100;this.mesh.visible=false;scene.add(this.mesh);
    this.buttons=[];this.highlight=null;this.dwell=0;this.key='';this.lastDwellPaint=0;
    this.raycaster=new THREE.Raycaster();this.direction=new THREE.Vector3();this.origin=new THREE.Vector3();this.rotation=new THREE.Matrix4();
    this.reticle=new THREE.Mesh(new THREE.RingGeometry(.004,.007,24),new THREE.MeshBasicMaterial({color:'#f9c365',depthTest:false,side:THREE.DoubleSide}));this.reticle.visible=false;this.reticle.renderOrder=101;scene.add(this.reticle);
  }
  place(position,quaternion){
    const f=new THREE.Vector3(0,0,-1).applyQuaternion(quaternion),yaw=Math.atan2(-f.x,-f.z);
    this.mesh.rotation.set(0,yaw,0);this.mesh.position.copy(position).add(new THREE.Vector3(-Math.sin(yaw)*1.35,-.57,-Math.cos(yaw)*1.35));this.mesh.visible=true;this.mesh.updateMatrixWorld(true);
  }
  setState(s){
    this.state=s;const key=JSON.stringify(s);if(key!==this.key){this.key=key;this.paint();}
  }
  paint(){
    const c=this.ctx,s=this.state;if(!s)return;
    c.clearRect(0,0,1440,880);c.fillStyle='#152630';c.beginPath();c.roundRect(0,0,1440,880,28);c.fill();
    c.textBaseline='middle';c.textAlign='left';c.fillStyle='#8fabb8';c.font='500 23px NotoLocal,sans-serif';c.fillText('投球軌道 VR  /  実寸 1:1',38,43);
    c.fillStyle='#fff';c.font='700 38px NotoLocal,sans-serif';c.fillText(s.pitcher||'投球を選択',38,95,1310);
    c.fillStyle='#bdcfd7';c.font='500 26px NotoLocal,sans-serif';c.fillText(s.pitch||'—',38,143,1300);
    c.fillStyle='#8eacb9';c.font='400 21px NotoLocal,sans-serif';c.fillText(s.detail||'',38,184,1300);
    const rows=[
      [['replay','最初から再生'],['pause',s.playing?'一時停止':'再開'],['next','次の球'],['compare',s.compare?'1球ずつ見る':'比較表示にする']],
      [['right','右打者'],['left','左打者'],['catcher','捕手'],['recenter','正面を合わせる']],
      [['slower',`速度 ${s.speed}×`],['paths',s.paths?'軌道線：ON':'軌道線：OFF'],['zone',s.zone?'ゾーン：ON':'ゾーン：OFF'],['loop',s.loop?'連続：ON':'連続：OFF']],
      [['closer','ホームへ 5cm'],['farther','外へ 5cm'],['forward','投手側へ 5cm'],['back','捕手側へ 5cm']],
      [['prevPitcher','前の投手'],['nextPitcher','次の投手'],['menu','パネルを正面へ'],['exit','VRを終了']]
    ];
    this.buttons=[];
    rows.forEach((row,i)=>row.forEach(([id,label],j)=>{
      const x=30+j*350,y=218+i*112,w=330,h=91,active=id===this.highlight;
      c.fillStyle=active?'#367585':id==='replay'?'#cc5a42':'#2a424e';c.beginPath();c.roundRect(x,y,w,h,12);c.fill();
      if(active&&this.dwell>0){c.fillStyle='#f8c364';c.fillRect(x+10,y+h-7,(w-20)*this.dwell,4);}
      c.textAlign='center';c.fillStyle='#fff';c.font='600 26px NotoLocal,sans-serif';c.fillText(label,x+w/2,y+h/2,w-18);this.buttons.push({id,x,y,w,h});
    }));
    c.textAlign='left';c.fillStyle='#a7bdc7';c.font='400 20px NotoLocal,sans-serif';
    c.fillText('指してトリガーで選択。コントローラーがなければ、ボタンを1.5秒見つめます。',38,818,1360);
    c.fillText(s.status||'何もない所でトリガーを押すとパネルが正面へ戻ります。',38,850,1360);this.texture.needsUpdate=true;
  }
  hit(origin,direction){
    if(!this.mesh.visible)return null;this.raycaster.set(origin,direction);const hit=this.raycaster.intersectObject(this.mesh,false)[0];
    if(!hit?.uv)return null;const x=hit.uv.x*1440,y=(1-hit.uv.y)*880;const button=this.buttons.find(b=>x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h);return button?{id:button.id,point:hit.point,distance:hit.distance}:null;
  }
  fromController(controller){controller.updateMatrixWorld(true);this.rotation.extractRotation(controller.matrixWorld);this.origin.setFromMatrixPosition(controller.matrixWorld);this.direction.set(0,0,-1).applyMatrix4(this.rotation).normalize();return this.hit(this.origin,this.direction);}
  setHover(hit,now,gaze=false){
    const id=hit?.id||null;
    if(this.highlight!==id){this.highlight=id;this.since=now;this.fired=false;this.dwell=0;this.paint();}
    this.reticle.visible=!!hit;if(hit){this.reticle.position.copy(hit.point);this.reticle.quaternion.copy(this.mesh.quaternion);this.reticle.position.add(new THREE.Vector3(0,0,.003).applyQuaternion(this.mesh.quaternion));}
    if(gaze&&id&&!this.fired){this.dwell=Math.min(1,(now-this.since)/1500);if(now-this.lastDwellPaint>70){this.paint();this.lastDwellPaint=now;}if(this.dwell>=1){this.fired=true;this.onAction(id);}}
    else if(!gaze&&this.dwell){this.dwell=0;this.paint();}
  }
  hide(){this.mesh.visible=false;this.reticle.visible=false;this.highlight=null;this.dwell=0;}
}
