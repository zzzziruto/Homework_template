export const EQ_BANDS=Object.freeze({low:{type:'lowshelf',frequency:250},mid:{type:'peaking',frequency:1000,Q:.8},hi:{type:'highshelf',frequency:4000}});
export function eqGain(value){if(!Number.isFinite(value))throw new Error('EQ 값이 올바르지 않아요.');return Math.max(-12,Math.min(12,value));}
export function createThreeBandEQ(context,values={}){
 const bands={};
 for(const [key,config] of Object.entries(EQ_BANDS)){
  const node=context.createBiquadFilter();node.type=config.type;node.frequency.value=config.frequency;
  if(config.Q)node.Q.value=config.Q;node.gain.value=eqGain(values[key]??0);bands[key]=node;
 }
 bands.low.connect(bands.mid);bands.mid.connect(bands.hi);
 return {input:bands.low,output:bands.hi,bands,setGain(band,value){if(!Object.hasOwn(bands,band))throw new Error('알 수 없는 EQ 밴드예요.');const gain=eqGain(value);bands[band].gain.setTargetAtTime(gain,context.currentTime,.015);return gain;}};
}
