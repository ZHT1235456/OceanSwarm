// =============================================================================
// Atmospheric sky: cinematic gradient dome with sun disc + halo, hand-painted
// cloud sprites, high cirrus sheets, and a shared sky-colour GLSL function used
// by the ocean shader so the sea/sky horizon line is mathematically seamless.
// =============================================================================
import * as THREE from 'three';
import { COLORS, WORLD } from '../config.js';
import { makeRng } from './geo.js';

// -----------------------------------------------------------------------------
// Shared uniforms between sky dome and ocean horizon fog
// -----------------------------------------------------------------------------
export function createSkyUniforms() {
  return {
    uSunDir: { value: WORLD.sunDirection.clone() },
    uSunColor: { value: new THREE.Color(COLORS.skySun) },
    uSkyTop: { value: new THREE.Color(COLORS.skyTop) },
    uSkyMid: { value: new THREE.Color(COLORS.skyMid) },
    uSkyHorizon: { value: new THREE.Color(COLORS.skyHorizon) },
    uHaze: { value: new THREE.Color(WORLD.fogColor) },
  };
}

// GLSL shared by sky dome + ocean. Both shaders must declare the same uniforms.
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
uniform vec3 uHaze;

// vertical atmospheric gradient including a wide warm scatter around the sun.
vec3 skyTint(vec3 dir) {
  float h = max(dir.y, 0.0);
  vec3 col = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.20, h));
  col = mix(col, uSkyTop, smoothstep(0.10, 0.72, h));

  float sd = max(dot(dir, uSunDir), 0.0);
  float nearHorizon = 1.0 - smoothstep(0.0, 0.55, h);
  vec3 warm = uSunColor * mix(vec3(1.0, 0.86, 0.66), vec3(1.0), nearHorizon);
  float scatter = pow(sd, 7.0) * 0.55 + pow(sd, 2.2) * 0.14;
  col = mix(col, warm, clamp(scatter * (0.45 + nearHorizon * 0.75), 0.0, 0.9));

  // pale atmospheric band hugging the horizon
  float band = exp(-abs(dir.y) * 26.0);
  col = mix(col, uHaze * 1.02, band * 0.42);
  return col;
}
`;

// -----------------------------------------------------------------------------
// Procedural cloud sprites
// -----------------------------------------------------------------------------
function createCloudTexture(seed, opts = {}) {
  const rng = makeRng(seed);
  const w = opts.width ?? 1024;
  const h = opts.height ?? 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const puffs = opts.puffs ?? 42;
  const spreadX = opts.spreadX ?? 0.72;
  const baseX = w / 2;
  const baseY = h * (opts.baseY ?? 0.66);

  // Build a cumulus-ish cluster: a flat wide base with towers rising in the
  // middle. Keep every blob away from the canvas border so the sprite has no
  // hard rectangular edges.
  const blobs = [];
  const margin = w * 0.1;
  for (let i = 0; i < puffs; i++) {
    const t = i / puffs;
    const clump = Math.sin(Math.PI * (0.15 + t * 0.7));
    const randX = (rng() - 0.5) * w * spreadX * (0.35 + clump * 0.9);
    const x = Math.min(w - margin, Math.max(margin, baseX + randX));
    const tower = Math.pow(Math.sin((Math.PI * (t * 0.85 + 0.08)) * 1.0), 1.6);
    const y = baseY - h * (0.04 + tower * 0.30 + rng() * 0.1);
    const r = w * (0.035 + rng() * 0.055) * (0.65 + tower * 0.85);
    blobs.push({ x, y, r, depth: tower });
  }
  // very soft big lumps first (volume)
  for (const b of blobs) {
    const span = b.r * 2.6;
    const g = ctx.createRadialGradient(b.x, b.y + b.r * 0.30, b.r * 0.1, b.x, b.y + b.r * 0.30, span);
    g.addColorStop(0, 'rgba(196, 212, 230, 0.16)');
    g.addColorStop(0.55, 'rgba(190, 206, 226, 0.10)');
    g.addColorStop(1, 'rgba(190, 206, 226, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y + b.r * 0.3, span, 0, Math.PI * 2);
    ctx.fill();
  }
  // shaded underside
  for (const b of blobs) {
    const g = ctx.createRadialGradient(b.x, b.y + b.r * 0.26, b.r * 0.08, b.x, b.y + b.r * 0.26, b.r * 1.05);
    g.addColorStop(0, 'rgba(176, 196, 218, 0.28)');
    g.addColorStop(0.55, 'rgba(174, 194, 216, 0.16)');
    g.addColorStop(1, 'rgba(174, 194, 216, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y + b.r * 0.26, b.r * 1.05, 0, Math.PI * 2);
    ctx.fill();
  }
  // lit crowns
  for (const b of blobs) {
    const g = ctx.createRadialGradient(b.x, b.y - b.r * 0.28, b.r * 0.06, b.x, b.y - b.r * 0.28, b.r * 1.0);
    g.addColorStop(0, 'rgba(255, 252, 244, 0.72)');
    g.addColorStop(0.45, 'rgba(255, 249, 238, 0.48)');
    g.addColorStop(1, 'rgba(255, 249, 238, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y - b.r * 0.28, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  // feather the canvas border so sprites never show a rectangular cut
  ctx.globalCompositeOperation = 'destination-in';
  const hfade = ctx.createLinearGradient(0, 0, w, 0);
  hfade.addColorStop(0, 'rgba(255,255,255,0)');
  hfade.addColorStop(0.10, 'rgba(255,255,255,1)');
  hfade.addColorStop(0.90, 'rgba(255,255,255,1)');
  hfade.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hfade;
  ctx.fillRect(0, 0, w, h);
  const vfade = ctx.createLinearGradient(0, 0, 0, h);
  vfade.addColorStop(0, 'rgba(255,255,255,0.35)');
  vfade.addColorStop(0.16, 'rgba(255,255,255,1)');
  vfade.addColorStop(0.82, 'rgba(255,255,255,1)');
  vfade.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = vfade;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function createCirrusTexture(seed) {
  const rng = makeRng(seed);
  const w = 1024;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 46; i++) {
    const x = rng() * w;
    const y = h * (0.2 + rng() * 0.6);
    const len = 40 + rng() * 300;
    const thick = 2 + rng() * 9;
    const alpha = 0.05 + rng() * 0.14;
    const grad = ctx.createLinearGradient(x - len / 2, y, x + len / 2, y);
    grad.addColorStop(0, 'rgba(255,252,246,0)');
    grad.addColorStop(0.5, `rgba(255,252,246,${alpha})`);
    grad.addColorStop(1, 'rgba(255,252,246,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = thick;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - len / 2, y);
    ctx.quadraticCurveTo(x, y - thick * 2.2, x + len / 2, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function createGlowTexture(inner = 'rgba(255,247,224,1)', mid = 'rgba(255,214,150,0.45)', outer = 'rgba(255,190,110,0)') {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.18, inner);
  g.addColorStop(0.42, mid);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// -----------------------------------------------------------------------------
const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_Position.z = gl_Position.w; // force to far plane
}
`;

