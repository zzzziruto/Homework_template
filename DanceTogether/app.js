import { PartyClient } from './party-client.mjs';
import { createMotionSensor } from './motion.mjs';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const DEVICE_KEY = 'dance-together-v3-device';
function isMobileDevice(nav,coarse){
  const ua=nav.userAgent||'';
  return /Android|iPhone|iPad|iPod/i.test(ua)
    || (/Mac/i.test(nav.platform||'') && nav.maxTouchPoints>1)
    || (nav.maxTouchPoints>0 && coarse);
}
const IS_MOBILE=isMobileDevice(navigator,matchMedia('(pointer: coarse)').matches);
let device = localStorage.getItem(DEVICE_KEY);
if (!device) {
  device = Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(16).padStart(2,'0')).join('');
  localStorage.setItem(DEVICE_KEY,device);
}
let state=null, online=false, joined=false, closed=false, clockOffset=0, pending={}, inFlight={}, sending=false, sendTimer;
let lastShake=-Infinity, shakeArmed=true, previousGravity=null, motionEnabled=false;
let wheelDrag=null, sliderDrag=null, angles={L:0,R:0}, lastServerAngles={L:null,R:null};
let celebration='', messageTimer, connectionTimer, visibleScreen='';

function notify(message) {
  if(closed)return;
  $('#toast').textContent=message; $('#toast').classList.remove('hidden');
  clearTimeout(messageTimer);messageTimer=setTimeout(()=>$('#toast').classList.add('hidden'),4000);
}
function accept(next) {
  if(closed)return;
  if(state && next.epoch===state.epoch && next.revision<state.revision)return;
  const changed=state && state.remaining!==next.remaining;
  const newRound=state && state.round!==next.round;
  clockOffset=next.serverTime*1000-Date.now();
  state=next;
  if(newRound){celebration='';clearConfetti();}
  render(changed);
}
function screen(id) {
  if(visibleScreen!==id){$$('.screen').forEach(el=>el.classList.toggle('hidden',el.id!==id));visibleScreen=id;}
  document.body.classList.toggle('is-dancer',id==='dancer');
}
function render(changed=false) {
  if(!state)return;
  if(!IS_MOBILE){
    screen('monitor');
    $('#mobile-count').textContent=`${state.online} / 2`;
    const labels={waiting:'모바일 기기를 기다리는 중',countdown:'3초 뒤 역할 배정',role:'두 모바일 기기에 역할 배정 중',playing:'DJ와 DANCER가 플레이 중',complete:'둘이 함께 목표 달성!'};
    $('#mobile-phase').textContent=labels[state.phase]||'';
    $('#connection').textContent=online?'연결됨':'다시 연결하는 중…';
    return;
  }
  const phase=state.phase;
  $('#connection').textContent=online?(state.online===2?'둘이 연결됨':phase==='complete'?'친구가 나갔어요.':'친구를 기다리는 중'):'다시 연결하는 중…';
  if(phase==='waiting'||phase==='countdown'){
    screen('waiting');$('#waiting').classList.toggle('counting',phase==='countdown');
    $('#waiting-note').textContent=phase==='countdown'?'잠시 후 역할이 정해져요.':'친구를 기다리고 있어요.';
    $('#waiting-description').textContent=phase==='countdown'?'':'두 사람이 접속하면 3초 뒤 역할이 정해져요.';
    countdown();
  }else if(phase==='role'){
    screen('role');$('#role-title').textContent=state.role==='dancer'?'DANCER!':'DJ!';
  }else{
    screen(state.role==='dancer'?'dancer':'dj');
    const complete=phase==='complete';
    document.documentElement.style.setProperty('--beat',state.color);
    $('#dancer-number').textContent=complete?'COMPLETE!':state.remaining;
    $('#dj-number').textContent=complete?'COMPLETE!':state.remaining;
    $('#dancer-number').classList.toggle('complete',complete);$('#dj-number').classList.toggle('complete',complete);
    $('#dancer-number').setAttribute('aria-label',complete?'목표 달성':`남은 흔들기 ${state.remaining}회`);
    $('#motion-tools').classList.toggle('hidden',complete);
    $$('.complete-actions').forEach(el=>el.classList.toggle('hidden',!complete));
    $$('.restart').forEach(el=>el.disabled=state.online<2);
    $('#rotate-hint').classList.toggle('hidden',complete);
    if(changed){$('#dancer-number').classList.remove('bump');void $('#dancer-number').offsetWidth;$('#dancer-number').classList.add('bump');}
    renderControls();
    if(complete && celebration!==String(state.round)){celebration=String(state.round);confetti();}
  }
}
function countdown(){if(state?.phase==='countdown')$('#waiting-title').textContent=Math.max(1,Math.ceil((state.deadline*1000-Date.now()-clockOffset)/1000));else if(state?.phase==='waiting')$('#waiting-title').textContent='LET’S DANCE!';}
const countdownTimer=setInterval(countdown,80);
function renderControls(){
  if(!state)return;
  const c={...state.controls,...inFlight,...pending};
  $$('[data-slider]').forEach(el=>{
    if(sliderDrag?.el===el)return;
    const value=c[el.dataset.slider];
    el.querySelector('.handle').style.top=`${(1-value)*(el.dataset.slider.startsWith('tempo')?76:85)}%`;
    el.setAttribute('aria-valuenow',Math.round(value*100));
  });
  $$('[data-pad]').forEach(el=>{
    const [side,n]=el.dataset.pad;
    el.classList.toggle('selected',c['pad'+side]===+n);
    el.classList.toggle('pressed',c['pressed'+side]===+n);
    el.setAttribute('aria-pressed',c['pad'+side]===+n);
  });
  $$('[data-play]').forEach(el=>el.setAttribute('aria-pressed',c['playing'+el.dataset.play]));
  for(const side of ['L','R']){
    const value=c['angle'+side];
    if(value!==lastServerAngles[side] && wheelDrag?.side!==side)angles[side]=value;
    lastServerAngles[side]=value;
  }
}
const client=new PartyClient({device,mobile:IS_MOBILE,
  onState(next){if(!closed)accept(next);},
  onStatus(status){
    if(closed)return;
    online=status==='online';
    $('#connection').textContent=online?'연결됨':status==='connecting'?'연결하는 중…':'다시 연결하는 중…';
    if(!online&&status!=='connecting'){$('#reconnect').classList.remove('hidden');}
    if(state&&!closed)render();
  },
  onFull(){
    joined=false;closed=true;screen('waiting');$('#waiting-note').textContent='두 사람이 이미 접속 중이에요.';
    $('#waiting-title').textContent='LET’S DANCE!';$('#waiting-description').textContent='기존 기기에서 나간 뒤 다시 연결해주세요.';
    $('#reconnect').classList.remove('hidden');
  }
});
async function connect(){
  closed=false;$('#reconnect').classList.add('hidden');
  clearTimeout(connectionTimer);connectionTimer=setTimeout(()=>{
    if(!joined&&!closed){$('#waiting-note').textContent='연결이 조금 늦어지고 있어요.';$('#waiting-description').textContent='인터넷 연결을 확인한 뒤 다시 연결해주세요.';$('#reconnect').classList.remove('hidden');}
  },15000);
  try{await client.connect();if(!closed)joined=true;}
  catch(error){if(closed)return;joined=false;$('#waiting-note').textContent='연결을 확인해주세요.';$('#waiting-description').textContent=error.message;$('#reconnect').classList.remove('hidden');notify(error.message);}
  finally{clearTimeout(connectionTimer);}
}
document.addEventListener('visibilitychange',()=>{if(!closed&&!document.hidden){client.pulse();client.syncClock();if(motionEnabled)keepAwake();}});
$('#reconnect').addEventListener('click',()=>{if(closed||!online)location.reload();else connect();});
async function act(name,body={}){const next=await client.request(name,body);if(!closed)accept(next);return next;}
function canControl(){return !closed&&IS_MOBILE&&online&&state?.phase==='playing'&&state.role==='dj';}
function queue(patch,immediate=false){
  if(!canControl())return;
  Object.assign(pending,patch);renderControls();
  clearTimeout(sendTimer);sendTimer=setTimeout(flush,immediate?0:35);
}
async function flush(){
  if(closed||sending||!Object.keys(pending).length)return;
  sending=true;const patch=pending;pending={};inFlight=patch;
  try{accept(await client.request('controls',{patch}));}
  catch(error){online=false;notify(error.message);}
  finally{sending=false;inFlight={};renderControls();if(Object.keys(pending).length)flush();}
}

