import test from 'node:test';
import assert from 'node:assert/strict';
import {BufferDeck} from '../audio/buffer-deck.mjs';
function fixture(){
 const sources=[],processors=[];let ended=0;
 const param=()=>({values:[],setValueAtTime(value,time){this.values.push([value,time]);}});
 const context={currentTime:10,createBufferSource(){
  const source={playbackRate:param(),starts:[],stops:0,connect(){},disconnect(){},start(...args){this.starts.push(args);},stop(){this.stops++;}};
  sources.push(source);return source;
 }};
 const deck=new BufferDeck({context,buffer:{duration:294.5},destination:{},onEnded(){ended++;},createProcessor(){
  const processor={parameters:new Map([['playbackRate',param()]]),connect(){},disconnect(){},port:{close(){}}};processors.push(processor);return processor;
 }});
 return {context,deck,sources,processors,get ended(){return ended;}};
}
test('rapid live tempo changes automate the same source and pitch processor without any stop or restart',async()=>{
 const f=fixture();await f.deck.play();f.context.currentTime=12;
 for(let n=0;n<=100;n++){
  const rate=.75+n/200;f.deck.playbackRate=rate;
  assert.equal(f.deck.playbackRate,rate);assert.equal(f.deck.paused,false);
  assert.equal(f.sources.length,1);assert.equal(f.sources[0].stops,0);assert.equal(f.processors.length,1);
  assert.deepEqual(f.sources[0].playbackRate.values.at(-1),[rate,12]);
  assert.deepEqual(f.processors[0].parameters.get('playbackRate').values.at(-1),[rate,12]);
 }
 assert.equal(f.deck.currentTime,2);f.context.currentTime=14;assert.equal(f.deck.currentTime,4.5);
 assert.equal(f.deck.preservesPitch,true);
});
test('pause, resume and seeks keep the song position with rate changes and never reuse stale audio',async()=>{
 const f=fixture();await f.deck.play();f.context.currentTime=12;f.deck.playbackRate=.75;f.context.currentTime=14;
 f.deck.pause();assert.equal(f.deck.currentTime,3.5);assert.equal(f.sources[0].stops,1);
 f.context.currentTime=25;assert.equal(f.deck.currentTime,3.5);await f.deck.play();
 assert.deepEqual(f.sources[1].starts,[[0,3.5]]);f.context.currentTime=27;assert.equal(f.deck.currentTime,5);
 f.deck.currentTime=87;assert.equal(f.deck.currentTime,87);assert.deepEqual(f.sources[2].starts,[[0,87]]);
 f.deck.pause();f.deck.currentTime=0;assert.equal(f.deck.currentTime,0);assert.equal(f.deck.paused,true);
});
test('natural completion fires once and disposal cancels a pending processor tail',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const dispose of [false,true]){
  const f=fixture();await f.deck.play();f.context.currentTime=310;f.sources[0].onended();
  if(dispose)f.deck.dispose();t.mock.timers.tick(151);
  assert.equal(f.ended,dispose?0:1);assert.equal(f.deck.currentTime,294.5);assert.equal(f.deck.paused,true);
  if(dispose){assert.equal(f.deck.buffer,null);await assert.rejects(f.deck.play());}
 }
});
