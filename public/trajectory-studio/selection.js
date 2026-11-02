(function(root){
 'use strict';
 // Every slot refers to a measured delivery, including unchecked slots.
 function initialSlots(pitcher,isZonePitch,limit=5){
  const pool=pitcher.pitches.filter(p=>p.validTrajectory),groups=new Map();
  for(const p of pool){if(!groups.has(p.type))groups.set(p.type,[]);groups.get(p.type).push(p);}
  const types=[...groups.keys()].sort((a,b)=>Number(b==='Fastball')-Number(a==='Fastball'));
  const picks=types.map(type=>{
   const ps=groups.get(type),id=pitcher.summary.find(s=>s.type===type)?.representativeId;
   return ps.find(p=>p.id===id&&isZonePitch(p))||ps.find(isZonePitch)||ps.find(p=>p.id===id)||ps[0];
  }).slice(0,limit);
  const used=new Set(picks.map(p=>p.id));
  // If the repertoire is small, prepare other deliveries before reusing one.
  for(const p of pool){if(picks.length>=limit)break;if(!used.has(p.id)){picks.push(p);used.add(p.id);}}
  const distinct=picks.slice();
  while(picks.length<limit&&distinct.length)picks.push(distinct[picks.length%distinct.length]);
  return Array.from({length:limit},(_,i)=>({type:picks[i]?.type||'',id:picks[i]?.id||'',enabled:i===0&&!!picks[i]}));
 }
 function makeDeck(pitches,random=Math.random){
  const pool=pitches.filter(p=>p.validTrajectory);let bag=[],lastId=null;
  return {size:pool.length,next(){
   if(!pool.length)return null;
   if(!bag.length){
    bag=pool.slice();
    for(let i=bag.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
    // Do not repeat the previous delivery at the boundary between shuffles.
    if(bag.length>1&&bag[bag.length-1].id===lastId)[bag[0],bag[bag.length-1]]=[bag[bag.length-1],bag[0]];
   }
   const p=bag.pop();lastId=p.id;return p;
  }};
 }
 root.StudioSelection={initialSlots,makeDeck};
})(window);
