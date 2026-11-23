import urllib.request,json,gzip,datetime,time,os,math
BASE='https://rata.digitraffic.fi/api/v1/'
def get(p):
 r=urllib.request.urlopen(urllib.request.Request(BASE+p,headers={'Accept':'application/json','Accept-Encoding':'gzip','Digitraffic-User':'raide-portfolio'}),timeout=30);b=r.read();return json.loads(gzip.decompress(b) if r.headers.get('Content-Encoding')=='gzip' else b)
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))+'/public/data/'
now=datetime.datetime.now(datetime.timezone.utc);date=now.astimezone(datetime.timezone(datetime.timedelta(hours=2))).strftime('%Y-%m-%d')
trains=get('trains/'+date);json.dump(trains,open(root+'trains.json','w'));print('daily trains',len(trains),flush=True)
frames=[]
for i in range(15):
 try:
  locations=get('train-locations/latest/')
  if i%2==0:trains=get('trains/'+date)
  active=[t for t in trains if t.get('runningCurrently') or any(l['trainNumber']==t['trainNumber'] and l['departureDate']==t['departureDate'] for l in locations)]
  frame={'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'locations':locations,'trains':active};frames.append(frame)
  json.dump({'source':'Fintraffic / Digitraffic','license':'CC BY 4.0','frames':frames},open(root+'recording.json','w'),ensure_ascii=False,separators=(',',':'));print('frame',i,len(active),len(locations),frame['capturedAt'],flush=True)
 except Exception as e:print('capture failed',str(e),flush=True)
 if i<14:time.sleep(30)
