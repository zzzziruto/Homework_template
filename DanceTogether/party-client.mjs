import {PROTOCOL,createSession,stepSession,viewSession} from './session.mjs';
const unique=()=>crypto.randomUUID();
const clone=value=>JSON.parse(JSON.stringify(value));
export function roomForLocation(location){
 // Both phones use the same folder URL. No room code or invitation is shown or required.
 const folder=new URL('.',location.href);const input=folder.origin+folder.pathname;
 let hash=2166136261;for(const c of input){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}
 return 'pair-'+(hash>>>0).toString(16);
}
export class PartyClient{
 constructor({party=globalThis.p5party,device,mobile,room=roomForLocation(location),onState=()=>{},onStatus=()=>{},onFull=()=>{}}){
  Object.assign(this,{party,device,mobile,room,onState,onStatus,onFull});
  this.started=false;this.ready=false;this.active=true;this.me=null;this.shared=null;this.hostState=null;this.wasHost=false;this.peers=new Map();
  this.seq=0;this.queue=[];this.current=null;this.stream=unique();this.offset=0;this.clockSynced=false;this.lastSnapshotAt=0;this.lastRevision=-1;this.lastEpoch=null;this.status=null;
 }
 async connect(){
  if(this.ready){this.join();return;}
  if(this.started)return this.connecting;
  this.started=true;
  this.connecting=(async()=>{
   if(!this.party)throw new Error('연결 파일을 불러오지 못했어요. 새로고침해주세요.');
   this.onStatus('connecting');
   await this.party.connect('wss://demoserver.p5party.org','yeji-dance-together-pages-v4',this.room);
   this.shared=await this.party.loadShared('session-v4',{snapshot:createSession(unique())});
   this.me=await this.party.loadMyShared({profile:{}});
   this.party.subscribe('clock-ping',data=>{
    if(this.party.isHost()&&data&&typeof data.stream==='string'&&Number.isFinite(data.sentAt))this.party.emit('clock-pong',{stream:data.stream,sentAt:data.sentAt,hostAt:Date.now()});
   });
   this.party.subscribe('clock-pong',data=>{
    if(data?.stream!==this.stream||!Number.isFinite(data.hostAt)||!Number.isFinite(data.sentAt))return;
    const now=Date.now();if(now-data.sentAt>2000)return;
    this.offset=data.hostAt-(data.sentAt+now)/2;this.clockSynced=true;
   });
   this.ready=true;this.join();
   this.timer=setInterval(()=>this.tick(),50);
   this.heartbeat=setInterval(()=>this.pulse(),1000);
   this.clockTimer=setInterval(()=>this.syncClock(),5000);
   this.pulse();this.tick();this.syncClock();
  })().catch(e=>{this.onStatus('error');throw e;});
  return this.connecting;
 }
 join(){
  if(!this.ready)return;
  this.active=true;this.stream=unique();this.seq=0;this.rejectQueue('연결을 다시 시작했어요.');this.lastFull=false;
  this.profile={protocol:PROTOCOL,id:this.device,stream:this.stream,kind:this.mobile?'mobile':'observer',active:true,joinedAt:Date.now(),ping:0,command:null};
  this.pulse();
 }
 pulse(){if(!this.me)return;this.profile.ping=Date.now();this.me.profile=clone(this.profile);}
 syncClock(){if(this.ready)this.party.emit('clock-ping',{stream:this.stream,sentAt:Date.now()});}
 tick(){
  if(!this.ready)return;
  const now=Date.now();const host=this.party.isHost();
  if(host){
   if(!this.wasHost||!this.hostState){this.hostState=clone(this.shared.snapshot);
    if(this.clockSynced&&this.offset){const shift=-this.offset;for(const key of ['deadline','startedAt','finishedAt','hostTime','lastShake'])if(Number.isFinite(this.hostState[key]))this.hostState[key]+=shift;this.hostState.members.forEach(m=>m.lastSeen+=shift);this.hostState.revision++;this.shared.snapshot=clone(this.hostState);}
    this.offset=0;this.clockSynced=true;}
   const profiles=[];
   for(const guest of [...this.party.loadGuestShareds(),this.me]){
    const p=guest?.profile;if(!p?.stream)continue;
    let seen=this.peers.get(p.stream);if(!seen||seen.ping!==p.ping){seen={ping:p.ping,at:now};this.peers.set(p.stream,seen);}
    profiles.push({...clone(p),observedAt:seen.at});
   }
   const dedup=[...new Map(profiles.map(p=>[p.stream,p])).values()];
   const next=stepSession(this.hostState,dedup,now);
   if(next){this.hostState=next;this.shared.snapshot=clone(next);}
  }
  this.wasHost=host;
  const snapshot=host?this.hostState:this.shared.snapshot;
  if(!snapshot||snapshot.protocol!==PROTOCOL)return;
  if(snapshot.epoch!==this.lastEpoch||snapshot.revision!==this.lastRevision){
   this.lastSnapshotAt=now;this.lastRevision=snapshot.revision;
   if(this.lastEpoch&&this.lastEpoch!==snapshot.epoch)this.rejectQueue('새로운 연결이 시작됐어요. 다시 시도해주세요.');
   this.lastEpoch=snapshot.epoch;
   if(!this.clockSynced)this.offset=snapshot.hostTime-now;
  }
  const live=now-this.lastSnapshotAt<8000;
  if(live!==this.status){this.status=live;this.onStatus(live?'online':'offline');}
  const view=viewSession(snapshot,this.device,now+this.offset);
  if(this.mobile&&this.active&&!view.admitted&&snapshot.members.length===2){
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
  if(!this.ready||!this.active)return Promise.reject(new Error('먼저 다시 연결해주세요.'));
  return new Promise((resolve,reject)=>{this.queue.push({name,body,resolve,reject});this.nextCommand();});
 }
 nextCommand(){
  if(this.current||!this.queue.length)return;
  const item=this.queue.shift();const snapshot=this.party.isHost()?this.hostState:this.shared.snapshot;
  item.seq=++this.seq;this.current=item;
  this.profile.command={seq:item.seq,name:item.name,body:item.body,epoch:snapshot.epoch,round:snapshot.round};this.pulse();
  item.timer=setTimeout(()=>{
   if(this.current!==item)return;this.current=null;this.profile.command=null;this.pulse();item.reject(new Error('연결이 지연되고 있어요. 다시 시도해주세요.'));this.nextCommand();
  },15000);
 }
 rejectQueue(message){
  if(this.current){clearTimeout(this.current.timer);this.current.reject(new Error(message));this.current=null;}
  for(const item of this.queue)item.reject(new Error(message));this.queue=[];
 }
 async leave(){
  try{await this.request('leave');}finally{this.active=false;if(this.profile){this.profile.active=false;this.pulse();}this.rejectQueue('이 기기에서 나왔어요.');}
 }
 destroy(){clearInterval(this.timer);clearInterval(this.heartbeat);clearInterval(this.clockTimer);this.rejectQueue('연결이 종료됐어요.');this.party.disconnect();}
}
