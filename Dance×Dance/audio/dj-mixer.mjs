import {DJAudio} from './audio-engine.mjs?v=20261129-layout1';
import {DeckSettings} from './deck-settings.mjs?v=20261129-layout1';
import {tempoFromPosition} from './scratch-core.mjs?v=20261129-layout1';

// Only the local DJ's gestures may start sound. Network state never starts media.
export class DJMixer {
 constructor(elements,{engine=new DJAudio(elements),canPlay=()=>true,onEnded=()=>{}}={}){
  this.engine=engine;this.elements=elements;this.canPlay=canPlay;this.settings=[new DeckSettings(),new DeckSettings()];
  this.session=null;this.allowed=false;this.generation=0;this.tickets=[0,0];this.desired=[false,false];
  this.gestures=[null,null];this.ending=[false,false];this.disposed=false;
  elements.forEach((audio,i)=>audio.addEventListener?.('ended',()=>{this.pause(i);onEnded(i);}));
 }
 get ready(){return this.engine.ready;}
 updateSession(state,connected=true){
  const allowed=!!(connected&&state?.phase==='playing'&&state.role==='dj');
  const key=allowed?`${state.epoch}:${state.round}:${state.role}`:null;
  if(key!==this.session||(!allowed&&this.allowed))this.halt();
  this.session=key;this.allowed=allowed;
 }
 apply(controls){
  if(!controls)return;
  for(const [i,side] of ['L','R'].entries()){
   this.engine.volume(i,controls['volume'+side]);
   this.engine.tempo(i,this.settings[i].setTempo(tempoFromPosition(controls['tempo'+side])));
   for(const band of ['hi','mid','low'])this.engine.eq(i,band,controls['eq'+band[0].toUpperCase()+band.slice(1)+side]??0);
   if(!controls['playing'+side]&&this.desired[i])this.pause(i);
  }
 }
 active(){return !this.disposed&&this.allowed&&this.canPlay();}
 prepare(){
  if(!this.active())return Promise.reject(new Error('플레이 중인 DJ 화면에서 소리를 켜주세요.'));
  // unlock is called now, before any await, in the original tap handler.
  return this.engine.unlock();
 }
 async play(i){
  if(!this.active())return;
  const generation=this.generation,ticket=++this.tickets[i];this.desired[i]=true;
  try{
   await this.prepare();
   if(generation!==this.generation||ticket!==this.tickets[i]||!this.desired[i]||!this.active())return;
   if(this.elements[i].ended)this.elements[i].currentTime=0;
   this.engine.tempo(i,this.settings[i].tempo);
   await this.engine.play(i);
  }catch(error){
   if(generation===this.generation&&ticket===this.tickets[i]&&this.desired[i]&&this.active()){this.pause(i);throw error;}
  }
 }
 pause(i){this.tickets[i]++;this.desired[i]=false;this.engine.pause(i);}
 cue(i){this.pause(i);this.gestures[i]=null;this.ending[i]=false;this.engine.cue(i);}
 startScratch(i){
  if(!this.active()||!this.ready||this.ending[i]||this.gestures[i])return null;
  const gesture={generation:this.generation};this.gestures[i]=gesture;this.engine.scratchStart(i);return gesture;
 }
 moveScratch(i,gesture,rate){if(this.gestures[i]===gesture&&gesture?.generation===this.generation)this.engine.scratchMove(i,rate);}
 async endScratch(i,gesture){
  if(!gesture||this.gestures[i]!==gesture||gesture.generation!==this.generation)return;
  this.gestures[i]=null;this.ending[i]=true;
  try{await this.engine.scratchStop(i,this.desired[i]&&this.active());}
  finally{if(gesture.generation===this.generation)this.ending[i]=false;}
 }
 halt(){
  this.generation++;this.tickets=this.tickets.map(n=>n+1);this.desired=[false,false];this.gestures=[null,null];this.ending=[false,false];
  this.engine.stopAll();
 }
 dispose(){this.halt();this.allowed=false;this.disposed=true;this.engine.dispose();}
}
