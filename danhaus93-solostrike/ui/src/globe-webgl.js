// SoloStrike WebGL globe renderer — clean rewrite (rev35).
//
// Renders a textured sphere with limb darkening. Full 3D drag-to-rotate
// (pitch + yaw). Designed to run behind a transparent 2D canvas that
// handles markers, pin tap overlay, and pin-placement UI.
//
// Public API:
//   const globe = createGlobeWebGL(canvas)
//   globe.setTexture(canvasOrImage)           // upload world map
//   globe.update({ rotY, rotX, dpr, width, height })  // every frame
//   globe.destroy()                            // tear down on unmount
//   globe.isReady()                            // boolean
//
// Coordinate system: sphere centered at origin, radius 1.
// X right, Y up, Z toward camera. Orthographic projection.
//
// KEY DESIGN CHOICE — polar pinch handling:
//   Equirectangular textures have a singularity at the poles where the
//   top/bottom row spans 360° of longitude as one geographic point.
//   When the user pitches the planet to look at a pole, this shows up
//   as a visible "hole" in the middle of the disk.
//
//   Solution: smoothly fade landMask to 0 over the last ~10° of latitude
//   near each pole. Pure latitude-based fade — no derivative tricks (which
//   create visible circular ring boundaries on the sphere surface).
//   Pole becomes ocean-only, no smearing, no visible threshold.

const VERT_SHADER = `
precision highp float;

attribute vec3 aPosition;     // sphere vertex, radius 1, untransformed

uniform float uRotY;          // yaw   (Y-axis spin)
uniform float uRotX;          // pitch (X-axis tilt)
uniform float uAspect;        // canvas W/H
uniform float uScale;         // disk scale factor

varying vec3 vNormal;         // post-rotation surface normal (lighting)
varying vec3 vObjectPos;      // ORIGINAL un-rotated position (texture UV)

void main() {
  vObjectPos = aPosition;

  // PITCH around X axis (looking up/down at the planet)
  float cx = cos(uRotX);
  float sx = sin(uRotX);
  vec3 pitched = vec3(
    aPosition.x,
    aPosition.y * cx - aPosition.z * sx,
    aPosition.y * sx + aPosition.z * cx
  );

  // YAW around Y axis (spinning planet east-west)
  float cy = cos(uRotY);
  float sy = sin(uRotY);
  vec3 spun = vec3(
    pitched.x * cy + pitched.z * sy,
    pitched.y,
    -pitched.x * sy + pitched.z * cy
  );
  vNormal = spun;

  // Orthographic projection — disk fills uScale * canvas height
  vec2 screen = vec2(spun.x * uScale / uAspect, spun.y * uScale);
  gl_Position = vec4(screen, -spun.z, 1.0);
}
`;

const FRAG_SHADER = `
precision highp float;

uniform sampler2D uMap;
uniform vec3 uOceanColor;
uniform vec3 uLandColor;

varying vec3 vNormal;
varying vec3 vObjectPos;

const float PI = 3.14159265359;

// Hash-based 3D noise — gives land a subtle organic warmth variation.
// Sampled in object space (vObjectPos) so the pattern stays glued to
// the planet surface as it rotates.
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

void main() {
  // 1) Compute equirectangular UV from un-rotated object position.
  //    The geometry rotates so the mesh spins, but vObjectPos interpolates
  //    across each rotated triangle — so different parts of the texture
  //    come into view as the planet rotates.
  float lon = atan(vObjectPos.x, vObjectPos.z);
  float lat = asin(clamp(vObjectPos.y, -1.0, 1.0));
  float u = fract(lon / (2.0 * PI) + 0.5);
  float v = 1.0 - (lat / PI + 0.5);

  // 2) POLAR PINCH FADE — smooth latitude-based fade.
  //    The texture's top/bottom rows are equirectangular singularities
  //    where 1024 different texel values map to a single geographic point.
  //    Sampling near v=0 or v=1 produces visible smearing.
  //
  //    Solution: gently fade landMask to 0 over the last ~10° of latitude
  //    near each pole. Smooth in latitude space, NOT in screen-space
  //    derivatives — the latter creates a visible circular ring boundary
  //    around the pole.
  //
  //    Fades 80°→90°: at 80° latitude pinchFade is 1.0 (full land), at
  //    90° it's 0.0 (ocean only). The transition is gradual across the
  //    surface so there's no visible threshold ring.
  float absLatDeg = abs(lat) * 180.0 / PI;
  float pinchFade = 1.0 - smoothstep(80.0, 90.0, absLatDeg);

  // 3) Sample texture
  float landMask = texture2D(uMap, vec2(u, v)).r;
  landMask *= pinchFade;

  // 5) Lighting — sun upper-left, slightly toward camera
  vec3 light = normalize(vec3(-0.4, 0.5, 0.85));
  float NdotL = max(0.0, dot(vNormal, light));
  float lit = 0.45 + 0.55 * NdotL;

  // 6) Procedural noise — subtle organic warmth on land. Sampled in
  //    object space (un-rotated) so the pattern stays anchored to the
  //    planet surface as it rotates. Scaled by pinchFade to vanish at
  //    the poles where adjacent triangles produce wildly different
  //    interpolated noise values (would otherwise show as striping).
  float noise = noise3(vObjectPos * 8.0) * 0.5
              + noise3(vObjectPos * 16.0) * 0.25
              + noise3(vObjectPos * 32.0) * 0.125;
  noise = (noise - 0.5) * 2.0 * pinchFade;

  // 7) Blend land + ocean
  vec3 oceanColor = uOceanColor * lit;
  vec3 landColor  = uLandColor * (0.45 + 0.85 * NdotL);
  landColor *= (1.0 + noise * 0.18);
  vec3 baseColor  = mix(oceanColor, landColor, landMask);

  // 8) Limb darkening — fade rim slightly so silhouette reads as 3D
  float limb = clamp(vNormal.z * 1.2 + 0.20, 0.0, 1.0);
  baseColor *= mix(0.78, 1.0, limb);

  gl_FragColor = vec4(baseColor, 1.0);
}
`;