// Native pointer events are shared by mouse, touch and pen.
function polar(event,el){const r=el.getBoundingClientRect();return Math.atan2(event.clientY-r.top-r.height/2,event.clientX-r.left-r.width/2)*180/Math.PI;}
$$('[data-wheel]').forEach(el=>{
  const side=el.dataset.wheel;
  el.addEventListener('pointerdown',event=>{
    if(!canControl()||wheelDrag)return;
    event.preventDefault();el.focus({preventScroll:true});el.setPointerCapture(event.pointerId);
    wheelDrag={side,pointer:event.pointerId,angle:polar(event,el)};el.classList.add('dragging');
  });
  el.addEventListener('pointermove',event=>{
    if(wheelDrag?.side!==side||wheelDrag.pointer!==event.pointerId)return;
    const next=polar(event,el);let delta=next-wheelDrag.angle;
    if(delta>180)delta-=360;if(delta< -180)delta+=360;
    angles[side]+=delta;wheelDrag.angle=next;queue({['angle'+side]:angles[side]});
  });
  const release=event=>{
    if(wheelDrag?.side!==side||event.pointerId!==wheelDrag.pointer)return;
    wheelDrag=null;el.classList.remove('dragging');queue({['angle'+side]:angles[side]},true);
  };
  for(const name of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(name,release);
  el.addEventListener('keydown',event=>{
    if(!canControl()||!['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();angles[side]+=event.key==='ArrowLeft'?-15:15;queue({['angle'+side]:angles[side]},true);
  });
});
$$('[data-slider]').forEach(el=>{
  const key=el.dataset.slider;
  function move(event){
    const r=el.getBoundingClientRect(),knob=key.startsWith('tempo')?.24:.15;
    const value=Math.max(0,Math.min(1,1-(event.clientY-r.top-r.height*knob/2)/(r.height*(1-knob))));
    el.querySelector('.handle').style.top=`${(1-value)*(key.startsWith('tempo')?76:85)}%`;
    el.setAttribute('aria-valuenow',Math.round(value*100));queue({[key]:value});
  }
  el.addEventListener('pointerdown',event=>{
    if(!canControl()||sliderDrag)return;
    event.preventDefault();el.focus({preventScroll:true});el.setPointerCapture(event.pointerId);sliderDrag={el,pointer:event.pointerId};move(event);
  });
  el.addEventListener('pointermove',event=>{if(sliderDrag?.el===el&&sliderDrag.pointer===event.pointerId)move(event);});
  const release=event=>{
    if(sliderDrag?.el!==el||sliderDrag.pointer!==event.pointerId)return;
    sliderDrag=null;flush();
  };
  for(const name of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(name,release);
  el.addEventListener('keydown',event=>{
    if(!canControl()||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();let value=pending[key]??state.controls[key];
    value=event.key==='Home'?0:event.key==='End'?1:Math.max(0,Math.min(1,value+(['ArrowUp','ArrowRight'].includes(event.key)?.03:-.03)));
    queue({[key]:value},true);
  });
});
$$('[data-pad]').forEach(el=>{
  const [side,index]=el.dataset.pad;
  const down=()=>queue({['pad'+side]:+index,['pressed'+side]:+index},true);
  const up=()=>queue({['pressed'+side]:null},true);
  el.addEventListener('pointerdown',event=>{if(!canControl())return;event.preventDefault();el.setPointerCapture(event.pointerId);down();});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(name,up);
  el.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)&&!event.repeat){event.preventDefault();down();}});
  el.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key))up();});
});
$$('[data-play]').forEach(el=>el.addEventListener('click',()=>{
  if(!canControl())return;const side=el.dataset.play,key='playing'+side;
  queue({[key]:!(pending[key]??state.controls[key]),['angle'+side]:angles[side]},true);
}));
let lastFrame=performance.now(),wheelFrame=0;
function animateWheels(now){
  if(closed)return;
  const dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now;
  for(const side of ['L','R']){
    const c=state?.controls;
    if(state?.phase==='playing'&&(pending['playing'+side]??c['playing'+side])&&wheelDrag?.side!==side)angles[side]+=dt*(30+100*(pending['tempo'+side]??c['tempo'+side]));
    const el=$(`[data-wheel="${side}"]`);el.firstElementChild.style.transform=`rotate(${angles[side]}deg)`;
    el.setAttribute('aria-valuenow',Math.round((angles[side]%360+360)%360));
  }
  wheelFrame=requestAnimationFrame(animateWheels);
}
wheelFrame=requestAnimationFrame(animateWheels);

