import {PROTOCOL,createSession,stepSession,viewSession} from './session.mjs?v=5';
const unique=()=>crypto.randomUUID();
const clone=value=>JSON.parse(JSON.stringify(value));
export const HOST_LEASE_MS=5000;
export const CONNECT_TIMEOUT_MS=20000;
export function selectAuthority(profiles,now){
 // Socket presence can outlive a suspended tab. Elect from live app heartbeats.
 const candidates=profiles.filter(p=>p?.protocol===PROTOCOL&&p.active&&p.visible!==false
  &&typeof p.stream==='string'&&Number.isFinite(p.observedAt)&&now-p.observedAt<HOST_LEASE_MS)
  .sort((a,b)=>(a.kind==='mobile'?0:1)-(b.kind==='mobile'?0:1)||a.joinedAt-b.joinedAt||a.stream.localeCompare(b.stream));
 return candidates[0]||null;
}
export function roomForLocation(location){
 // Both phones use the same folder URL. No room code or invitation is shown or required.
 const folder=new URL('.',location.href);const input=folder.origin+folder.pathname;
 let hash=2166136261;for(const c of input){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}
 return 'pair-'+(hash>>>0).toString(16);
}
export class PartyClient{
 constructor({party=globalThis.p5party,device,mobile,visible=true,room=roomForLocation(location),onState=()=>{},onStatus=()=>{},onFull=()=>{}}){
  Object.assign(this,{party,device,mobile,visible,room,onState,onStatus,onFull});
  this.started=false;this.ready=false;this.active=true;this.me=null;this.shared=null;this.hostState=null;this.wasHost=false;this.peers=new Map();
  this.destroyed=false;this.leaving=false;this.isAuthority=false;
  this.seq=0;this.queue=[];this.current=null;this.stream=unique();this.offset=0;this.clockSynced=false;this.lastSnapshotAt=0;this.lastRevision=-1;this.lastEpoch=null;this.status=null;
 }
 async connect(){
  if(this.destroyed)throw new Error('다시 연결 버튼으로 새로 시작해주세요.');
  if(this.ready){this.join();return;}
  if(this.started)return this.connecting;
  this.started=true;
  const startup=(async()=>{
   if(!this.party)throw new Error('연결 파일을 불러오지 못했어요. 새로고침해주세요.');
   this.onStatus('connecting');
   await this.party.connect('wss://demoserver.p5party.org','yeji-dance-together-pages-v'+PROTOCOL,this.room);
   if(this.destroyed)return;
   // Every transport record has one writer. Multiple hosts can briefly coexist
   // during discovery, so their snapshots must never share a writable record.
   this.shared={snapshot:null};
   this.me=await this.party.loadMyShared({profile:{},snapshot:null});
   if(this.destroyed)return;
   this.onClockPing=data=>{
    if(this.isAuthority&&!this.leaving&&data&&typeof data.stream==='string'&&Number.isFinite(data.sentAt))this.party.emit('clock-pong',{stream:data.stream,sentAt:data.sentAt,hostAt:Date.now()});
   };
   this.onClockPong=data=>{
    if(data?.stream!==this.stream||!Number.isFinite(data.hostAt)||!Number.isFinite(data.sentAt))return;
    const now=Date.now();if(now-data.sentAt>2000)return;
    this.offset=data.hostAt-(data.sentAt+now)/2;this.clockSynced=true;
   };
   this.party.subscribe('clock-ping',this.onClockPing);
   this.party.subscribe('clock-pong',this.onClockPong);
   this.ready=true;this.join();
   this.timer=setInterval(()=>this.tick(),50);
   this.heartbeat=setInterval(()=>this.pulse(),1000);
   this.clockTimer=setInterval(()=>this.syncClock(),5000);
   this.pulse();this.tick();this.syncClock();
  })();
  this.connecting=Promise.race([startup,new Promise((resolve,reject)=>{
   this.connectTimer=setTimeout(()=>reject(new Error('연결 준비가 지연되고 있어요. 다시 연결을 눌러주세요. Wi-Fi에서 계속 안 되면 모바일 데이터로도 확인해주세요.')),CONNECT_TIMEOUT_MS);
  })]).catch(e=>{if(!this.destroyed){this.onStatus('error');this.destroy();}throw e;})
   .finally(()=>clearTimeout(this.connectTimer));
  return this.connecting;
 }
 join(){
  if(!this.ready||this.leaving||this.destroyed)return;
  this.active=true;this.stream=unique();this.seq=0;this.rejectQueue('연결을 다시 시작했어요.');this.lastFull=false;
  this.admissionDeadline=Date.now()+2000;
  this.profile={protocol:PROTOCOL,id:this.device,stream:this.stream,kind:this.mobile?'mobile':'observer',active:true,visible:this.visible,joinedAt:Date.now(),ping:0,command:null};
  this.pulse();
 }
 pulse(){if(!this.me||this.destroyed)return;this.profile.ping=Date.now();this.me.profile=clone(this.profile);}
 setVisibility(visible){this.visible=visible;if(this.profile){this.profile.visible=visible;this.pulse();}if(visible){this.tick();this.syncClock();}}
 syncClock(){if(this.ready&&!this.leaving&&!this.destroyed)this.party.emit('clock-ping',{stream:this.stream,sentAt:Date.now()});}
 tick(){
  if(!this.ready||this.destroyed)return;
  const now=Date.now();const profiles=[];
  const guests=[...this.party.loadGuestShareds(),this.me];
  for(const guest of guests){
   const p=guest?.profile;if(!p?.stream)continue;
   let seen=this.peers.get(p.stream);if(!seen||seen.ping!==p.ping){seen={ping:p.ping,at:now};this.peers.set(p.stream,seen);}
   profiles.push({...clone(p),observedAt:seen.at});
  }
  const dedup=[...new Map(profiles.map(p=>[p.stream,p])).values()];
  const authority=selectAuthority(dedup,now);
  const host=authority?.stream===this.stream;this.isAuthority=host;
  const source=guests.find(g=>g?.profile?.stream===authority?.stream)?.snapshot;
  if(!host&&source?.protocol===PROTOCOL)this.shared.snapshot=clone(source);
  if(host){
   let takeover=false;
   if(!this.wasHost||!this.hostState){
    const backup=guests.map(g=>g?.snapshot).filter(s=>s?.protocol===PROTOCOL).sort((a,b)=>b.revision-a.revision)[0];
    this.hostState=clone(this.shared.snapshot||backup||createSession(unique(),now));
    if(this.clockSynced&&this.offset){const shift=-this.offset;for(const key of ['deadline','startedAt','finishedAt','hostTime','lastShake'])if(Number.isFinite(this.hostState[key]))this.hostState[key]+=shift;this.hostState.members.forEach(m=>m.lastSeen+=shift);this.hostState.revision++;}
    this.offset=0;this.clockSynced=true;takeover=true;}
   if(this.hostState.authority!==this.stream){this.hostState.authority=this.stream;this.hostState.revision++;takeover=true;}
   const next=stepSession(this.hostState,dedup,now);
   if(next||takeover){if(next)this.hostState=next;this.shared.snapshot=clone(this.hostState);}
  }
  this.wasHost=host;
  const snapshot=host?this.hostState:this.shared.snapshot;
  if(!snapshot||snapshot.protocol!==PROTOCOL)return;
  // Keep a per-device copy so a replacement host or a reloaded peer can resume.
  if(this.me.snapshot?.epoch!==snapshot.epoch||this.me.snapshot?.revision!==snapshot.revision)this.me.snapshot=clone(snapshot);
  if(snapshot.epoch!==this.lastEpoch||snapshot.revision!==this.lastRevision){
   this.lastSnapshotAt=now;this.lastRevision=snapshot.revision;
   if(this.lastEpoch&&this.lastEpoch!==snapshot.epoch)this.rejectQueue('새로운 연결이 시작됐어요. 다시 시도해주세요.');
   this.lastEpoch=snapshot.epoch;
   if(!this.clockSynced)this.offset=snapshot.hostTime-now;
  }
  const live=now-this.lastSnapshotAt<8000;
  if(live!==this.status){this.status=live;this.onStatus(live?'online':'offline');}
  const view=viewSession(snapshot,this.device,now+this.offset);
  if(this.mobile&&this.active&&!view.admitted&&view.online===2&&live&&this.clockSynced&&now>=this.admissionDeadline){
   if(!this.lastFull){this.lastFull=true;this.active=false;this.profile.active=false;this.pulse();this.onFull();}
  }else if((!this.mobile||view.admitted)&&(snapshot.revision!==this.renderedRevision||snapshot.epoch!==this.renderedEpoch||now-(this.lastRenderAt||0)>1000)){this.renderedRevision=snapshot.revision;this.renderedEpoch=snapshot.epoch;this.lastRenderAt=now;this.onState(view);}
  if(this.current){
   const ack=snapshot.acks[this.stream];
   if(ack&&ack.seq>=this.current.seq){
    const item=this.current;this.current=null;clearTimeout(item.timer);this.profile.command=null;this.pulse();
    if(ack.error)item.reject(new Error(ack.error));else item.resolve(view);
    this.nextCommand();
   }
  }
 }
 request(name,body={}){
  if(!this.ready||!this.active||this.destroyed||(this.leaving&&name!=='leave'))return Promise.reject(new Error('먼저 다시 연결해주세요.'));
  return new Promise((resolve,reject)=>{this.queue.push({name,body,resolve,reject});this.nextCommand();});
 }
 nextCommand(){
  if(this.current||!this.queue.length)return;
  const item=this.queue.shift();const snapshot=this.isAuthority?this.hostState:this.shared.snapshot;
  item.seq=++this.seq;this.current=item;
  this.profile.command={seq:item.seq,name:item.name,body:item.body,epoch:snapshot.epoch,round:snapshot.round};this.pulse();
  item.timer=setTimeout(()=>{
   if(this.current!==item)return;this.current=null;this.profile.command=null;this.pulse();item.reject(new Error('연결이 지연되고 있어요. 다시 시도해주세요.'));this.nextCommand();
  },item.name==='leave'?1500:15000);
 }
 rejectQueue(message){
  if(this.current){clearTimeout(this.current.timer);this.current.reject(new Error(message));this.current=null;}
  for(const item of this.queue)item.reject(new Error(message));this.queue=[];
 }
 async leave(){
  if(this.destroyed||this.leaving)return;
  this.leaving=true;this.rejectQueue('이 기기에서 나왔어요.');
  try{if(this.ready&&this.active)await this.request('leave');}
  finally{this.destroy();}
 }
 destroy(){
  if(this.destroyed)return;
  this.active=false;
  if(this.profile){this.profile.active=false;this.profile.command=null;this.pulse();}
  this.destroyed=true;this.ready=false;this.isAuthority=false;
  clearInterval(this.timer);clearInterval(this.heartbeat);clearInterval(this.clockTimer);
  clearTimeout(this.connectTimer);
  this.rejectQueue('연결이 종료됐어요.');
  if(this.onClockPing)this.party.unsubscribe('clock-ping',this.onClockPing);
  if(this.onClockPong)this.party.unsubscribe('clock-pong',this.onClockPong);
  this.party?.disconnect();
  this.me=null;this.profile=null;this.shared=null;this.hostState=null;this.device=null;this.stream=null;this.peers.clear();
 }
}
