import test from 'node:test';import assert from 'node:assert/strict';import {DJAudio} from '../audio/audio-engine.mjs';
function fixture(){
 const elements=[0,1].map(()=>({paused:true,playbackRate:1,preservesPitch:false,currentTime:0,async play(){this.paused=false;},pause(){this.paused=true;}}));
 const engine=new DJAudio(elements);engine.ready=true;engine.context={async resume(){},currentTime:1};engine.duration=294.5;
 engine.gains=[0,1].map(()=>({gain:{value:0,setTargetAtTime(value){this.value=value;}}}));
 return {elements,engine};
}
test('changing the tempo keeps pitch preservation enabled and does not alter the other deck',async()=>{
 const {elements,engine}=fixture();engine.tempo(0,1.25);assert.equal(elements[0].playbackRate,1.25);assert.equal(elements[0].preservesPitch,true);assert.equal(elements[1].playbackRate,1);
 engine.tempo(1,.75);await engine.play(0);await engine.play(1);engine.pause(0);assert.equal(elements[0].paused,true);assert.equal(elements[1].paused,false);
});
test('each deck volume controls its audio gain, including a true zero gain target',()=>{
 const {engine}=fixture();engine.volume(0,0);engine.volume(1,1);assert.equal(engine.gains[0].gain.value,0);assert.ok(engine.gains[1].gain.value>0);assert.ok(engine.gains[1].gain.value<=1);
});
test('stopping while a scratch release is pending cannot unexpectedly resume playback',async()=>{
 const {engine,elements}=fixture();let finish;
 engine.node={port:{postMessage(m){if(m.type==='stop')finish=()=>{const request=engine.pending.get(m.token);clearTimeout(request.timer);engine.pending.delete(m.token);request.resolve(7.5);};}}};
 await engine.play(0);engine.scratchStart(0);engine.scratchMove(0,1);assert.equal(elements[0].paused,true);
 const release=engine.scratchStop(0,true);engine.pause(0);finish();await release;
 assert.equal(elements[0].paused,true);assert.equal(elements[0].currentTime,7.5);
});
test('tapping either platter at 87 seconds does not seek or restart that deck',async()=>{
 for(const i of [0,1]){
  const {engine,elements}=fixture();elements[i].currentTime=87;let seeks=0,current=87;
  Object.defineProperty(elements[i],'currentTime',{get:()=>current,set:value=>{seeks++;current=value;}});
  engine.node={port:{postMessage(m){if(m.type==='stop')queueMicrotask(()=>{const request=engine.pending.get(m.token);clearTimeout(request.timer);engine.pending.delete(m.token);request.resolve(0);});}}};
  await engine.play(i);engine.scratchStart(i);
  engine.receivePositions([null,null]); // Inactive periodic updates used to contain zero.
  await engine.scratchStop(i,true);
  assert.equal(current,87);assert.equal(seeks,0);assert.equal(elements[i].paused,false);
 }
});
test('a stale worklet update cannot reset a new scratch to zero',()=>{
 const {engine,elements}=fixture();elements[0].currentTime=43;engine.node={port:{postMessage(){}}};
 engine.scratchStart(0);const session=engine.sessions[0].id;
 engine.receivePositions([{session:session-1,position:0},null]);assert.equal(engine.positions[0],43);
 engine.receivePositions([{session,position:42.8},null]);assert.equal(engine.positions[0],42.8);
 engine.receivePositions([null,null]);assert.equal(engine.positions[0],42.8);
});
test('missing release acknowledgement keeps the last valid gesture position',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {engine,elements}=fixture();elements[1].currentTime=90;engine.node={port:{postMessage(){}}};
 engine.scratchStart(1);engine.scratchMove(1,-1);
 engine.receivePositions([null,{session:engine.sessions[1].id,position:89.5}]);
 const released=engine.scratchStop(1,false);t.mock.timers.tick(1201);await released;
 assert.equal(elements[1].currentTime,89.5);assert.equal(elements[1].paused,true);
});
test('a mobile pause that mutates currentTime is restored to the captured touch position',async()=>{
 const {engine,elements}=fixture();elements[0].currentTime=61;elements[0].pause=()=>{elements[0].currentTime=0;};let sent;
 engine.node={port:{postMessage(m){sent=m;if(m.type==='stop')queueMicrotask(()=>{const r=engine.pending.get(m.token);clearTimeout(r.timer);engine.pending.delete(m.token);r.resolve(61);});}}};engine.scratchStart(0);assert.equal(sent.position,61);assert.equal(engine.positions[0],61);await engine.scratchStop(0,false);assert.equal(elements[0].currentTime,61);
});