async function shake(){
  if(closed||!online||state?.role!=='dancer'||state.phase!=='playing'||performance.now()-lastShake<320)return;
  lastShake=performance.now();
  const event=Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('');
  try{await act('shake',{event});}catch(error){notify(error.message);}
}
function motion(event){
  let force=0;const a=event.acceleration;
  if(a&&[a.x,a.y,a.z].every(Number.isFinite))force=Math.hypot(a.x,a.y,a.z);
  else{
    const g=event.accelerationIncludingGravity;
    if(g&&[g.x,g.y,g.z].every(Number.isFinite)){
      if(previousGravity)force=Math.hypot(g.x-previousGravity.x,g.y-previousGravity.y,g.z-previousGravity.z);
      previousGravity={x:g.x,y:g.y,z:g.z};
    }
  }
  if(force<5)shakeArmed=true;
  if(force>12&&shakeArmed){shakeArmed=false;shake();}
}
const sensor=createMotionSensor(window,{onSample:motion,onStatus(status){motionEnabled=status==='on';}});
let screenLock=null,requestingLock=false;
async function keepAwake(){
  if(closed||!motionEnabled||screenLock||requestingLock||document.hidden)return;
  requestingLock=true;
  try{
    const lock=await navigator.wakeLock?.request('screen');
    if(!lock)return;
    if(closed||!motionEnabled){await lock.release();return;}
    screenLock=lock;lock.addEventListener('release',()=>{if(screenLock===lock)screenLock=null;});
  }catch{}finally{requestingLock=false;}
}
$('#enable-motion').addEventListener('click',async()=>{
  if(closed)return;
  const button=$('#enable-motion');button.disabled=true;
  $('#motion-message').textContent='접근을 물으면 허용을 눌러주세요.';
  try{
    await sensor.enable();if(closed)return;motionEnabled=true;button.classList.add('hidden');
    $('#motion-message').textContent='움직임 감지 ON · 폰을 쥐고 춤춰요';keepAwake();
  }catch(error){if(!closed){$('#motion-message').textContent=error.message;notify(error.message);}}
  finally{button.disabled=false;}
});
$('#demo-shake').addEventListener('click',shake);
$$('.restart').forEach(el=>el.addEventListener('click',()=>act('restart').catch(error=>notify(error.message))));
$('#help-button').addEventListener('click',()=>$('#help').showModal());
$$('.close-dialog').forEach(el=>el.addEventListener('click',()=>el.closest('dialog').close()));
$('#open-network').addEventListener('click',()=>{$('#help').close();$('#network').showModal();});
async function leaveSession(){
  if(closed)return;
  closed=true;joined=false;online=false;state=null;pending={};inFlight={};
  clearTimeout(sendTimer);clearTimeout(messageTimer);clearTimeout(connectionTimer);clearInterval(countdownTimer);
  cancelAnimationFrame(wheelFrame);clearConfetti();celebration='';
  sensor.stop();motionEnabled=false;previousGravity=null;shakeArmed=true;lastShake=-Infinity;
  screenLock?.release().catch(()=>{});screenLock=null;
  wheelDrag=null;sliderDrag=null;$$('.dragging').forEach(el=>el.classList.remove('dragging'));
  localStorage.removeItem(DEVICE_KEY);device=null;
  $('#enable-motion').classList.remove('hidden');$('#motion-message').textContent='';$('#toast').classList.add('hidden');
  $$('dialog[open]').forEach(el=>el.close());$$('.complete-actions').forEach(el=>el.classList.add('hidden'));
  $('#waiting').classList.remove('counting');screen('waiting');
  $('#waiting-note').textContent='이 기기에서 나왔어요.';$('#waiting-title').textContent='LET’S DANCE!';
  $('#waiting-description').textContent='참가 정보와 움직임 감지를 정리했어요. 연결을 종료하는 중…';
  $('#reconnect').classList.add('hidden');$('#connection').textContent='';
  try{await client.leave();}catch{} // Always disconnect, even if the host cannot acknowledge leaving.
  $('#waiting-description').textContent='참가 정보, 서버 연결, 움직임 감지를 종료했어요. 다시 연결하면 새로 시작해요.';
  $('#reconnect').classList.remove('hidden');
}
$('#leave').addEventListener('click',leaveSession);
$$('.leave-session').forEach(el=>el.addEventListener('click',leaveSession));

