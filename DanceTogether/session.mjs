// Pure session rules. Only the p5.party host publishes the returned state.
export const PROTOCOL=4;
export const COLORS=['#ff00ff','#ceff60','#00e5e9','#ff98da','#ff7845'];
const copy=value=>JSON.parse(JSON.stringify(value));
const validId=value=>typeof value==='string'&&/^[a-f0-9-]{16,64}$/.test(value);
export function initialControls(){return {angleL:0,angleR:0,tempoL:.5,tempoR:.1,volumeL:.8,volumeR:.3,padL:2,padR:1,pressedL:null,pressedR:null,playingL:false,playingR:false};}
export function createSession(epoch,now=Date.now()){
 return {protocol:PROTOCOL,epoch,revision:0,phase:'waiting',deadline:null,startedAt:null,finishedAt:null,remaining:100,round:1,controls:initialControls(),members:[],acks:{},excluded:[],events:[],lastShake:-1e20,hostTime:now};
}
function begin(s,now){s.phase='countdown';s.deadline=now+3000;s.remaining=100;s.controls=initialControls();s.events=[];s.lastShake=-1e20;s.startedAt=null;s.finishedAt=null;s.members.forEach(m=>m.role=null);}
function command(s,member,peer,c,now){
 if(c.epoch!==s.epoch)throw new Error('연결 정보가 바뀌었어요. 다시 시도해주세요.');
 if(c.name==='leave'){
  s.excluded=[...s.excluded,peer.stream].slice(-32);s.members=s.members.filter(m=>m.id!==member.id);
  // The other phone must still be able to leave from its completion screen.
  if(s.phase!=='complete'||!s.members.length){s.round++;s.phase='waiting';s.deadline=null;s.members.forEach(m=>m.role=null);}
  s.controls.pressedL=s.controls.pressedR=null;return;
 }
 if(c.round!==s.round)throw new Error('새 라운드가 시작됐어요. 다시 시도해주세요.');
 if(c.name==='restart'){
  if(s.phase!=='complete')throw new Error('완료 후 다시 시작할 수 있어요.');
  s.round++;if(s.members.length===2&&s.members.every(m=>now-m.lastSeen<15000))begin(s,now);else{s.phase='waiting';s.deadline=null;}return;
 }
 if(c.name==='shake'){
  if(member.role!=='dancer')throw new Error('댄서의 움직임만 기록해요.');
  if(typeof c.body?.event!=='string'||!c.body.event||c.body.event.length>100)throw new Error('움직임 정보가 올바르지 않아요.');
  if(s.phase!=='playing'||s.events.includes(c.body.event)||now-s.lastShake<250)return;
  s.events=[...s.events,c.body.event].slice(-1000);s.lastShake=now;s.remaining=Math.max(0,s.remaining-1);
  if(s.remaining===0){s.phase='complete';s.finishedAt=now;s.controls.pressedL=s.controls.pressedR=null;}return;
 }
 if(c.name==='controls'){
  if(member.role!=='dj')throw new Error('DJ만 박스를 조작할 수 있어요.');
  if(s.phase!=='playing')return;
  const patch=c.body?.patch;if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('조작 정보가 올바르지 않아요.');
  const clean={};for(const [key,value] of Object.entries(patch)){
   if(!Object.hasOwn(s.controls,key))throw new Error('알 수 없는 컨트롤이에요.');
   if(key.startsWith('playing')){if(typeof value!=='boolean')throw new Error('재생 상태가 올바르지 않아요.');clean[key]=value;}
   else if(key.startsWith('pressed')&&value===null)clean[key]=null;
   else{
    if(typeof value!=='number'||!Number.isFinite(value))throw new Error('숫자 값이 올바르지 않아요.');
    const [low,high]=key.startsWith('angle')?[-1000000,1000000]:/^(pad|pressed)/.test(key)?[0,2]:[0,1];
    clean[key]=Math.max(low,Math.min(high,value));if(/^(pad|pressed)/.test(key))clean[key]=Math.trunc(clean[key]);
   }
  }Object.assign(s.controls,clean);return;
 }
 throw new Error('알 수 없는 요청이에요.');
}
export function stepSession(previous,profiles,now,random=Math.random){
 const s=copy(previous);const before=JSON.stringify(s);
 const all=profiles.filter(p=>p&&p.protocol===PROTOCOL&&validId(p.id)&&validId(p.stream)&&Number.isFinite(p.observedAt));
 // One active tab per physical device; observers never reserve either player slot.
 const mobile=new Map();for(const p of all){
  if(p.kind!=='mobile'||!p.active||s.excluded.includes(p.stream)||now-p.observedAt>=15000)continue;
  const current=mobile.get(p.id);if(!current||p.joinedAt>current.joinedAt||(p.joinedAt===current.joinedAt&&p.stream>current.stream))mobile.set(p.id,p);
 }
 let removed=false;
 for(const m of [...s.members]){
  const p=mobile.get(m.id);
  if(p){m.lastSeen=p.observedAt;m.stream=p.stream;}
  else if(all.some(p=>p.id===m.id&&p.stream===m.stream&&p.active===false)||now-m.lastSeen>=60000){s.members=s.members.filter(x=>x.id!==m.id);removed=true;}
 }
 if(removed){if(s.phase!=='complete'||!s.members.length){s.phase='waiting';s.deadline=null;s.members.forEach(m=>m.role=null);s.round++;}s.controls.pressedL=s.controls.pressedR=null;}
 const newcomers=[...mobile.values()].sort((a,b)=>a.joinedAt-b.joinedAt||a.id.localeCompare(b.id));
 for(const p of newcomers){
  if(s.members.length===2)break;
  if(!s.members.some(m=>m.id===p.id)){
   if(s.phase==='complete'){s.round++;s.phase='waiting';s.deadline=null;s.members.forEach(m=>m.role=null);}
   s.members.push({id:p.id,stream:p.stream,role:null,lastSeen:p.observedAt});
  }
 }
 const bothLive=s.members.length===2&&s.members.every(m=>mobile.has(m.id));
 if(s.phase==='waiting'&&bothLive)begin(s,now);
 if((s.phase==='countdown'||s.phase==='role')&&!bothLive){s.phase='waiting';s.deadline=null;s.members.forEach(m=>m.role=null);}
 if(s.phase==='countdown'&&now>=s.deadline){
  const dancer=random()<.5?0:1;s.members.forEach((m,i)=>m.role=i===dancer?'dancer':'dj');s.phase='role';s.deadline+=2000;
 }
 if(s.phase==='role'&&now>=s.deadline){s.phase='playing';s.startedAt=s.deadline;s.deadline=null;}
 for(const member of [...s.members]){
  const p=mobile.get(member.id);if(!p||p.stream!==member.stream)continue;
  const c=p.command;if(!c||!Number.isSafeInteger(c.seq)||c.seq<1||c.seq<=(s.acks[p.stream]?.seq||0))continue;
  let error=null;try{command(s,member,p,c,now);}catch(e){error=e.message;}
  s.acks[p.stream]={seq:c.seq,error};
 }
 if(now-s.hostTime>=1000)s.hostTime=now;
 // Keep acknowledgements bounded while retaining active and recently connected clients.
 const ackKeys=Object.keys(s.acks);if(ackKeys.length>64)for(const key of ackKeys.slice(0,ackKeys.length-64))if(!s.members.some(m=>m.stream===key))delete s.acks[key];
 if(JSON.stringify(s)===before)return null;
 s.revision=previous.revision+1;return s;
}
export function viewSession(s,id,now=Date.now()){
 return {epoch:s.epoch,phase:s.phase,deadline:s.deadline===null?null:s.deadline/1000,role:s.members.find(m=>m.id===id)?.role||null,
  admitted:s.members.some(m=>m.id===id),online:s.members.filter(m=>now-m.lastSeen<15000).length,remaining:s.remaining,round:s.round,revision:s.revision,
  serverTime:now/1000,color:s.phase==='complete'?'#ffff45':COLORS[(100-s.remaining)%COLORS.length],controls:copy(s.controls),startedAt:s.startedAt,finishedAt:s.finishedAt};
}
