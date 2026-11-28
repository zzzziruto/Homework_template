import {ScratchEngine} from './scratch-core.mjs?v=20261129-deck2';
class ScratchProcessor extends AudioWorkletProcessor {
 constructor(){super();this.engine=new ScratchEngine(sampleRate);this.frames=0;this.sessions=[null,null];
  this.port.onmessage=({data:m})=>{
   if(m.type==='load'){this.engine.load(m.channels,m.rate);this.port.postMessage({type:'loaded'});}
   if(m.type==='start'){this.sessions[m.deck]=m.session;this.engine.start(m.deck,m.position);}
   if(m.type==='move'&&this.sessions[m.deck]===m.session)this.engine.move(m.deck,m.rate);
   if(m.type==='stop'&&this.sessions[m.deck]===m.session){const position=this.engine.stop(m.deck);this.port.postMessage({type:'stopped',deck:m.deck,position,token:m.token,session:m.session});this.sessions[m.deck]=null;}
  };
 }
 process(inputs,outputs){this.engine.render(outputs);this.frames+=outputs[0]?.[0]?.length||128;
  if(this.frames>sampleRate/20){this.frames=0;this.port.postMessage({type:'position',positions:this.engine.decks.map((d,i)=>this.sessions[i]===null?null:{session:this.sessions[i],position:d.position/this.engine.sourceRate})});}
  return true;
 }
}
registerProcessor('dj-scratch',ScratchProcessor);
