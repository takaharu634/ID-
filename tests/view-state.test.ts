import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreViewState, persistViewState, readViewState } from '../lib/view-state.ts';

test('shared URL conditions take priority; seasons and invalid data remain isolated', () => {
  const defaults={team:'', page:0, ranges:{} as Record<string,string>, filters:{velocityMin:null}};
  const params=new URLSearchParams({'条件先':'search|2026年秋季','条件':JSON.stringify({team:'東洋大学',page:1,ranges:{veloMin:'140'},filters:{velocityMin:145}})});
  assert.deepEqual(restoreViewState('search|2026年秋季',defaults,params.toString(),'{"team":"中央大学"}'),{team:'東洋大学',page:1,ranges:{veloMin:'140'},filters:{velocityMin:145}});
  assert.equal(restoreViewState('search|2026年春季',defaults,params.toString(),null).team,'');
  assert.deepEqual(restoreViewState('x',defaults,'','broken'),defaults);
});

test('player IDs containing university separators persist intact and explicit comparisons override old session defaults', () => {
  const scope='compare|2026年秋季|id:1000274516|青山学院大学';
  const params=new URLSearchParams({'表示':'compare','シーズン':'2026-fall','選手':'id:1000274516|青山学院大学'});
  const stored=new Map<string,string>();
  const fake:any={location:{href:`https://example.test/?${params}`,search:`?${params}`},sessionStorage:{getItem:(k:string)=>stored.get(k)??null,setItem:(k:string,v:string)=>stored.set(k,v)},history:{state:null,replaceState:(_s:unknown,_title:string,url:string)=>{fake.location.href=`https://example.test${url}`;fake.location.search=new URL(fake.location.href).search;}}};
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{value:fake,configurable:true});
  try {
    stored.set(`tohto-view-v1:${scope}`,JSON.stringify({ids:['someone'],mode:'delta'}));
    const defaults={ids:['id:1000274516|青山学院大学'],mode:'players'};
    assert.deepEqual(readViewState(scope,defaults,true),defaults);
    persistViewState(scope,{...defaults,mode:'delta'});
    assert.equal(new URL(fake.location.href).searchParams.get('条件先'),scope);
    assert.equal(readViewState(scope,defaults,true).mode,'delta','explicit URL supports reload and sharing');
    const url=fake.location.href; persistViewState('compare|2026年春季|id:1000274516|青山学院大学',{mode:'players'});
    assert.equal(fake.location.href,url,'old season cannot rewrite new URL');
  } finally { if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window'); }
});

test('ranking links preserve metric group and table filters across fresh sessions', () => {
  const season='2026年秋季',board='pitching_percentile';
  const scope=`leaders|${season}|${board}`,metric=`leadersMetrics|${season}|${board}`,detail=`leadersDevelopment|${season}|${board}|release`;
  const fake:any={location:{href:'https://example.test/?表示=leaders&シーズン=2026-fall&指標=pitching_percentile',search:''},sessionStorage:{getItem:()=>null,setItem:()=>{}},history:{state:null,replaceState:(_s:unknown,_title:string,url:string)=>{fake.location.href=`https://example.test${url}`;fake.location.search=new URL(fake.location.href).search;}}};
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{value:fake,configurable:true});
  const defaults={team:'',minimum:100,sortKey:'x',direction:'desc'};
  const filters={team:'中央大学',minimum:25,sortKey:'release',direction:'asc'};
  try {
    persistViewState(metric,{group:'release'});
    persistViewState(detail,filters);
    persistViewState(metric,{group:'release'});
    assert.equal(new URL(fake.location.href).searchParams.get('条件先'),scope);
    assert.deepEqual(readViewState(metric,{group:'standard'}),{group:'release'});
    assert.deepEqual(readViewState(detail,defaults),filters);
    assert.deepEqual(readViewState(scope,defaults),defaults,'a different group cannot inherit incompatible filters');
    const url=fake.location.href;
    persistViewState(`leadersDevelopment|${season}|batting_average|release`,filters);
    assert.equal(fake.location.href,url,'another board cannot overwrite the active link');
    persistViewState(metric,{group:'standard'});
    persistViewState(scope,{...defaults,team:'立正大学'});
    assert.deepEqual(readViewState(metric,{group:'other'}),{group:'standard'});
    assert.equal(readViewState(scope,defaults).team,'立正大学');
  } finally {if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});
