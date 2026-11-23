import json,os
p=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))+'/public/data/recording.json'
raw=json.load(open(p));masters={};prev={};frames=[]
train_fields=['trainNumber','departureDate','trainType','trainCategory','commuterLineID','runningCurrently','cancelled']
row_fields=['stationShortCode','type','commercialStop','scheduledTime','liveEstimateTime','actualTime','differenceInMinutes','cancelled','commercialTrack','unknownDelay']
def normalize(t):return {**{k:t[k] for k in train_fields if k in t},'timeTableRows':[{k:r[k] for k in row_fields if k in r} for r in t['timeTableRows']]}
for f in raw['frames']:
 changes=[];active=[]
 for source in f['trains']:
  t=normalize(source);k=t['departureDate']+'/'+str(t['trainNumber']);active.append(k)
  if k not in masters:masters[k]=t;prev[k]=t
  old=prev[k];patch=[]
  if len(old['timeTableRows'])!=len(t['timeTableRows']):raise Exception('Timetable structure changed; full snapshot needed')
  for i,r in enumerate(t['timeTableRows']):
   fields=['actualTime','liveEstimateTime','unknownDelay','cancelled','differenceInMinutes','commercialTrack']
   diff={field:r.get(field) for field in fields if r.get(field)!=old['timeTableRows'][i].get(field)}
   if diff:patch.append([i,diff])
  if patch or old['runningCurrently']!=t['runningCurrently'] or old['cancelled']!=t['cancelled']:changes.append([k,t['runningCurrently'],t['cancelled'],patch])
  prev[k]=t
 frames.append({'capturedAt':f['capturedAt'],'locations':f['locations'],'active':active,'changes':changes})
packed={'format':'raide-delta-v1','source':raw['source'],'license':raw['license'],'trains':masters,'frames':frames}
json.dump(packed,open(p,'w'),ensure_ascii=False,separators=(',',':'));print('Packed',len(frames),'frames,',len(masters),'trains,',os.path.getsize(p),'bytes')
