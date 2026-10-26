const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/sketch.js`, 'utf8');
const constants = source.slice(source.indexOf('  const INITIAL'), source.indexOf('  const STORAGE'));
const functions = source.slice(source.indexOf('  function decompose'), source.indexOf('  function announce'));
const api = vm.runInNewContext(`${constants}\n${functions}\n({decompose,makePattern,glyphBounds,glyphsOverlap,makeSilhouette,silhouetteStyle,roundedContourPath})`);
assert.equal(api.decompose('한').join(''), 'ㅎㅏㄴ');
assert.equal(api.decompose('과').join(''), 'ㄱㅗㅏ');
assert.equal(api.decompose('값').join(''), 'ㄱㅏㅂㅅ');
assert.equal(api.decompose(' ').length, 0);
assert.equal(api.decompose('ᄀ').join(''), 'ㄱ');
for (const text of ['오늘의 작은 생각이 내일의 다른 모양이 된다.', '가가가가나다라마 가나다', '한글 English 123 !?', '가'.repeat(280)]) {
  const pattern = api.makePattern(text);
  const expected = [...text].flatMap(api.decompose).length;
  assert(pattern.glyphs.length>=expected,'Visual repeats must retain all source jamo');
  const sourceCounts=new Map(),visualCounts=new Map();
  [...text].flatMap(api.decompose).forEach(c=>sourceCounts.set(c,(sourceCounts.get(c)||0)+1));
  pattern.glyphs.forEach(g=>visualCounts.set(g.char,(visualCounts.get(g.char)||0)+1));
  for(const [c,n] of sourceCounts)assert(visualCounts.get(c)>=n);
  assert.equal(JSON.stringify(pattern), JSON.stringify(api.makePattern(text)), 'Layout must be deterministic');
  const styles = new Map(), frequencies = new Map();
  for (let i=0;i<pattern.glyphs.length;i++) {
    const a = pattern.glyphs[i];
    const bounds=api.glyphBounds(a);
    assert(bounds.left>=0 && bounds.top>=0 && bounds.right<=pattern.width+.001 && bounds.bottom<=pattern.height+.001);
    assert(a.rowGap>=0 && a.rowGap<=a.size*1.6,'Extra leading must stay within 0..1.6em');
    const style = `${a.size}/${a.weight}`;
    if(styles.has(a.char))assert.equal(styles.get(a.char),style);
    styles.set(a.char,style);frequencies.set(a.char,(frequencies.get(a.char)||0)+1);
    for(let j=0;j<i;j++) {
      const b=pattern.glyphs[j];
      assert(!api.glyphsOverlap(a,b,0),'Rotated glyph boxes must not overlap');
    }
  }
  for(const a of pattern.glyphs)for(const b of pattern.glyphs)if(frequencies.get(a.char)>frequencies.get(b.char)) {
    assert(a.size<b.size);assert(a.weight<b.weight);
  }
}
const sample='같은 글자는 같은 리듬으로, 서로 다른 생각은 빈틈 사이로.';
const shapes=new Set(),orders=new Set();
for(let seed=0;seed<12;seed++) {
  const pattern=api.makePattern(sample,String(seed));
  assert.equal(JSON.stringify(pattern),JSON.stringify(api.makePattern(sample,String(seed))));
  shapes.add(JSON.stringify(pattern));
  orders.add([...new Set(pattern.glyphs.map(g=>g.char))].join(''));
  assert(pattern.glyphs.some(g=>Math.abs(g.angle%90)>10),'Must have diagonal rotation');
  assert(pattern.glyphs.some(g=>['wave','s','arc','orbit'].includes(g.motif)),'Must have curved groups');
  for(let i=0;i<pattern.glyphs.length;i++)for(let j=0;j<i;j++)assert(!api.glyphsOverlap(pattern.glyphs[i],pattern.glyphs[j],0));
}
assert.equal(shapes.size,12);assert.equal(orders.size,12);
console.log('PASS: Hangul, source retention and visual repeats, stable seeded composition, randomized group order, diagonal/curved motifs, rotated ink non-overlap, 0..1.6em leading, frequency styles, max input.');

// Silhouette geometry retains all groups without changing their glyph layout.
const lShape=[{x:0,y:0},{x:60,y:0},{x:60,y:20},{x:20,y:20},{x:20,y:60},{x:0,y:60}];
for(const points of [lShape,lShape.slice().reverse()]) {
  const d=api.roundedContourPath(points,8);
  assert.equal((d.match(/Q/g)||[]).length,5,'Only the five convex corners are rounded');
  assert(d.includes('L20 20'),'The inward corner must stay sharp');
  assert(!d.includes('Q20 20'),'No fillet on the inward corner');
}
const palette=new Set(['#2c7dff','#7835da','#ff99be','#ff5d31','#ff9a3e','#ccff66','#b19375','#4c292f']),variants=new Set(),colors=new Set(),pairs=new Set();
for(let seed=0;seed<240;seed++) {
  const style=api.silhouetteStyle(String(seed));
  assert(palette.has(style.color));assert(['solid','outline'].includes(style.type));
  assert.equal(JSON.stringify(style),JSON.stringify(api.silhouetteStyle(String(seed))));
  variants.add(style.type);colors.add(style.color);pairs.add(style.type+style.color);
}
assert.equal(variants.size,2);assert.equal(colors.size,8);assert.equal(pairs.size,16);
const inside=(point,polygon)=>{
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)result=!result;
  }
  return result;
};
const bentRow=[{cx:20,cy:20},{cx:20,cy:200},{cx:200,cy:200}].map(p=>({...p,size:24,box:26,inkWidth:16,inkHeight:16,angle:0,group:0,row:0,motif:'wave'}));
const bentSilhouette=api.makeSilhouette(bentRow,230,230);
assert(!bentSilhouette.contours.some(c=>inside({x:70,y:130},c)),'A bent row must not turn into a large triangular fan');
for(const [i,text] of ['기억은 곡선을 따라 새로운 모양으로 남는다.','글자가 모여 선이 되고 선이 모여 하나의 풍경이 된다. 오늘의 작은 생각은 곡선을 따라 흐르고, 기억은 서로 가까이 모여 새로운 모양으로 남는다.','가'.repeat(280)].entries()) {
  const pattern=api.makePattern(text,`silhouette-test-${i}`),before=JSON.stringify(pattern);
  const shape=api.makeSilhouette(pattern.glyphs,pattern.width,pattern.height);
  assert.equal(JSON.stringify(pattern),before,'Silhouette construction must never move the letters');
  assert(shape.path.length>0&&!/NaN|Infinity/.test(shape.path));
  assert.equal(shape.contours.length,1,'All groups and tails must join into one outer contour');
  assert(shape.contours.flat().length<3000,'Cached contours must have bounded complexity');
  for(const g of pattern.glyphs)assert(shape.contours.some(c=>inside({x:g.cx,y:g.cy},c)),'Each glyph group must be represented');
  assert.equal(shape.path,api.makeSilhouette(pattern.glyphs,pattern.width,pattern.height).path,'Contour must remain stable');
}
assert.equal(api.makeSilhouette([],160,100).path,'');
console.log('PASS: silhouette union, complete group coverage, stable contour/styles, 2 variants × 8 palette colors, convex fillets and sharp concave corners.');

// Exercise the actual registered gesture handlers with two concurrent contacts.
const handlers = {}, gestureCamera = {x:0,y:0,scale:1}, interactions = [];
let gestureNow=0,timerId=0,saveCalls=0,boundsCalls=0;
const timers=new Map(),moveFrames=new Map(),announcements=[],blurHandlers={};
const advanceHold=ms=>{gestureNow+=ms;for(const [id,timer] of [...timers])if(timer.at<=gestureNow){timers.delete(id);timer.fn();}};
const gestureContext = {
  viewport:{classList:{add:()=>{},remove:()=>{}},clientHeight:600,clientWidth:800,getBoundingClientRect:()=>({left:0,top:0}),addEventListener:(name,fn)=>{handlers[name]=fn;},setPointerCapture:()=>{}},
  viewportGeometry:{left:0,top:0,width:800,height:600},pointers:new Map(),camera:gestureCamera,lastPointer:null,panGesture:null,tapCandidate:null,nativeGesture:null,cameraAnimation:0,memoPress:null,memoMove:null,memoMoveFrame:0,notes:[],MIN_ZOOM:.08,MAX_ZOOM:3,DEFAULT_ZOOM:.65,
  setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,at:gestureNow+delay});return id;},clearTimeout:id=>timers.delete(id),
  requestAnimationFrame:fn=>{const id=++timerId;moveFrames.set(id,fn);return id;},cancelAnimationFrame:id=>moveFrames.delete(id),
  clampCamera:()=>{},renderCamera:()=>{},announce:text=>announcements.push(text),updateBounds:()=>boundsCalls++,persist:()=>{saveCalls++;return true;},
  window:{addEventListener:(name,fn)=>{blurHandlers[name]=fn;}},
  interact:(x,y,d)=>interactions.push({x,y,d})
};
const gestureSource=source.slice(source.indexOf('  function cancelMemoPress'),source.indexOf('  let composing=false'));
vm.runInNewContext(source.slice(source.indexOf('  function gesturePoint'),source.indexOf('  function focusNote'))+gestureSource,gestureContext);
const pointer=(id,x,y)=>({pointerId:id,clientX:x,clientY:y,pointerType:'touch',target:{closest:()=>false}});
handlers.pointerdown(pointer(1,100,100));
handlers.pointermove(pointer(1,120,100));
assert.equal(interactions.length,1,'One finger must transform notes');
handlers.pointerdown(pointer(2,200,100));
handlers.pointermove(pointer(1,160,130));
handlers.pointermove(pointer(2,240,130));
assert.equal(gestureCamera.x,40);assert.equal(gestureCamera.y,30);
assert.equal(interactions.length,1,'Two fingers must pan without transforming notes');
handlers.pointercancel(pointer(2,240,130));handlers.pointerup(pointer(1,160,130));
let prevented=false;
handlers.wheel({ctrlKey:false,deltaX:25,deltaY:45,deltaMode:0,shiftKey:false,preventDefault:()=>{prevented=true;}});
assert(prevented);assert.equal(gestureCamera.x,15);assert.equal(gestureCamera.y,-15);
const close=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const worldAt=(x,y)=>({x:(x-gestureCamera.x)/gestureCamera.scale,y:(y-gestureCamera.y)/gestureCamera.scale});
const wheelAnchor=worldAt(320,240);
handlers.wheel({ctrlKey:true,deltaY:-50,deltaMode:0,clientX:320,clientY:240,preventDefault:()=>{}});
assert(gestureCamera.scale>1);close(worldAt(320,240).x,wheelAnchor.x);close(worldAt(320,240).y,wheelAnchor.y);
Object.assign(gestureCamera,{x:0,y:0,scale:1});
handlers.pointerdown(pointer(1,100,100));handlers.pointerdown(pointer(2,200,100));
handlers.pointermove(pointer(1,50,100));handlers.pointermove(pointer(2,250,100));
close(gestureCamera.scale,2);close(worldAt(150,100).x,150);close(worldAt(150,100).y,100);
handlers.pointermove(pointer(1,125,100));handlers.pointermove(pointer(2,175,100));
close(gestureCamera.scale,.5);close(worldAt(150,100).x,150);close(worldAt(150,100).y,100);
assert.equal(interactions.length,1,'Pinching must not transform memo letters');
handlers.pointerup(pointer(2,175,100));handlers.pointermove(pointer(1,140,100));handlers.pointermove(pointer(1,150,100));
assert.equal(interactions.length,1,'Remaining finger after pinch must not transform notes');
handlers.pointerup(pointer(1,150,100));
handlers.pointerdown(pointer(1,100,100));handlers.pointerdown(pointer(2,200,100));
handlers.pointercancel({...pointer(2,200,100),type:'pointercancel'});
handlers.pointermove(pointer(1,120,100));handlers.pointermove(pointer(1,140,100));
assert.equal(interactions.length,1,'Cancelled pinch must not turn into one-finger conversion');
handlers.pointerup(pointer(1,140,100));
gestureContext.zoomAt(999,{x:150,y:100});close(gestureCamera.scale,3);
gestureContext.zoomAt(.0001,{x:150,y:100});close(gestureCamera.scale,.08);
Object.assign(gestureCamera,{x:0,y:0,scale:1});
handlers.gesturestart({clientX:200,clientY:150,preventDefault:()=>{}});
handlers.gesturechange({scale:1.8,clientX:220,clientY:160,preventDefault:()=>{}});
close(gestureCamera.scale,1.8);close(worldAt(220,160).x,200);close(worldAt(220,160).y,150);
handlers.wheel({ctrlKey:true,deltaY:-10,deltaMode:0,clientX:220,clientY:160,preventDefault:()=>{}});
close(gestureCamera.scale,1.8);
handlers.gesturechange({scale:.7,clientX:220,clientY:160,preventDefault:()=>{}});close(gestureCamera.scale,.7);
handlers.gestureend({preventDefault:()=>{}});assert.equal(gestureContext.nativeGesture,null);
console.log('PASS: pan, touch pinch in/out, fixed zoom anchor, 8–300% limits, trackpad/WebKit pinch, no accidental memo conversion.');

// Exercise long holds, normal clicks/swipes, drag cancellation and multitouch
// against the same registered handlers; fake time avoids real test delays.
const moveClasses=new Set(),moveWrites=[];
const moveStyle={setProperty:()=>{}};
Object.defineProperty(moveStyle,'transform',{get:()=>moveWrites.at(-1)||'',set:value=>moveWrites.push(value)});
const moveElement={style:moveStyle,classList:{add:name=>moveClasses.add(name),remove:name=>moveClasses.delete(name)},setPointerCapture:()=>{}};
const movingNote={id:'moved-note',text:'위치를 기억한다.',archived:true,created:1,el:moveElement,x:100,y:200,width:200,height:120};
const storedPositions=[];gestureContext.STORAGE='test-memo-storage';gestureContext.localStorage={setItem:(key,value)=>storedPositions.push(JSON.parse(value))};
vm.runInNewContext(source.slice(source.indexOf('  function persist()'),source.indexOf('  function refreshCount')),gestureContext);
const actualPersist=gestureContext.persist;gestureContext.persist=()=>{saveCalls++;return actualPersist();};
gestureContext.notes.push(movingNote);
const notePointer=(type,id,x,y,pointerType='touch')=>({type,pointerId:id,clientX:x,clientY:y,pointerType,button:0,preventDefault:()=>{},target:{closest:selector=>selector==='.memo'?moveElement:false}});
const emptyPointer=(type,id,x,y)=>({...notePointer(type,id,x,y),target:{closest:()=>false}});
const flushMove=()=>{for(const [id,fn] of [...moveFrames]){moveFrames.delete(id);fn();}};
Object.assign(gestureCamera,{x:0,y:0,scale:.25});
handlers.pointerdown(notePointer('pointerdown',1,100,100));advanceHold(449);
assert.equal(gestureContext.memoMove,null,'A short click must not start moving');
handlers.pointerup(notePointer('pointerup',1,100,100));advanceHold(1);
assert.equal(gestureContext.tapCandidate.moved,false,'A short click stays available for original-view toggle');
assert.equal(saveCalls,0);
// Test the registered memo click handler after the complete browser event
// sequence, including the implicit lost capture between pointerup and click.
const clickHandlers={};let originalToggles=0;
const clickContext={el:{addEventListener:(name,fn)=>clickHandlers[name]=fn},note:{archived:true},tapCandidate:gestureContext.tapCandidate,toggleOriginal:()=>originalToggles++};
const clickSource=source.slice(source.indexOf("    el.addEventListener('click',e=>{"),source.indexOf("    el.addEventListener('keydown',e=>{"));
vm.runInNewContext(clickSource,clickContext);
for(const pointerType of ['mouse','touch']) {
  handlers.pointerdown(notePointer('pointerdown',1,100,100,pointerType));
  handlers.pointerup(notePointer('pointerup',1,100,100,pointerType));
  handlers.lostpointercapture(notePointer('lostpointercapture',1,100,100,pointerType));
  assert.equal(gestureContext.tapCandidate.panned,false,'Implicit capture loss after release must not cancel a tap');
  clickContext.tapCandidate={...gestureContext.tapCandidate,note:clickContext.el};
  const before=originalToggles;clickHandlers.click({detail:1});assert.equal(originalToggles,before+1,'Short mouse/touch tap must show the original');
  clickHandlers.click({detail:0});assert.equal(originalToggles,before+2,'Keyboard activation remains available');
}
handlers.pointerdown(notePointer('pointerdown',1,100,100));advanceHold(450);
assert(moveClasses.has('dragging'));assert(gestureContext.tapCandidate.moved&&gestureContext.tapCandidate.held,'A hold must suppress the trailing click');
const interactionsBeforeDrag=interactions.length;
const activeDrag=gestureContext.memoMove;handlers.pointerdown(notePointer('pointerdown',1,100,100));
assert.equal(gestureContext.memoMove,activeDrag,'Repeated down for the same held pointer must not interrupt a drag');
for(let i=1;i<=120;i++)handlers.pointermove(notePointer('pointermove',1,100+i/4,100+i/8));
assert.equal(moveFrames.size,1,'Drag event bursts must produce one visual update');
assert.equal(movingNote.x,220);assert.equal(movingNote.y,260,'Movement must account for 25% zoom');
flushMove();assert(moveStyle.transform.includes('120px,60px'));
assert.equal(interactions.length,interactionsBeforeDrag,'Moving a memo must not transform letters');
handlers.pointerup(notePointer('pointerup',1,130,115));
assert.equal(moveStyle.left,'220px');assert.equal(moveStyle.top,'260px');assert.equal(moveStyle.transform,'');assert(!moveClasses.has('dragging'));assert.equal(saveCalls,1);assert.equal(boundsCalls,1);assert.equal(storedPositions.at(-1)[0].x,220);assert.equal(storedPositions.at(-1)[0].y,260);
clickContext.tapCandidate={...gestureContext.tapCandidate,note:clickContext.el};const heldToggleCount=originalToggles;clickHandlers.click({detail:1});assert.equal(originalToggles,heldToggleCount,'A drag release must not toggle the original');
handlers.lostpointercapture(notePointer('lostpointercapture',1,130,115));assert.equal(saveCalls,1,'Lost capture after release must not undo or save twice');
// Cancellation and Escape restore the exact starting position.
handlers.pointerdown(notePointer('pointerdown',1,100,100));advanceHold(450);handlers.pointermove(notePointer('pointermove',1,160,120));
handlers.pointercancel(notePointer('pointercancel',1,160,120));assert.equal(movingNote.x,220);assert.equal(movingNote.y,260);assert.equal(gestureContext.memoMove,null);
handlers.pointerdown(notePointer('pointerdown',1,100,100));advanceHold(450);handlers.pointermove(notePointer('pointermove',1,120,130));
handlers.keydown({key:'Escape',target:moveElement,preventDefault:()=>{}});assert.equal(movingNote.x,220);assert.equal(movingNote.y,260);handlers.pointerup(notePointer('pointerup',1,120,130));
// A normal early swipe keeps its original conversion behavior.
const beforeSwipe=interactions.length;
handlers.pointerdown(notePointer('pointerdown',1,100,100));handlers.pointermove(notePointer('pointermove',1,110,100));advanceHold(500);
assert.equal(gestureContext.memoMove,null);assert.equal(interactions.length,beforeSwipe+1);handlers.pointerup(notePointer('pointerup',1,110,100));
// A second finger cancels an unactivated hold, and takes over an active drag.
handlers.pointerdown(notePointer('pointerdown',1,100,100));handlers.pointerdown(emptyPointer('pointerdown',2,200,100));advanceHold(500);
assert.equal(gestureContext.memoMove,null);handlers.pointerup(emptyPointer('pointerup',2,200,100));handlers.pointerup(notePointer('pointerup',1,100,100));
handlers.pointerdown(notePointer('pointerdown',1,100,100));advanceHold(450);handlers.pointermove(notePointer('pointermove',1,110,100));
handlers.pointerdown(emptyPointer('pointerdown',2,210,100));assert.equal(gestureContext.memoMove,null);assert(gestureContext.panGesture);assert.equal(movingNote.x,260);
const beforePan=interactions.length;handlers.pointermove(emptyPointer('pointermove',2,230,100));assert.equal(interactions.length,beforePan);
handlers.pointerup(emptyPointer('pointerup',2,230,100));handlers.pointerup(notePointer('pointerup',1,110,100));
// Mouse movement also respects zoom; window blur rolls back an in-flight drag.
Object.assign(gestureCamera,{x:0,y:0,scale:2});
handlers.pointerdown(notePointer('pointerdown',1,100,100,'mouse'));advanceHold(450);handlers.pointermove(notePointer('pointermove',1,120,130,'mouse'));
assert.equal(movingNote.x,270);assert.equal(movingNote.y,275);blurHandlers.blur();assert.equal(movingNote.x,260);assert.equal(movingNote.y,260);assert.equal(gestureContext.pointers.size,0);
const restoreCondition=source.slice(source.indexOf('    const canRestore=restore'),source.indexOf('    const position=canRestore'))+'\ncanRestore;';
assert(vm.runInNewContext(restoreCondition,{restore:true,record:{x:100,y:200},notes:[{x:100,y:200,width:300,height:300}]}),'User-placed overlapping notes must restore exactly');
console.log('PASS: 450ms hold, mouse/touch click after capture release, click/swipe separation, zoom-correct drag, frame batching, save on release, exact overlap restoration, cancel/Escape/blur rollback, multitouch takeover.');

const placementContext={notes:[]};
vm.runInNewContext(source.slice(source.indexOf('  function positionNote'),source.indexOf('  function renderNote'))+'\nthis.place=positionNote;',placementContext);
let placementSeed=9;
const placementRandom=()=>{placementSeed=(Math.imul(placementSeed,1664525)+1013904223)>>>0;return placementSeed/4294967296;};
for(let i=0;i<60;i++) {
  const width=300+i%4*24,height=200+i%3*32,p=placementContext.place(width,height,placementRandom);
  for(const n of placementContext.notes)assert(p.x+width+76<=n.x||p.x>=n.x+n.width+76||p.y+height+76<=n.y||p.y>=n.y+n.height+76);
  placementContext.notes.push({...p,width,height});
}
const xs=placementContext.notes.map(n=>n.x),ys=placementContext.notes.map(n=>n.y);
assert(Math.max(...xs)-Math.min(...xs)>800,'Canvas must expand horizontally');
assert(Math.max(...ys)-Math.min(...ys)>800,'Canvas must expand vertically');
placementContext.notes=[{x:-2000,y:0,width:300,height:200},{x:0,y:0,width:300,height:200},{x:2000,y:0,width:300,height:200}];
for(let index=0;index<3;index++)for(const phase of [0,.25,.5,.75]) {
  let call=0;
  const p=placementContext.place(200,120,()=>call++===0?(index+.1)/3:phase);
  const anchor=placementContext.notes[index];
  assert(Math.abs(p.x+100-anchor.x-150)<600 && Math.abs(p.y+60-anchor.y-100)<600,'Any existing memo can be selected as anchor');
}
console.log('PASS: random anchor selection across all memos, all four directions, 60 non-overlapping placements, two-dimensional expansion.');

// Input bursts must produce a single DOM commit, with no unchanged zoom-label writes.
const frames=[],commits=[],labels=[],detailModes=[];
const worldStyle={};Object.defineProperty(worldStyle,'transform',{set:value=>commits.push(value)});
const zoomLabel={};Object.defineProperty(zoomLabel,'textContent',{set:value=>labels.push(value)});
const renderContext={world:{style:worldStyle,classList:{toggle:(name,value)=>detailModes.push({name,value})},insertBefore:el=>{el.isConnected=true;}},zoomLabel,camera:{x:0,y:0,scale:1},cameraRender:0,lastZoom:null,lastLowDetail:null,viewportGeometry:{width:800,height:600},notes:[],pointers:new Map(),document:{activeElement:null},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;}};
vm.runInNewContext(source.slice(source.indexOf('  function renderCamera'),source.indexOf('  function clampCamera')),renderContext);
for(let i=0;i<120;i++){renderContext.camera.x=i;renderContext.renderCamera();}
assert.equal(frames.length,1);frames.shift()();assert.equal(commits.length,1);assert(commits[0].includes('119px'));
assert.equal(labels.length,1);
renderContext.camera.x+=1;renderContext.renderCamera();frames.shift()();assert.equal(labels.length,1);assert.equal(detailModes.length,1,'Panning must not repeat layer changes');
renderContext.camera.scale=.15;renderContext.renderCamera();frames.shift()();assert.equal(detailModes.at(-1).value,true);
renderContext.camera.scale=.149;renderContext.renderCamera();frames.shift()();assert.equal(detailModes.length,2);
renderContext.camera.scale=.15001;renderContext.renderCamera();frames.shift()();assert.equal(detailModes.at(-1).value,false);
renderContext.camera.scale=1;
const fakeElement={isConnected:true,contains:target=>target===fakeElement,hasPointerCapture:()=>false,remove(){this.isConnected=false;}};
renderContext.notes.push({x:2000,y:0,width:300,height:200,archived:true,el:fakeElement});
renderContext.updateVisibility();assert.equal(fakeElement.isConnected,false);
renderContext.camera.x=-1900;renderContext.updateVisibility();assert.equal(fakeElement.isConnected,true);
renderContext.camera.x=0;renderContext.document.activeElement=fakeElement;renderContext.updateVisibility();assert.equal(fakeElement.isConnected,true);
renderContext.document.activeElement=null;renderContext.pointers.set(1,{});fakeElement.hasPointerCapture=id=>id===1;
renderContext.updateVisibility();assert.equal(fakeElement.isConnected,true);
renderContext.pointers.clear();renderContext.updateVisibility();assert.equal(fakeElement.isConnected,false);
console.log('PASS: 120 camera updates -> 1 DOM commit, unchanged zoom label skipped, offscreen detach/restore, focus/pointer capture retained.');
