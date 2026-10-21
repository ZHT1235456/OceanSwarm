// =============================================================================
// Procedural ocean: a camera-following radial grid with a custom shader.
// - shared CPU/GPU wave field (core/waves.js) so hulls ride the visible surface
// - fresnel sky reflection via the shared sky-colour GLSL (seamless horizon)
// - depth-tinted shallow shoals (reef/lagoon) rendered translucent so the
//   seabed, coral and fish show through
// - sun glitter, sparse whitecaps, drifting cloud shadows and distance haze
// =============================================================================
import * as THREE from 'three';
import { WORLD, COLORS, SHOALS } from '../config.js';
import { WAVE_GLSL } from './waves.js';
import { SKY_GLSL, createSkyUniforms } from './sky.js';

const NEAR_RADIUS = 2800;
const NEAR_RINGS = 210;
const FAR_RINGS = 26;

function ringRadius(i, radius) {
  if (i <= NEAR_RINGS) {
    return NEAR_RADIUS * Math.pow(i / NEAR_RINGS, 2.3);
  }
  const t = (i - NEAR_RINGS) / FAR_RINGS;
  return NEAR_RADIUS * Math.exp(t * Math.log(radius / NEAR_RADIUS));
}

function buildOceanGeometry(radius, rings, segments) {
  const positions = new Float32Array((rings + 1) * (segments + 1) * 3);
  let ptr = 0;
  for (let i = 0; i <= rings; i++) {
    const r = ringRadius(i, radius);
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      positions[ptr++] = Math.cos(a) * r;
      positions[ptr++] = 0;
      positions[ptr++] = Math.sin(a) * r;
    }
  }
  const indices = [];
  const stride = segments + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * stride + j;
      const b = a + stride;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, c, b);
      indices.push(c, d, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

const OCEAN_VERT = /* glsl */ `
precision highp float;
${WAVE_GLSL}

uniform float uTime;
uniform vec3 uSunDir;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vH;
varying float vDist;
varying vec2 vWorldXZ;

// per-wave distance fading prevents shimmer / aliasing on the far coarse mesh
void sampleWavesAttenuated(vec2 p, float t, vec3 camPos, out float h, out vec2 grad) {
  h = 0.0;
  grad = vec2(0.0);
  float dist = distance(camPos.xz, p);
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 a = WAVE_A[i];
    vec2 b = WAVE_B[i];
    float len = 6.2831853 / a.z;
    float fade = 1.0 - smoothstep(len * 24.0, len * 150.0, dist);
    float ph = a.z * dot(a.xy, p) - b.x * t + b.y;
    h += a.w * sin(ph) * fade;
    grad += a.w * a.z * a.xy * cos(ph) * fade;
  }
}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float h;
  vec2 grad;
  sampleWavesAttenuated(wp.xz, uTime, cameraPosition, h, grad);
  wp.y += h;
  vH = h;
  vWorldPos = wp.xyz;
  vWorldXZ = wp.xz;
  vDist = length(wp.xyz - cameraPosition);
  vNormal = normalize(vec3(-grad.x, 1.0, -grad.y));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const OCEAN_FRAG = /* glsl */ `
precision highp float;
${SKY_GLSL}

uniform float uTime;
uniform float uFogDensity;
uniform vec3 uDeepColor;
uniform vec3 uMidColor;
uniform vec3 uLightColor;
uniform vec3 uShallowColor;
uniform vec3 uCrestColor;
uniform vec3 uFoamColor;
uniform vec3 uSandColor;
uniform vec4 uShoalA[4];
uniform float uShoalStrength[4];

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vH;
varying float vDist;
varying vec2 vWorldXZ;

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
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.07 + vec2(9.1, 3.7);
    a *= 0.5;
  }
  return s;
}

// high-frequency wind ripples, not part of the vertex displacement
vec2 rippleGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  g += vec2(0.62, 0.78) * 0.045 * cos(dot(p, vec2(0.62, 0.78)) * 0.90 - t * 1.9);
  g += vec2(-0.78, 0.62) * 0.038 * cos(dot(p, vec2(-0.78, 0.62)) * 1.25 - t * 2.2 + 1.7);
  g += vec2(0.96, -0.28) * 0.030 * cos(dot(p, vec2(0.96, -0.28)) * 1.75 - t * 2.7 + 4.2);
  g += vec2(0.31, 0.95) * 0.021 * cos(dot(p, vec2(0.31, 0.95)) * 2.60 - t * 3.3 + 2.1);
  g += vec2(0.80, 0.60) * 0.016 * cos(dot(p, vec2(0.80, 0.60)) * 4.10 - t * 4.1 + 0.6);
  return g;
}

// returns shallow-water factor 0..1, and shore-edge foam 0..1
float shoalField(vec2 p, out float edgeFoam) {
  float shoal = 0.0;
  edgeFoam = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 s = uShoalA[i];
    float strength = uShoalStrength[i];
    if (strength <= 0.0) continue;
    float e = length((p - s.xy) / s.zw);
    float shallow = (1.0 - smoothstep(0.42, 1.06, e)) * strength;
    shoal = max(shoal, shallow);
    float edge = smoothstep(0.97, 0.78, e) * smoothstep(0.55, 0.82, e);
    edgeFoam = max(edgeFoam, edge * strength);
  }
  return clamp(shoal, 0.0, 1.0);
}

