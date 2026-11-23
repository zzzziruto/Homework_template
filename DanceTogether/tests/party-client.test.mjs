import test from 'node:test';
import assert from 'node:assert/strict';
import {PartyClient} from '../party-client.mjs';

function transport(){
 const party={shared:null,me:null,callbacks:new Map(),disconnections:0,emissions:0,
  async connect(){},async loadShared(name,data){return this.shared=data;},
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
  await client.connect();assert.equal(party.shared.snapshot.members.length,1);
  const leaving=client.leave();client.tick();await leaving;
  assert.equal(party.shared.snapshot.members.length,0);assert.equal(party.me.profile.active,false);
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
