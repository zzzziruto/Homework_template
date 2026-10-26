const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(`${__dirname}/sketch.js`,'utf8');
const block=source.slice(source.indexOf('  function clearMemoTap('),source.indexOf('  function interact('));
const makeNote=id=>({id,text:`삭제 검사 ${id}`,x:10,y:20,width:100,height:80,progress:1,archived:true,created:1,silhouetteColor:'#ff99be',silhouetteType:'solid',glyphs:[{char:'ㄱ'}],el:{removed:false,contains:()=>false,remove(){this.removed=true;},replaceChildren(){this.emptied=true;}}});
function setup() {
  let time=0,next=0;
  const timers=new Map(),frames=new Map(),storage=new Map(),messages=[],canvases=[];
  const ctx2d={setTransform:()=>{},clearRect:()=>{},beginPath:()=>{},arc:()=>{},fill:()=>{},fillText:()=>{},scale:()=>{},getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4).fill(255)})};
  const document={hidden:false,activeElement:null,body:{},createElement:()=>{
    const canvas={width:0,height:0,dataset:{},removed:false,setAttribute:()=>{},getContext:()=>ctx2d,remove(){this.removed=true;}};
    canvases.push(canvas);return canvas;
  }};
  const context=vm.createContext({DELETE_TAP_INTERVAL:50,STORAGE:'test-memo-storage',memoTap:null,deletionCanvas:null,deletionFrame:0,deletionEffects:[],notes:[],memoPress:null,memoMove:null,cameraAnimation:0,tapCandidate:null,lastPointer:null,reducedMotion:true,
    camera:{x:0,y:0,scale:1},viewportGeometry:{width:800,height:600},devicePixelRatio:1,
    document,viewport:{append:()=>{},focus:()=>{}},Path2D:class {},getComputedStyle:()=>({fontFamily:'sans-serif',fontSize:'21px',fontWeight:'400'}),
    performance:{now:()=>time},
    setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:time+delay});return id;},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:fn=>{const id=++next;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    localStorage:{setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    announce:message=>messages.push(message),updateBounds:()=>{},refreshCount:()=>{},renderCamera:()=>{},renderNote:()=>{},complete:()=>{},cancelMemoPress:()=>{},finishMemoMove:()=>{},buildSilhouette:()=>{},
    inkMetrics:{cache:new Map([['deleted-glyph',{}]])}
  });
  vm.runInContext(source.slice(source.indexOf('  function seededRandom('),source.indexOf('  function inkMetrics('))+block+source.slice(source.indexOf('  function persist()'),source.indexOf('  function refreshCount'))+source.slice(source.indexOf('  function animateNote('),source.indexOf('  function addNote(')),context);
  return {context,timers,frames,storage,messages,canvases,setTime:value=>{time=value;},advance:ms=>{time+=ms;for(const [id,timer] of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}},draw:now=>{for(const [id,fn] of [...frames]){frames.delete(id);fn(now);}}};
}
const click=(context,note,time,single)=>context.activateMemo(note,{detail:1,timeStamp:time},single);
for(const gap of [0,20,49.999,50]) {
  const t=setup(),note=makeNote('rapid');t.context.notes.push(note);let singles=0;
  click(t.context,note,100,()=>singles++);click(t.context,note,100+gap,()=>singles++);
  assert.equal(singles,0);assert.equal(t.context.notes.length,0);assert.equal(t.timers.size,0);
  assert.equal(note.deleting,true);assert.equal(note.text,null);assert.equal(note.glyphs,null);assert.equal(note.silhouetteColor,null);
}
{
  const t=setup(),note=makeNote('single');t.context.notes.push(note);let singles=0;
  click(t.context,note,0,()=>singles++);t.advance(49);assert.equal(singles,0);t.advance(1);assert.equal(singles,1);
  click(t.context,note,100,()=>singles++);click(t.context,note,150.001,()=>singles++);t.advance(50);
  assert.equal(singles,3);assert.equal(t.context.notes.length,1,'Clicks outside the threshold remain two ordinary clicks');
  t.context.activateMemo(note,{detail:0},()=>singles++);t.context.activateMemo(note,{detail:0},()=>singles++);
  assert.equal(singles,5);assert.equal(t.context.notes.length,1,'Keyboard activation must never count as rapid deletion');
}
{
  const t=setup(),a=makeNote('a'),b=makeNote('b');t.context.notes.push(a,b);let singles=0;
  click(t.context,a,0,()=>singles++);click(t.context,b,20,()=>singles++);t.advance(50);
  assert.equal(singles,2);assert.equal(t.context.notes.length,2,'Two different memos must not trigger deletion');
  click(t.context,a,100,()=>singles++);t.context.clearMemoTap();t.advance(50);assert.equal(singles,2);
}
console.log('PASS: exact 50ms rapid-tap boundary, delayed single click, slower clicks, different targets, keyboard activation, cancellation.');
function gestureSetup(pointerType) {
  const t=setup(),note=makeNote('gesture'),handlers={},clicks={};let singles=0;
  Object.assign(note.el,{style:{setProperty:()=>{}},classList:{add:()=>{},remove:()=>{}},setPointerCapture:()=>{},addEventListener:(name,fn)=>{clicks[name]=fn;}});
  Object.assign(t.context,{note,el:note.el,toggleOriginal:()=>singles++,pointers:new Map(),panGesture:null,nativeGesture:null,memoMoveFrame:0,
    window:{addEventListener:()=>{}},viewportGeometry:{width:800,height:600,left:0,top:0}});
  Object.assign(t.context.document,{addEventListener:()=>{}});
  Object.assign(t.context.viewport,{classList:{add:()=>{},remove:()=>{}},setPointerCapture:()=>{},addEventListener:(name,fn)=>{handlers[name]=fn;}});
  t.context.notes.push(note);
  vm.runInContext(source.slice(source.indexOf('  function cancelMemoPress('),source.indexOf('  let composing=false'))+source.slice(source.indexOf("    el.addEventListener('click',e=>{"),source.indexOf("    el.addEventListener('keydown',e=>{")),t.context);
  const target={closest:selector=>selector==='.memo'?note.el:false};
  const event=(type,time)=>({type,pointerId:1,pointerType,button:0,clientX:100,clientY:100,timeStamp:time,target});
  return {...t,note,getSingles:()=>singles,down:time=>{t.setTime(time);handlers.pointerdown(event('pointerdown',time));},up:time=>{
    t.setTime(time);handlers.pointerup(event('pointerup',time));handlers.lostpointercapture(event('lostpointercapture',time));clicks.click({detail:1,timeStamp:time,target});
  }};
}
for(const pointerType of ['mouse','touch']) {
  const t=gestureSetup(pointerType);t.down(0);t.up(5);t.down(15);t.up(25);
  assert.equal(t.context.notes.length,0);assert.equal(t.getSingles(),0);assert.equal(t.context.memoTap,null);
}
{
  const t=gestureSetup('touch');t.down(0);t.up(5);t.down(15);t.advance(450);t.up(470);
  assert.equal(t.context.notes.length,1);assert.equal(t.getSingles(),0);assert.equal(t.context.memoTap,null,'A second press held for dragging must cancel the rapid-click candidate');
}
console.log('PASS: complete mouse/touch pointer-capture-click deletion sequence and second-press long-hold separation.');
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
