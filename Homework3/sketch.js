/* 사이 — dependency-free, browser-local memo canvas. */
(() => {
  'use strict';
  const INITIAL = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
  const MEDIAL = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
  const FINAL = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
  const CLUSTERS = {ㄳ:'ㄱㅅ',ㄵ:'ㄴㅈ',ㄶ:'ㄴㅎ',ㄺ:'ㄹㄱ',ㄻ:'ㄹㅁ',ㄼ:'ㄹㅂ',ㄽ:'ㄹㅅ',ㄾ:'ㄹㅌ',ㄿ:'ㄹㅍ',ㅀ:'ㄹㅎ',ㅄ:'ㅂㅅ',ㅘ:'ㅗㅏ',ㅙ:'ㅗㅐ',ㅚ:'ㅗㅣ',ㅝ:'ㅜㅓ',ㅞ:'ㅜㅔ',ㅟ:'ㅜㅣ',ㅢ:'ㅡㅣ'};
  const STORAGE = 'sai.homework3.v1';
  const DELETE_SCRUB = {window:900,pause:200,reversals:3,minSpeed:.12}; // Screen px/ms; independent of zoom.
  const $ = (selector) => document.querySelector(selector);
  const viewport = $('#viewport'), world = $('#world'), input = $('#memo-input');
  const zoomLabel=$('#position');
  const initialViewport=viewport.getBoundingClientRect();
  let viewportGeometry={left:initialViewport.left,top:initialViewport.top,width:initialViewport.width,height:initialViewport.height};
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const notes = [];
  const MIN_ZOOM=.08,MAX_ZOOM=3,DEFAULT_ZOOM=.65;
  const camera = { x: 0, y: 0, scale: DEFAULT_ZOOM };
  const pointers = new Map();
  let lastPointer = null, panGesture = null, nativeGesture = null, tapCandidate = null, toastTimer, cameraAnimation = 0, cameraRender = 0, lastZoom = null, lastLowDetail = null;
  let memoPress=null,memoMove=null,memoMoveFrame=0;
  let memoScrub=null,deletionCanvas=null,deletionFrame=0;
  const deletionEffects=[];
  let bounds = { left:-800, right:800, top:-600, bottom:600 };

  function decompose(character) {
    const code = character.codePointAt(0);
    let parts;
    if (code >= 0xac00 && code <= 0xd7a3) {
      const n = code - 0xac00;
      parts = [INITIAL[Math.floor(n / 588)], MEDIAL[Math.floor(n % 588 / 28)], FINAL[n % 28]].filter(Boolean);
    } else if (/\s/u.test(character)) return [];
    else if (code >= 0x1100 && code <= 0x1112) parts = [INITIAL[code - 0x1100]];
    else if (code >= 0x1161 && code <= 0x1175) parts = [MEDIAL[code - 0x1161]];
    else if (code >= 0x11a8 && code <= 0x11c2) parts = [FINAL[code - 0x11a7]];
    else parts = [character];
    return parts.flatMap(part => [...(CLUSTERS[part] || part)]);
  }

  // A memo's seed fixes its composition after saving. Randomness chooses the
  // order, location and flowing motif of groups, never independent loose letters.
  function seededRandom(seed) {
    let state=2166136261;
    for(const char of String(seed)){state^=char.codePointAt(0);state=Math.imul(state,16777619);}
    return () => {state+=0x6D2B79F5;let t=state;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
  }
  function inkMetrics(char,size,weight) {
    const context=inkMetrics.context ||= document.createElement('canvas').getContext('2d');
    const family=inkMetrics.family ||= getComputedStyle(document.body).fontFamily;
    const cache=inkMetrics.cache ||= new Map(),key=`${char}|${size}|${weight}`;
    if(cache.has(key))return cache.get(key);
    context.font=`${weight} ${size}px ${family}`;
    const m=context.measureText(char);
    const metrics={inkWidth:Math.max(1,m.actualBoundingBoxLeft+m.actualBoundingBoxRight),inkHeight:Math.max(1,m.actualBoundingBoxAscent+m.actualBoundingBoxDescent),inkLeft:m.actualBoundingBoxLeft,inkRight:m.actualBoundingBoxRight,inkAscent:m.actualBoundingBoxAscent,inkDescent:m.actualBoundingBoxDescent};
    cache.set(key,metrics);return metrics;
  }
  function glyphBounds(glyph) {
    const angle=glyph.angle*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
    const x=(glyph.inkWidth??glyph.box)/2*c+(glyph.inkHeight??glyph.box)/2*s;
    const y=(glyph.inkWidth??glyph.box)/2*s+(glyph.inkHeight??glyph.box)/2*c;
    return {left:glyph.cx-x,right:glyph.cx+x,top:glyph.cy-y,bottom:glyph.cy+y};
  }
  function glyphsOverlap(a,b,padding=0) {
    const aa=a.angle*Math.PI/180,ba=b.angle*Math.PI/180;
    const au={x:Math.cos(aa),y:Math.sin(aa)},av={x:-au.y,y:au.x};
    const bu={x:Math.cos(ba),y:Math.sin(ba)},bv={x:-bu.y,y:bu.x};
    const dx=b.cx-a.cx,dy=b.cy-a.cy;
    const aw=(a.inkWidth??a.box)/2+padding/2,ah=(a.inkHeight??a.box)/2+padding/2;
    const bw=(b.inkWidth??b.box)/2+padding/2,bh=(b.inkHeight??b.box)/2+padding/2;
    for(const axis of [au,av,bu,bv]) {
      const distance=Math.abs(dx*axis.x+dy*axis.y);
      const extentA=aw*Math.abs(au.x*axis.x+au.y*axis.y)+ah*Math.abs(av.x*axis.x+av.y*axis.y);
      const extentB=bw*Math.abs(bu.x*axis.x+bu.y*axis.y)+bh*Math.abs(bv.x*axis.x+bv.y*axis.y);
      if(distance>=extentA+extentB-.001)return false;
    }
    return true;
  }
  function supportRadius(glyph,theta) {
    const delta=theta-glyph.angle*Math.PI/180;
    return Math.abs(Math.cos(delta))*(glyph.inkWidth??glyph.box)/2+Math.abs(Math.sin(delta))*(glyph.inkHeight??glyph.box)/2;
  }
  function glyphTouchesVoid(glyph,hole) {
    const theta=-glyph.angle*Math.PI/180,dx=hole.cx-glyph.cx,dy=hole.cy-glyph.cy;
    const x=Math.abs(dx*Math.cos(theta)-dy*Math.sin(theta)),y=Math.abs(dx*Math.sin(theta)+dy*Math.cos(theta));
    return Math.hypot(Math.max(0,x-glyph.inkWidth/2),Math.max(0,y-glyph.inkHeight/2))<hole.radius;
  }
  function groupMotif(count,box,random,motif,ink,kind='cluster') {
    const size=box-2,width=ink.inkWidth,height=ink.inkHeight;
    const columns=kind==='strand'||motif==='orbit'?count:motif==='matrix'?Math.max(2,Math.ceil(Math.sqrt(count*.8))):count<=6?count:Math.max(4,Math.ceil(Math.sqrt(count*2.6)));
    const rotation=([-68,-42,-24,24,42,68,96,128][Math.floor(random()*8)]+(random()-.5)*12)*Math.PI/180;
    const shape=[],voids=[];let bottom=0;
    for(let start=0,row=0;start<count;start+=columns,row++) {
      const length=Math.min(columns,count-start),advance=width+size*.025;
      let line=[],hole;
      for(let col=0;col<length;col++) {
        const u=(col-(length-1)/2)*advance;
        let x=u,y=0,angle=0;
        if(motif==='orbit'&&length>=4) {
          const sweep=Math.PI*(length>=8?1.7:.95),radius=advance/(2*Math.sin(sweep/(length-1)/2)),theta=-sweep/2+col*sweep/(length-1);
          x=Math.sin(theta)*radius;y=(1-Math.cos(theta))*radius;angle=theta*180/Math.PI;
          if(length>=8)hole={cx:0,cy:radius,radius:Math.max(0,radius-height*.7)};
        } else if(motif==='wave'||motif==='s') {
          const cycle=motif==='s'?2:1.25,amplitude=kind==='strand'?.9:.28;
          const phase=col/Math.max(1,length-1)*Math.PI*cycle;
          y=Math.sin(phase)*height*amplitude;
          angle=Math.atan(Math.cos(phase)*height*amplitude*Math.PI*cycle/Math.max(advance,(length-1)*advance))*180/Math.PI;
        } else if(motif==='arc') {
          const t=(col-(length-1)/2)/Math.max(1,length/2);
          y=t*t*height*.28;
          angle=Math.atan(t*height*.56/Math.max(advance,length/2*advance))*180/Math.PI;
        }
        line.push({cx:x,cy:y,angle,box,...ink,row});
      }
      // Compact letters along each path, using visible ink rather than em boxes.
      if(length>1) {
        const clearAt=scale=>{
          const points=line.map(p=>({...p,cx:p.cx*scale,cy:p.cy*scale}));
          for(let i=0;i<points.length;i++)for(let j=0;j<i;j++)if(glyphsOverlap(points[i],points[j],.15))return false;
          return true;
        };
        let low=0,high=1;
        while(!clearAt(high))high*=1.12;
        for(let i=0;i<10;i++){const middle=(low+high)/2;if(clearAt(middle))high=middle;else low=middle;}
        line=line.map(p=>({...p,cx:p.cx*high,cy:p.cy*high}));
        if(hole){hole.cx*=high;hole.cy*=high;hole.radius=Math.max(0,hole.radius*high-height*.08);}
      }
      // Additional leading between visible row edges, 0..1.6em. Bias toward
      // close leading so repeats read as a texture, with occasional open seams.
      const rowGap=row===0?0:(random()<.18?0:Math.pow(random(),5)*size*1.6);
      const local=line.map(glyphBounds),top=Math.min(...local.map(b=>b.top));
      const shift=row===0?-top:bottom+rowGap-top;
      line.forEach(p=>{p.cy+=shift;p.rowGap=rowGap;shape.push(p);});
      if(hole&&hole.radius>size*.15){hole.cy+=shift;voids.push(hole);}
      bottom=Math.max(...line.map(p=>glyphBounds(p).bottom));
    }
    const center={x:shape.reduce((s,p)=>s+p.cx,0)/count,y:shape.reduce((s,p)=>s+p.cy,0)/count};
    const cos=Math.cos(rotation),sin=Math.sin(rotation);
    const result=shape.map(p=>({...p,cx:(p.cx-center.x)*cos-(p.cy-center.y)*sin,cy:(p.cx-center.x)*sin+(p.cy-center.y)*cos,angle:p.angle+rotation*180/Math.PI}));
    result.voids=voids.map(p=>({...p,cx:(p.cx-center.x)*cos-(p.cy-center.y)*sin,cy:(p.cx-center.x)*sin+(p.cy-center.y)*cos}));
    return result;
  }
  function makePattern(text,seed=text,measure) {
    const random=seededRandom(seed),occurrences=[];
    [...text].forEach((character,source)=>decompose(character).forEach(char=>occurrences.push({char,source})));
    if(!occurrences.length)return {glyphs:[],width:160,height:100};
    const counts=new Map();
    occurrences.forEach(({char})=>counts.set(char,(counts.get(char)||0)+1));
    const frequencies=[...counts.values()],min=Math.min(...frequencies),max=Math.max(...frequencies);
    const groups=[],repeatBudget=Math.max(1,Math.min(4,640/occurrences.length));
    for(const [char,count] of counts) {
      const commonness=max===min?.5:(count-min)/(max-min);
      const repeat=Math.max(count,Math.floor(count*(1+(repeatBudget-1)*Math.pow(commonness,1.15))));
      const pieces=repeat>=25?3:repeat>=12?2:1;
      for(let piece=0;piece<pieces;piece++) {
        const amount=Math.floor(repeat/pieces)+(piece<repeat%pieces?1:0);
        const kind=pieces>1&&piece===pieces-1?'strand':commonness>.55&&amount>=6?'texture':'cluster';
        groups.push({char,count,amount,kind,piece,pieces,commonness,bridge:kind==='strand'&&pieces===2});
      }
    }
    for(let i=groups.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[groups[i],groups[j]]=[groups[j],groups[i]];}
    // Add the fine strands last, where they can emerge from the outer contour.
    groups.sort((a,b)=>(a.kind==='strand')-(b.kind==='strand'));
    const glyphs=[],hash=new Map(),voids=[],bucket=56;
    let envelope={left:0,right:0,top:0,bottom:0};
    const cells=b=>{
      const result=[];
      for(let y=Math.floor(b.top/bucket);y<=Math.floor(b.bottom/bucket);y++)for(let x=Math.floor(b.left/bucket);x<=Math.floor(b.right/bucket);x++)result.push(`${x},${y}`);
      return result;
    };
    function fits(shape,x,y) {
      for(const g of shape) {
        const candidate={...g,cx:g.cx+x,cy:g.cy+y},b=glyphBounds(candidate);
        if(voids.some(hole=>glyphTouchesVoid(candidate,hole)))return false;
        b.left-=5;b.right+=5;b.top-=5;b.bottom+=5;
        const checked=new Set();
        for(const key of cells(b))for(const index of hash.get(key)||[]) {
          if(checked.has(index))continue;checked.add(index);
          const breathingRoom=(candidate.size>=43||glyphs[index].size>=43)?3:.65;
          if(glyphsOverlap(candidate,glyphs[index],breathingRoom))return false;
        }
      }
      for(const hole of shape.voids||[])if(glyphs.some(g=>glyphTouchesVoid(g,{...hole,cx:hole.cx+x,cy:hole.cy+y})))return false;
      return true;
    }
    groups.forEach(({char,count,amount,kind,piece,commonness,bridge},group)=>{
      const rarity=max===min?.5:1-(count-min)/(max-min),size=18+30*rarity,weight=300+500*rarity,box=size+2;
      const fallback={inkWidth:/[ㅣ]/u.test(char)?size*.13:size*.77,inkHeight:/[ㅡ]/u.test(char)?size*.13:size*.77};
      const ink=measure?measure(char,size,weight):fallback;
      const pool=kind==='texture'?['matrix','matrix','wave']:kind==='strand'?['s','wave','arc','orbit']:['wave','s','arc','orbit','ribbon'];
      const motif=pool[Math.floor(random()*pool.length)];
      const shape=groupMotif(amount,box,random,motif,ink,kind),local=shape.map(glyphBounds);
      const extent={left:Math.min(...local.map(b=>b.left)),right:Math.max(...local.map(b=>b.right)),top:Math.min(...local.map(b=>b.top)),bottom:Math.max(...local.map(b=>b.bottom))};
      let best=group===0?{x:0,y:0,score:0}:null;
      const center={x:(envelope.left+envelope.right)/2,y:(envelope.top+envelope.bottom)/2};
      const span=Math.max(envelope.right-envelope.left,envelope.bottom-envelope.top,box*3);
      for(let attempt=0;group>0&&attempt<640;attempt++) {
        // Place a visible stroke beside an existing stroke. Groups join the
        // same composition instead of occupying separate loose rectangles.
        let anchor=glyphs[Math.floor(random()*glyphs.length)];
        if(kind==='strand'&&!bridge) {
          const direction=group*2.399963;
          anchor=glyphs.reduce((a,b)=>(a.cx-center.x)*Math.cos(direction)+(a.cy-center.y)*Math.sin(direction)>(b.cx-center.x)*Math.cos(direction)+(b.cy-center.y)*Math.sin(direction)?a:b);
        }
        const tip=kind==='strand'?shape[bridge?0:random()<.5?0:shape.length-1]:shape[Math.floor(random()*shape.length)];
        const theta=random()*Math.PI*2;
        const distance=supportRadius(anchor,theta)+supportRadius(tip,theta)+(size>=43||anchor.size>=43?3.2:.7)+random()*.8;
        const x=anchor.cx+Math.cos(theta)*distance-tip.cx,y=anchor.cy+Math.sin(theta)*distance-tip.cy;
        const left=Math.min(envelope.left,extent.left+x),right=Math.max(envelope.right,extent.right+x);
        const top=Math.min(envelope.top,extent.top+y),bottom=Math.max(envelope.bottom,extent.bottom+y);
        const width=right-left,height=bottom-top;
        let score=width*height+Math.pow(width-height,2)*.035+Math.hypot(x-center.x,y-center.y)*(kind==='strand'&&!bridge?-15:3);
        if(bridge) {
          const end=shape.at(-1);
          let endGap=Infinity;
          for(const g of glyphs)if(g.group!==anchor.group) {
            const dx=g.cx-end.cx-x,dy=g.cy-end.cy-y,direction=Math.atan2(dy,dx);
            endGap=Math.min(endGap,Math.max(0,Math.hypot(dx,dy)-supportRadius(end,direction)-supportRadius(g,direction)));
          }
          if(Number.isFinite(endGap))score+=endGap*box*3;
        }
        if(best&&score>=best.score)continue;
        if(fits(shape,x,y))best={x,y,score};
      }
      if(!best) {
        // Keep a safe fallback, then slide inward until it touches the collage.
        const theta=random()*Math.PI*2;
        let radius=span*.65;
        do {best={x:center.x+Math.cos(theta)*radius,y:center.y+Math.sin(theta)*radius};radius+=box;}while(!fits(shape,best.x,best.y));
        if(!fits(shape,center.x,center.y)) {
          let low=0,high=1;
          for(let i=0;i<13;i++){const t=(low+high)/2;if(fits(shape,center.x+(best.x-center.x)*t,center.y+(best.y-center.y)*t))high=t;else low=t;}
          best={x:center.x+(best.x-center.x)*high,y:center.y+(best.y-center.y)*high};
        }
      }
      const sources=occurrences.filter(o=>o.char===char);
      for(const hole of shape.voids||[])voids.push({...hole,cx:hole.cx+best.x,cy:hole.cy+best.y});
      shape.forEach((point,i)=>{
        const glyph={...point,cx:point.cx+best.x,cy:point.cy+best.y,char,source:sources[(i+piece*amount)%sources.length].source,size,weight,group,motif,kind};
        const b=glyphBounds(glyph),index=glyphs.length;
        for(const key of cells(b)){if(!hash.has(key))hash.set(key,[]);hash.get(key).push(index);}
        glyphs.push(glyph);
        envelope={left:Math.min(envelope.left,b.left),right:Math.max(envelope.right,b.right),top:Math.min(envelope.top,b.top),bottom:Math.max(envelope.bottom,b.bottom)};
      });
    });
    const padding=8;
    glyphs.forEach(g=>{g.cx+=padding-envelope.left;g.cy+=padding-envelope.top;g.x=g.cx-g.box/2;g.y=g.cy-g.box/2;});
    return {glyphs,width:Math.max(160,envelope.right-envelope.left+padding*2),height:Math.max(100,envelope.bottom-envelope.top+padding*2)};
  }

  function silhouetteStyle(seed,previousColor,savedColor,preserveSaved=false) {
    const colors=['#2c7dff','#7835da','#ff99be','#ff5d31','#ff9a3e','#ccff66','#b19375','#4c292f'];
    const random=seededRandom(`silhouette:${seed}`);
    // Keep the seeded shape variant and existing colors unless two consecutive
    // memos match. Choose a replacement once, then save it with the memo.
    const choice=Math.floor(random()*3),seedColor=colors[Math.floor(random()*colors.length)];
    const type=choice===2?(random()<.5?'solid':'outline'):['solid','outline'][choice];
    let color=colors.includes(savedColor)?savedColor:seedColor;
    if(color===previousColor&&!(preserveSaved&&colors.includes(savedColor))) {
      const available=colors.filter(candidate=>candidate!==previousColor);
      color=available[Math.floor(random()*available.length)];
    }
    return {type,color};
  }
  function assignSilhouetteStyle(seed,previousNotes,record={},restore=false) {
    const style=silhouetteStyle(seed,previousNotes.at(-1)?.silhouetteColor,record.silhouetteColor,restore);
    if(['solid','outline'].includes(record.silhouetteType)) {
      style.type=record.silhouetteType;
      // Deleting a separator must not restyle previously assigned survivors.
      if(restore)return style;
    }
    // Only the last three creations matter, regardless of archive/zoom order.
    const recent=previousNotes.slice(-3);
    if(recent.length===3&&recent.every(note=>note.silhouetteType===recent[0].silhouetteType)) {
      style.type=recent[0].silhouetteType==='solid'?'outline':'solid';
    }
    return style;
  }
  function polygonArea(points) {
    return points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2;
  }
  function convexHull(points) {
    const sorted=points.slice().sort((a,b)=>a.x-b.x||a.y-b.y);
    const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    const half=items=>{const hull=[];for(const p of items){while(hull.length>1&&cross(hull.at(-2),hull.at(-1),p)<=0)hull.pop();hull.push(p);}return hull;};
    return half(sorted).slice(0,-1).concat(half(sorted.slice().reverse()).slice(0,-1));
  }
  function simplifyContour(points,epsilon) {
    function open(line) {
      if(line.length<=2)return line;
      const keep=new Uint8Array(line.length),stack=[[0,line.length-1]];keep[0]=keep[line.length-1]=1;
      while(stack.length) {
        const [start,end]=stack.pop(),a=line[start],b=line[end],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
        let furthest=-1,distance=epsilon*epsilon;
        for(let i=start+1;i<end;i++) {
          const p=line[i],t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
          const d=(p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;
          if(d>distance){distance=d;furthest=i;}
        }
        if(furthest>=0){keep[furthest]=1;stack.push([start,furthest],[furthest,end]);}
      }
      return line.filter((_,i)=>keep[i]);
    }
    let opposite=1;
    for(let i=2;i<points.length;i++)if((points[i].x-points[0].x)**2+(points[i].y-points[0].y)**2>(points[opposite].x-points[0].x)**2+(points[opposite].y-points[0].y)**2)opposite=i;
    const result=open(points.slice(0,opposite+1)).slice(0,-1).concat(open(points.slice(opposite).concat(points[0])).slice(0,-1));
    return result.length>=3?result:points;
  }
  function roundedContourPath(points,radius) {
    if(points.length<3)return '';
    const orientation=Math.sign(polygonArea(points)),number=n=>Math.round(n*100)/100;
    const corners=points.map((p,i)=>{
      const a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length];
      const ix=p.x-a.x,iy=p.y-a.y,ox=b.x-p.x,oy=b.y-p.y;
      const incoming=Math.hypot(ix,iy),outgoing=Math.hypot(ox,oy);
      // Only convex (outward) corners receive a fillet. Re-entrant corners
      // remain literal line vertices, rather than a globally smoothed curve.
      const convex=(ix*oy-iy*ox)*orientation>1e-6;
      const trim=convex?Math.min(radius,incoming*.45,outgoing*.45):0;
      return {p,rounded:trim>0,entry:{x:p.x-ix/(incoming||1)*trim,y:p.y-iy/(incoming||1)*trim},exit:{x:p.x+ox/(outgoing||1)*trim,y:p.y+oy/(outgoing||1)*trim}};
    });
    const xy=p=>`${number(p.x)} ${number(p.y)}`;
    let path=`M${xy(corners[0].entry)}`;
    corners.forEach((c,i)=>{if(i)path+=`L${xy(c.entry)}`;if(c.rounded)path+=`Q${xy(c.p)} ${xy(c.exit)}`;});
    return path+'Z';
  }
  function makeSilhouette(glyphs,width,height) {
    if(!glyphs.length)return {path:'',contours:[],cell:0,roundRadius:0};
    const average=glyphs.reduce((sum,g)=>sum+g.size,0)/glyphs.length,padding=40;
    // Bound construction work even for the longest, most elongated memo.
    // This grid is used once; zoom and pan reuse the resulting SVG path.
    const cell=Math.max(2,Math.sqrt((width+padding*2)*(height+padding*2)/100000),Math.max(width,height)/640);
    const columns=Math.ceil((width+padding*2)/cell),rows=Math.ceil((height+padding*2)/cell);
    const mask=new Uint8Array(columns*rows),grid=p=>({x:(p.x+padding)/cell,y:(p.y+padding)/cell});
    function fillPolygon(worldPoints) {
      const points=worldPoints.map(grid);
      const top=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))),bottom=Math.min(rows-1,Math.ceil(Math.max(...points.map(p=>p.y))));
      for(let y=top;y<=bottom;y++) {
        const intersections=[],scan=y+.5;
        for(let i=0;i<points.length;i++) {
          const a=points[i],b=points[(i+1)%points.length];
          if((a.y<=scan&&b.y>scan)||(b.y<=scan&&a.y>scan))intersections.push(a.x+(scan-a.y)*(b.x-a.x)/(b.y-a.y));
        }
        intersections.sort((a,b)=>a-b);
        for(let i=0;i+1<intersections.length;i+=2) {
          const left=Math.max(0,Math.ceil(intersections[i]-.5)),right=Math.min(columns-1,Math.floor(intersections[i+1]-.5));
          if(right>=left)mask.fill(1,y*columns+left,y*columns+right+1);
        }
      }
    }
    function disc(x,y,radius) {
      const p=grid({x,y}),r=radius/cell;
      for(let y=Math.max(0,Math.floor(p.y-r));y<=Math.min(rows-1,Math.ceil(p.y+r));y++) {
        const dy=y+.5-p.y;if(Math.abs(dy)>r)continue;
        const span=Math.sqrt(r*r-dy*dy),left=Math.max(0,Math.ceil(p.x-span-.5)),right=Math.min(columns-1,Math.floor(p.x+span-.5));
        if(right>=left)mask.fill(1,y*columns+left,y*columns+right+1);
      }
    }
    function bridge(a,b) {
      const dx=b.cx-a.cx,dy=b.cy-a.cy,length=Math.hypot(dx,dy);
      if(!length)return;
      const radius=Math.max(cell*1.3,Math.min(a.size,b.size)*.13+1.5),px=-dy/length*radius,py=dx/length*radius;
      fillPolygon([{x:a.cx+px,y:a.cy+py},{x:b.cx+px,y:b.cy+py},{x:b.cx-px,y:b.cy-py},{x:a.cx-px,y:a.cy-py}]);
      disc(a.cx,a.cy,radius);disc(b.cx,b.cy,radius);
    }
    const groups=new Map();
    for(const g of glyphs){if(!groups.has(g.group))groups.set(g.group,[]);groups.get(g.group).push(g);}
    const previous=[];
    for(const group of groups.values()) {
      const boxes=new Map(),lines=new Map();
      for(const g of group) {
        const angle=g.angle*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),pad=3+g.size*.17;
        const w=(g.inkWidth??g.box)/2+pad,h=(g.inkHeight??g.box)/2+pad;
        const corners=[[-w,-h],[w,-h],[w,h],[-w,h]].map(([x,y])=>({x:g.cx+x*c-y*s,y:g.cy+x*s+y*c}));
        boxes.set(g,corners);fillPolygon(corners);
        if(!lines.has(g.row))lines.set(g.row,[]);lines.get(g.row).push(g);
      }
      const join=(a,b)=>fillPolygon(convexHull(boxes.get(a).concat(boxes.get(b))));
      let previousLine=null;
      for(const line of lines.values()) {
        // Follow the original row, including its curves, rather than taking
        // the hull of an entire curved group (which creates empty fans).
        for(let i=1;i<line.length;i++)join(line[i-1],line[i]);
        if(line.length>=8&&line[0].motif==='orbit')join(line[0],line.at(-1));
        if(previousLine){join(previousLine[0],line[0]);join(previousLine.at(-1),line.at(-1));}
        previousLine=line;
      }
      let nearest=null;
      for(const a of group)for(const b of previous) {
        const dx=b.cx-a.cx,dy=b.cy-a.cy,length=Math.hypot(dx,dy),theta=Math.atan2(dy,dx);
        const gap=Math.max(0,length-supportRadius(a,theta)-supportRadius(b,theta));
        const score=gap+length*.15;
        if(!nearest||score<nearest.score)nearest={a,b,score};
      }
      if(nearest)bridge(nearest.a,nearest.b);
      previous.push(...group);
    }
    // Fill enclosed voids; open concave notches remain part of the contour.
    const outside=new Uint8Array(mask.length),queue=new Int32Array(mask.length);let head=0,tail=1;outside[0]=1;
    while(head<tail) {
      const index=queue[head++],x=index%columns,y=Math.floor(index/columns);
      const visit=next=>{if(!mask[next]&&!outside[next]){outside[next]=1;queue[tail++]=next;}};
      if(x)visit(index-1);if(x<columns-1)visit(index+1);if(y)visit(index-columns);if(y<rows-1)visit(index+columns);
    }
    for(let i=0;i<mask.length;i++)if(!outside[i])mask[i]=1;
    const edges=[],starts=new Map(),stride=columns+1;
    function edge(x,y,nx,ny,direction) {
      const a=y*stride+x,b=ny*stride+nx,index=edges.length;
      edges.push({a,b,direction,used:false});if(!starts.has(a))starts.set(a,[]);starts.get(a).push(index);
    }
    for(let y=0;y<rows;y++)for(let x=0;x<columns;x++)if(mask[y*columns+x]) {
      if(!y||!mask[(y-1)*columns+x])edge(x,y,x+1,y,0);
      if(x===columns-1||!mask[y*columns+x+1])edge(x+1,y,x+1,y+1,1);
      if(y===rows-1||!mask[(y+1)*columns+x])edge(x+1,y+1,x,y+1,2);
      if(!x||!mask[y*columns+x-1])edge(x,y+1,x,y,3);
    }
    const contours=[];
    for(const first of edges) {
      if(first.used)continue;
      const points=[];let current=first;
      while(current&&!current.used) {
        current.used=true;points.push({x:(current.a%stride)*cell-padding,y:Math.floor(current.a/stride)*cell-padding});
        if(current.b===first.a)break;
        const options=(starts.get(current.b)||[]).map(i=>edges[i]).filter(e=>!e.used);
        const priority=e=>[1,0,3,2].indexOf((e.direction-current.direction+4)%4);
        current=options.sort((a,b)=>priority(a)-priority(b))[0];
      }
      if(points.length>=3&&Math.abs(polygonArea(points))>cell*cell*2)contours.push(simplifyContour(points,Math.max(cell*1.3,average*.12)));
    }
    const roundRadius=Math.max(8,average*.85);
    return {path:contours.map(points=>roundedContourPath(points,roundRadius)).join(''),contours,cell,roundRadius};
  }
  function buildSilhouette(note) {
    if(note.silhouette)return;
    const geometry=makeSilhouette(note.glyphs,note.width,note.height),style={type:note.silhouetteType,color:note.silhouetteColor};
    const svg=(tag,attributes)=>{const element=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))element.setAttribute(key,value);return element;};
    const group=svg('g',{'class':`silhouette silhouette-${style.type}`,color:style.color});
    const path=svg('path',{d:geometry.path,fill:style.type==='outline'?'none':'currentColor'});
    if(style.type==='outline') {
      // Ten world units read as 1.5px at the 15% transition. A CSS
      // transform outside an SVG can otherwise shrink a non-scaling stroke.
      path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','10');path.setAttribute('stroke-linejoin','miter');

    }
    group.append(path);note.pattern.append(group);note.silhouette=group;
    note.el.dataset.silhouette=style.type;note.el.dataset.silhouetteColor=style.color;
  }

  function announce(message) {
    const toast=$('#announcement'); toast.textContent=message;toast.classList.add('visible');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('visible'),3000);
  }
  function persist() {
    try {
      if(notes.length)localStorage.setItem(STORAGE,JSON.stringify(notes.map(({id,text,x,y,archived,created,silhouetteColor,silhouetteType})=>({id,text,x,y,archived,created,silhouetteColor,silhouetteType}))));
      else localStorage.removeItem(STORAGE);
      return true;
    } catch { announce('브라우저 저장 공간을 사용할 수 없어요. 현재 화면에서만 유지됩니다.'); return false; }
  }
  function refreshCount() {
    $('#archive-count').textContent=`${notes.filter(n=>n.archived).length}개의 기억`;
  }
  function updateBounds() {
    bounds=notes.reduce((b,n)=>({left:Math.min(b.left,n.x-240),top:Math.min(b.top,n.y-240),right:Math.max(b.right,n.x+n.width+240),bottom:Math.max(b.bottom,n.y+n.height+240)}),{left:-800,right:800,top:-600,bottom:600});
    world.style.width=`${bounds.right-bounds.left}px`;world.style.height=`${bounds.bottom-bounds.top}px`;
  }
  function renderCamera() {
    if(!cameraRender)cameraRender=requestAnimationFrame(flushCamera);
  }
  function flushCamera() {
    cameraRender=0;
    world.style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;
    const zoom=Math.round(camera.scale*100);
    if(zoom!==lastZoom){zoomLabel.textContent=`${zoom}%`;lastZoom=zoom;}
    const lowDetail=camera.scale<=.15+1e-9;
    if(lowDetail!==lastLowDetail){world.classList.toggle('low-zoom',lowDetail);lastLowDetail=lowDetail;}
    updateVisibility();
  }
  function updateVisibility() {
    const margin=140,w=viewportGeometry.width,h=viewportGeometry.height;
    const focused=document.activeElement,capturedIds=[...pointers.keys()];
    let nextVisible=null;
    for(let i=notes.length-1;i>=0;i--) {
      const note=notes[i];
      const x=note.x*camera.scale+camera.x,y=note.y*camera.scale+camera.y;
      const nearby=x+note.width*camera.scale>=-margin&&x<=w+margin&&y+note.height*camera.scale>=-margin&&y<=h+margin;
      const captured=capturedIds.some(id=>note.el.hasPointerCapture(id));
      const visible=!note.archived||nearby||captured||note.el.contains(focused);
      if(visible){if(!note.el.isConnected)world.insertBefore(note.el,nextVisible);nextVisible=note.el;}
      else if(note.el.isConnected)note.el.remove();
      note.visible=visible;
    }
  }
  function clampCamera() {
    const w=viewportGeometry.width,h=viewportGeometry.height,s=camera.scale;
    camera.x=Math.max(-bounds.right*s+w*.2,Math.min(-bounds.left*s+w*.8,camera.x));
    camera.y=Math.max(-bounds.bottom*s+h*.2,Math.min(-bounds.top*s+h*.8,camera.y));
  }
  function moveCamera(x,y,scale=1) {
    cancelAnimationFrame(cameraAnimation);
    const start={...camera},then=performance.now(),duration=reducedMotion?0:450;
    function frame(now) {
      const t=duration?Math.min(1,(now-then)/duration):1,ease=1-Math.pow(1-t,3);
      camera.x=start.x+(x-start.x)*ease;camera.y=start.y+(y-start.y)*ease;camera.scale=start.scale+(scale-start.scale)*ease;
      renderCamera();if(t<1)cameraAnimation=requestAnimationFrame(frame);
    }
    cameraAnimation=requestAnimationFrame(frame);
  }
  function gesturePoint(e={}) {
    const rect=viewportGeometry;
    return {x:Number.isFinite(e.clientX)?e.clientX:rect.left+rect.width/2,y:Number.isFinite(e.clientY)?e.clientY:rect.top+rect.height/2};
  }
  function zoomAt(nextScale,point,previousPoint=point) {
    cancelAnimationFrame(cameraAnimation);lastPointer=null;
    const rect=viewportGeometry;
    const worldX=(previousPoint.x-rect.left-camera.x)/camera.scale,worldY=(previousPoint.y-rect.top-camera.y)/camera.scale;
    camera.scale=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,nextScale));
    camera.x=point.x-rect.left-worldX*camera.scale;camera.y=point.y-rect.top-worldY*camera.scale;
    clampCamera();renderCamera();
  }
  function focusNote(note) {
    const {width:w,height:h}=viewportGeometry;
    const scale=note.archived?Math.max(MIN_ZOOM,Math.min(DEFAULT_ZOOM,(w-64)/note.width*.8,(h-64)/note.height*.8)):Math.min(.85,(w-32)/note.sentence.offsetWidth);
    moveCamera(w/2-(note.x+note.width/2)*scale,h/2-(note.y+note.height/2)*scale,scale);
  }
  function overview() {
    const {width:w,height:h}=viewportGeometry;
    if(!notes.length){moveCamera(w/2,h/2,DEFAULT_ZOOM);return;}
    const left=Math.min(...notes.map(n=>n.x)),right=Math.max(...notes.map(n=>n.x+n.width));
    const top=Math.min(...notes.map(n=>n.y)),bottom=Math.max(...notes.map(n=>n.y+n.height));
    const scale=Math.max(MIN_ZOOM,Math.min(DEFAULT_ZOOM,(w-70)/(right-left+80),(h-50)/(bottom-top+80)));
    moveCamera(w/2-(left+right)/2*scale,h/2-(top+bottom)/2*scale,scale);
  }
  function positionNote(width,height,random=Math.random) {
    if(!notes.length)return {x:-width/2,y:-height/2};
    const anchor=notes[Math.floor(random()*notes.length)],gap=76;
    const centerX=anchor.x+anchor.width/2,centerY=anchor.y+anchor.height/2;
    const phase=random()*Math.PI*2;
    // Pick one existing memo uniformly, then search nearby space in every
    // direction. The random phase removes the old rightward placement bias.
    for(let ring=0;ring<1000;ring++) {
      for(let i=0;i<16;i++) {
        const theta=phase+i*Math.PI/8,dx=Math.cos(theta),dy=Math.sin(theta);
        const distance=Math.min(((anchor.width+width)/2+gap)/Math.abs(dx),((anchor.height+height)/2+gap)/Math.abs(dy))+ring*Math.min(width+gap,height+gap)*.5+.01;
        const x=centerX+dx*distance-width/2,y=centerY+dy*distance-height/2;
        if(notes.every(n=>x+width+gap<=n.x || x>=n.x+n.width+gap || y+height+gap<=n.y || y>=n.y+n.height+gap))return {x,y};
      }
    }
    return {x:centerX-width/2,y:Math.max(...notes.map(n=>n.y+n.height))+gap};
  }
  function renderNote(note) {
    if(note.deleting)return;
    const t=note.progress,reading=note.reading;
    const eased=t*t*(3-2*t);
    note.sentence.style.opacity=reading?1:Math.max(0,1-t*3);
    note.sentence.style.transform=`translateY(${reading?0:-t*8}px)`;
    if(note.drawnProgress!==t) {
      for(const glyph of note.glyphs) {
        const x=glyph.sx+(glyph.cx-glyph.sx)*eased,y=glyph.sy+(glyph.cy-glyph.sy)*eased;
        glyph.el.setAttribute('transform',`translate(${x} ${y}) rotate(${glyph.angle*eased})`);
      }
      note.drawnProgress=t;
    }
    note.pattern.style.opacity=reading?0:Math.min(1,t*2);
    note.pattern.style.visibility=reading?'hidden':'visible';
    note.ring.style.setProperty('--progress',`${t*360}deg`);
    note.el.classList.toggle('archived',note.archived);note.el.classList.toggle('reading',!!reading);
    note.action.hidden=note.archived;
    note.actionLabel.textContent=t>0?`기억으로 엮는 중 ${Math.round(t*100)}%`:'주변을 쓸어 저장';
    note.action.setAttribute('aria-label','메모를 자모 패턴으로 전환하고 저장');
    if(note.archived){
      note.el.setAttribute('role','button');note.el.tabIndex=0;
      note.el.setAttribute('aria-pressed',String(!!reading));
      note.el.setAttribute('aria-label',`메모 ${note.number}: ${reading?note.text+' · 클릭하면 패턴으로 돌아갑니다':'클릭하면 원문이 보입니다'}`);
    }
  }
  function complete(note) {
    if(note.archived||note.deleting)return;
    note.archived=true;note.progress=1;note.target=1;buildSilhouette(note);renderNote(note);refreshCount();
    if(memoMove?.note!==note&&memoPress?.note!==note)focusNote(note);
    const saved=persist();
    if(saved)announce('문장이 새로운 모양으로 남았어요. 이 브라우저에 저장되었습니다.');
  }
  function animateNote(note) {
    if(note.animating||note.deleting)return;note.animating=true;
    function frame() {
      note.animationFrame=0;
      if(note.deleting){note.animating=false;return;}
      note.progress=reducedMotion?note.target:note.progress+(note.target-note.progress)*.13;
      if(note.target-note.progress<.001)note.progress=note.target;
      renderNote(note);
      if(note.progress>=.999&&note.target===1){complete(note);note.animating=false;}
      else if(note.progress!==note.target)note.animationFrame=requestAnimationFrame(frame);
      else note.animating=false;
    }
    note.animationFrame=requestAnimationFrame(frame);
  }
  function addNote(record,restore=false) {
    const id=record.id||crypto.randomUUID();
    const number=(notes.at(-1)?.number||0)+1;
    // Assign by creation order, even when notes finish archiving out of order.
    const {color:silhouetteColor,type:silhouetteType}=assignSilhouetteStyle(id,notes,record,restore);
    const pattern=makePattern(record.text,id,inkMetrics);
    const el=document.createElement('article');el.className='memo';el.setAttribute('aria-label',`메모 ${number}`);
    const sentence=document.createElement('p');sentence.className='sentence';sentence.style.width=`${Math.min(360,innerWidth-64)}px`;
    sentence.setAttribute('aria-label',record.text);
    [...record.text].forEach(char=>{const span=document.createElement('span');span.textContent=char;span.setAttribute('aria-hidden','true');sentence.append(span);});
    const patternEl=document.createElementNS('http://www.w3.org/2000/svg','svg');
    patternEl.classList.add('pattern');patternEl.setAttribute('aria-hidden','true');
    patternEl.setAttribute('width',pattern.width);patternEl.setAttribute('height',pattern.height);
    patternEl.setAttribute('viewBox',`0 0 ${pattern.width} ${pattern.height}`);
    const meta=document.createElement('div');meta.className='note-meta';
    const index=document.createElement('span');index.className='note-index';index.textContent=String(number).padStart(2,'0');
    const action=document.createElement('button');action.className='note-action';
    const ring=document.createElement('span');ring.className='progress';ring.setAttribute('aria-hidden','true');
    const actionLabel=document.createElement('span');action.append(ring,actionLabel);
    meta.append(index,action);el.append(sentence,patternEl,meta);world.append(el);
    // Measure in local coordinates; camera scale never changes the source layout.
    const width=Math.max(pattern.width,sentence.offsetWidth),height=Math.max(pattern.height,sentence.offsetHeight)+35;
    sentence.style.left=`${(width-sentence.offsetWidth)/2}px`;sentence.style.top=`${Math.max(0,(height-35-sentence.offsetHeight)/2)}px`;
    const origins=[...sentence.children].map(span=>({x:span.offsetLeft+sentence.offsetLeft,y:span.offsetTop+sentence.offsetTop,w:span.offsetWidth,h:span.offsetHeight}));
    // User-arranged notes may intentionally overlap; restore their exact positions.
    const canRestore=restore&&Number.isFinite(record.x)&&Number.isFinite(record.y);
    const position=canRestore?record:positionNote(width,height);
    const note={id,silhouetteColor,silhouetteType,number,text:record.text,created:record.created||Date.now(),x:position.x,y:position.y,width,height,archived:!!record.archived,progress:record.archived?1:0,target:record.archived?1:0,el,sentence,pattern:patternEl,action,ring,actionLabel,glyphs:[]};
    el.style.left=`${note.x}px`;el.style.top=`${note.y}px`;el.style.width=`${width}px`;el.style.height=`${height}px`;meta.style.top=`${height-23}px`;
    const letterGroup=document.createElementNS('http://www.w3.org/2000/svg','g');letterGroup.classList.add('letter-pattern');patternEl.append(letterGroup);
    for(const glyph of pattern.glyphs){
      const letter=document.createElementNS('http://www.w3.org/2000/svg','text');
      letter.classList.add('glyph');letter.textContent=glyph.char;
      letter.setAttribute('x',(glyph.inkLeft-glyph.inkRight)/2);
      letter.setAttribute('y',(glyph.inkAscent-glyph.inkDescent)/2);
      letter.setAttribute('fill','currentColor');letter.setAttribute('font-size',glyph.size);letter.setAttribute('font-weight',glyph.weight);
      const origin=origins[glyph.source]||{x:0,y:0,w:20,h:28};
      note.glyphs.push({...glyph,sx:origin.x+origin.w/2,sy:origin.y+origin.h/2,el:letter});letterGroup.append(letter);
    }
    action.addEventListener('click',()=>{if(!note.archived){note.target=1;animateNote(note);}});
    const toggleOriginal=()=>{
      clearMemoScrub();
      note.reading=!note.reading;
      if(note.reading){
        note.patternCamera={...camera};
        const scale=Math.min(1,(viewport.clientWidth-32)/sentence.offsetWidth);
        moveCamera(viewport.clientWidth/2-(note.x+sentence.offsetLeft+sentence.offsetWidth/2)*scale,viewport.clientHeight/2-(note.y+sentence.offsetTop+sentence.offsetHeight/2)*scale,scale);
      }else if(note.patternCamera)moveCamera(note.patternCamera.x,note.patternCamera.y,note.patternCamera.scale);
      renderNote(note);
    };
    el.addEventListener('click',e=>{
      if(note.deleting||e.target?.closest('button'))return;
      if(e.detail!==0&&(!tapCandidate||tapCandidate.note!==el||tapCandidate.moved||tapCandidate.panned))return;
      tapCandidate=null;
      clearMemoScrub();if(note.archived)toggleOriginal();
    });
    el.addEventListener('keydown',e=>{
      if(note.archived&&e.target===el&&(e.key==='Enter'||e.key===' ')){
        e.preventDefault();toggleOriginal();
      }
    });
    if(note.archived)buildSilhouette(note);
    notes.push(note);renderNote(note);refreshCount();updateBounds();
    if(!restore){persist();focusNote(note);announce('문장 가까이에서 포인터나 손가락을 움직여보세요.');}
    return note;
  }
  function clearMemoScrub() {memoScrub=null;}
  function trackMemoScrub(e) {
    if(memoMove||nativeGesture||pointers.size>1||(pointers.has(e.pointerId)&&(tapCandidate?.panned||tapCandidate?.held))||(e.pointerType==='touch'&&!pointers.has(e.pointerId))||(e.pointerType==='mouse'&&e.buttons&&!(e.buttons&1))) {clearMemoScrub();return false;}
    const el=e.target.closest('.memo');
    const note=el&&(memoScrub?.note.el===el?memoScrub.note:notes.find(n=>n.el===el));
    if(!note||note.deleting){clearMemoScrub();return false;}
    const x=e.clientX,y=e.clientY,rect=viewportGeometry,s=camera.scale;
    const left=rect.left+camera.x+note.x*s,top=rect.top+camera.y+note.y*s;
    if(x<left-8||x>left+note.width*s+8||y<top-8||y>top+note.height*s+8){clearMemoScrub();return false;}
    const now=Number.isFinite(e.timeStamp)?e.timeStamp:performance.now();
    if(!memoScrub||memoScrub.note!==note||memoScrub.id!==e.pointerId||now<memoScrub.time||now-memoScrub.time>DELETE_SCRUB.pause||now-memoScrub.start>DELETE_SCRUB.window) {
      memoScrub={note,id:e.pointerId,start:now,time:now,x,y,anchorX:x,anchorY:y,dx:0,dy:0,distance:0,reversals:0};return false;
    }
    const scrub=memoScrub;
    scrub.distance+=Math.hypot(x-scrub.x,y-scrub.y);scrub.x=x;scrub.y=y;scrub.time=now;
    const dx=x-scrub.anchorX,dy=y-scrub.anchorY,length=Math.hypot(dx,dy);
    const stroke=Math.max(6,Math.min(18,Math.min(note.width,note.height)*s*.16));
    // Ignore tiny jitter. A real reversal must turn back by at least 120 degrees.
    if(length>=stroke) {
      const ux=dx/length,uy=dy/length;
      if(scrub.dx*ux+scrub.dy*uy<-.5)scrub.reversals++;
      scrub.dx=ux;scrub.dy=uy;scrub.anchorX=x;scrub.anchorY=y;
    }
    if(scrub.reversals<DELETE_SCRUB.reversals||scrub.distance<Math.max(48,stroke*4)||scrub.distance/Math.max(1,now-scrub.start)<DELETE_SCRUB.minSpeed)return false;
    clearMemoScrub();if(tapCandidate)tapCandidate.moved=true;
    deleteNote(note);return true;
  }
  function deletionTarget(x,y,cx,cy,width,height,margin,random) {
    const angle=Math.atan2(y-cy,x-cx)+(random()-.5)*.55;
    const dx=Math.cos(angle),dy=Math.sin(angle);
    const tx=dx>0?(width+margin-x)/dx:dx<0?(-margin-x)/dx:Infinity;
    const ty=dy>0?(height+margin-y)/dy:dy<0?(-margin-y)/dy:Infinity;
    const distance=Math.max(0,Math.min(tx,ty))+margin+random()*80;
    return {endX:x+dx*distance,endY:y+dy*distance,spin:(random()-.5)*1.6,delay:random()*.12};
  }
  function makeDeletionEffect(note) {
    if(reducedMotion)return null;
    const {width,height}=viewportGeometry,scale=camera.scale,random=seededRandom(`delete:${note.id}`);
    const particles=[],family=getComputedStyle(document.body).fontFamily;
    const x0=note.x*scale+camera.x,y0=note.y*scale+camera.y;
    if(scale<=.15+1e-9) {
      if(!note.silhouette)buildSilhouette(note);
      // Rasterize the existing contour once; all fragment centers stay inside it.
      const mask=document.createElement('canvas'),sampleScale=Math.min(scale,240/Math.max(note.width,note.height));
      mask.width=Math.max(1,Math.ceil(note.width*sampleScale));mask.height=Math.max(1,Math.ceil(note.height*sampleScale));
      const ctx=mask.getContext('2d',{willReadFrequently:true});
      ctx.scale(sampleScale,sampleScale);ctx.fill(new Path2D(note.silhouette.querySelector('path').getAttribute('d')),'evenodd');
      const pixels=ctx.getImageData(0,0,mask.width,mask.height).data;
      const step=Math.max(2,Math.ceil(Math.sqrt(mask.width*mask.height/220))),ratio=scale/sampleScale;
      for(let y=step/2;y<mask.height;y+=step)for(let x=step/2;x<mask.width;x+=step) {
        if(pixels[(Math.floor(y)*mask.width+Math.floor(x))*4+3]<128)continue;
        particles.push({x:x0+x*ratio,y:y0+y*ratio,radius:Math.max(1,step*ratio*(.28+random()*.55)),color:note.silhouetteColor});
      }
      // A very small contour can fall between grid samples.
      if(!particles.length)for(let i=3;i<pixels.length;i+=4)if(pixels[i]>=128) {
        const pixel=(i-3)/4;
        particles.push({x:x0+(pixel%mask.width)*ratio,y:y0+Math.floor(pixel/mask.width)*ratio,radius:Math.max(1,ratio),color:note.silhouetteColor});break;
      }
      mask.width=mask.height=1;
    }else if(note.reading||note.progress<.34) {
      const style=getComputedStyle(note.sentence),size=parseFloat(style.fontSize)*scale;
      const left=note.sentence.offsetLeft,top=note.sentence.offsetTop-(note.reading?0:note.progress*8);
      for(const span of note.sentence.children)if(span.textContent.trim())particles.push({char:span.textContent,x:x0+(left+span.offsetLeft+span.offsetWidth/2)*scale,y:y0+(top+span.offsetTop+span.offsetHeight/2)*scale,size,weight:style.fontWeight,angle:0});
    }else {
      const t=note.progress,ease=t*t*(3-2*t);
      for(const glyph of note.glyphs)particles.push({char:glyph.char,x:x0+(glyph.sx+(glyph.cx-glyph.sx)*ease)*scale,y:y0+(glyph.sy+(glyph.cy-glyph.sy)*ease)*scale,size:glyph.size*scale,weight:glyph.weight,angle:glyph.angle*ease*Math.PI/180});
    }
    const visible=particles.filter(p=>p.x>=-200&&p.x<=width+200&&p.y>=-200&&p.y<=height+200);
    const cx=x0+note.width*scale/2,cy=y0+note.height*scale/2;
    for(const particle of visible)Object.assign(particle,deletionTarget(particle.x,particle.y,cx,cy,width,height,Math.max(40,particle.size||particle.radius*2),random));
    return {particles:visible,family,start:performance.now(),duration:1400,kind:scale<=.15+1e-9?'circles':'letters'};
  }
  function clearDeletionEffects() {
    cancelAnimationFrame(deletionFrame);deletionFrame=0;
    for(const effect of deletionEffects)effect.particles.length=0;
    deletionEffects.length=0;
    if(deletionCanvas){deletionCanvas.remove();deletionCanvas.width=deletionCanvas.height=1;deletionCanvas=null;}
  }
  function drawDeletionEffects(now) {
    deletionFrame=0;
    if(!deletionCanvas)return;
    const width=viewportGeometry.width,height=viewportGeometry.height,dpr=Math.min(devicePixelRatio||1,2);
    if(deletionCanvas.width!==Math.ceil(width*dpr)||deletionCanvas.height!==Math.ceil(height*dpr)) {
      deletionCanvas.width=Math.ceil(width*dpr);deletionCanvas.height=Math.ceil(height*dpr);
    }
    const ctx=deletionCanvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,deletionCanvas.width,deletionCanvas.height);
    for(let i=deletionEffects.length-1;i>=0;i--) {
      const effect=deletionEffects[i],time=(now-effect.start)/effect.duration;
      if(time>=1){effect.particles.length=0;deletionEffects.splice(i,1);continue;}
      for(const p of effect.particles) {
        const t=Math.max(0,(time-p.delay)/(1-p.delay)),travel=.12*t+.88*t*t;
        const x=p.x+(p.endX-p.x)*travel,y=p.y+(p.endY-p.y)*travel;
        if(p.char) {
          const angle=p.angle+p.spin*t,c=Math.cos(angle)*dpr,s=Math.sin(angle)*dpr;
          ctx.setTransform(c,s,-s,c,x*dpr,y*dpr);ctx.fillStyle='#000';ctx.font=`${p.weight} ${p.size}px ${effect.family}`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.char,0,0);
        }else {
          ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(x,y,p.radius*(1+t*.2),0,Math.PI*2);ctx.fill();
        }
      }
    }
    if(deletionEffects.length)deletionFrame=requestAnimationFrame(drawDeletionEffects);
    else clearDeletionEffects();
  }
  function startDeletionEffect(effect) {
    if(!effect?.particles.length||document.hidden)return;
    if(!deletionCanvas) {
      deletionCanvas=document.createElement('canvas');deletionCanvas.className='deletion-layer';deletionCanvas.setAttribute('aria-hidden','true');viewport.append(deletionCanvas);
    }
    deletionCanvas.dataset.kind=effect.kind;deletionEffects.push(effect);
    if(!deletionFrame)deletionFrame=requestAnimationFrame(drawDeletionEffects);
  }
  function deleteNote(note) {
    const index=notes.indexOf(note);
    if(index<0||note.deleting)return false;
    note.deleting=true;notes.splice(index,1);
    // Commit first, so a reload during the animation cannot resurrect the memo.
    if(!persist()) {
      notes.splice(index,0,note);note.deleting=false;
      announce('브라우저 저장소를 갱신하지 못해 메모를 삭제하지 않았어요.');return false;
    }
    clearMemoScrub();
    if(memoPress?.note===note)cancelMemoPress();
    if(memoMove?.note===note)finishMemoMove(false);
    cancelAnimationFrame(cameraAnimation);cancelAnimationFrame(note.animationFrame);
    let effect;
    try {effect=makeDeletionEffect(note);}catch { /* Deletion still completes if graphics are unavailable. */ }
    for(const id of [...pointers.keys()])if(note.el.hasPointerCapture?.(id)){
      pointers.delete(id);note.el.releasePointerCapture(id);
    }
    panGesture=null;tapCandidate=null;lastPointer=null;
    const focused=note.el.contains(document.activeElement);
    note.el.remove();note.el.replaceChildren();note.glyphs.length=0;
    // No deleted source, glyph, contour, DOM, or camera reference survives here.
    for(const key of Object.keys(note))if(key!=='deleting')note[key]=null;
    inkMetrics.cache?.clear();
    updateBounds();refreshCount();renderCamera();
    if(focused)viewport.focus({preventScroll:true});
    startDeletionEffect(effect);announce('메모를 삭제했어요.');return true;
  }
  function interact(x,y,distance) {
    if(distance<.2||distance>150)return;
    const rect=viewportGeometry,wx=(x-rect.left-camera.x)/camera.scale,wy=(y-rect.top-camera.y)/camera.scale;
    for(const note of notes){
      if(note.archived)continue;
      const activeWidth=note.target>0?note.width:note.sentence.offsetWidth,activeHeight=note.target>0?note.height:note.sentence.offsetHeight;
      const activeX=note.x+(note.target>0?0:note.sentence.offsetLeft),activeY=note.y+(note.target>0?0:note.sentence.offsetTop);
      const dx=Math.max(activeX-wx,0,wx-activeX-activeWidth),dy=Math.max(activeY-wy,0,wy-activeY-activeHeight);
      const proximity=Math.hypot(dx,dy);
      if(proximity<75){note.target=Math.min(1,note.target+distance/320*(1-proximity/100));animateNote(note);}
    }
  }
  function cancelMemoPress() {
    if(memoPress)clearTimeout(memoPress.timer);
    memoPress=null;
  }
  function armMemoMove(note,e) {
    cancelMemoPress();
    const press={note,id:e.pointerId,x:e.clientX,y:e.clientY,timer:null};
    memoPress=press;
    press.timer=setTimeout(()=>{
      if(memoPress!==press||pointers.size!==1||!pointers.has(press.id))return;
      const point=pointers.get(press.id);
      clearMemoScrub();memoPress=null;cancelAnimationFrame(cameraAnimation);lastPointer=null;
      memoMove={note,id:press.id,x:point.x,y:point.y,startX:note.x,startY:note.y};
      if(tapCandidate){tapCandidate.moved=true;tapCandidate.held=true;}
      note.el.style.setProperty('--drag-outline',`${1/camera.scale}px`);
      note.el.style.setProperty('--drag-gap',`${5/camera.scale}px`);
      note.el.classList.add('dragging');viewport.classList.add('moving-memo');
      announce('원하는 위치로 끌어 옮긴 뒤 놓아주세요.');
    },450);
  }
  function drawMemoMove() {
    memoMoveFrame=0;
    if(!memoMove)return;
    const {note,startX,startY}=memoMove;
    note.el.style.transform=`translate(${note.x-startX}px,${note.y-startY}px)`;
  }
  function moveMemo(e) {
    const drag=memoMove,note=drag.note;
    note.x=drag.startX+(e.clientX-drag.x)/camera.scale;
    note.y=drag.startY+(e.clientY-drag.y)/camera.scale;
    if(!memoMoveFrame)memoMoveFrame=requestAnimationFrame(drawMemoMove);
  }
  function finishMemoMove(commit=true) {
    cancelMemoPress();
    if(!memoMove)return;
    const {note,startX,startY}=memoMove;
    cancelAnimationFrame(memoMoveFrame);memoMoveFrame=0;memoMove=null;
    const changed=note.x!==startX||note.y!==startY;
    if(!commit){note.x=startX;note.y=startY;}
    note.el.style.left=`${note.x}px`;note.el.style.top=`${note.y}px`;note.el.style.transform='';
    note.el.classList.remove('dragging');viewport.classList.remove('moving-memo');
    lastPointer=null;
    if(changed) {
      updateBounds();const saved=persist();
      if(saved)announce(commit?'메모 위치를 저장했어요.':'메모를 원래 위치로 돌렸어요.');
    }
    renderCamera();
  }

  viewport.addEventListener('pointerdown',e=>{
    if(e.target.closest('button'))return;
    if(e.pointerType==='mouse'&&e.button!==0){clearMemoScrub();cancelMemoPress();if(!memoMove)tapCandidate=null;return;}
    if(pointers.has(e.pointerId))return;
    const memo=e.target.closest('.memo');
    if(pointers.size===0)tapCandidate={note:memo,id:e.pointerId,x:e.clientX,y:e.clientY,moved:false,panned:false};
    else {clearMemoScrub();if(tapCandidate)tapCandidate.panned=true;finishMemoMove(true);}
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});(memo||viewport).setPointerCapture(e.pointerId);
    lastPointer={x:e.clientX,y:e.clientY};
    if(pointers.size===1&&memo) {
      const note=notes.find(n=>n.el===memo);
      if(note){cancelAnimationFrame(cameraAnimation);armMemoMove(note,e);trackMemoScrub(e);}
    }
    if(pointers.size===2){cancelMemoPress();const p=[...pointers.values()];panGesture={x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2,distance:Math.max(8,Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y))};}
  });
  viewport.addEventListener('pointermove',e=>{
    if(memoPress&&memoPress.id===e.pointerId&&Math.hypot(e.clientX-memoPress.x,e.clientY-memoPress.y)>6)cancelMemoPress();
    if(tapCandidate&&tapCandidate.id===e.pointerId&&Math.hypot(e.clientX-tapCandidate.x,e.clientY-tapCandidate.y)>6)tapCandidate.moved=true;
    if(pointers.has(e.pointerId))pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size>=2){
      clearMemoScrub();
      const p=[...pointers.values()],center={x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2,distance:Math.max(8,Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y))};
      if(panGesture&&!nativeGesture)zoomAt(camera.scale*center.distance/panGesture.distance,center,panGesture);
      panGesture=center;lastPointer=null;return;
    }
    if(memoMove&&memoMove.id===e.pointerId){e.preventDefault();moveMemo(e);return;}
    if(trackMemoScrub(e))return;
    if(memoPress||(tapCandidate?.held&&pointers.has(e.pointerId)))return;
    if(e.pointerType==='touch'&&!pointers.has(e.pointerId))return;
    if(e.pointerType==='touch'&&tapCandidate?.panned)return;
    if(lastPointer)interact(e.clientX,e.clientY,Math.hypot(e.clientX-lastPointer.x,e.clientY-lastPointer.y));
    lastPointer={x:e.clientX,y:e.clientY};
  });
  function release(e){
    // A normal pointerup releases capture and is followed by lostpointercapture.
    // That second notification must not invalidate the click awaiting dispatch.
    if(!pointers.has(e.pointerId))return;
    if(memoPress?.id===e.pointerId)cancelMemoPress();
    if(memoMove?.id===e.pointerId)finishMemoMove(e.type==='pointerup');
    pointers.delete(e.pointerId);panGesture=null;lastPointer=null;
    if(e.type!=='pointerup'||e.pointerType!=='mouse'||!tapCandidate?.moved||tapCandidate?.held||tapCandidate?.panned)clearMemoScrub();
    if(e.type!=='pointerup'&&tapCandidate)tapCandidate.panned=true;renderCamera();
  }
  viewport.addEventListener('pointerup',release);viewport.addEventListener('pointercancel',release);viewport.addEventListener('lostpointercapture',release);
  viewport.addEventListener('pointerleave',()=>{clearMemoScrub();lastPointer=null;});
  viewport.addEventListener('contextmenu',e=>{if(memoPress||memoMove||tapCandidate?.held)e.preventDefault();});
  viewport.addEventListener('wheel',e=>{
    clearMemoScrub();finishMemoMove(true);tapCandidate=null;
    e.preventDefault();cancelAnimationFrame(cameraAnimation);lastPointer=null;
    const factor=e.deltaMode===1?16:e.deltaMode===2?viewportGeometry.height:1;
    if(e.ctrlKey){
      if(!nativeGesture)zoomAt(camera.scale*Math.exp(Math.max(-1,Math.min(1,-e.deltaY*factor*.008))),gesturePoint(e));
      return;
    }
    camera.x-=(e.shiftKey&&!e.deltaX?e.deltaY:e.deltaX)*factor;camera.y-=(e.shiftKey&&!e.deltaX?0:e.deltaY)*factor;
    clampCamera();renderCamera();
  },{passive:false});
  // WebKit emits GestureEvents for a trackpad pinch instead of ctrl+wheel.
  viewport.addEventListener('gesturestart',e=>{
    e.preventDefault();clearMemoScrub();finishMemoMove(true);if(tapCandidate)tapCandidate.panned=true;lastPointer=null;cancelAnimationFrame(cameraAnimation);
    nativeGesture={scale:camera.scale,point:gesturePoint(e)};
  },{passive:false});
  viewport.addEventListener('gesturechange',e=>{
    e.preventDefault();if(!nativeGesture)return;
    const point=gesturePoint(e);
    zoomAt(nativeGesture.scale*e.scale,point,nativeGesture.point);nativeGesture.point=point;
  },{passive:false});
  viewport.addEventListener('gestureend',e=>{e.preventDefault();nativeGesture=null;lastPointer=null;},{passive:false});
  viewport.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&(memoMove||memoPress)){e.preventDefault();if(tapCandidate)tapCandidate.moved=true;finishMemoMove(false);return;}
    if(e.target!==viewport)return;
    clearMemoScrub();
    if(memoMove||memoPress)finishMemoMove(true);
    if(['+','=','-','_','0'].includes(e.key)){
      e.preventDefault();tapCandidate=null;
      zoomAt(e.key==='0'?DEFAULT_ZOOM:camera.scale*(e.key==='-'||e.key==='_'?1/1.15:1.15),gesturePoint());return;
    }
    const directions={ArrowLeft:[80,0],ArrowRight:[-80,0],ArrowUp:[0,80],ArrowDown:[0,-80]};
    if(directions[e.key]){e.preventDefault();cancelAnimationFrame(cameraAnimation);camera.x+=directions[e.key][0];camera.y+=directions[e.key][1];clampCamera();renderCamera();}
  });
  window.addEventListener('blur',()=>{clearMemoScrub();finishMemoMove(false);pointers.clear();panGesture=null;tapCandidate=null;lastPointer=null;});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearMemoScrub();clearDeletionEffects();}});
  window.addEventListener('pagehide',()=>{clearMemoScrub();clearDeletionEffects();});
  let composing=false;
  input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;});
  input.addEventListener('input',()=>{
    $('#send').disabled=!input.value.trim();$('#input-count').textContent=`${input.value.length} / 280`;
    input.style.height='24px';input.style.height=`${Math.min(132,input.scrollHeight)}px`;
  });
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!composing&&e.keyCode!==229){e.preventDefault();$('#composer').requestSubmit();}});
  $('#composer').addEventListener('submit',e=>{
    e.preventDefault();if(composing)return;
    const text=input.value.trim();if(!text)return;
    addNote({text});input.value='';input.dispatchEvent(new Event('input'));input.focus();
  });
  $('#home').addEventListener('click',()=>notes.length?focusNote(notes.at(-1)):overview());
  $('#overview').addEventListener('click',overview);$('.wordmark').addEventListener('click',e=>{e.preventDefault();overview();});
  function refreshViewport() {
    const rect=viewport.getBoundingClientRect();
    camera.x+=(rect.width-viewportGeometry.width)/2;camera.y+=(rect.height-viewportGeometry.height)/2;
    viewportGeometry={left:rect.left,top:rect.top,width:rect.width,height:rect.height};renderCamera();
  }
  addEventListener('resize',refreshViewport);
  window.visualViewport?.addEventListener('resize',refreshViewport);
  camera.x=viewportGeometry.width/2;camera.y=viewportGeometry.height/2;renderCamera();
  try {
    const saved=JSON.parse(localStorage.getItem(STORAGE)||'[]');
    if(Array.isArray(saved))saved.filter(r=>r&&typeof r.text==='string'&&r.text.trim()&&r.text.length<=280).forEach(r=>addNote(r,true));
  } catch {announce('이전에 저장한 메모를 읽지 못했어요. 새 메모는 계속 작성할 수 있습니다.');}
  if(notes.length){persist();focusNote(notes.at(-1));}
})();
