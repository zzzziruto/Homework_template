// p5.js: 화면 그리기 / Matter.js: 중력, 충돌, 마찰, 회전 계산
// p5 웹 에디터에서는 index.html에 Matter.js도 추가해 주세요.
const SETTINGS = {
  width: 1000,
  height: 680,
  gravity: 0.12,
  finalGravity: 0.9, // 후반 낙하 가속도의 세기
  gravityDelay: 1.5, // 폭발 후 중력이 강해지기 전 시간
  gravityRamp: 6, // 중력이 점점 강해지는 시간(초)
  burstDelay: 1.15,
  colors: ["#ff00a6", "#88ff00", "#00ffe5", "#fbff00", "#8800ff", "#ff7700"],
};

let engine;
let pieces = [];
let elapsed = 0;
let accumulator = 0;
let exploded = false;
const STEP = 1000 / 120;

function setup() {
  if (!window.Matter) {
    noLoop();
    return;
  }
  const canvas = createCanvas(SETTINGS.width, SETTINGS.height);
  if (document.getElementById("sketch")) canvas.parent("sketch");
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
  describe("중앙의 원이 커진 뒤 도형들이 흩어지고, 중력으로 바닥에 모입니다.");
  //중앙의 원이 다채로운 도형들로 흩어진다. 도형은 벽에서 튕기고 중력과 마찰로 바닥에 쌓인다
  randomSeed(27);
  engine = Matter.Engine.create({ enableSleeping: true });
  engine.gravity.y = SETTINGS.gravity;
  engine.positionIterations = 8;
  engine.velocityIterations = 8;

  // 화면의 네 가장자리에 두꺼운 고정 벽을 배치한다.
  const fixed = { isStatic: true, friction: 0.65, restitution: 0 };
  Matter.Composite.add(engine.world, [
    Matter.Bodies.rectangle(width / 2, height + 50, width + 200, 100, fixed),
    Matter.Bodies.rectangle(width / 2, -50, width + 200, 100, fixed),
    Matter.Bodies.rectangle(-50, height / 2, 100, height + 200, fixed),
    Matter.Bodies.rectangle(width + 50, height / 2, 100, height + 200, fixed),
  ]);
}

function burst() {
  exploded = true;
  // 도형 사이 간격을 확보한 네 겹의 방사형 배치: 총 84개.
  const rings = [
    { count: 8, radius: 36 },
    { count: 16, radius: 72 },
    { count: 24, radius: 108 },
    { count: 36, radius: 156 },
  ];
  let index = 0;
  for (const [ringIndex, ring] of rings.entries()) {
    for (let i = 0; i < ring.count; i++) {
      const angle = (TWO_PI * i) / ring.count + ringIndex * 0.19;
      const x = width / 2 + cos(angle) * ring.radius;
      const y = height / 2 + sin(angle) * ring.radius;
      const radius = random(9, 12);
      const options = {
        restitution: 0.88,
        friction: 0.48,
        frictionStatic: 0.8,
        frictionAir: 0.003,
        density: random(0.0015, 0.004),
        angle: random(TWO_PI),
        sleepThreshold: 100,
      };
      const kind = index % 4;
      let body;
      if (kind === 0) body = Matter.Bodies.circle(x, y, radius, options);
      else if (kind === 1)
        body = Matter.Bodies.rectangle(
          x,
          y,
          radius * 1.5,
          radius * 1.5,
          options,
        );
      else
        body = Matter.Bodies.polygon(
          x,
          y,
          kind === 2 ? 3 : 5,
          radius * 1.1,
          options,
        );
      const speed = random(18, 26);
      Matter.Body.setVelocity(body, {
        x: cos(angle) * speed,
        y: sin(angle) * speed,
      });
      Matter.Body.setAngularVelocity(body, random(-0.18, 0.18));
      Matter.Composite.add(engine.world, body);
      body.plugin.isStar = kind === 3;
      body.plugin.starRadius = radius * 1.1;
      body.plugin.outlineOnly = random() < 0.3;
      pieces.push({
        body,
        color: SETTINGS.colors[index % SETTINGS.colors.length],
      });
      index++;
    }
  }
}

function draw() {
  if (!engine) return;
  // 작은 고정 시간 간격으로 계산해 빠른 도형의 벽 관통을 줄인다.
  // 탭이 숨겨진 동안의 시간을 한 번에 따라잡지 않는다.
  accumulator += Math.min(deltaTime, 50);
  while (accumulator >= STEP) {
    elapsed += STEP / 1000;
    if (!exploded && elapsed >= SETTINGS.burstDelay) burst();
    if (exploded) {
      const age = elapsed - SETTINGS.burstDelay;
      const fallProgress = constrain(
        (age - SETTINGS.gravityDelay) / SETTINGS.gravityRamp,
        0,
        1,
      );
      // 시간이 지날수록 아래 방향 가속도를 높인다.
      engine.gravity.y = lerp(
        SETTINGS.gravity,
        SETTINGS.finalGravity,
        fallProgress,
      );
      const progress = constrain(age / 9, 0, 1);
      for (const { body } of pieces) {
        // 초반에는 큰 반동, 후반에는 마찰과 공기 저항으로 안정화.
        body.restitution = lerp(0.88, 0.18, progress);
        body.frictionAir = lerp(0.003, 0.022, progress);
      }
      Matter.Engine.update(engine, STEP);
    }
    accumulator -= STEP;
  }

  background("#d8d8d8");
  noStroke();
  for (let x = 40; x < width; x += 40) {
    for (let y = 40; y < height; y += 40) point(x, y);
  }

  if (!exploded) {
    // 시작부터 폭발 직전까지 0 → 1
    const t = constrain(elapsed / SETTINGS.burstDelay, 0, 1);

    // 중앙의 원 하나가 점점 커짐
    noStroke();
    fill("#242c36");
    const diameter = lerp(40, 202, t);
    circle(width / 2, height / 2, diameter);
  } else {
    // 중앙 원은 사라지고 도형들이 흩어짐
    for (const piece of pieces) drawPiece(piece);
  }
}

function drawPiece({ body, color: bodyColor }) {
  if (body.plugin.outlineOnly) {
    noFill();
    stroke(bodyColor);
    strokeWeight(1.5);
  } else {
    fill(bodyColor);
    noStroke();
  }

  if (body.circleRadius) {
    circle(body.position.x, body.position.y, body.circleRadius * 2);
  } else if (body.plugin.isStar) {
    push();
    translate(body.position.x, body.position.y);
    rotate(body.angle);

    const outerRadius = body.plugin.starRadius;
    const innerRadius = outerRadius * 0.45;

    beginShape();
    for (let i = 0; i < 10; i++) {
      const angle = -HALF_PI + (i * PI) / 5;
      const r = i % 2 === 0 ? outerRadius : innerRadius;

      vertex(cos(angle) * r, sin(angle) * r);
    }
    endShape(CLOSE);

    pop();
  } else {
    beginShape();
    for (const point of body.vertices) {
      vertex(point.x, point.y);
    }
    endShape(CLOSE);
  }
}

function vertexPoint(point) {
  vertex(point.x, point.y);
}
