import test from 'node:test';
import assert from 'node:assert/strict';
import {rotationDelta,rotatedGain} from '../audio/knob-rotation.mjs';
const rad=d=>d*Math.PI/180;
test('rotary gain follows clockwise and counterclockwise gestures across the angle seam',()=>{
 assert.ok(Math.abs(rotationDelta(rad(179),rad(-179))-rad(2))<1e-10);
 assert.ok(Math.abs(rotationDelta(rad(-179),rad(179))-rad(-2))<1e-10);
 assert.equal(rotatedGain(0,rad(135)),12);
 assert.equal(rotatedGain(0,rad(-135)),-12);
 assert.equal(rotatedGain(7,0),7);
});
test('gain stops at its limits and reverses immediately',()=>{
 assert.equal(rotatedGain(12,rad(40)),12);
 assert.equal(rotatedGain(-12,rad(-40)),-12);
 assert.equal(rotatedGain(12,rad(-135)),0);
});
