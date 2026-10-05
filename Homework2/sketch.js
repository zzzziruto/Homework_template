// p5.js: 장면과 캐릭터 그리기 / Matter.js: 악몽과 별의 이동
const { Engine, Bodies, Body, Composite } = Matter;
const NIGHT_END = 40, DURATION = 45;
let engine, nightmares = [], stars = [], startedAt = null, nextSpawn = 0;
let dawnScheduled = false, gesture = null, canvasElement;
let counts = { click: 0, swipe: 0, dawn: 0 };

function setup() {
  canvasElement = createCanvas(960, 640).parent('scene').elt;
  engine = Engine.create(); engine.gravity.y = 0;
  startDream();
  // Pointer Events 한 경로로 마우스와 터치를 처리하여 중복 클릭을 방지한다.
  canvasElement.addEventListener('pointerdown', pointerDown);
  canvasElement.addEventListener('pointermove', pointerMove);
  canvasElement.addEventListener('pointerup', pointerUp);
  canvasElement.addEventListener('pointercancel', cancelGesture);
}
function elapsed() { return startedAt === null ? 0 : min((performance.now() - startedAt) / 1000, DURATION); }
function startDream() {
  gesture = null; Composite.clear(engine.world, false);
  nightmares = []; stars = []; counts = { click: 0, swipe: 0, dawn: 0 };
  startedAt = performance.now(); nextSpawn = random(1, 2); dawnScheduled = false;

}
function draw() {
  const t = elapsed(), daylight = constrain((t - NIGHT_END) / 5, 0, 1);
  drawRoom(daylight);
  if (startedAt !== null) {
    if (t < NIGHT_END && t >= nextSpawn) {
      nightmares.push(new Nightmare()); nextSpawn = t + random(1, 2);
    }
    if (t >= NIGHT_END && !dawnScheduled) {
      dawnScheduled = true;
      // 생성 순서대로 배정. 마지막 객체도 45초 전에 완전히 투명해진다.
      const waiting = nightmares.filter(n => n.state !== 'flying');
      waiting.forEach((n, i) => { n.fadeAt = 40 + i * (4 / max(1, waiting.length)); });
    }
    Engine.update(engine, min(deltaTime, 1000 / 30));
    for (let i = nightmares.length - 1; i >= 0; i--) {
      const n = nightmares[i]; n.update(t); n.display();
      if (n.dead) { n.remove(); nightmares.splice(i, 1); }
    }
    for (let i = stars.length - 1; i >= 0; i--) {
      stars[i].display();
      if (stars[i].outside()) { stars[i].remove(); stars.splice(i, 1); }
    }
  }

}

