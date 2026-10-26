const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(`${__dirname}/sketch.js`,'utf8');
const block=source.slice(source.indexOf('  function clearMemoScrub('),source.indexOf('  function interact('));
const makeNote=id=>({id,text:`삭제 검사 ${id}`,x:10,y:20,width:100,height:80,progress:1,archived:true,created:1,silhouetteColor:'#ff99be',silhouetteType:'solid',glyphs:[{char:'ㄱ'}],el:{removed:false,contains:()=>false,remove(){this.removed=true;},replaceChildren(){this.emptied=true;}}});
function setup() {
  let time=0,next=0;
  const timers=new Map(),frames=new Map(),storage=new Map(),messages=[],canvases=[];
  const ctx2d={setTransform:()=>{},clearRect:()=>{},beginPath:()=>{},arc:()=>{},fill:()=>{},fillText:()=>{},scale:()=>{},getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4).fill(255)})};
  const document={hidden:false,activeElement:null,body:{},createElement:()=>{
    const canvas={width:0,height:0,dataset:{},removed:false,setAttribute:()=>{},getContext:()=>ctx2d,remove(){this.removed=true;}};
    canvases.push(canvas);return canvas;
  }};
  const context=vm.createContext({STORAGE:'test-memo-storage',memoScrub:null,pointers:new Map(),panGesture:null,nativeGesture:null,deletionCanvas:null,deletionFrame:0,deletionEffects:[],notes:[],memoPress:null,memoMove:null,cameraAnimation:0,tapCandidate:null,lastPointer:null,reducedMotion:true,
    camera:{x:0,y:0,scale:1},viewportGeometry:{width:800,height:600,left:0,top:0},devicePixelRatio:1,
    document,viewport:{append:()=>{},focus:()=>{}},Path2D:class {},getComputedStyle:()=>({fontFamily:'sans-serif',fontSize:'21px',fontWeight:'400'}),
    performance:{now:()=>time},
    setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:time+delay});return id;},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:fn=>{const id=++next;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    localStorage:{setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    announce:message=>messages.push(message),updateBounds:()=>{},refreshCount:()=>{},renderCamera:()=>{},renderNote:()=>{},complete:()=>{},cancelMemoPress:()=>{},finishMemoMove:()=>{},buildSilhouette:()=>{},interact:()=>{},zoomAt:()=>{},clampCamera:()=>{},
    inkMetrics:{cache:new Map([['deleted-glyph',{}]])}
  });
  vm.runInContext(source.slice(source.indexOf('  const DELETE_SCRUB'),source.indexOf('  const $'))+source.slice(source.indexOf('  function seededRandom('),source.indexOf('  function inkMetrics('))+block+source.slice(source.indexOf('  function persist()'),source.indexOf('  function refreshCount'))+source.slice(source.indexOf('  function animateNote('),source.indexOf('  function addNote(')),context);
  return {context,timers,frames,storage,messages,canvases,setTime:value=>{time=value;},advance:ms=>{time+=ms;for(const [id,timer] of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}},draw:now=>{for(const [id,fn] of [...frames]){frames.delete(id);fn(now);}}};
}
function gestureSetup(pointerType) {
  const t=setup(),note=makeNote('gesture'),handlers={},clicks={},captured=new Set();let singles=0;
  Object.assign(note.el,{style:{setProperty:()=>{}},classList:{add:()=>{},remove:()=>{}},setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id),addEventListener:(name,fn)=>{clicks[name]=fn;}});
  Object.assign(t.context,{note,el:note.el,toggleOriginal:()=>singles++,memoMoveFrame:0,window:{addEventListener:()=>{}}});
  Object.assign(t.context.document,{addEventListener:()=>{}});
  Object.assign(t.context.viewport,{classList:{add:()=>{},remove:()=>{}},setPointerCapture:()=>{},addEventListener:(name,fn)=>{handlers[name]=fn;}});
  t.context.notes.push(note);
  vm.runInContext(source.slice(source.indexOf('  function cancelMemoPress('),source.indexOf('  let composing=false'))+source.slice(source.indexOf("    el.addEventListener('click',e=>{"),source.indexOf("    el.addEventListener('keydown',e=>{")),t.context);
  const element=note.el,target={closest:selector=>selector==='.memo'?element:false};
  const event=(type,time,x=44,y=60,id=1)=>({type,pointerId:id,pointerType,button:0,buttons:t.context.pointers.size?1:0,clientX:x,clientY:y,timeStamp:time,target,preventDefault:()=>{}});
  return {...t,note,handlers,captured,getSingles:()=>singles,
    down:(time,x=44,y=60,id=1)=>{t.setTime(time);handlers.pointerdown(event('pointerdown',time,x,y,id));},
    move:(time,x,y=60)=>{t.setTime(time);handlers.pointermove(event('pointermove',time,x,y));},
    up:(time,x=44,y=60)=>{t.setTime(time);handlers.pointerup(event('pointerup',time,x,y));handlers.lostpointercapture(event('lostpointercapture',time,x,y));clicks.click({detail:1,timeStamp:time,target});}
  };
}
for(const pointerType of ['mouse','touch']) {
  const t=gestureSetup(pointerType);t.down(0);t.up(5);t.down(15);t.up(25);
  assert.equal(t.context.notes.length,1);assert.equal(t.getSingles(),2,'Rapid clicks must immediately toggle and never delete');
}
for(const pointerType of ['mouse','touch']) {
  const t=gestureSetup(pointerType);t.down(0);
  for(const [time,x] of [[50,76],[100,44],[150,76],[200,44]])t.move(time,x);
  assert.equal(t.context.notes.length,0);assert.equal(t.getSingles(),0);assert.equal(t.context.memoScrub,null);
  assert.equal(t.context.pointers.size,0);assert.equal(t.captured.size,0,'Scrub deletion releases touch/mouse capture');
  t.up(210);assert.equal(t.getSingles(),0,'The trailing click cannot toggle a deleted memo');
}
{
  const t=gestureSetup('mouse');
  for(const [time,x] of [[0,44],[50,76],[100,44],[150,76],[200,44]])t.move(time,x);
  assert.equal(t.context.notes.length,0,'Mouse hover scrubbing needs no click');
}
for(const motion of ['slow','one-way','jitter','paused','outside']) {
  const t=gestureSetup('touch');t.down(0);
  const traces={slow:[[350,76],[700,44],[1050,76],[1400,44]],'one-way':[[30,60],[60,76],[90,92]],jitter:[[20,46],[40,44],[60,46],[80,44],[100,46]],paused:[[50,76],[100,44],[700,76],[750,44]],outside:[[50,76],[100,44],[150,200],[200,76],[250,44]]};
  for(const [time,x] of traces[motion])t.move(time,x);
  assert.equal(t.context.notes.length,1,`${motion} motion must not delete`);
}
{
  const t=gestureSetup('touch');t.down(0);t.advance(450);
  for(const [time,x] of [[500,76],[550,44],[600,76],[650,44]])t.move(time,x);
  assert.equal(t.context.notes.length,1,'An activated hold/drag must not become a scrub');t.up(660);
}
{
  const t=gestureSetup('touch');t.down(0);t.down(10,76,60,2);
  for(const [time,x] of [[50,76],[100,44],[150,76],[200,44]])t.move(time,x);
  assert.equal(t.context.notes.length,1,'Two-finger pan/pinch must not delete');assert.equal(t.context.memoScrub,null);
  t.handlers.pointerup({type:'pointerup',pointerId:2,pointerType:'touch'});
  for(const [time,x] of [[250,76],[300,44],[350,76],[400,44]])t.move(time,x);
  assert.equal(t.context.notes.length,1,'The finger remaining after a pinch must stay in navigation mode');
}
{
  const t=gestureSetup('touch');t.context.camera.scale=.08;t.note.x=t.note.y=0;t.down(0,0,3);
  for(const [time,x] of [[50,12],[100,0],[150,12],[200,0]])t.move(time,x,3);
  assert.equal(t.context.notes.length,0,'Small overview silhouettes can be scrubbed in screen coordinates');
}
console.log('PASS: rapid mouse/touch scrubbing, hover input, immediate clicks, capture cleanup, slow/swipe/jitter/pause/outside rejection, hold/pinch separation, 8% overview.');
{
  const t=setup(),a=makeNote('deleted'),b=makeNote('retained'),element=a.el; t.context.notes.push(a,b);t.context.persist();
  t.context.animateNote(a);assert.equal(t.frames.size,1);
  assert(t.context.deleteNote(a));assert(element.removed&&element.emptied);assert.equal(t.frames.size,0,'In-flight letter animation must be cancelled');
  assert.equal(t.context.inkMetrics.cache.size,0);assert.equal(JSON.parse(t.storage.get('test-memo-storage')).length,1);
  assert.equal(JSON.parse(t.storage.get('test-memo-storage'))[0].id,'retained');
  assert(!t.storage.get('test-memo-storage').includes('deleted'));assert.equal(t.context.deleteNote(a),false);
  assert(t.context.deleteNote(b));assert.equal(t.storage.has('test-memo-storage'),false,'Deleting the last memo removes the storage key');
  assert.equal(t.context.notes.length,0);assert.equal(t.context.deletionEffects.length,0);
}
{
  const t=setup(),a=makeNote('a'),b=makeNote('b'),element=a.el;t.context.notes.push(a,b);
  t.context.localStorage.setItem=()=>{throw Error('storage unavailable');};
  assert.equal(t.context.deleteNote(a),false);assert.equal(t.context.notes[0],a);assert.equal(t.context.notes[1],b);
  assert.equal(element.removed,false);assert.equal(a.deleting,false);assert.equal(a.text,'삭제 검사 a');
}
console.log('PASS: immediate persistence, no deleted source/glyph/contour references, RAF/cache cleanup, final storage-key removal, failed-storage rollback.');
{
  const t=setup(),random=t.context.seededRandom('flight');
  for(let i=0;i<1000;i++) {
    const x=random()*800,y=random()*600,margin=40+random()*144;
    const target=t.context.deletionTarget(x,y,400,300,800,600,margin,random);
    assert(Number.isFinite(target.endX)&&Number.isFinite(target.endY));
    assert(target.endX<-margin||target.endX>800+margin||target.endY<-margin||target.endY>600+margin,'Every particle must finish beyond the viewport');
  }
  t.context.reducedMotion=false;
  const note=makeNote('particles');note.progress=1;note.glyphs=[{char:'ㄱ',cx:30,cy:40,sx:10,sy:20,size:24,weight:400,angle:30}];
  t.context.camera.scale=.15001;const letters=t.context.makeDeletionEffect(note);assert.equal(letters.kind,'letters');assert.equal(letters.particles[0].char,'ㄱ');
  note.silhouette={querySelector:()=>({getAttribute:()=>''})};t.context.camera.scale=.15;
  const circles=t.context.makeDeletionEffect(note);assert.equal(circles.kind,'circles');assert(circles.particles.length>1&&circles.particles.length<=300);
  assert(new Set(circles.particles.map(p=>p.radius)).size>1);assert(circles.particles.every(p=>!p.char&&p.color==='#ff99be'));
  t.context.camera.scale=1;note.reading=true;note.sentence={offsetLeft:0,offsetTop:0,children:[{textContent:'한',offsetLeft:0,offsetTop:0,offsetWidth:20,offsetHeight:24}]};
  assert.equal(t.context.makeDeletionEffect(note).particles[0].char,'한','Original view must scatter the visible syllables');
  t.context.startDeletionEffect(letters);t.context.startDeletionEffect(circles);assert.equal(t.frames.size,1,'All effects share one animation frame');
  const layer=t.context.deletionCanvas;t.draw(0);assert.equal(t.frames.size,1);
  t.draw(1401);assert.equal(t.frames.size,0);assert.equal(t.context.deletionEffects.length,0);assert.equal(t.context.deletionCanvas,null);
  assert(layer.removed);assert.equal(layer.width,1);assert.equal(layer.height,1);assert.equal(letters.particles.length,0);assert.equal(circles.particles.length,0);
}
console.log('PASS: offscreen flight endpoints, 15% circle/letter boundary, varied circle fragments, original syllables, shared canvas/RAF and complete effect cleanup.');
