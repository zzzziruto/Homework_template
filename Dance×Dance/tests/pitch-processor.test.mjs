import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code=await readFile(new URL('../vendor/soundtouch-processor-2.1.1.js',import.meta.url),'utf8');
for(const rate of [.75,1,1.25])test(`the shipped pitch processor keeps a 440 Hz tone at ${rate}x tempo`,()=>{
 let Processor;
 const scope=vm.createContext({sampleRate:44100,console,
  AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},
  registerProcessor(name,processor){assert.equal(name,'soundtouch-processor');Processor=processor;}
 });
 vm.runInContext(code,scope);
 const processor=new Processor(),signal=[];
 for(let block=0;block<700;block++){
  // Model an AudioBufferSource feeding faster/slower samples into the worklet.
  const input=Float32Array.from({length:128},(_,j)=>Math.sin(2*Math.PI*440*rate*(block*128+j)/44100)*.2);
  const output=[new Float32Array(128),new Float32Array(128)];
  processor.process([[input,input]],[output],{pitch:[1],pitchSemitones:[0],playbackRate:[rate]});
  if(block>300)signal.push(...output[0]);
 }
 let energy=0;const crossings=[];
 signal.forEach((value,i)=>{
  assert.ok(Number.isFinite(value));energy+=value*value;
  if(i&&signal[i-1]<=0&&value>0)crossings.push(i);
 });
 const frequency=(crossings.length-1)*44100/(crossings.at(-1)-crossings[0]);
 assert.ok(Math.abs(frequency-440)<3,`pitch drifted to ${frequency} Hz`);
 assert.ok(Math.sqrt(energy/signal.length)>.1,'audio output disappeared');
});
