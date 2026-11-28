import {loadLocalTrack} from './media-position.mjs?v=20261129-tempo1';
import {createThreeBandEQ,eqGain,EQ_BANDS} from './eq.mjs?v=20261129-tempo1';
import {TEST_TRACK} from './deck-settings.mjs?v=20261129-tempo1';
export class DJAudio {
 constructor(elements){this.elements=elements;this.ready=false;this.loading=null;this.context=null;this.node=null;this.gains=[];this.equalizers=[];this.eqValues=[{hi:0,mid:0,low:0},{hi:0,mid:0,low:0}];this.scratching=[false,false];this.token=0;this.pending=new Map();this.positions=[0,0];this.sessions=[null,null];this.objectURL=null;this.intent=[false,false];this.volumes=[.7,.5];this.tempos=[1,1];this.operations=[0,0];this.disposed=false;this.abort=new AbortController();}
 checkOpen(){if(this.disposed)throw new Error('오디오 연결이 종료됐어요. 다시 접속해주세요.');}
 unlock(){
  this.checkOpen();
  // Create and resume synchronously inside the user's original tap (iOS).
  if(!this.context){
   const Context=window.AudioContext||window.webkitAudioContext;
   if(!Context)throw new Error('이 브라우저는 오디오 조작을 지원하지 않아요. Safari 또는 Chrome으로 열어주세요.');
   this.context=new Context({latencyHint:'interactive'});
   this.master=this.context.createDynamicsCompressor();this.master.threshold.value=-3;this.master.knee.value=6;this.master.ratio.value=12;this.master.attack.value=.003;this.master.release.value=.12;
   this.analyser=this.context.createAnalyser();this.analyser.fftSize=256;
   this.master.connect(this.analyser);this.analyser.connect(this.context.destination);
   this.elements.forEach((audio,i)=>{
    const source=this.context.createMediaElementSource(audio),gain=this.context.createGain();gain.gain.value=0;
    const equalizer=createThreeBandEQ(this.context,this.eqValues[i]);source.connect(equalizer.input);equalizer.output.connect(gain);gain.connect(this.master);
    this.equalizers[i]=equalizer;this.gains[i]=gain;
    audio.preservesPitch=true;if('webkitPreservesPitch' in audio)audio.webkitPreservesPitch=true;
   });
  }
  const resume=this.context.resume();
  if(this.ready)return resume;
  if(this.loading)return this.loading;
  const starts=this.elements.map(audio=>audio.play().then(()=>{audio.pause();audio.currentTime=0;}));
  this.loading=(async()=>{
   await Promise.all([resume,...starts]);
   this.checkOpen();
   if(!this.context.audioWorklet)throw new Error('스크래치 기능을 위해 최신 Safari 또는 Chrome에서 열어주세요.');
   if(!this.node){
    await this.context.audioWorklet.addModule(new URL('./scratch-worklet.mjs?v=20261129-tempo1',import.meta.url));
    this.checkOpen();
    this.node=new AudioWorkletNode(this.context,'dj-scratch',{numberOfInputs:0,numberOfOutputs:2,outputChannelCount:[2,2]});
    // Keep the scratch processor running for playhead movement, but never send
    // its scrub audio to the speakers. Normal playback uses the per-deck gains.
    this.scratchOutput=this.context.createGain();this.scratchOutput.gain.value=0;
    this.node.connect(this.scratchOutput,0);this.node.connect(this.scratchOutput,1);
    this.scratchOutput.connect(this.master);
    this.node.port.onmessage=({data:m})=>{
     if(m.type==='position')this.receivePositions(m.positions);
     if(m.type==='stopped'){const request=this.pending.get(m.token);if(request){clearTimeout(request.timer);this.pending.delete(m.token);request.resolve(m.session===request.session&&Number.isFinite(m.position)?m.position:request.fallback);}}
     if(m.type==='loaded')this.onLoaded?.();
    };
   }
   const response=await fetch(TEST_TRACK.src,{signal:this.abort.signal});if(!response.ok)throw new Error('음원을 불러오지 못했어요. 다시 시도해주세요.');
   const Decoder=window.OfflineAudioContext||window.webkitOfflineAudioContext;
   const bytes=await response.arrayBuffer();
   // A complete local Blob makes seeks independent of the host's HTTP Range support.
   const localURL=URL.createObjectURL(new Blob([bytes],{type:'audio/mpeg'}));
   try{await loadLocalTrack(this.elements,localURL,{signal:this.abort.signal});this.checkOpen();}catch(error){URL.revokeObjectURL(localURL);throw error;}
   if(this.objectURL)URL.revokeObjectURL(this.objectURL);this.objectURL=localURL;
   const decoder=new Decoder(2,1,22050);const buffer=await decoder.decodeAudioData(bytes);
   this.checkOpen();
   const channels=[buffer.getChannelData(0).slice(),buffer.getChannelData(Math.min(1,buffer.numberOfChannels-1)).slice()];
   await new Promise((resolve,reject)=>{
    this.rejectLoad=reject;this.loadTimer=setTimeout(()=>reject(new Error('스크래치 준비가 늦어지고 있어요. 다시 시도해주세요.')),20000);
    this.onLoaded=()=>{clearTimeout(this.loadTimer);this.rejectLoad=null;resolve();};
    this.node.port.postMessage({type:'load',channels,rate:buffer.sampleRate},channels.map(c=>c.buffer));
   });
   this.checkOpen();this.duration=buffer.duration;this.ready=true;this.volumes.forEach((v,i)=>this.volume(i,v));this.tempos.forEach((v,i)=>this.tempo(i,v));
  })().catch(error=>{this.elements.forEach(a=>a.pause());this.gains.forEach(g=>g.gain.value=0);throw error;}).finally(()=>{this.loading=null;});
  return this.loading;
 }
 async play(i){this.checkOpen();if(!this.ready)throw new Error('먼저 소리를 켜주세요.');const operation=++this.operations[i];this.intent[i]=true;await this.context.resume();if(operation!==this.operations[i]||!this.intent[i]||this.scratching[i])return;await this.elements[i].play();if(!this.intent[i]||this.disposed)this.elements[i].pause();}
 pause(i){this.operations[i]++;this.intent[i]=false;this.elements[i].pause();}
 volume(i,value){this.volumes[i]=value;if(this.ready){const gain=this.gains[i].gain;if(value===0){gain.cancelScheduledValues?.(this.context.currentTime);if(gain.setValueAtTime)gain.setValueAtTime(0,this.context.currentTime);else gain.value=0;}else gain.setTargetAtTime(value*.65,this.context.currentTime,.012);}}
 tempo(i,value){
  this.tempos[i]=value;const audio=this.elements[i];
  // Shared-state renders must not keep restarting Safari's rate/pitch pipeline.
  if(audio.preservesPitch!==true)audio.preservesPitch=true;
  if('webkitPreservesPitch' in audio&&audio.webkitPreservesPitch!==true)audio.webkitPreservesPitch=true;
  if(audio.playbackRate!==value)audio.playbackRate=value;
 }
 eq(i,band,value){
  if(!Object.hasOwn(EQ_BANDS,band))throw new Error('알 수 없는 EQ 밴드예요.');
  const gain=eqGain(value);this.eqValues[i][band]=gain;this.equalizers[i]?.setGain(band,gain);return gain;
 }
 receivePositions(positions){
  positions?.forEach((update,i)=>{
   const session=this.sessions[i];
   // Inactive or late messages from another gesture must never overwrite this gesture.
   if(!session||update?.session!==session.id||!Number.isFinite(update.position))return;
   session.position=update.position;this.positions[i]=update.position;
  });
 }
 scratchStart(i){
  if(!this.ready||this.scratching[i])return;
  const position=this.elements[i].currentTime; // Capture before pausing mobile media.
  const session={id:++this.token,start:position,position,moved:false};
  this.sessions[i]=session;this.positions[i]=position;this.scratching[i]=true;
  this.elements[i].pause();
  this.node.port.postMessage({type:'start',deck:i,position,session:session.id});
 }
 scratchMove(i,rate){
  if(!this.scratching[i]||!Number.isFinite(rate)||Math.abs(rate)<.015)return;
  this.sessions[i].moved=true;
  this.node.port.postMessage({type:'move',deck:i,rate,session:this.sessions[i].id});
 }
 async scratchStop(i,resume){
  if(!this.scratching[i])return;this.scratching[i]=false;
  const session=this.sessions[i],token=++this.token;
  const position=await new Promise(resolve=>{
   const timer=setTimeout(()=>{this.pending.delete(token);resolve(session.position);},1200);
   this.pending.set(token,{resolve,timer,deck:i,session:session.id,fallback:session.position});
   this.node.port.postMessage({type:'stop',deck:i,token,session:session.id});
  });
  if(this.sessions[i]!==session)return;
  // A tap/hold without a drag is only a pause: don't issue any media seek at all.
  if(session.moved||Math.abs(this.elements[i].currentTime-session.start)>.05){
   const safe=session.moved&&Number.isFinite(position)?position:session.start;
   this.elements[i].currentTime=Math.max(0,Math.min(safe,this.duration-.01));
  }
  this.sessions[i]=null;
  if(resume&&this.intent[i])await this.play(i);
 }
 cancelScratch(i){
  const session=this.sessions[i];this.sessions[i]=null;this.scratching[i]=false;
  if(session)this.node?.port.postMessage({type:'stop',deck:i,token:++this.token,session:session.id});
  for(const [token,request] of this.pending)if(request.deck===i){clearTimeout(request.timer);this.pending.delete(token);request.resolve(request.fallback);}
 }
 cue(i){this.pause(i);this.cancelScratch(i);this.elements[i].currentTime=0;this.positions[i]=0;}
 async stopAll(){for(let i=0;i<2;i++){this.pause(i);this.cancelScratch(i);}}
 dispose(){
  if(this.disposed)return;this.stopAll();this.disposed=true;this.ready=false;this.abort.abort();
  clearTimeout(this.loadTimer);this.rejectLoad?.(new Error('오디오 연결이 종료됐어요.'));this.rejectLoad=null;
  this.node?.disconnect();this.scratchOutput?.disconnect();this.context?.close().catch(()=>{});
  if(this.objectURL)URL.revokeObjectURL(this.objectURL);this.objectURL=null;
  this.elements.forEach(a=>{a.removeAttribute?.('src');a.load?.();});
 }
}
