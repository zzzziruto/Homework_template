// Native buffer playback changes rate without restarting Safari's media pipeline.
// SoundTouch corrects the corresponding pitch shift on the audio rendering thread.
export class BufferDeck {
 constructor({context,buffer,destination,onEnded=()=>{},createProcessor=ctx=>new AudioWorkletNode(ctx,'soundtouch-processor',{
  numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]
 })}){
  Object.assign(this,{context,buffer,destination,onEnded,createProcessor});this.trackDuration=buffer.duration;
  this.source=null;this.processor=null;this.position=0;this.startedAt=0;this.rate=1;this.paused=true;this.disposed=false;this.endTimer=null;
  this.preservesPitch=true;this.webkitPreservesPitch=true;
 }
 get duration(){return this.trackDuration;}
 get ended(){return this.paused&&this.position>=this.duration;}
 get currentTime(){return Math.min(this.duration,this.position+(this.paused?0:(this.context.currentTime-this.startedAt)*this.rate));}
 set currentTime(value){
  const playing=!this.paused;this.pause();
  this.position=Math.max(0,Math.min(Number.isFinite(value)?value:0,this.duration));
  if(playing)this.play();
 }
 get playbackRate(){return this.rate;}
 set playbackRate(value){
  if(!Number.isFinite(value)||value<=0)throw new Error('템포 값이 올바르지 않아요.');
  if(value===this.rate)return;
  this.position=this.currentTime;this.startedAt=this.context.currentTime;this.rate=value;
  const now=this.context.currentTime;
  this.source?.playbackRate.setValueAtTime(value,now);
  this.processor?.parameters.get('playbackRate').setValueAtTime(value,now);
 }
 async play(){
  if(this.disposed)throw new Error('오디오 연결이 종료됐어요.');
  if(!this.paused)return;
  if(this.ended)this.position=0;
  const source=this.context.createBufferSource(),processor=this.createProcessor(this.context);
  source.buffer=this.buffer;source.playbackRate.setValueAtTime(this.rate,this.context.currentTime);
  processor.parameters.get('playbackRate').setValueAtTime(this.rate,this.context.currentTime);
  source.connect(processor);processor.connect(this.destination);
  this.source=source;this.processor=processor;this.startedAt=this.context.currentTime;this.paused=false;
  source.onended=()=>{
   if(this.source!==source)return;
   // Let the pitch processor's short tail drain at the natural end only.
   this.endTimer=setTimeout(()=>{
    if(this.source!==source)return;
    this.pause();this.position=this.duration;this.onEnded();
   },150);
  };
  source.start(0,this.position);
 }
 pause(){
  if(this.paused)return;
  this.position=this.currentTime;this.paused=true;clearTimeout(this.endTimer);this.endTimer=null;
  const source=this.source,processor=this.processor;this.source=null;this.processor=null;
  if(source){source.onended=null;source.stop();source.disconnect();}
  processor?.disconnect();processor?.port.close();
 }
 dispose(){this.pause();this.disposed=true;this.buffer=null;this.onEnded=()=>{};}
}