function buildSphereMesh(nLat = 64, nLon = 128) {
  const positions = new Float32Array(nLat * nLon * 3);
  let p = 0;
  for (let i = 0; i < nLat; i++) {
    const lat = -Math.PI / 2 + (i / (nLat - 1)) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    for (let j = 0; j < nLon; j++) {
      const lon = (j / nLon) * Math.PI * 2;
      positions[p++] = cosLat * Math.sin(lon);
      positions[p++] = sinLat;
      positions[p++] = cosLat * Math.cos(lon);
    }
  }
  const indices = [];
  for (let i = 0; i < nLat - 1; i++) {
    for (let j = 0; j < nLon; j++) {
      const a = i * nLon + j;
      const b = i * nLon + ((j + 1) % nLon);
      const c = (i + 1) * nLon + j;
      const d = (i + 1) * nLon + ((j + 1) % nLon);
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions, indices: new Uint16Array(indices) };
}

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(sh), '\n', src);
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function createGlobeWebGL(canvas) {
  let gl;
  try {
    gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      depth: true,
      preserveDrawingBuffer: false,
    });
  } catch {}
  if (!gl) return null;

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SHADER);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Shader link error:', gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);

  const locs = {
    aPosition:   gl.getAttribLocation(program, 'aPosition'),
    uRotY:       gl.getUniformLocation(program, 'uRotY'),
    uRotX:       gl.getUniformLocation(program, 'uRotX'),
    uAspect:     gl.getUniformLocation(program, 'uAspect'),
    uScale:      gl.getUniformLocation(program, 'uScale'),
    uMap:        gl.getUniformLocation(program, 'uMap'),
    uOceanColor: gl.getUniformLocation(program, 'uOceanColor'),
    uLandColor:  gl.getUniformLocation(program, 'uLandColor'),
  };

  // Mesh
  const mesh = buildSphereMesh(64, 128);
  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(locs.aPosition);
  gl.vertexAttribPointer(locs.aPosition, 3, gl.FLOAT, false, 0, 0);

  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  const indexCount = mesh.indices.length;

  // Texture (1x1 placeholder until setTexture called)
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.uniform1i(locs.uMap, 0);

  // Colors — SoloStrike amber palette matching the target screenshots
  gl.uniform3f(locs.uOceanColor, 0.110, 0.090, 0.060);
  gl.uniform3f(locs.uLandColor,  0.96, 0.65, 0.14);
  gl.uniform1f(locs.uScale, 0.72);

  // GL state
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.frontFace(gl.CCW);
  gl.clearColor(0, 0, 0, 0);

  let _ready = true;
  let _destroyed = false;

  return {
    isReady() { return _ready && !_destroyed; },

    setTexture(source) {
      if (_destroyed) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    },

    update({ rotY = 0, rotX = 0, dpr = 1, width = 100, height = 100 }) {
      if (_destroyed || !_ready) return;
      const W = Math.round(width * dpr);
      const H = Math.round(height * dpr);
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      gl.viewport(0, 0, W, H);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform1f(locs.uRotY, rotY);
      gl.uniform1f(locs.uRotX, rotX);
      gl.uniform1f(locs.uAspect, W / H);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
    },

    destroy() {
      if (_destroyed) return;
      _destroyed = true;
      try {
        gl.deleteBuffer(posBuf);
        gl.deleteBuffer(idxBuf);
        gl.deleteTexture(tex);
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      } catch {}
    },
  };
}

// Bake equirectangular texture from TopoJSON rings.
// Land = white (R=240), Ocean = dark (R=15). The shader blends ocean→land
// based on the red channel.
//
// rings: arrays of [lon, lat] in degrees.
export function bakeWorldMapTexture(rings, opts = {}) {
  const W = opts.width || 2048;
  const H = opts.height || 1024;

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  ctx.fillStyle = 'rgb(15,15,15)';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgb(240,240,240)';
  ctx.beginPath();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    let started = false;
    for (let i = 0; i < ring.length; i++) {
      const lon = ring[i][0];
      const lat = ring[i][1];
      const x = (lon + 180) / 360 * W;
      const y = (90 - lat) / 180 * H;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
    }
    ctx.closePath();
  }
  ctx.fill('evenodd');

  return c;
}