void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec2 p = vWorldXZ;
  float camDist = vDist;

  // ---- surface detail -------------------------------------------------------
  float detailFade = 1.0 - smoothstep(320.0, 2600.0, camDist);
  vec2 rg = rippleGrad(p, uTime) * detailFade;
  float n1 = fbm(p * 0.55 + vec2(uTime * 0.21, -uTime * 0.16)) - 0.5;
  float n2 = fbm(p * 0.55 + vec2(-uTime * 0.18, uTime * 0.23) + 17.3) - 0.5;
  rg += vec2(n1, n2) * 0.026 * detailFade;

  vec3 N = normalize(vNormal + vec3(-rg.x, 0.0, -rg.y));

  // ---- shoals ---------------------------------------------------------------
  float edgeFoam;
  float shoal = shoalField(p, edgeFoam);

  // ---- water body colour ----------------------------------------------------
  // Shade the surface by the slope facing the sun rather than by wave height.
  // Colouring uses the smooth vertex normal (no high-frequency ripples) so the
  // large colour fields stay calm and readable from high above; the fine detail
  // normal only drives the specular glitter below.
  vec3 Ncolor = normalize(vNormal);
  float swell = smoothstep(-0.95, 0.95, vH);
  float slopeSun = dot(Ncolor.xz, uSunDir.xz);
  float lightSide = smoothstep(-0.28, 0.30, slopeSun);
  float sunDiff = clamp(dot(Ncolor, uSunDir), 0.0, 1.0);
  vec3 base = mix(uDeepColor, uMidColor, 0.34 + 0.44 * lightSide);
  base = mix(base, uLightColor, smoothstep(0.62, 1.0, lightSide) * 0.30);
  base *= 0.90 + 0.18 * sunDiff;
  base += uCrestColor * smoothstep(1.05, 1.4, vH) * 0.06;
  base += uSkyHorizon * 0.03;

  // dominant long swell band (matches the main wave in core/waves.js) keeps the
  // sea readable from high vantage points with clean diagonal light bands.
  float swellPhase = dot(p, vec2(0.94, -0.34)) * 0.0476 - uTime * 0.421 + 0.0;
  float band = sin(swellPhase + fbm(p * 0.0022 + uTime * 0.004) * 0.5);
  float bandLight = smoothstep(-0.15, 0.85, band);
  base = mix(base, uLightColor, bandLight * 0.05);
  base = mix(base, uDeepColor, smoothstep(0.1, -0.9, band) * 0.05);

  // shallow turquoise lagoon: rich sandbar / patch-reef colour fields so the
  // lagoon reads as clear tropical water rather than a flat pale sheet.
  float barN = fbm(p * 0.0022 + vec2(3.1, 7.7));
  float patchN = fbm(p * 0.011 + vec2(uTime * 0.003, -uTime * 0.002));
  float lagoonN = fbm(p * 0.035 + vec2(uTime * 0.01, uTime * 0.008));
  vec3 shallowCol = mix(uShallowColor, uCrestColor, 0.10 + 0.18 * sunDiff);
  shallowCol = mix(shallowCol, uMidColor, smoothstep(0.42, 0.78, patchN) * 0.30);
  shallowCol = mix(shallowCol, uDeepColor, smoothstep(0.55, 0.85, barN) * 0.22);
  shallowCol = mix(shallowCol, uCrestColor, smoothstep(0.55, 0.9, lagoonN) * 0.20);
  shallowCol *= 0.94 + 0.12 * lagoonN;
  base = mix(base, shallowCol, smoothstep(0.10, 0.95, shoal) * 0.95);

  // drifting cloud shadows (very soft, large scale)
  float cloud = fbm(p * 0.00022 + vec2(uTime * 0.0016, -uTime * 0.0011));
  base *= 1.0 - smoothstep(0.32, 0.78, cloud) * 0.10;
  // elongated wind streaks
  float windStreak = smoothstep(0.52, 0.86, fbm(vec2(p.x * 0.012, p.y * 0.095) + vec2(uTime * 0.004, uTime * 0.012)));
  base *= 0.97 + windStreak * 0.05;
  // caustic shimmer in the shallows
  float caust = pow(fbm(p * 0.055 + vec2(uTime * 0.05, -uTime * 0.04)), 2.2);
  base += vec3(0.62, 1.0, 0.92) * caust * shoal * 0.40;
  // small white sand ripples catching the light
  float sandRipple = smoothstep(0.60, 0.92, fbm(p * 0.10 + vec2(uTime * 0.01, 0.0)));
  base += uSandColor * sandRipple * shoal * 0.10;

  // ---- reflection -----------------------------------------------------------
  vec3 Rflat = reflect(-V, vec3(0.0, 1.0, 0.0));
  Rflat.y = abs(Rflat.y) + 0.03;
  vec3 Rwave = reflect(-V, N);
  Rwave.y = max(Rwave.y, 0.13) + 0.01;
  vec3 skyRef = mix(skyTint(normalize(Rflat)), skyTint(normalize(Rwave)), 0.16) * 0.94;
  float fres = 0.018 + 0.978 * pow(1.0 - clamp(dot(vec3(0.0, 1.0, 0.0), V), 0.0, 1.0), 4.5);
  fres = clamp(fres * 0.78, 0.0, 0.62);
  fres = mix(fres, fres * 0.62, shoal);
  vec3 col = mix(base, skyRef, fres);

  // ---- sun specular / glitter ----------------------------------------------
  vec3 H = normalize(uSunDir + V);
  float nh = clamp(dot(N, H), 0.0, 1.0);
  float glitter = smoothstep(0.28, 0.85, fbm(p * 0.28 + vec2(uTime * 0.22, -uTime * 0.16)));
  float sharp = pow(nh, 130.0) * 1.35 * (0.25 + glitter * 0.9);
  float broad = pow(nh, 18.0) * 0.12;
  col += uSunColor * (sharp + broad);

  // ---- foam -----------------------------------------------------------------
  // genuine whitecaps only: rare, small, broken by noise (the wakes provide the
  // dense foam around the vessels).
  float crestFoam = smoothstep(1.02, 1.42, vH) * smoothstep(0.72, 0.96, fbm(p * 0.30 + vec2(uTime * 0.08, uTime * 0.05)));
  float shoreline = edgeFoam * smoothstep(0.38, 0.86, fbm(p * 0.22 + vec2(uTime * 0.12, -uTime * 0.09)));
  float foam = clamp(crestFoam * (0.40 - shoal * 0.22) + shoreline * 0.80, 0.0, 1.0);
  vec3 foamCol = mix(uFoamColor, uSunColor, 0.22) * (0.80 + 0.35 * sunDiff);
  col = mix(col, foamCol, foam * 0.75);

  // ---- atmosphere -----------------------------------------------------------
  vec2 hdir = vec2(-V.x, -V.z);
  float hl = length(hdir);
  hdir = hl > 0.0001 ? hdir / hl : vec2(0.0, 1.0);
  vec3 horizonCol = skyTint(normalize(vec3(hdir.x, 0.0, hdir.y)));
  float fogF = 1.0 - exp(-pow(camDist * uFogDensity, 2.0));
  fogF = clamp(fogF, 0.0, 1.0);
  col = mix(col, horizonCol, fogF);

  // shallow water is translucent so the seabed and reef show through
  float alpha = mix(1.0, 0.72, shoal * 0.9);
  alpha = mix(alpha, 1.0, smoothstep(0.30, 0.85, fres));
  if (fogF > 0.985) alpha = 1.0;

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createOcean() {
  const skyUniforms = createSkyUniforms();
  const shoalPositions = [];
  const shoalStrengths = [];
  const pad = { x: 0, z: 0, rx: 1, rz: 1 };
  const list = (SHOALS || []).slice(0, 4);
  for (let i = 0; i < 4; i++) {
    const s = list[i] || pad;
    shoalPositions.push(new THREE.Vector4(s.x, s.z, s.rx, s.rz));
    shoalStrengths.push(i < list.length ? (list[i].strength ?? 1) : 0);
  }

  const uniforms = {
    ...skyUniforms,
    uTime: { value: 0 },
    uFogDensity: { value: WORLD.fogDensity },
    uDeepColor: { value: new THREE.Color(COLORS.oceanDeep) },
    uMidColor: { value: new THREE.Color(COLORS.oceanMid) },
    uLightColor: { value: new THREE.Color(COLORS.oceanLight) },
    uShallowColor: { value: new THREE.Color(COLORS.oceanShallow) },
    uCrestColor: { value: new THREE.Color(COLORS.oceanCrest) },
    uFoamColor: { value: new THREE.Color(COLORS.foam) },
    uSandColor: { value: new THREE.Color(COLORS.sand) },
    uShoalA: { value: shoalPositions },
    uShoalStrength: { value: shoalStrengths },
  };

  const geometry = buildOceanGeometry(WORLD.oceanRadius, WORLD.oceanRings, WORLD.oceanSegments);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: OCEAN_VERT,
    fragmentShader: OCEAN_FRAG,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
    fog: false,
    toneMapped: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ocean-surface';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.matrixAutoUpdate = false;

  const snap = 3.0;
  const pos = new THREE.Vector3();

  function update(time, camera) {
    uniforms.uTime.value = time;
    if (!camera) return;
    // follow the camera so the dense part of the radial grid is always around it
    pos.set(Math.round(camera.position.x / snap) * snap, 0, Math.round(camera.position.z / snap) * snap);
    mesh.position.copy(pos);
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
  }

  return { mesh, group: mesh, update, uniforms, material };
}




