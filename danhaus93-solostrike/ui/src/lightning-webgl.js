// True WebGL lightning renderer.
//
// Used by both Hunt mode (NonceField) and BFM celebration. The renderer
// owns a WebGL canvas and draws everything: clouds, bolts, sparks, ground
// impacts, and screen flash. It exposes:
//
//   step(dt, hashTHS, autoSpawn, opts) — render one frame
//   spawnBolt(opts)                    — manually trigger a bolt
//   resize()                           — re-measure canvas
//   destroy()                          — free GL resources
//   failed                             — true if init failed (caller falls back)
//
// All bells + whistles:
//
//   - Volumetric bolts: each segment is a triangle-strip quad; fragment
//     shader gets signed distance from centerline as a varying and computes
//     4-tier exponential glow falloff (core + edge + glow + bloom).
//   - Procedural cloud backdrop: 4-octave fbm noise in fragment shader,
//     animated; per-pulse bright spots where bolts originated.
//   - Sparks: instanced GL_POINTS with size attenuation and additive
//     gaussian falloff in fragment shader.
//   - Ground impacts + screen flash: full-screen quad with uniform array
//     of impacts (x, age, intensity).
//   - Type-based color shifts: regular = amber, gold = warmer, mega =
//     white-hot core + blue mid + gold halo.
//   - Per-bolt forks (multi-fork: 0–4 depending on type).

// ─── Shader sources ────────────────────────────────────────────────

const BOLT_VS = `
attribute vec3 aPos;
attribute float aLifeT;
attribute float aBoltType;
uniform vec2 uResolution;
varying float vDist;
varying float vLifeT;
varying float vType;
void main() {
  vec2 pos = aPos.xy;
  vDist = aPos.z;
  vLifeT = aLifeT;
  vType = aBoltType;
  vec2 clip = (pos / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

const BOLT_FS = `
precision mediump float;
varying float vDist;
varying float vLifeT;
varying float vType;
void main() {
  float lifeAlpha = vLifeT < 0.25 ? 1.0 : pow(1.0 - (vLifeT - 0.25) / 0.75, 0.7);
  float d = abs(vDist);
  float core   = exp(-d*d * 6.0);
  float edge   = exp(-d*d * 0.5);
  float glow   = exp(-d*d * 0.04);
  float bloom  = exp(-d*d * 0.005);

  vec3 coreColor, glowColor, bloomColor;
  if (vType > 1.5) {
    coreColor  = vec3(1.0, 1.0, 0.95);
    glowColor  = vec3(1.0, 0.9, 0.55);
    bloomColor = vec3(0.95, 0.65, 0.18);
  } else if (vType > 0.5) {
    coreColor  = vec3(1.0, 0.97, 0.85);
    glowColor  = vec3(1.0, 0.85, 0.5);
    bloomColor = vec3(0.95, 0.65, 0.18);
  } else {
    coreColor  = vec3(1.0, 0.85, 0.55);
    glowColor  = vec3(0.95, 0.65, 0.18);
    bloomColor = vec3(0.7, 0.4, 0.08);
  }
  vec3 finalRgb = coreColor * core + glowColor * (edge * 0.7 + glow * 0.4) + bloomColor * bloom * 0.18;
  float finalAlpha = (core + edge * 0.7 + glow * 0.35 + bloom * 0.08) * lifeAlpha;
  finalAlpha = clamp(finalAlpha, 0.0, 1.0);
  gl_FragColor = vec4(finalRgb * finalAlpha, finalAlpha);
}
`;

const QUAD_VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos.x, -aPos.y, 0.0, 1.0);
}
`;

const CLOUD_FS = `
precision mediump float;
varying vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uPulses[16];
uniform int uPulseCount;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.0; a *= 0.5;
  }
  return v;
}
void main() {
  vec2 px = vUv * uResolution;
  float yt = vUv.y;
  if (yt > 0.45) { gl_FragColor = vec4(0.0); return; }
  float cloudFade = 1.0 - smoothstep(0.30, 0.45, yt);
  float n = fbm(vec2(px.x * 0.012 + uTime * 0.05, px.y * 0.020));
  float clouds = smoothstep(0.4, 0.85, n) * cloudFade;
  vec3 baseCloud = vec3(0.16, 0.12, 0.08) * clouds;
  vec3 pulseGlow = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= uPulseCount) break;
    vec2 p = uPulses[i];
    float dx = px.x - p.x;
    float dy = px.y;
    float d2 = dx*dx + dy*dy * 0.4;
    float falloff = exp(-d2 / 4000.0);
    pulseGlow += vec3(1.0, 0.75, 0.32) * falloff * p.y * cloudFade;
  }
  vec3 finalRgb = baseCloud + pulseGlow;
  float a = (clouds * 0.5 + length(pulseGlow) * 0.5);
  gl_FragColor = vec4(finalRgb, a);
}
`;