const DOME_FRAG = /* glsl */ `
${SKY_GLSL}
varying vec3 vDir;
uniform float uTime;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(11.3, 7.7);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  vec3 col = skyTint(dir);

  // faint high cirrus painted directly into the dome for softness
  if (h > 0.02) {
    vec2 uv = dir.xz / (h + 0.22);
    float streak = fbm(uv * vec2(0.55, 2.6) + vec2(uTime * 0.0015, 0.0));
    streak = smoothstep(0.52, 0.82, streak) * smoothstep(0.02, 0.28, h) * (1.0 - smoothstep(0.55, 0.95, h));
    vec3 ccol = mix(vec3(0.92, 0.95, 1.0), uSunColor, 0.25);
    col = mix(col, ccol, streak * 0.16);
  }

  // sun disc + layered glow
  float sd = max(dot(dir, uSunDir), 0.0);
  float disc = smoothstep(0.99955, 0.99988, sd);
  float halo = pow(sd, 900.0) * 2.2 + pow(sd, 90.0) * 0.35 + pow(sd, 9.0) * 0.08;
  col += uSunColor * (disc * 14.0 + halo);
  // below the horizon: flat haze so the ocean fog blends perfectly
  if (h < 0.0) {
    col = mix(uHaze, skyTint(vec3(dir.x, 0.0, dir.z)), exp(h * 30.0));
  }

  // tiny dither to defeat 8-bit banding
  float dither = (hash12(gl_FragCoord.xy) - 0.5) * 0.0025;
  col += dither;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSky() {
  const root = new THREE.Group();
  const uniforms = createSkyUniforms();
  uniforms.uTime = { value: 0 };

  const domeMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: true,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), domeMat);
  dome.scale.setScalar(48000);
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  dome.name = 'sky-dome';
  root.add(dome);

  // ---- cumulus billboards ---------------------------------------------------
  const cloudRoot = new THREE.Group();
  cloudRoot.name = 'clouds';
  const texA = createCloudTexture(1049, { puffs: 46, spreadX: 0.78 });
  const texB = createCloudTexture(7331, { puffs: 34, spreadX: 0.86, baseY: 0.7 });
  const texC = createCloudTexture(99101, { puffs: 58, spreadX: 0.9, baseY: 0.62 });
  const cloudTextures = [texA, texB, texC];
  const rng = makeRng(20260101);
  const clouds = [];
  const cloudCount = 26;
  for (let i = 0; i < cloudCount; i++) {
    const tex = cloudTextures[i % cloudTextures.length];
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      color: 0xffffff,
      opacity: 0.6,
      toneMapped: true,
      alphaTest: 0.01,
    });
    const sprite = new THREE.Sprite(mat);
    // A good share of the clouds sit in the forward view cone (the camera looks
    // roughly 23 degrees to port of the +X course), the rest ring the horizon.
    const inView = i < 12;
    const az = inView
      ? (-1.05 + rng() * 1.25) // about -60..+11 degrees from +X
      : rng() * Math.PI * 2;
    const high = rng() < (inView ? 0.2 : 0.26);
    const dist = high ? 4200 + rng() * 5600 : 5000 + rng() * 9000;
    const elevDeg = high ? 6 + rng() * 9 : 1.1 + rng() * 3.6;
    const elev = (elevDeg * Math.PI) / 180;
    const x = Math.cos(az) * dist;
    const z = Math.sin(az) * dist;
    const y = Math.tan(elev) * dist + 30;
    sprite.position.set(x, y, z);
    const w = dist * (high ? 0.17 : 0.15) * (0.7 + rng() * 0.75);
    sprite.scale.set(w, w * (0.32 + rng() * 0.10), 1);
    const fade = high ? 0.26 : 0.28 + rng() * 0.20;
    mat.opacity = fade;
    // atmospheric tint: distant clouds lean toward haze
    const haze = new THREE.Color(WORLD.fogColor);
    const c = new THREE.Color(0xffffff).lerp(haze, THREE.MathUtils.clamp(dist / 17000, 0.05, 0.55));
    mat.color.copy(c);
    sprite.renderOrder = -900;
    cloudRoot.add(sprite);
    clouds.push({ sprite, baseAz: az, dist, speed: 0.000008 + rng() * 0.000014 });
  }

  // ---- sun glow -------------------------------------------------------------
  const glowMat = new THREE.SpriteMaterial({
    map: createGlowTexture(),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    fog: false,
    opacity: 0.38,
    toneMapped: true,
  });
  const sunGlow = new THREE.Sprite(glowMat);
  sunGlow.position.copy(WORLD.sunDirection).multiplyScalar(30000);
  sunGlow.scale.setScalar(2400);
  sunGlow.renderOrder = -890;
  cloudRoot.add(sunGlow);

  // ---- high cirrus sheets ---------------------------------------------------
  const cirrusRoot = new THREE.Group();
  cirrusRoot.name = 'cirrus';
  const cirrusTex = createCirrusTexture(4411);
  for (let i = 0; i < 5; i++) {
    const geo = new THREE.PlaneGeometry(9000 + rng() * 9000, 2600 + rng() * 2200);
    const mat = new THREE.MeshBasicMaterial({
      map: cirrusTex,
      transparent: true,
      opacity: 0.22 + rng() * 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rng() * Math.PI * 2;
    mesh.position.set((rng() - 0.5) * 9000, 6800 + rng() * 4200, (rng() - 0.5) * 9000);
    mesh.renderOrder = -910;
    cirrusRoot.add(mesh);
  }

  root.add(cloudRoot);
  root.add(cirrusRoot);

  const tmp = new THREE.Vector3();
  function update(time, camera) {
    uniforms.uTime.value = time;
    if (camera) {
      dome.position.copy(camera.position);
      // clouds drift extremely slowly with the wind, and stay anchored in world
      cloudRoot.rotation.y = time * 0.000004;
      cirrusRoot.rotation.y = -time * 0.0000025;
      // sun glow stays at infinity in the sun direction
      tmp.copy(WORLD.sunDirection).multiplyScalar(30000);
      sunGlow.position.copy(tmp);
    }
  }

  return { group: root, dome, clouds, update, uniforms };
}
