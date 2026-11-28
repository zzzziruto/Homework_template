import test from 'node:test';import assert from 'node:assert/strict';
import {ScratchEngine,scratchVelocity,tempoFromPosition} from '../audio/scratch-core.mjs';
const output=(n=128)=>[[new Float32Array(n),new Float32Array(n)],[new Float32Array(n),new Float32Array(n)]];
function fixture(){const e=new ScratchEngine(44100);const samples=Float32Array.from({length:22050*4},(_,i)=>Math.sin(i*2*Math.PI*440/22050));e.load([samples,samples],22050);return e;}
test('clockwise and counterclockwise scratch moves read audio forwards and backwards',()=>{const e=fixture();e.start(0,2);e.move(0,1);for(let i=0;i<10;i++)e.render(output());assert.ok(e.decks[0].position/22050>2);const before=e.decks[0].position;e.move(0,-2);let audible=false;for(let i=0;i<10;i++){const o=output();e.render(o);audible ||=o[0][0].some(x=>Math.abs(x)>.01);}assert.ok(e.decks[0].position<before);assert.ok(audible);});
test('a held platter settles to silence and releasing it returns the correct playhead',()=>{const e=fixture();e.start(0,1);e.move(0,2);for(let i=0;i<80;i++)e.render(output());const o=output();e.render(o);assert.ok(o[0][0].every(x=>Math.abs(x)<.001));const position=e.stop(0);assert.ok(position>=1&&position<1.2);const stopped=output();e.render(stopped);assert.ok(stopped[0][0].every(x=>x===0));});
test('deck outputs remain isolated and boundary scratching is finite and clamped',()=>{const e=fixture();e.start(1,0);e.move(1,-4);let o=output();e.render(o);assert.equal(e.decks[1].position,0);assert.ok(o.flat().every(c=>c.every(Number.isFinite)));assert.ok(o[0][0].every(x=>x===0));e.move(1,4);o=output();e.render(o);assert.ok(o[1][0].some(x=>x!==0));});
test('tempo slider maps to the requested slower and faster beat range; scratch speeds are limited',()=>{assert.equal(tempoFromPosition(0),.75);assert.equal(tempoFromPosition(.5),1);assert.equal(tempoFromPosition(1),1.25);assert.equal(tempoFromPosition(9),1.25);assert.equal(scratchVelocity(360,.01),4);assert.equal(scratchVelocity(-360,.01),-4);});
test('one third of the previous platter movement gives the same scratch effect in both directions',()=>{
 for(const previousAngle of [-120,-45,-10,10,45,120]){
  const oldSpeed=Math.max(-4,Math.min(4,previousAngle*1.8/360/.2));
  assert.ok(Math.abs(scratchVelocity(previousAngle/3,.2)-oldSpeed)<1e-10);
 }
});