const GROUND_FS = `
precision mediump float;
varying vec2 vUv;
uniform vec2 uResolution;
uniform float uFlash;
uniform vec3 uImpacts[16];
uniform int uImpactCount;
void main() {
  vec2 px = vUv * uResolution;
  vec3 col = vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uImpactCount) break;
    vec3 imp = uImpacts[i];
    float dx = px.x - imp.x;
    float dy = uResolution.y - px.y;
    float t = imp.y;
    float intensity = imp.z * (1.0 - t);
    float radius = 20.0 + t * 50.0;
    float d2 = dx*dx + dy*dy * 0.3;
    float falloff = max(0.0, 1.0 - d2 / (radius*radius));
    col += vec3(1.0, 0.78, 0.32) * falloff * intensity;
    a += falloff * intensity;
  }
  col += vec3(1.0, 0.86, 0.55) * uFlash * 0.20;
  a += uFlash * 0.20;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

const SPARK_VS = `
attribute vec2 aPos;
attribute float aSize;
attribute float aAlpha;
uniform vec2 uResolution;
varying float vAlpha;
void main() {
  vec2 clip = (aPos / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = aSize;
  vAlpha = aAlpha;
}
`;

const SPARK_FS = `
precision mediump float;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  float d = length(c);
  if (d > 0.5) discard;
  float a = exp(-d * d * 18.0) * vAlpha;
  vec3 col = vec3(1.0, 0.85, 0.5);
  gl_FragColor = vec4(col * a, a);
}
`;

// ─── Helpers ───────────────────────────────────────────────────────

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}
function link(gl, vs, fs) {
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram();
  gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

// ─── Public factory ────────────────────────────────────────────────

export function createLightningWebGL(canvas, opts = {}) {
  const scale = opts.scale || 'hunt'; // 'hunt' or 'bfm'

  let gl;
  try {
    gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      depth: false,
    });
  } catch (e) {}
  if (!gl) return { failed: true };

  // Compile programs
  const boltProg   = link(gl, BOLT_VS, BOLT_FS);
  const cloudProg  = link(gl, QUAD_VS, CLOUD_FS);
  const groundProg = link(gl, QUAD_VS, GROUND_FS);
  const sparkProg  = link(gl, SPARK_VS, SPARK_FS);
  if (!boltProg || !cloudProg || !groundProg || !sparkProg) {
    return { failed: true };
  }

  // Cache uniform locations
  const boltLocs = {
    aPos:        gl.getAttribLocation(boltProg, 'aPos'),
    aLifeT:      gl.getAttribLocation(boltProg, 'aLifeT'),
    aBoltType:   gl.getAttribLocation(boltProg, 'aBoltType'),
    uResolution: gl.getUniformLocation(boltProg, 'uResolution'),
  };
  const cloudLocs = {
    aPos:        gl.getAttribLocation(cloudProg, 'aPos'),
    uResolution: gl.getUniformLocation(cloudProg, 'uResolution'),
    uTime:       gl.getUniformLocation(cloudProg, 'uTime'),
    uPulses:     gl.getUniformLocation(cloudProg, 'uPulses'),
    uPulseCount: gl.getUniformLocation(cloudProg, 'uPulseCount'),
  };
  const groundLocs = {
    aPos:         gl.getAttribLocation(groundProg, 'aPos'),
    uResolution:  gl.getUniformLocation(groundProg, 'uResolution'),
    uFlash:       gl.getUniformLocation(groundProg, 'uFlash'),
    uImpacts:     gl.getUniformLocation(groundProg, 'uImpacts'),
    uImpactCount: gl.getUniformLocation(groundProg, 'uImpactCount'),
  };
  const sparkLocs = {
    aPos:        gl.getAttribLocation(sparkProg, 'aPos'),
    aSize:       gl.getAttribLocation(sparkProg, 'aSize'),
    aAlpha:      gl.getAttribLocation(sparkProg, 'aAlpha'),
    uResolution: gl.getUniformLocation(sparkProg, 'uResolution'),
  };

  // Buffers
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  const boltVertBuf = gl.createBuffer();
  const boltVertData = new Float32Array(scale === 'bfm' ? 128 * 1024 : 64 * 1024);
  let boltVertLen = 0;

  const sparkBuf = gl.createBuffer();
  const sparkData = new Float32Array(scale === 'bfm' ? 16 * 1024 : 8 * 1024);
  let sparkCount = 0;

  // State
  const state = {
    bolts: [],
    cloudPulses: [],
    impacts: [],
    sparks: [],
    flash: 0,
    startedAt: performance.now(),
    W: 0, H: 0,
  };

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    state.W = r.width;
    state.H = r.height;
    canvas.width = Math.max(1, Math.round(state.W * dpr));
    canvas.height = Math.max(1, Math.round(state.H * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // Generate jagged centerline polyline
  function genBoltPath(sx, gold, mega, optTargetY) {
    const targetY = optTargetY != null ? optTargetY : state.H + 4;
    const pts = [{ x: sx, y: 0 }];
    let x = sx, y = 0;
    const stepMin = gold ? 5 : 4;
    const stepRange = gold ? 9 : 8;
    while (y < targetY) {
      const dy = stepMin + Math.random() * stepRange;
      y += dy;
      x += (Math.random() - 0.5) * 0.55 * dy;
      pts.push({ x, y });
    }
    // Forks
    const forks = [];
    const forkCount = mega
      ? 4
      : (gold ? 2 + Math.floor(Math.random() * 2)
              : (Math.random() < 0.55 ? 1 : 0) + (Math.random() < 0.3 ? 1 : 0));
    for (let f = 0; f < forkCount; f++) {
      if (pts.length <= 4) break;
      const fi = 2 + Math.floor(Math.random() * (pts.length - 4));
      const fp = pts[fi];
      const fpts = [{ x: fp.x, y: fp.y }];
      let fx = fp.x, fy = fp.y;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const flen = 3 + Math.floor(Math.random() * 5);
      for (let i = 0; i < flen; i++) {
        const dy = stepMin + Math.random() * stepRange;
        fy += dy;
        fx += dir * (1.5 + Math.random() * 2.0);
        fpts.push({ x: fx, y: fy });
        if (fy > targetY) break;
      }
      forks.push(fpts);
    }
    return { main: pts, forks };
  }

  function spawnBolt(boltOpts = {}) {
    const sx = boltOpts.x != null ? boltOpts.x : (8 + Math.random() * (state.W - 16));
    const gold = boltOpts.type === 'gold' || boltOpts.type === 'mega' || Math.random() < 0.05;
    const mega = boltOpts.type === 'mega';
    const path = genBoltPath(sx, gold || mega, mega, boltOpts.targetY);
    const lastP = path.main[path.main.length - 1];
    state.bolts.push({
      main: path.main,
      forks: path.forks,
      life: 0,
      maxLife: mega ? 0.85 : (gold ? 0.65 : 0.32),
      type: mega ? 2 : (gold ? 1 : 0),
    });
    state.cloudPulses.push({
      x: sx, age: 0, life: 0.45,
      intensity: mega ? 1 : (gold ? 0.7 : 0.4),
    });
    // Ground impact only if bolt reached ground
    if (lastP.y >= state.H - 8) {
      state.impacts.push({
        x: lastP.x, age: 0, life: mega ? 0.6 : (gold ? 0.4 : 0.25),
        intensity: mega ? 1 : (gold ? 0.7 : 0.4),
      });
    }
    if (mega) state.flash = Math.max(state.flash, 0.6);
    else if (gold) state.flash = Math.max(state.flash, 0.25);
    // Sparks at branch points
    for (const f of path.forks) {
      const sparkN = mega ? 6 : 2;
      for (let s = 0; s < sparkN; s++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 60;
        state.sparks.push({
          x: f[0].x, y: f[0].y,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed - 20,
          life: 0,
          maxLife: 0.25 + Math.random() * 0.3,
        });
      }
    }
  }

  // Build bolt vertex buffer (each segment = 6 verts = 2 triangles)
  function buildBoltVerts() {
    let vi = 0;
    const HALF = scale === 'bfm' ? 16 : 12;
    const buf = boltVertData;
    const writeQuad = (a, b, t, type) => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      const px = -dy / len, py = dx / len;
      const aMin = [a.x - px*HALF, a.y - py*HALF, -HALF, t, type];
      const aPlu = [a.x + px*HALF, a.y + py*HALF,  HALF, t, type];
      const bMin = [b.x - px*HALF, b.y - py*HALF, -HALF, t, type];
      const bPlu = [b.x + px*HALF, b.y + py*HALF,  HALF, t, type];
      buf[vi++]=aMin[0]; buf[vi++]=aMin[1]; buf[vi++]=aMin[2]; buf[vi++]=aMin[3]; buf[vi++]=aMin[4];
      buf[vi++]=aPlu[0]; buf[vi++]=aPlu[1]; buf[vi++]=aPlu[2]; buf[vi++]=aPlu[3]; buf[vi++]=aPlu[4];
      buf[vi++]=bMin[0]; buf[vi++]=bMin[1]; buf[vi++]=bMin[2]; buf[vi++]=bMin[3]; buf[vi++]=bMin[4];
      buf[vi++]=bMin[0]; buf[vi++]=bMin[1]; buf[vi++]=bMin[2]; buf[vi++]=bMin[3]; buf[vi++]=bMin[4];
      buf[vi++]=aPlu[0]; buf[vi++]=aPlu[1]; buf[vi++]=aPlu[2]; buf[vi++]=aPlu[3]; buf[vi++]=aPlu[4];
      buf[vi++]=bPlu[0]; buf[vi++]=bPlu[1]; buf[vi++]=bPlu[2]; buf[vi++]=bPlu[3]; buf[vi++]=bPlu[4];
    };
    for (const b of state.bolts) {
      const t = b.life / b.maxLife;
      const type = b.type;
      for (let i = 0; i < b.main.length - 1; i++) {
        if (vi + 30 > buf.length) break;
        writeQuad(b.main[i], b.main[i+1], t, type);
      }
      for (const f of b.forks) {
        for (let i = 0; i < f.length - 1; i++) {
          if (vi + 30 > buf.length) break;
          writeQuad(f[i], f[i+1], t, type);
        }
      }
    }
    boltVertLen = vi / 5;
  }

  function buildSparkVerts() {
    let i = 0;
    const buf = sparkData;
    for (const s of state.sparks) {
      if (i + 4 > buf.length) break;
      const t = s.life / s.maxLife;
      const a = (1 - t) * 0.95;
      const size = (window.devicePixelRatio || 1) * (3 + (1 - t) * 2);
      buf[i++] = s.x;
      buf[i++] = s.y;
      buf[i++] = size;
      buf[i++] = a;
    }
    sparkCount = i / 4;
  }

  // Reusable uniform array buffers (avoid per-frame alloc)
  const pulseUniformArr = new Float32Array(32);
  const impactUniformArr = new Float32Array(48);

  function step(dt, hashTHS, autoSpawn, stepOpts = {}) {
    if (autoSpawn) {
      const ths = hashTHS || 0;
      let spawnRate;
      if (stepOpts.spawnRateOverride != null) {
        spawnRate = stepOpts.spawnRateOverride;
      } else if (scale === 'bfm') {
        spawnRate = 4 + Math.min(10, ths * 0.10);
      } else {
        spawnRate = 1.5 + Math.min(8, ths * 0.08);
      }
      const expected = spawnRate * dt;
      let toSpawn = Math.floor(expected) + (Math.random() < (expected - Math.floor(expected)) ? 1 : 0);
      for (let i = 0; i < toSpawn; i++) {
        // Mega-strike: only at high hashrate, 1.5% chance (Hunt mode); BFM uses 4% rate
        const isMega = scale === 'bfm'
          ? Math.random() < 0.04
          : (ths >= 30 && Math.random() < 0.015);
        spawnBolt(isMega ? { type: 'mega' } : {});
      }
    }

    // Step entities
    for (let i = state.bolts.length - 1; i >= 0; i--) {
      state.bolts[i].life += dt;
      if (state.bolts[i].life >= state.bolts[i].maxLife) state.bolts.splice(i, 1);
    }
    for (let i = state.cloudPulses.length - 1; i >= 0; i--) {
      state.cloudPulses[i].age += dt;
      if (state.cloudPulses[i].age >= state.cloudPulses[i].life) state.cloudPulses.splice(i, 1);
    }
    for (let i = state.impacts.length - 1; i >= 0; i--) {
      state.impacts[i].age += dt;
      if (state.impacts[i].age >= state.impacts[i].life) state.impacts.splice(i, 1);
    }
    for (let i = state.sparks.length - 1; i >= 0; i--) {
      const s = state.sparks[i];
      s.life += dt;
      if (s.life >= s.maxLife) { state.sparks.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 60 * dt;
    }
    state.flash = Math.max(0, state.flash - dt * 2.5);

    // ─── Render ───
    // ─── Render ───
    // v1.8.5-rev70e: fully transparent clear so the card shows behind.
    // Was: clearColor(0.031, 0.031, 0.039, 1.0) matching rgba(8,8,10,1).
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);

    // 1) Clouds (regular alpha blend)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(cloudProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(cloudLocs.aPos);
    gl.vertexAttribPointer(cloudLocs.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(cloudLocs.uResolution, state.W, state.H);
    gl.uniform1f(cloudLocs.uTime, (performance.now() - state.startedAt) / 1000);
    {
      const N = Math.min(state.cloudPulses.length, 16);
      for (let i = 0; i < N; i++) {
        const cp = state.cloudPulses[i];
        const fade = 1 - cp.age / cp.life;
        pulseUniformArr[i*2] = cp.x;
        pulseUniformArr[i*2+1] = cp.intensity * fade;
      }
      // Zero out unused slots
      for (let i = N; i < 16; i++) {
        pulseUniformArr[i*2] = 0;
        pulseUniformArr[i*2+1] = 0;
      }
      gl.uniform2fv(cloudLocs.uPulses, pulseUniformArr);
      gl.uniform1i(cloudLocs.uPulseCount, N);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 2) Bolts (additive)
    gl.blendFunc(gl.ONE, gl.ONE);
    buildBoltVerts();
    if (boltVertLen > 0) {
      gl.useProgram(boltProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, boltVertBuf);
      gl.bufferData(gl.ARRAY_BUFFER, boltVertData.subarray(0, boltVertLen * 5), gl.DYNAMIC_DRAW);
      const stride = 5 * 4;
      gl.enableVertexAttribArray(boltLocs.aPos);
      gl.vertexAttribPointer(boltLocs.aPos, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(boltLocs.aLifeT);
      gl.vertexAttribPointer(boltLocs.aLifeT, 1, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(boltLocs.aBoltType);
      gl.vertexAttribPointer(boltLocs.aBoltType, 1, gl.FLOAT, false, stride, 16);
      gl.uniform2f(boltLocs.uResolution, state.W, state.H);
      gl.drawArrays(gl.TRIANGLES, 0, boltVertLen);
    }

    // 3) Sparks (additive)
    buildSparkVerts();
    if (sparkCount > 0) {
      gl.useProgram(sparkProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, sparkBuf);
      gl.bufferData(gl.ARRAY_BUFFER, sparkData.subarray(0, sparkCount * 4), gl.DYNAMIC_DRAW);
      const stride = 4 * 4;
      gl.enableVertexAttribArray(sparkLocs.aPos);
      gl.vertexAttribPointer(sparkLocs.aPos, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(sparkLocs.aSize);
      gl.vertexAttribPointer(sparkLocs.aSize, 1, gl.FLOAT, false, stride, 8);
      gl.enableVertexAttribArray(sparkLocs.aAlpha);
      gl.vertexAttribPointer(sparkLocs.aAlpha, 1, gl.FLOAT, false, stride, 12);
      gl.uniform2f(sparkLocs.uResolution, state.W, state.H);
      gl.drawArrays(gl.POINTS, 0, sparkCount);
    }

    // 4) Ground impacts + flash (additive)
    gl.useProgram(groundProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(groundLocs.aPos);
    gl.vertexAttribPointer(groundLocs.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(groundLocs.uResolution, state.W, state.H);
    gl.uniform1f(groundLocs.uFlash, state.flash);
    {
      const N = Math.min(state.impacts.length, 16);
      for (let i = 0; i < N; i++) {
        const im = state.impacts[i];
        impactUniformArr[i*3] = im.x;
        impactUniformArr[i*3+1] = im.age / im.life;
        impactUniformArr[i*3+2] = im.intensity;
      }
      for (let i = N; i < 16; i++) {
        impactUniformArr[i*3] = 0;
        impactUniformArr[i*3+1] = 0;
        impactUniformArr[i*3+2] = 0;
      }
      gl.uniform3fv(groundLocs.uImpacts, impactUniformArr);
      gl.uniform1i(groundLocs.uImpactCount, N);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function destroy() {
    try { ro.disconnect(); } catch {}
    try {
      gl.deleteBuffer(quadBuf);
      gl.deleteBuffer(boltVertBuf);
      gl.deleteBuffer(sparkBuf);
      gl.deleteProgram(boltProg);
      gl.deleteProgram(cloudProg);
      gl.deleteProgram(groundProg);
      gl.deleteProgram(sparkProg);
    } catch {}
  }

  return { failed: false, step, spawnBolt, resize, destroy };
}
