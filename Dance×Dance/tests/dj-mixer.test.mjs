import test from 'node:test';
import assert from 'node:assert/strict';
import {DJMixer} from '../audio/dj-mixer.mjs';
import {DJAudio} from '../audio/audio-engine.mjs';
import {initialControls} from '../session.mjs';

const session=(patch={})=>({epoch:'pair',round:1,phase:'playing',role:'dj',...patch});
function fixture(){
 const elements=[0,1].map(()=>Object.assign(new EventTarget(),{currentTime:0,playbackRate:1,paused:true,plays:0,async play(){this.plays++;this.paused=false;},pause(){this.paused=true;}}));
 const engine=new DJAudio(elements);engine.ready=true;engine.duration=295;
 engine.context={currentTime:1,async resume(){},async close(){}};
 engine.gains=[0,1].map(()=>({gain:{value:0,setTargetAtTime(v){this.value=v;}}}));
 engine.node={port:{postMessage(){}},disconnect(){}};
 let unlocks=0;engine.unlock=()=>{unlocks++;return Promise.resolve();};
 const mixer=new DJMixer(elements,{engine});
 return {elements,engine,mixer,get unlocks(){return unlocks;}};
}
test('role/network state and shared Play values cannot automatically unlock or play music',()=>{
 const f=fixture();f.mixer.updateSession(session());f.mixer.apply({...initialControls(),playingL:true,playingR:true});
 assert.equal(f.unlocks,0);assert.ok(f.elements.every(a=>a.paused));
 f.mixer.updateSession(session({role:'dancer'}));f.mixer.play(0);assert.equal(f.unlocks,0);
});
test('a real Play action unlocks synchronously and immediately starts the requested deck only',async()=>{
 const f=fixture();f.mixer.updateSession(session());const pending=f.mixer.play(0);
 assert.equal(f.unlocks,1);await pending;
 assert.equal(f.elements[0].paused,false);assert.equal(f.elements[1].paused,true);
 f.mixer.pause(0);assert.equal(f.elements[0].paused,true);
});
test('completion, leaving, changed role, new round and lost connection cancel a pending start',async()=>{
 for(const reason of ['complete','leave','role','round','offline','hidden']){
  const f=fixture();let finish;f.engine.unlock=()=>new Promise(resolve=>{finish=resolve;});
  f.mixer.updateSession(session());const starting=f.mixer.play(0);
  if(reason==='leave')f.mixer.dispose();
  else f.mixer.updateSession(session(reason==='complete'?{phase:'complete'}:reason==='role'?{role:'dancer'}:reason==='round'?{round:2}:{}),!['offline','hidden'].includes(reason));
  finish();await starting;assert.equal(f.elements[0].plays,0,reason);assert.ok(f.elements.every(a=>a.paused),reason);
 }
});
test('tempo/BPM and EQ work before the first playback without unlocking or changing the other deck',()=>{
 const f=fixture();f.mixer.updateSession(session());f.mixer.apply({...initialControls(),tempoL:1,eqHiL:9,volumeR:0});
 assert.equal(f.mixer.settings[0].formattedBpm,'148.75');assert.equal(f.mixer.settings[1].formattedBpm,'119.00');
 assert.equal(f.engine.eqValues[0].hi,9);assert.equal(f.engine.eqValues[1].hi,0);
 assert.equal(f.engine.gains[1].gain.value,0);assert.equal(f.unlocks,0);
});
test('every local tempo input changes the media rate immediately without stopping or seeking either deck',async()=>{
 for(const i of [0,1]){
  const f=fixture();f.mixer.updateSession(session());await f.mixer.play(0);await f.mixer.play(1);
  f.elements[i].currentTime=87;
  const controls={...initialControls(),playingL:true,playingR:true};
  for(let n=0;n<=100;n++){
   controls['tempo'+['L','R'][i]]=n/100;f.mixer.apply(controls);
   assert.equal(f.elements[i].playbackRate,.75+n/200);
   assert.equal(f.elements[1-i].playbackRate,1);
   assert.equal(f.elements[i].currentTime,87);assert.ok(f.elements.every(a=>!a.paused));
  }
  assert.equal(f.mixer.settings[i].formattedBpm,'148.75');
 }
});
test('all-stop pauses both decks immediately and invalidates an unfinished scratch release',async()=>{
 const f=fixture();f.mixer.updateSession(session());await f.mixer.play(0);await f.mixer.play(1);
 f.elements[0].currentTime=87;const gesture=f.mixer.startScratch(0);f.mixer.moveScratch(0,gesture,1);
 const release=f.mixer.endScratch(0,gesture);f.mixer.updateSession(session({phase:'complete'}));
 assert.ok(f.elements.every(a=>a.paused));await release;
 assert.equal(f.elements[0].currentTime,87);assert.ok(f.elements.every(a=>a.paused));assert.equal(f.engine.pending.size,0);
});
test('CUE cancels a late scratch seek and keeps tempo/EQ on its own deck',async()=>{
 const f=fixture();f.mixer.updateSession(session());f.mixer.apply({...initialControls(),tempoL:.8,eqLowL:-7});
 await f.mixer.play(0);f.elements[0].currentTime=66;f.elements[1].currentTime=24;
 const gesture=f.mixer.startScratch(0);f.mixer.moveScratch(0,gesture,1);const release=f.mixer.endScratch(0,gesture);
 f.mixer.cue(0);await release;
 assert.equal(f.elements[0].currentTime,0);assert.equal(f.elements[1].currentTime,24);
 assert.equal(f.elements[0].playbackRate,1.15);assert.equal(f.engine.eqValues[0].low,-7);assert.equal(f.elements[0].paused,true);
});
test('stopping while AudioContext.resume is pending prevents a late media play',async()=>{
 const f=fixture();let resumed;f.engine.context.resume=()=>new Promise(resolve=>{resumed=resolve;});
 const playing=f.engine.play(0);f.engine.stopAll();resumed();await playing;
 assert.equal(f.elements[0].plays,0);assert.equal(f.elements[0].paused,true);
});
test('a delayed media play cannot restart after stop, or pause a newer successful play',async()=>{
 for(const restart of [false,true]){
  const f=fixture();let finish;
  f.elements[0].play=()=>new Promise(resolve=>{finish=()=>{f.elements[0].paused=false;resolve();};});
  const old=f.engine.play(0);await Promise.resolve();f.engine.pause(0);
  if(restart){f.elements[0].play=async()=>{f.elements[0].paused=false;};await f.engine.play(0);}
  finish();await old;assert.equal(f.elements[0].paused,!restart);
 }
});
