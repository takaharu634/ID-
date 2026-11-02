"""Refresh the autumn trajectory feed from the validated CSV manifest.
Existing pitch records and default selections are preserved; only new PitchUIDs
are appended. Summary metrics use raw TaggedPitchType, as in this viewer.
"""
import csv,json,re,math,hashlib
from pathlib import Path
from collections import defaultdict
ROOT=Path(__file__).resolve().parent.parent
base=ROOT/'public/trajectory-studio'
html=(base/'index.html').read_text();match=re.search(r'<script>const DATA=([\s\S]*?);</script>',html)
catalog=json.loads(match[1]);season=next(s for s in catalog['seasons'] if s['id']=='2026-fall')
manifest=json.loads((ROOT/'data/trackman/2026-fall/manifest.json').read_text())
first_date=manifest['summary']['firstDate'];last_date=manifest['summary']['lastDate']
dataset=json.loads((ROOT/'public/data/season-2026-fall.json').read_text());names={p['id']:p for p in dataset['pitches']}
rows={}
for f in manifest['files']:
 for r in csv.DictReader((ROOT/'data/trackman/2026-fall'/f"{f['id']}.csv").open(encoding='utf-8-sig')):rows[r['PitchUID']]=r
assert set(rows)==set(names)
groups=defaultdict(list)
for r in rows.values():groups[r['PitcherId']].append(r)
old={p['id']:p for p in season['pitchers']}
styles={s['type']:(s['label'],s['color']) for p in season['pitchers'] for s in p['summary']}
fields={'velocity':('RelSpeed',1),'spin':('SpinRate',1),'ivb':('InducedVertBreak',100),'hb':('HorzBreak',100),'releaseHeight':('RelHeight',1),'releaseSide':('RelSide',1),'extension':('Extension',1),'vertRelAngle':('VertRelAngle',1),'horzRelAngle':('HorzRelAngle',1),'vaa':('VertApprAngle',1),'haa':('HorzApprAngle',1),'spinAxis':('SpinAxis',1),'plateHeight':('PlateLocHeight',1),'plateSide':('PlateLocSide',1),'vertBreak':('VertBreak',100),'time':('ZoneTime',1)}
def num(v):
 try:
  x=float(v);return x if math.isfinite(x) else None
 except (ValueError,TypeError):return None
def circular(vals):
 vals=[v for v in vals if v is not None]
 if not vals:return None,0,None
 x=sum(math.cos(math.radians(v)) for v in vals)/len(vals);y=sum(math.sin(math.radians(v)) for v in vals)/len(vals)
 return round(math.degrees(math.atan2(y,x))%360,6),len(vals),round(math.hypot(x,y),6)
def clock(v):
 try:h,m=map(int,v.split(':'));return ((h%12)*60+m)/2
 except:return None
def tilt(v):
 if v is None:return None
 m=round(v*2)%720;return f'{m//60 or 12}:{m%60:02d}'
