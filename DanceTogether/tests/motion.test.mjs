import test from 'node:test';
import assert from 'node:assert/strict';
import {createMotionSensor} from '../motion.mjs';
function fake(permission){const w=new EventTarget();w.isSecureContext=true;w.DeviceMotionEvent=permission?{requestPermission:permission}:{};return w;}
function sample(w,value={x:0,y:0,z:0}){const e=new Event('devicemotion');e.acceleration=value;w.dispatchEvent(e);}
test('permission is requested synchronously in tap; ON waits for actual valid sensor data',async()=>{
  let requested=false,reads=0;const w=fake(()=>{requested=true;return Promise.resolve('granted');});
  const s=createMotionSensor(w,{onSample:()=>reads++,timeoutMs:100});const p=s.enable();
  assert.equal(requested,true);assert.equal(s.enabled,false);await Promise.resolve();await Promise.resolve();
  sample(w,{x:null,y:null,z:null});assert.equal(s.enabled,false);sample(w);await p;assert.equal(s.enabled,true);assert.equal(reads,1);
  s.stop();sample(w);assert.equal(reads,1);
});
test('Android-style permissionless sensor still starts after the initial tap',async()=>{
  const w=fake();const s=createMotionSensor(w,{timeoutMs:100});const p=s.enable();await Promise.resolve();await Promise.resolve();sample(w);await p;assert.equal(s.enabled,true);s.stop();
});
test('denial never marks sensor ready and a later explicit retry works',async()=>{
  let granted=false;const w=fake(()=>Promise.resolve(granted?'granted':'denied'));const s=createMotionSensor(w,{timeoutMs:100});
  await assert.rejects(s.enable(),/거부/);assert.equal(s.enabled,false);granted=true;const p=s.enable();await Promise.resolve();await Promise.resolve();sample(w);await p;assert.equal(s.enabled,true);s.stop();
});
test('missing sensor data times out instead of pretending detection is on',async()=>{
  const s=createMotionSensor(fake(),{timeoutMs:10});await assert.rejects(s.enable(),/센서 신호/);assert.equal(s.enabled,false);
});
test('insecure or unsupported devices cannot silently bypass permissions',async()=>{
  const w=fake();w.isSecureContext=false;await assert.rejects(createMotionSensor(w).enable(),/HTTPS/);
  w.isSecureContext=true;delete w.DeviceMotionEvent;await assert.rejects(createMotionSensor(w).enable(),/지원하지/);
});
