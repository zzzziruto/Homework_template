import test from 'node:test';
import assert from 'node:assert/strict';
import {PROTOCOL,createSession,stepSession,viewSession} from '../session.mjs';
const a='a'.repeat(36),b='b'.repeat(36),c='c'.repeat(36),d='d'.repeat(36);
const peer=(id,at=0,kind='mobile',stream=id)=>({protocol:PROTOCOL,id,stream,kind,active:true,joinedAt:at,ping:at,observedAt:at,command:null});
function fixture(){let s=createSession('test-epoch',0);const peers=[peer(a),peer(b)];let time=0;
 const tick=(at=time)=>{time=at;for(const p of peers)p.observedAt=at;const n=stepSession(s,peers,at,()=>0);if(n)s=n;return s;};
 const send=(id,name,body={},at=time)=>{const p=peers.find(p=>p.id===id);p.command={seq:(s.acks[p.stream]?.seq||0)+1,epoch:s.epoch,round:s.round,name,body};return tick(at);};
 return {peers,tick,send,get state(){return s;}};
}
test('a computer observes; two phones automatically count down and get exactly one role each',()=>{
 const f=fixture();f.peers.splice(1);f.peers.push(peer(c,0,'observer'));assert.equal(f.tick().phase,'waiting');assert.equal(f.state.members.length,1);
 f.peers.push(peer(b,1));assert.equal(f.tick(1).phase,'countdown');assert.ok(f.state.members.every(m=>m.role===null));
 assert.equal(f.tick(3000).phase,'countdown');assert.equal(f.tick(3001).phase,'role');assert.deepEqual(f.state.members.map(m=>m.role).sort(),['dancer','dj']);
 assert.equal(f.tick(5000).phase,'role');assert.equal(f.tick(5001).phase,'playing');assert.equal(viewSession(f.state,a,5001).role,'dancer');
});
test('a third device cannot replace active players and a second tab does not count as a phone',()=>{
 const f=fixture();f.tick();f.peers.push(peer(c,1),peer(a,2,'mobile',d));f.tick(2);
 assert.deepEqual(f.state.members.map(m=>m.id),[a,b]);assert.equal(f.state.members.find(m=>m.id===a).stream,d);
});
test('counts are shared, duplicate commands are ignored, completion and replay preserve rules',()=>{
 const f=fixture();f.tick();f.tick(5000);
 const first=f.send(a,'shake',{event:'one'},5320);assert.equal(first.remaining,99);
 f.tick(5700);assert.equal(f.state.remaining,99);
 f.send(a,'shake',{event:'one'},6020);assert.equal(f.state.remaining,99);
 for(let i=1;i<100;i++)f.send(a,'shake',{event:'shake-'+i},6020+i*320);
 assert.equal(f.state.remaining,0);assert.equal(f.state.phase,'complete');assert.equal(viewSession(f.state,b).remaining,0);
 f.send(b,'restart',{},40000);assert.equal(f.state.phase,'countdown');assert.equal(f.state.round,2);assert.equal(f.state.remaining,100);assert.ok(f.state.members.every(m=>m.role===null));
});
test('only the DJ writes controls; rejected patches do not partially update shared state',()=>{
 const f=fixture();f.tick();f.tick(5000);
 f.send(a,'controls',{patch:{tempoL:.9}},5200);assert.match(f.state.acks[a].error,/DJ만/);assert.equal(f.state.controls.tempoL,.5);
 f.send(b,'controls',{patch:{tempoL:.9,pressedR:2,angleR:160}},5300);assert.equal(f.state.controls.tempoL,.9);assert.equal(f.state.controls.pressedR,2);
 f.send(b,'controls',{patch:{tempoL:.1,volumeL:'bad'}},5400);assert.ok(f.state.acks[b].error);assert.equal(f.state.controls.tempoL,.9);
 f.send(b,'shake',{event:'wrong'},5500);assert.match(f.state.acks[b].error,/댄서/);assert.equal(f.state.remaining,100);
});
test('reload resumes the same phone without resetting the shared game',()=>{
 const f=fixture();f.tick();f.tick(5000);f.send(a,'shake',{event:'one'},5400);
 f.peers[0]={...peer(a,5500,'mobile',d)};f.tick(5500);assert.equal(f.state.remaining,99);assert.equal(f.state.members.find(m=>m.id===a).role,'dancer');
});
test('leave keeps the departing stream out; reconnect and replacement start a new countdown',()=>{
 const f=fixture();f.tick();f.tick(5000);f.send(a,'leave',{},5200);assert.equal(f.state.members.length,1);assert.equal(f.state.phase,'waiting');
 f.tick(5300);assert.equal(f.state.members.length,1);
 f.peers[0]=peer(a,5400,'mobile',d);f.tick(5400);assert.equal(f.state.members.length,2);assert.equal(f.state.phase,'countdown');
});
test('a missing phone cancels countdown and an expired phone frees its slot',()=>{
 const f=fixture();f.tick();f.peers.splice(1);f.tick(16000);assert.equal(f.state.phase,'waiting');assert.ok(f.state.members.every(m=>m.role===null));
 f.peers.push(peer(c,61000));f.tick(61000);assert.deepEqual(f.state.members.map(m=>m.id),[a,c]);assert.equal(f.state.phase,'countdown');
});
test('commands from a previous round cannot change a new round',()=>{
 const f=fixture();f.tick();f.tick(5000);f.peers[0].command={seq:1,epoch:'test-epoch',round:0,name:'shake',body:{event:'old'}};f.tick(5300);
 assert.equal(f.state.remaining,100);assert.match(f.state.acks[a].error,/새 라운드/);
});
test('a new host can advance a late clock without assigning two identical roles',()=>{
 const f=fixture();f.tick();f.tick(20000);assert.equal(f.state.phase,'playing');assert.equal(new Set(f.state.members.map(m=>m.role)).size,2);
});
function complete(f){f.tick();f.tick(5000);for(let i=0;i<100;i++)f.send(a,'shake',{event:'complete-'+i},5320+i*320);}
test('either role can leave completion and the other phone keeps its completion screen until it leaves',()=>{
 for(const first of [a,b]){
  const f=fixture();complete(f);const second=first===a?b:a;const role=viewSession(f.state,second).role;
  f.send(first,'leave',{},40000);f.tick(40100);
  assert.equal(viewSession(f.state,first).admitted,false);assert.equal(f.state.members.length,1);
  assert.equal(viewSession(f.state,second).phase,'complete');assert.equal(viewSession(f.state,second).role,role);
  f.send(second,'leave',{},40200);f.tick(40300);
  assert.equal(f.state.members.length,0);assert.equal(f.state.phase,'waiting');
 }
});
test('a replacement after completion starts a fresh round with fresh roles and counts',()=>{
 const f=fixture();complete(f);const round=f.state.round;f.send(a,'leave',{},40000);
 f.peers[0]=peer(c,40100);f.tick(40100);
 assert.equal(f.state.phase,'countdown');assert.equal(f.state.round,round+1);assert.equal(f.state.remaining,100);
 assert.deepEqual(f.state.members.map(m=>m.id),[b,c]);assert.ok(f.state.members.every(m=>m.role===null));
});
test('an explicit inactive profile releases its slot without waiting for the stale-device timeout',()=>{
 const f=fixture();complete(f);f.peers[0].active=false;f.tick(40000);
 assert.deepEqual(f.state.members.map(m=>m.id),[b]);assert.equal(viewSession(f.state,b).phase,'complete');
});