const canvas=$('#confetti'),ctx=canvas.getContext('2d');let confettiFrame=0;
function sizeCanvas(){canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);}
window.addEventListener('resize',sizeCanvas);sizeCanvas();
function clearConfetti(){cancelAnimationFrame(confettiFrame);ctx.clearRect(0,0,innerWidth,innerHeight);}
function confetti(){
  clearConfetti();const start=performance.now(),colors=['#ff00ef','#00e5e9','#ceff60','#ff7845','#ff98da','#ffff45','#a43dba'];
  const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;
  const pieces=Array.from({length:reduced?50:280},()=>({x:Math.random()*innerWidth,y:Math.random()*innerHeight-innerHeight,dx:Math.random()*2-1,dy:1.2+Math.random()*2.6,angle:Math.random()*6.28,spin:Math.random()*.12-.06,w:5+Math.random()*7,h:6+Math.random()*9,color:colors[Math.floor(Math.random()*colors.length)]}));
  let previous=start;
  function frame(now){
    const dt=Math.min(2,(now-previous)/16.67);previous=now;ctx.clearRect(0,0,innerWidth,innerHeight);
    for(const p of pieces){
      if(!reduced){p.x+=p.dx*dt;p.y+=p.dy*dt;p.angle+=p.spin*dt;}
      ctx.save();ctx.translate(p.x,reduced?p.y+innerHeight:p.y);ctx.rotate(p.angle);ctx.fillStyle=p.color;ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);ctx.fillStyle='#ffffff70';ctx.fillRect(-p.w/2,-p.h/2,p.w,1.5);ctx.restore();
      if(p.y>innerHeight+20&&now-start<9000)p.y=-20;
    }
    if(!reduced&&now-start<14000)confettiFrame=requestAnimationFrame(frame);
  }
  confettiFrame=requestAnimationFrame(frame);
}
function info(){
  const link=new URL('.',location.href);link.search='';link.hash='';
  for(const id of ['#addresses','#mobile-links']){
    const a=document.createElement('a');a.href=link.href;a.textContent=link.href;$(id).replaceChildren(a);
  }
}
if(!IS_MOBILE){screen('monitor');$('#leave').classList.add('hidden');}
info();connect();
