export const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
export function scratchVelocity(degrees,seconds){return clamp(degrees*5.4/360/Math.max(seconds,1/240),-4,4);}
export function tempoFromPosition(position){return .75+clamp(position,0,1)*.5;}
export class ScratchEngine {
 constructor(outputRate){this.outputRate=outputRate;this.sourceRate=22050;this.channels=[];this.time=0;this.decks=[this.deck(),this.deck()];}
 deck(){return {active:false,position:0,targetRate:0,rate:0,lastMove:-Infinity,envelope:0};}
 load(channels,rate){this.channels=channels;this.sourceRate=rate;this.decks=[this.deck(),this.deck()];}
 start(index,seconds){const d=this.decks[index];Object.assign(d,this.deck(),{active:true,position:clamp(seconds*this.sourceRate,0,(this.channels[0]?.length||1)-1)});}
 move(index,rate){const d=this.decks[index];if(!d.active)return;d.targetRate=clamp(rate,-4,4);d.lastMove=this.time;}
 stop(index){const d=this.decks[index];d.active=false;d.targetRate=0;d.rate=0;d.envelope=0;return d.position/this.sourceRate;}
 render(outputs){
  const frames=outputs[0]?.[0]?.length||128;const size=this.channels[0]?.length||0;
  const smoothing=1-Math.exp(-1/(this.outputRate*.004));
  for(let deck=0;deck<2;deck++){
   const d=this.decks[deck],out=outputs[deck];if(!out)continue;
   for(let i=0;i<frames;i++){
    const target=d.active&&this.time+i/this.outputRate-d.lastMove<.065?d.targetRate:0;
    d.rate+=(target-d.rate)*smoothing;
    const envelope=d.active&&Math.abs(d.rate)>.015?1:0;d.envelope+=(envelope-d.envelope)*smoothing;
    const next=d.position+d.rate*this.sourceRate/this.outputRate;
    const within=next>=0&&next<size-1;
    if(d.active)d.position=clamp(next,0,Math.max(0,size-1));
    const p=Math.floor(d.position),fraction=d.position-p;
    for(let c=0;c<out.length;c++){
     const data=this.channels[c]||this.channels[0];
     out[c][i]=within&&data?((data[p]||0)*(1-fraction)+(data[p+1]||0)*fraction)*d.envelope:0;
    }
   }
  }
  this.time+=frames/this.outputRate;
 }
}
