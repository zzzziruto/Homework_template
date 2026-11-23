import test from 'node:test';
import assert from 'node:assert/strict';
import {CONNECT_TIMEOUT_MS,HOST_LEASE_MS,PartyClient,selectAuthority} from '../party-client.mjs';
import {PROTOCOL} from '../session.mjs';

function transport(){
 const party={shared:null,me:null,callbacks:new Map(),disconnections:0,emissions:0,
  async connect(){},async loadShared(name,data={}){return this.shared=data;},
  async loadMyShared(data){return this.me=data;},loadGuestShareds(){return [];},isHost(){return true;},
  subscribe(name,fn){this.callbacks.set(name,fn);},unsubscribe(name,fn){if(this.callbacks.get(name)===fn)this.callbacks.delete(name);},
  emit(){this.emissions++;},disconnect(){this.disconnections++;}};
 return party;
}
const device='a'.repeat(36);
test('leaving removes participation, disconnects once, and prevents later traffic or automatic rejoining',async()=>{
 const party=transport();const views=[];
 const client=new PartyClient({party,device,mobile:true,room:'test',onState:view=>views.push(view)});
 try{
  await client.connect();assert.equal(party.me.snapshot.members.length,1);
  const leaving=client.leave();client.tick();await leaving;
  assert.equal(party.me.snapshot.members.length,0);assert.equal(party.me.profile.active,false);
  assert.equal(party.me.profile.command,null);assert.equal(party.disconnections,1);assert.equal(party.callbacks.size,0);
  const before={views:views.length,emissions:party.emissions,profile:JSON.stringify(party.me.profile)};
  client.pulse();client.syncClock();client.tick();await new Promise(resolve=>setTimeout(resolve,80));
  assert.deepEqual({views:views.length,emissions:party.emissions,profile:JSON.stringify(party.me.profile)},before);
  await assert.rejects(client.request('restart'),/다시 연결/);await assert.rejects(client.connect(),/다시 연결/);
  client.destroy();assert.equal(party.disconnections,1);
 }finally{client.destroy();}
});
test('leave cancels queued controls and disconnects even when the host never acknowledges',async()=>{
 const party=transport();const client=new PartyClient({party,device,mobile:true,room:'test'});
 try{
  await client.connect();clearInterval(client.timer);
  const controls=assert.rejects(client.request('controls',{patch:{tempoL:1}}),/나왔어요/);
  const queued=assert.rejects(client.request('restart'),/나왔어요/);
  const leaving=assert.rejects(client.leave(),/지연/);
  await assert.rejects(client.request('shake',{event:'late'}),/다시 연결/);
  await Promise.all([controls,queued,leaving]);
  assert.equal(party.disconnections,1);assert.equal(party.me.profile.active,false);
  assert.equal(party.me.profile.command,null);
 }finally{client.destroy();}
});
test('destroying a pending connection never installs timers, subscriptions, or a participant afterwards',async()=>{
 const party=transport();let finish;
 party.connect=()=>new Promise(resolve=>{finish=resolve;});
 const client=new PartyClient({party,device,mobile:true,room:'test'});
 const connecting=client.connect();await client.leave();finish();await connecting;
 assert.equal(party.disconnections,1);assert.equal(party.me,null);assert.equal(party.callbacks.size,0);
 assert.equal(client.ready,false);
});
test('an active phone takes authority over an observer; hidden and stale tabs cannot block it',()=>{
 const now=10000;
 const observer={protocol:PROTOCOL,kind:'observer',stream:'a',active:true,visible:true,observedAt:now};
 const phone={...observer,kind:'mobile',stream:'b'};
 assert.equal(selectAuthority([observer,phone],now),phone);
 assert.equal(selectAuthority([{...phone,visible:false},observer],now),observer);
 assert.equal(selectAuthority([{...phone,observedAt:now-HOST_LEASE_MS},observer],now),observer);
 assert.equal(selectAuthority([{...phone,protocol:PROTOCOL-1}],now),null);
 const second={...phone,stream:'c'};
 assert.equal(selectAuthority([{...phone,joinedAt:20},{...second,joinedAt:10}],now).stream,second.stream);
});
test('an unresponsive session read fails visibly and disconnects instead of waiting forever',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const party=transport();const statuses=[];
 party.loadMyShared=()=>new Promise(()=>{});
 const client=new PartyClient({party,device,mobile:true,room:'test',onStatus:s=>statuses.push(s)});
 const waiting=assert.rejects(client.connect(),/연결 준비가 지연/);
 await Promise.resolve();t.mock.timers.tick(CONNECT_TIMEOUT_MS);await waiting;
 assert.equal(party.disconnections,1);assert.equal(client.ready,false);assert.equal(statuses.at(-1),'error');
});
test('two phones start and share counts with a frozen p5.party host, then survive a frozen game host',async t=>{
 let now=10000;t.mock.method(Date,'now',()=>now);
 const network={nodes:[]};
 function node(){
  const n=transport();network.nodes.push(n);
  n.loadGuestShareds=()=>network.nodes.map(other=>other.me).filter(Boolean);
  n.isHost=()=>n===network.nodes[0]; // The library's original host remains a suspended desktop.
  n.emit=(name,data)=>{for(const other of network.nodes)if(!other.frozen)other.callbacks.get(name)?.(data);};
  return n;
 }
 const clients=[
  new PartyClient({party:node(),device:'d'.repeat(36),mobile:false,room:'test'}),
  new PartyClient({party:node(),device:'a'.repeat(36),mobile:true,room:'test'}),
  new PartyClient({party:node(),device:'b'.repeat(36),mobile:true,room:'test'})
 ];
 const snapshot=()=>clients.map(c=>c.shared?.snapshot).filter(Boolean).sort((a,b)=>b.revision-a.revision)[0];
 try{
  for(const c of clients){await c.connect();clearInterval(c.timer);clearInterval(c.heartbeat);clearInterval(c.clockTimer);}
  clients[0].party.frozen=true;
  function advance(ms,active=clients.slice(1)){
   for(let end=now+ms;now<end;now+=100){for(const c of active)c.pulse();for(const c of active)c.tick();}
  }
  advance(6000);
  assert.equal(snapshot().phase,'playing');assert.equal(snapshot().members.length,2);
  assert.equal(clients.slice(1).filter(c=>c.isAuthority).length,1);
  const dancer=clients.find(c=>snapshot().members.some(m=>m.id===c.device&&m.role==='dancer'));
  const shake=dancer.request('shake',{event:'live'});advance(300);await shake;
  assert.equal(snapshot().remaining,99);
  const oldHost=clients.slice(1).find(c=>c.isAuthority);oldHost.party.frozen=true;
  const survivor=clients.slice(1).find(c=>c!==oldHost);advance(HOST_LEASE_MS+1500,[survivor]);
  assert.equal(survivor.isAuthority,true);assert.equal(snapshot().remaining,99);
  assert.equal(snapshot().phase,'playing');assert.ok(now-snapshot().hostTime<1200);
 }finally{for(const c of clients)c.destroy();}
});
test('connecting never writes to a multi-writer shared game record',async()=>{
 const party=transport();let calls=0;
 party.loadShared=()=>{calls++;throw new Error('Shared record must not be used');};
 const client=new PartyClient({party,device,mobile:true,room:'test'});
 try{await client.connect();assert.equal(calls,0);assert.equal(party.me.snapshot.members.length,1);}
 finally{client.destroy();}
});