class Nightmare {
  constructor() {
    this.r = random(27, 43); this.phase = random(TWO_PI);
    this.body = Bodies.circle(random(85, width - 85), random(120, 390), this.r,
      { frictionAir: 0, restitution: 1, isSensor: true });
    Composite.add(engine.world, this.body);
    Body.setVelocity(this.body, { x: random(-0.7, 0.7), y: random(-0.4, 0.4) });
    this.state = 'floating'; this.fadeAt = Infinity; this.opacity = 255; this.dead = false;
  }
  update(t) {
    const p = this.body.position;
    if (this.state === 'floating') {
      if (p.x < this.r + 25 || p.x > width - this.r - 25) Body.setVelocity(this.body, { x: p.x < width / 2 ? 0.7 : -0.7, y: this.body.velocity.y });
      if (p.y < 100 || p.y > 410) Body.setVelocity(this.body, { x: this.body.velocity.x, y: p.y < 250 ? 0.4 : -0.4 });
    }
    if (this.state !== 'flying' && t >= this.fadeAt) {
      this.opacity = 255 * (1 - constrain((t - this.fadeAt) / 0.8, 0, 1));
      if (this.opacity <= 0) { this.dead = true; counts.dawn++; }
    }
    if (this.state === 'flying' && this.outside()) this.dead = true;
  }
  contains(x, y) { return dist(x, y, this.body.position.x, this.body.position.y) < this.r * 1.25; }
  outside() { const p = this.body.position; return p.x < -this.r * 2 || p.x > width + this.r * 2 || p.y < -this.r * 2 || p.y > height + this.r * 2; }
  burst() {
    for (let i = 0; i < 12; i++) stars.push(new Star(this.body.position.x, this.body.position.y, i * TWO_PI / 12 + random(-0.15, 0.15)));
    this.dead = true; counts.click++;
  }
  fling(vx, vy) {
    this.state = 'flying'; Body.setStatic(this.body, false);
    Body.setVelocity(this.body, { x: vx, y: vy }); counts.swipe++;
  }
  remove() { if (gesture?.target === this) gesture = null; Composite.remove(engine.world, this.body); }
  display() {
    const r = this.r, p = this.body.position;
    push(); translate(p.x, p.y); rotate(this.state === 'flying' || this.state === 'held' ? 0 : sin(millis() / 700 + this.phase) * 0.09);
    noStroke(); fill(12, 12, 20, this.opacity);
    beginShape(); vertex(-r, 0); bezierVertex(-r, -r * 1.6); bezierVertex(r, -r * 1.6); bezierVertex(r, 0);
    vertex(r * 1.1, r * 1.4); vertex(r * 0.45, r); vertex(0, r * 1.4); vertex(-r * 0.45, r); vertex(-r, r * 1.35); endShape(CLOSE);
    fill(255, 219, 72, this.opacity);
    triangle(-r * 0.7, -r * 0.42, -r * 0.15, -r * 0.13, -r * 0.35, r * 0.02);
    triangle(r * 0.7, -r * 0.42, r * 0.15, -r * 0.13, r * 0.35, r * 0.02);
    arc(0, r * 0.1, r * 1.05, r * 0.7, 0, PI, CHORD); pop();
  }
}
class Star {
  constructor(x, y, angle) {
    this.r = random(4, 9); this.body = Bodies.circle(x, y, this.r, { isSensor: true, frictionAir: 0 });
    Composite.add(engine.world, this.body);
    const speed = random(5, 9); Body.setVelocity(this.body, { x: cos(angle) * speed, y: sin(angle) * speed });
    Body.setAngularVelocity(this.body, random(-0.12, 0.12));
  }
  display() { push(); translate(this.body.position.x, this.body.position.y); rotate(this.body.angle); drawStar(0, 0, this.r); pop(); }
  outside() { const p = this.body.position; return p.x < -20 || p.x > width + 20 || p.y < -20 || p.y > height + 20; }
  remove() { Composite.remove(engine.world, this.body); }
}
function drawStar(x, y, r, alpha = 255) {
  noStroke(); fill(255, 222, 112, alpha); beginShape();
  for (let i = 0; i < 10; i++) { const a = -HALF_PI + i * PI / 5, size = i % 2 ? r * 0.43 : r; vertex(x + cos(a) * size, y + sin(a) * size); } endShape(CLOSE);
}
function pointFromEvent(e) {
  const bounds = canvasElement.getBoundingClientRect();
  return { x: (e.clientX - bounds.left) * width / bounds.width, y: (e.clientY - bounds.top) * height / bounds.height };
}
function pointerDown(e) {
  if (gesture || startedAt === null || elapsed() >= 45 || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const p = pointFromEvent(e);
  const target = [...nightmares].reverse().find(n => !n.dead && n.state === 'floating' && n.contains(p.x, p.y));
  if (!target) return;
  e.preventDefault(); canvasElement.setPointerCapture(e.pointerId);
  gesture = { id: e.pointerId, target, start: p, last: p, lastAt: performance.now(), vx: 0, vy: 0, distance: 0 };
  target.state = 'held'; Body.setStatic(target.body, true);
}
function pointerMove(e) {
  if (!gesture || gesture.id !== e.pointerId) return;
  const p = pointFromEvent(e), now = performance.now(), dt = max(8, now - gesture.lastAt);
  gesture.vx = (p.x - gesture.last.x) / dt * 16.667;
  gesture.vy = (p.y - gesture.last.y) / dt * 16.667;
  gesture.distance = max(gesture.distance, dist(p.x, p.y, gesture.start.x, gesture.start.y));
  if (gesture.distance > 12) Body.setPosition(gesture.target.body, p);
  gesture.last = p; gesture.lastAt = now;
}
function pointerUp(e) {
  if (!gesture || gesture.id !== e.pointerId) return;
  const g = gesture; gesture = null;
  if (g.target.dead) return;
  if (g.distance <= 12) g.target.burst();
  else {
    let vx = g.vx, vy = g.vy;
    if (performance.now() - g.lastAt > 100 || Math.hypot(vx, vy) < 3) { vx = g.last.x - g.start.x; vy = g.last.y - g.start.y; }
    const magnitude = Math.hypot(vx, vy) || 1, speed = constrain(magnitude, 12, 30);
    g.target.fling(vx / magnitude * speed, vy / magnitude * speed);
  }
}
function cancelGesture(e) {
  if (!gesture || gesture.id !== e.pointerId) return;
  gesture.target.state = 'floating'; Body.setStatic(gesture.target.body, false); gesture = null;
}
function drawRoom(day) {
  background('#f5e6d2'); noStroke(); fill('#e9d4bb'); rect(0, 470, width, 170);
  stroke('#d8bea3'); strokeWeight(2); line(0, 470, width, 470);
  noStroke(); fill('#d6edf3'); rect(350, 65, 260, 210, 24);
  // 달과 별은 낮으로 바뀌면서 사라진다.
  fill(255, 226, 151, 255 * (1 - day)); circle(400, 112, 43);
  fill(214, 237, 243, 255 * (1 - day)); circle(412, 104, 36);
  for (let i = 0; i < 7; i++) drawStar(375 + (i * 67) % 210, 148 + (i * 43) % 100, 5, 255 * (1 - day));
  fill(255, 209, 113, day * 255); circle(557, 114, 42);
  fill(255, 255, 255, day * 255); ellipse(407, 203, 75, 24); ellipse(543, 225, 85, 25);
  noFill(); stroke('#b7906c'); strokeWeight(12); rect(350, 65, 260, 210, 24); strokeWeight(7); line(480, 70, 480, 270); line(355, 168, 605, 168);
  noStroke(); fill('#895937'); rect(225, 375, 510, 150, 25); rect(232, 500, 23, 88, 6); rect(705, 500, 23, 88, 6);
  fill('#fff5e4'); rect(257, 382, 446, 118, 25);
  fill('#6a4430'); ellipse(480, 406, 83, 74); fill('#f2c3a0'); ellipse(480, 408, 67, 58);
  stroke('#735443'); strokeWeight(3); noFill(); arc(467, 407, 13, 8, 0, PI); arc(493, 407, 13, 8, 0, PI);
  noStroke(); fill('#e9aeb3'); rect(215, 430, 530, 90, 25); fill('#f4c7c7'); rect(220, 431, 520, 19, 10);
  fill('#f2c3a0'); ellipse(442, 442, 27, 21); ellipse(518, 442, 27, 21);
  fill('#895937'); rect(218, 510, 525, 24, 8);
  // 기본 배경 위에 실제 곱하기 레이어. 40~45초에 불투명도가 감소한다.
  blendMode(MULTIPLY); noStroke(); fill(49, 88, 145, 235 * (1 - day)); rect(0, 0, width, height); blendMode(BLEND);
}
