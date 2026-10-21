// =============================================================================
// OceanSwarm — future autonomous surface-vessel swarm on a vast open sea.
// Third-person free-orbit cinematic scene, no UI.
// =============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WORLD, COLORS, LAYOUT } from './config.js';
import { createMaterials } from './core/materials.js';
import { createSky } from './core/sky.js';
import { createOcean } from './core/ocean.js';
import { createFleet } from './objects/ships/index.js';
import { Fleet } from './systems/formation.js';
import { createWakes } from './objects/effects/wakes.js';
import { createTechFx } from './objects/effects/tech.js';
import { createBirds } from './objects/effects/birds.js';
import { createIslands } from './objects/world/islands.js';
import { createReef } from './objects/world/reef.js';
import { createBase } from './objects/world/base.js';
import { createMothership } from './objects/world/mothership.js';
import { createMarkers } from './objects/world/markers.js';

const app = document.getElementById('app');

// -----------------------------------------------------------------------------
// renderer
// -----------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false,
  stencil: false,
  logarithmicDepthBuffer: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, WORLD.renderer.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = WORLD.renderer.exposure;
renderer.shadowMap.enabled = false;
app.appendChild(renderer.domElement);

// -----------------------------------------------------------------------------
// scene / camera / controls
// -----------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.haze);
scene.fog = new THREE.FogExp2(WORLD.fogColor, WORLD.fogDensity);

const camera = new THREE.PerspectiveCamera(
  WORLD.camera.fov,
  window.innerWidth / window.innerHeight,
  WORLD.camera.near,
  WORLD.camera.far,
);
camera.position.set(-320, 130, 240);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = WORLD.camera.dampingFactor;
controls.rotateSpeed = WORLD.camera.rotateSpeed;
controls.panSpeed = WORLD.camera.panSpeed;
controls.zoomSpeed = WORLD.camera.zoomSpeed;
controls.minDistance = WORLD.camera.minDistance;
controls.maxDistance = WORLD.camera.maxDistance;
controls.minPolarAngle = WORLD.camera.minPolarAngle;
controls.maxPolarAngle = WORLD.camera.maxPolarAngle;
controls.screenSpacePanning = false;
controls.target.set(0, 6, 0);
controls.update();

// -----------------------------------------------------------------------------
// lighting: warm low sun + cool sky dome light + soft fill
// -----------------------------------------------------------------------------
const sun = new THREE.DirectionalLight(WORLD.sunColor, WORLD.sunIntensity);
sun.position.copy(WORLD.sunDirection).multiplyScalar(9000);
sun.target.position.set(0, 0, 0);
scene.add(sun);
scene.add(sun.target);

const hemi = new THREE.HemisphereLight(WORLD.hemisphereSky, WORLD.hemisphereGround, WORLD.hemisphereIntensity);
scene.add(hemi);

const fill = new THREE.DirectionalLight(WORLD.fillColor, WORLD.fillIntensity);
fill.position.set(-WORLD.sunDirection.x * 6000, 2200, -WORLD.sunDirection.z * 6000);
fill.target.position.set(0, 0, 0);
scene.add(fill);
scene.add(fill.target);

// -----------------------------------------------------------------------------
// materials, sky, ocean
// -----------------------------------------------------------------------------
const materials = createMaterials(renderer);
const sky = createSky();
scene.add(sky.group);

const ocean = createOcean();
scene.add(ocean.mesh);

// -----------------------------------------------------------------------------
// world modules (each tolerant of a late/absent module)
// -----------------------------------------------------------------------------
const worldModules = [];
function mountWorld(name, factory, opts = {}) {
  try {
    const mod = factory(materials, opts);
    if (!mod) return;
    if (mod.group) scene.add(mod.group);
    worldModules.push(mod);
  } catch (err) {
    console.error(`[world:${name}]`, err);
  }
}
mountWorld('islands', createIslands);
mountWorld('reef', createReef);
mountWorld('base', createBase);
mountWorld('mothership', createMothership);
mountWorld('markers', createMarkers);

// -----------------------------------------------------------------------------
// fleet + formation
// -----------------------------------------------------------------------------
const boats = createFleet(materials);
for (const boat of boats) scene.add(boat.group);
const fleet = new Fleet(boats);
fleet.snap();
const flagship = boats.find((b) => b.type === 'flagship') || boats[0];

// -----------------------------------------------------------------------------
// effects
// -----------------------------------------------------------------------------
let wakes = null;
let tech = null;
let birds = null;
try {
  wakes = createWakes(boats);
  if (wakes?.group) scene.add(wakes.group);
} catch (err) {
  console.error('[wakes]', err);
}
try {
  tech = createTechFx(boats, flagship);
  if (tech?.group) scene.add(tech.group);
} catch (err) {
  console.error('[tech fx]', err);
}
try {
  birds = createBirds();
  if (birds?.group) scene.add(birds.group);
} catch (err) {
  console.error('[birds]', err);
}

// -----------------------------------------------------------------------------
// camera presets / initial framing
// -----------------------------------------------------------------------------
const _v = new THREE.Vector3();
function setCameraFromFleet() {
  const fwd = fleet.forward;
  const right = fleet.right;
  const target = fleet.center.clone().addScaledVector(fwd, WORLD.camera.targetAhead);
  target.y = WORLD.camera.targetHeight;
  camera.position
    .copy(target)
    .addScaledVector(fwd, -WORLD.camera.back)
    .addScaledVector(right, WORLD.camera.right)
    .add(new THREE.Vector3(0, WORLD.camera.up, 0));
  controls.target.copy(target);
  controls.update();
}
setCameraFromFleet();

const shipPos = (b) => (b ? b.group.position : fleet.center);

