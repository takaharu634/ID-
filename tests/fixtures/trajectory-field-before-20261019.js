// Frozen pre-optimization field renderer for pixel-equivalence regression tests.
 const surfaces=[],fieldMarkers=[];
 function face(vertices,fill,stroke=null,layer=surfaces){
  const clipped=[];for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length],az=dot(sub(a,eye),forward),bz=dot(sub(b,eye),forward),insideA=az>=.09,insideB=bz>=.09;if(insideA)clipped.push(a);if(insideA!==insideB){let t=(.09-az)/(bz-az);clipped.push(a.map((v,k)=>v+(b[k]-v)*t));}}
  if(clipped.length<3)return;let pp=clipped.map(project);if(pp.some(p=>!p))return;layer.push({pp,fill,stroke,z:pp.reduce((s,p)=>s+p[2],0)/pp.length});
 }
 for(let z=-30;z<62;z+=2.5) for(let x=-45;x<45;x+=5){let dirt=(z<7&&Math.abs(x+2.5)<8)||(Math.abs(z-18.0)<2&&Math.abs(x+2.5)<3);face([[x,0,z],[x+5,0,z],[x+5,0,z+2.5],[x,0,z+2.5]],dirt?'#c8b18d':(Math.round(z/2.5)%2?'#8faa6b':'#99b674'));}
 for(let x=-45;x<45;x+=5){face([[x,0,58],[x+5,0,58],[x+5,9,64],[x,9,64]],'#334b48');for(let h=1;h<9;h+=1.2)face([[x,h,58+h*.66],[x+5,h,58+h*.66],[x+5,h+.12,58+h*.66],[x,h+.12,58+h*.66]],'#798782');}
 for(const x of [-34,34]){face([[x,0,43],[x+.3,0,43],[x+.3,22,43],[x,22,43]],'#bdc5c4');face([[x-2,22,43],[x+2,22,43],[x+2,23,43],[x-2,23,43]],'#eeeeea');}
 let mound=[];for(let i=0;i<48;i++){let a=i/48*Math.PI*2;mound.push([Math.sin(a)*2.7,.025,18.0+Math.cos(a)*2.7]);}face(mound,'#c9b28f');
 // The rubber's front edge is 60 ft 6 in from the rendered home tip.
 // Keep the existing schematic mound level; markers draw after terrain so
 // the mound's average-depth sorting cannot paint over this small surface.
 const rubberFront=18.4404-.432,rubberBack=rubberFront+.1524,rubberHalf=.6096/2;
 face([[-rubberHalf,.025,rubberFront],[rubberHalf,.025,rubberFront],[rubberHalf,.04,rubberFront],[-rubberHalf,.04,rubberFront]],'#e3e6e8','#d5d9dc',fieldMarkers);
 face([[-rubberHalf,.04,rubberFront],[rubberHalf,.04,rubberFront],[rubberHalf,.04,rubberBack],[-rubberHalf,.04,rubberBack]],'#fff','#fff',fieldMarkers);
 face([[-.216,.025,0],[.216,.025,0],[.216,.025,-.216],[0,.025,-.432],[-.216,.025,-.216]],'#fcfcfc','#e2e4e6');
 for(let s of [-1,1])face([[0,.016,-.432],[s*30,.016,29.6],[s*30+.045,.016,29.65],[.045,.016,-.4]],'#f7f8ef');
 surfaces.sort((a,b)=>b.z-a.z);fieldMarkers.sort((a,b)=>b.z-a.z);for(const a of [...surfaces,...fieldMarkers]){c.beginPath();a.pp.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.closePath();c.fillStyle=a.fill;c.fill();if(a.stroke){c.strokeStyle=a.stroke;c.lineWidth=1;c.stroke();}}