added=0
for pid,rs in groups.items():
 rs.sort(key=lambda r:(r['Date'],r['GameUID'],int(r['PitchNo'])))
 p=old.get(pid);path=base/(p['dataUrl'].split('?')[0] if p else f'data/2026-fall-{pid}.json')
 payload=json.loads(path.read_text()) if p else {'id':pid,'seasonId':'2026-fall','pitches':[]}
 existing={x['id']:x for x in payload['pitches']};previous=set(existing)
 for r in rs:
  if r['PitchUID'] in existing:continue
  x={'id':r['PitchUID'],'date':r['Date'],'inning':int(r['Inning']),'pitchNo':int(r['PitchNo']),'balls':int(r['Balls'] or 0),'strikes':int(r['Strikes'] or 0),'type':r['TaggedPitchType'] or 'Undefined'}
  x.update({k:(num(r.get(src))*scale if num(r.get(src)) is not None else None) for k,(src,scale) in fields.items() if k!='vertBreak'});x['tilt']=r['Tilt']
  c=[[num(r.get(f'PitchTrajectory{axis}c{i}')) for i in range(3)] for axis in 'XYZ'];t=x['time']
  complete=all(v is not None for a in c for v in a) and t is not None and 0<t<2
  if complete:
   # Raw coefficients already use forward / vertical / lateral axes.
   h=sum(c[1][i]*t**i for i in range(3));side=-sum(c[2][i]*t**i for i in range(3))
   complete=x['plateHeight'] is not None and x['plateSide'] is not None and math.hypot(h-x['plateHeight'],side-x['plateSide'])<0.5
  end=t
  if complete and sum(c[1][i]*t**i for i in range(3))<0:
   a,b,z=c[1][2],c[1][1],c[1][0];disc=b*b-4*a*z
   roots=[q for q in ((-b+math.sqrt(disc))/(2*a),(-b-math.sqrt(disc))/(2*a)) if 0<q<t] if disc>=0 and a else []
   if roots:end=round(min(roots),6)
  x.update(validTrajectory=complete,c=c if complete else None,flightEndTime=end,endsBeforePlate=complete and end<t)
  existing[x['id']]=x;added+=1
 payload['pitches']=[existing[r['PitchUID']] for r in rs]
 assert previous.issubset(existing)
 if p is None:
  n=names[rs[0]['PitchUID']];p={'id':pid,'name':n['pitcherKanji'],'team':n['pitcherTeam'],'throws':rs[0]['PitcherThrows'],'defaultIds':[]};season['pitchers'].append(p)
 n=names[rs[0]['PitchUID']];p['name']=n['pitcherKanji'] or n['pitcher'];p['team']=n['pitcherTeam']
 p['n']=len(rs);p['trajectoryN']=sum(x['validTrajectory'] for x in payload['pitches']);summary=[]
 for typ in sorted(set(x['type'] for x in payload['pitches']),key=lambda t:(t!='Fastball',-sum(x['type']==t for x in payload['pitches']))):
  rr=[r for r in rs if (r['TaggedPitchType'] or 'Undefined')==typ];xx=[x for x in payload['pitches'] if x['type']==typ];valid=[x for x in xx if x['validTrajectory']]
  metrics={};counts={}
  for k,(src,scale) in fields.items():
   vv=[num(r.get(src))*scale for r in rr if num(r.get(src)) is not None];metrics[k]=round(sum(vv)/len(vv),6) if vv else None;counts[k]=len(vv)
  axis,an,ac=circular([num(r['SpinAxis']) for r in rr]);tv,tn,tc=circular([clock(r['Tilt']) for r in rr]);metrics.update(spinAxis=axis,tilt=tilt(tv));counts.update(spinAxis=an,tilt=tn)
  prior=next((s for s in p.get('summary',[]) if s['type']==typ),None)
  representative=prior['representativeId'] if prior and any(x['id']==prior['representativeId'] for x in valid) else (min(valid,key=lambda x:abs((x['velocity'] or 0)-(metrics['velocity'] or 0)))['id'] if valid else None)
  label,color=styles.get(typ,(typ,'#82969c'))
  summary.append({'type':typ,'label':label,'color':color,'n':len(rr),'trajectoryN':len(valid),'metrics':metrics,'metricCounts':counts,'maxVelocity':max((x['velocity'] for x in xx if x['velocity'] is not None),default=None),'maxSpin':max((x['spin'] for x in xx if x['spin'] is not None),default=None),'spinAxis':axis,'spinAxisN':an,'spinAxisConcentration':ac,'tilt':tilt(tv),'tiltN':tn,'tiltConcentration':tc,'tiltAggregation':'circular mean of source clock values, rounded to nearest minute','representativeId':representative})
 p['summary']=summary
 if not p['defaultIds']:
  candidates=[x for x in payload['pitches'] if x['validTrajectory'] and x['type']=='Fastball' and x['plateHeight'] is not None and .45<=x['plateHeight']<=1.05 and abs(x['plateSide'])<=.25]
  if not candidates:candidates=[x for x in payload['pitches'] if x['validTrajectory']]
  p['defaultIds']=[x['id'] for x in candidates[:3]]
 path.parent.mkdir(parents=True,exist_ok=True);text=json.dumps(payload,ensure_ascii=False,separators=(',',':'));path.write_text(text);p['dataUrl']=str(path.relative_to(base))+'?v='+hashlib.sha256(text.encode()).hexdigest()[:12]
meta=season['meta'];meta.update(source=f"ID東都 2026秋季リーグ戦 TrackMan原本{len(manifest['files'])}ファイル（{last_date}まで）",sourceDateRange=[first_date,last_date],lastDate=last_date)
xx=[x for p in season['pitchers'] for x in json.loads((base/p['dataUrl'].split('?')[0]).read_text())['pitches']]
meta['counts'].update(rows=len(xx),pitchers=len(groups),games=dataset['metadata']['games'],uniquePitchUID=len(rows),usableTrajectories=sum(x['validTrajectory'] for x in xx),missingTrajectory=sum(not x['validTrajectory'] for x in xx),completeTrajectories=sum(x['validTrajectory'] for x in xx),groundClippedTrajectories=sum(x['endsBeforePlate'] for x in xx))
html=html[:match.start(1)]+json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+html[match.end(1):];(base/'index.html').write_text(html)
p=ROOT/'lib/generated/trajectory-studio.json';m=json.loads(p.read_text());m['seasons']['2026-fall'].update(pitches=len(xx),pitchers=len(groups),lastDate=last_date);p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'appended':added,'total':len(xx),'usable':sum(x['validTrajectory'] for x in xx),'pitchers':len(groups)}))