function viewDefault() {
  setCameraFromFleet();
}
function viewLow() {
  const fp = shipPos(flagship);
  const fwd = fleet.forward;
  const right = fleet.right;
  controls.target.copy(fp).addScaledVector(fwd, 18).add(new THREE.Vector3(0, 2.2, 0));
  camera.position
    .copy(fp)
    .addScaledVector(fwd, -26)
    .addScaledVector(right, 17)
    .add(new THREE.Vector3(0, 4.6, 0));
  controls.update();
}
function viewTop() {
  const c = fleet.center;
  controls.target.copy(c).add(new THREE.Vector3(0, 4, 0));
  camera.position.copy(c).addScaledVector(fleet.forward, 60).addScaledVector(fleet.right, 40).add(new THREE.Vector3(0, 780, 0));
  controls.update();
}
function viewFleet() {
  // show the whole cooperative formation: forward vanguard, both wings and the
  // support group astern, from a raised rear-quarter vantage point.
  const c = fleet.center;
  controls.target.copy(c).add(new THREE.Vector3(0, 6, 0));
  camera.position
    .copy(c)
    .addScaledVector(fleet.forward, -330)
    .addScaledVector(fleet.right, 80)
    .add(new THREE.Vector3(0, 235, 0));
  controls.update();
}
function viewBow() {
  const fp = shipPos(flagship);
  controls.target.copy(fp).add(new THREE.Vector3(0, 3.6, 0));
  camera.position
    .copy(fp)
    .addScaledVector(fleet.forward, 36)
    .addScaledVector(fleet.right, -28)
    .add(new THREE.Vector3(0, 6.5, 0));
  controls.update();
}
function viewSide() {
  const fp = shipPos(flagship);
  controls.target.copy(fp).add(new THREE.Vector3(0, 4, 0));
  camera.position
    .copy(fp)
    .addScaledVector(fleet.forward, 4)
    .addScaledVector(fleet.right, -46)
    .add(new THREE.Vector3(0, 10, 0));
  controls.update();
}
function viewBase() {
  // frame the base tower, the quay/pier fingers and the moored mothership
  const b = LAYOUT.base;
  const m = LAYOUT.mothership;
  controls.target.set((b.x + m.x) * 0.5 + 60, 34, (b.z + m.z) * 0.5 - 40);
  camera.position.set(b.x + 330, 152, b.z + 420);
  controls.update();
}
function viewReef() {
  const r = LAYOUT.reef;
  controls.target.set(r.x - 40, -2, r.z + 40);
  camera.position.set(r.x - 300, 86, r.z + 430);
  controls.update();
}
const VIEWS = {
  default: viewDefault,
  low: viewLow,
  top: viewTop,
  fleet: viewFleet,
  bow: viewBow,
  side: viewSide,
  base: viewBase,
  reef: viewReef,
};
function setView(name) {
  const fn = VIEWS[name] || viewDefault;
  fn();
}

const urlParams = new URLSearchParams(window.location.search);
const requestedView = urlParams.get('view');
if (requestedView && VIEWS[requestedView]) setView(requestedView);

// -----------------------------------------------------------------------------
// resize
// -----------------------------------------------------------------------------
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, WORLD.renderer.maxPixelRatio));
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);

// -----------------------------------------------------------------------------
// debug hook (used by the QA harness, invisible in the scene)
// -----------------------------------------------------------------------------
const stats = { fps: 0, drawCalls: 0, triangles: 0, boats: boats.length };
let paused = false;
window.__oceanSwarm = {
  ready: false,
  scene,
  camera,
  controls,
  renderer,
  fleet,
  boats,
  setView,
  stats,
  pause() {
    paused = true;
  },
  resume() {
    paused = false;
    lastNow = performance.now();
  },
  isPaused() {
    return paused;
  },
};

// -----------------------------------------------------------------------------
// animation loop
// -----------------------------------------------------------------------------
let time = 0;
let frames = 0;
let fpsElapsed = 0;
let firstFrame = true;
let lastNow = performance.now();

function updateWorldModules(dt) {
  for (let i = 0; i < worldModules.length; i++) {
    const m = worldModules[i];
    if (m.update) {
      try {
        m.update(time, dt);
      } catch (err) {
        console.error('[world update]', err);
        m.update = null;
      }
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const rawDt = Math.min((now - lastNow) / 1000, 0.5);
  lastNow = now;
  const dt = Math.min(rawDt, 0.1);
  if (paused) return;
  time += dt;

  // 1. fleet motion + vessel internal animation
  fleet.update(dt);

  // 2. camera rides with the fleet (keeps the composition stable while cruising)
  const delta = fleet.delta;
  camera.position.add(delta);
  controls.target.add(delta);
  controls.update();

  // sea surface follows the camera so the horizon never shows a mesh edge

  // 3. water-contact effects read the updated world transforms
  scene.updateMatrixWorld(true);
  if (wakes?.update) wakes.update(time, dt);
  if (tech?.update) tech.update(time, dt);
  if (birds?.update) birds.update(time, dt);

  // 4. environment animation
  updateWorldModules(dt);
  ocean.update(time, camera);
  sky.update(time, camera);

  renderer.render(scene, camera);

  if (firstFrame) {
    firstFrame = false;
    window.__oceanSwarm.ready = true;
  }

  frames++;
  fpsElapsed += rawDt;
  if (fpsElapsed >= 0.5) {
    stats.fps = Math.round(frames / fpsElapsed);
    stats.drawCalls = renderer.info.render.calls;
    stats.triangles = renderer.info.render.triangles;
    frames = 0;
    fpsElapsed = 0;
  }

  // expose a smooth simulation clock for any external tooling
  window.__oceanSwarm.simTime = time;
}

animate();
