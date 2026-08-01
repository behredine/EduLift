import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildTransformer } from './components.js';

/* ------------------------------------------------------------------ *
 *  Transformer Lab - main app
 * ------------------------------------------------------------------ */

const state = {
  mode: 'translate',
  explode: 0,
  xray: false,
  showInternals: false,
  load: 50,
  selected: null,
  dragging: false,
};

const LS_KEY = 'transformer-lab-scene-v1';

/* show fatal errors on screen (e.g. three.js CDN unreachable) */
window.addEventListener('error', (e) => {
  const box = document.getElementById('errBox');
  if (box) {
    box.style.display = 'block';
    box.textContent = 'Something went wrong:\n' + (e.message || String(e)) +
      '\n\nIf the three.js library could not be loaded, check your internet connection and reload.';
  }
});

/* ---------- renderer / scene / camera ---------- */
const container = document.getElementById('viewport');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e141b);
scene.fog = new THREE.FogExp2(0x0e141b, 0.016);

/* environment reflections for the PBR materials (helps metals look alive) */
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 200);
camera.position.set(9.5, 6.5, 10.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2.5;
controls.maxDistance = 40;
controls.maxPolarAngle = Math.PI * 0.92;

const tc = new TransformControls(camera, renderer.domElement);
tc.setMode('translate');
tc.setSize(0.8);
tc.addEventListener('dragging-changed', (e) => {
  state.dragging = e.value;
  controls.enabled = !e.value;
});
tc.addEventListener('objectChange', () => {
  if (state.selected) {
    syncFromGroup(state.selected);
    refreshPanel();
    scheduleSave();
  }
});
scene.add(tc);

/* ---------- lights ---------- */
scene.add(new THREE.HemisphereLight(0xdbe7ff, 0x2b323c, 0.85));
scene.add(new THREE.AmbientLight(0x3a4250, 0.5));

const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(10, 14, 7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -14;
key.shadow.camera.right = 14;
key.shadow.camera.top = 14;
key.shadow.camera.bottom = -14;
key.shadow.camera.near = 1;
key.shadow.camera.far = 45;
key.shadow.bias = -0.0004;
scene.add(key);
scene.add(key.target);

const fill = new THREE.DirectionalLight(0x9fb6d4, 0.5);
fill.position.set(-8, 6, -6);
scene.add(fill);

/* ---------- ground ---------- */
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(15, 48),
  new THREE.MeshStandardMaterial({ color: 0x131a23, roughness: 0.95, metalness: 0 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(30, 30, 0x2a3a4d, 0x1c2835);
grid.position.y = 0.002;
grid.material.transparent = true;
grid.material.opacity = 0.6;
scene.add(grid);

/* ---------- build the transformer ---------- */
const { parts, internals } = buildTransformer(scene);

scene.traverse((o) => {
  if (o.isMesh && o !== floor) {
    o.castShadow = true;
    o.receiveShadow = true;
  }
});

/* ---------- explode / x-ray / internals ---------- */
function explodeOffset(def, amount = state.explode / 100) {
  return def.explodeDir.clone().multiplyScalar(amount * def.explodeDist);
}

function applyExplode() {
  const amount = state.explode / 100;
  for (const def of parts.values()) {
    const off = explodeOffset(def, amount);
    def.group.position.copy(def.base).add(off);
    def.group.quaternion.copy(def.restQuat);
    def.group.scale.copy(def.restScale);
  }
}

function setXray(on) {
  state.xray = on;
  for (const def of parts.values()) {
    if (def.internals || !def.xrayFriendly) continue;
    for (const m of def.materials) {
      if (!m || m.map && def.id === 'nameplate') continue;
      m.transparent = on ? true : def.opacity < 1;
      m.opacity = on ? Math.min(0.16, def.opacity) : def.opacity;
      m.needsUpdate = true;
    }
  }
  document.getElementById('btnXray').classList.toggle('active', on);
}

function setInternals(on) {
  state.showInternals = on;
  internals.visible = on;
  document.getElementById('btnInternals').classList.toggle('active', on);
}

/* ---------- selection ---------- */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function pick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  for (const h of hits) {
    const id = h.object.userData.partId;
    if (id && parts.has(id)) return parts.get(id);
  }
  return null;
}

function highlight(def, on) {
  for (const m of def.materials) {
    m.emissive = on ? new THREE.Color(0x123f5e) : new THREE.Color(0x000000);
    m.emissiveIntensity = on ? 0.55 : 0;
  }
}

function select(def) {
  if (state.selected) highlight(state.selected, false);
  state.selected = def;
  if (def) {
    highlight(def, true);
    tc.attach(def.group);
    setStatus(`${def.label} selected — use the gizmo or the inspector`);
  } else {
    tc.detach();
    setStatus('Click a component to select it');
  }
  buildPanel(def);
}

/* ---------- transform sync ---------- */
function syncFromGroup(def) {
  const off = explodeOffset(def);
  def.base.copy(def.group.position).sub(off);
  def.restQuat.copy(def.group.quaternion);
  def.restScale.copy(def.group.scale);
}

/* ---------- inspector panel ---------- */
const panelBody = document.getElementById('panelBody');
const panelTitle = document.getElementById('panelTitle');
let panelDef = null;

function row(label, controlEl, valueEl) {
  const r = document.createElement('div');
  r.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  r.appendChild(l);
  r.appendChild(controlEl);
  if (valueEl) r.appendChild(valueEl);
  return r;
}

function sliderControl(min, max, step, value) {
  const i = document.createElement('input');
  i.type = 'range';
  i.min = min;
  i.max = max;
  i.step = step;
  i.value = value;
  return i;
}

function sliderRow(label, min, max, step, value, fmt, onInput) {
  const input = sliderControl(min, max, step, value);
  const val = document.createElement('span');
  val.className = 'rv';
  val.textContent = fmt(value);
  const wrap = row(label, input, val);
  input.addEventListener('input', () => {
    val.textContent = fmt(parseFloat(input.value));
    onInput(parseFloat(input.value));
  });
  return { wrap, input, val };
}

function buildPanel(def) {
  panelBody.innerHTML = '';
  panelDef = def;
  if (!def) {
    panelTitle.textContent = 'Component Inspector';
    const p1 = document.createElement('p');
    p1.className = 'muted';
    p1.innerHTML = 'Click any part of the transformer to select it. Use the <b>Move / Rotate / Scale</b> tools or drag the arrows to edit.';
    const p2 = document.createElement('p');
    p2.className = 'muted';
    p2.innerHTML = 'Tip: turn on <b>X-ray</b> and <b>Internals</b> to see the core and windings inside the tank.';
    panelBody.appendChild(p1);
    panelBody.appendChild(p2);
    return;
  }

  panelTitle.textContent = def.label;

  const head = document.createElement('div');
  head.className = 'part-title';
  const h = document.createElement('h3');
  h.textContent = def.label;
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = def.type;
  head.appendChild(h);
  head.appendChild(chip);
  panelBody.appendChild(head);

  const desc = document.createElement('p');
  desc.className = 'part-desc';
  desc.textContent = def.desc || '';
  panelBody.appendChild(desc);

  /* position */
  if (def.movable) {
    const g = document.createElement('div');
    g.className = 'prop-group';
    const t = document.createElement('div');
    t.className = 'g-title';
    t.textContent = 'Position';
    g.appendChild(t);
    const axes = [
      { k: 'x', min: -8, max: 8 },
      { k: 'y', min: -4, max: 10 },
      { k: 'z', min: -8, max: 8 },
    ];
    const posRefs = {};
    for (const a of axes) {
      const sr = sliderRow(a.k.toUpperCase(), a.min, a.max, 0.05,
        def.group.position[a.k], (v) => v.toFixed(2), (v) => {
          def.base[a.k] = v - explodeOffset(def)[a.k];
          def.group.position[a.k] = v;
          scheduleSave();
        });
      g.appendChild(sr.wrap);
      posRefs[a.k] = sr;
    }
    panelBody.appendChild(g);
    def._panel = { posRefs };
  }

  /* rotation */
  if (def.rotatable) {
    const g = document.createElement('div');
    g.className = 'prop-group';
    const t = document.createElement('div');
    t.className = 'g-title';
    t.textContent = 'Rotation (Y-axis)';
    g.appendChild(t);
    const deg = THREE.MathUtils.radToDeg(def.group.rotation.y);
    const sr = sliderRow('DEG', 0, 360, 1, deg, (v) => `${v}°`, (v) => {
      def.group.rotation.set(0, THREE.MathUtils.degToRad(v), 0);
      def.restQuat.copy(def.group.quaternion);
      scheduleSave();
    });
    g.appendChild(sr.wrap);
    panelBody.appendChild(g);
    def._panel = def._panel || {};
    def._panel.rotRef = sr;
  }

  /* scale */
  if (def.scalable) {
    const g = document.createElement('div');
    g.className = 'prop-group';
    const t = document.createElement('div');
    t.className = 'g-title';
    t.textContent = 'Scale';
    g.appendChild(t);
    const sr = sliderRow('SCALE', 0.5, 3, 0.05, def.group.scale.x, (v) => `${v.toFixed(2)}×`, (v) => {
      def.group.scale.set(v, v, v);
      def.restScale.copy(def.group.scale);
      scheduleSave();
    });
    g.appendChild(sr.wrap);
    panelBody.appendChild(g);
    def._panel = def._panel || {};
    def._panel.scaleRef = sr;
  }

  /* colour & opacity */
  if (def.colorable || def.materials.length) {
    const g = document.createElement('div');
    g.className = 'prop-group';
    const t = document.createElement('div');
    t.className = 'g-title';
    t.textContent = 'Appearance';
    g.appendChild(t);

    if (def.colorable) {
      const ci = document.createElement('input');
      ci.type = 'color';
      ci.value = '#' + def.materials[0].color.getHexString();
      ci.addEventListener('input', () => {
        for (const m of def.materials) m.color.set(ci.value);
        scheduleSave();
      });
      g.appendChild(row('Colour', ci));
    }

    const osr = sliderRow('Opacity', 0.1, 1, 0.05, def.opacity ?? 1, (v) => v.toFixed(2), (v) => {
      def.opacity = v;
      for (const m of def.materials) {
        m.transparent = v < 1 || state.xray;
        m.opacity = state.xray ? Math.min(0.16, v) : v;
        m.needsUpdate = true;
      }
      scheduleSave();
    });
    g.appendChild(osr.wrap);
    panelBody.appendChild(g);
    def._panel = def._panel || {};
    def._panel.opacityRef = osr;
  }

  /* visibility */
  if (def.hideable) {
    const g = document.createElement('div');
    g.className = 'prop-group';
    const r = document.createElement('label');
    r.className = 'row check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !def.hidden;
    cb.addEventListener('change', () => {
      def.hidden = !cb.checked;
      def.group.visible = cb.checked && !(def.internals && !state.showInternals);
      scheduleSave();
    });
    r.appendChild(cb);
    const s = document.createElement('span');
    s.textContent = 'Visible in scene';
    r.appendChild(s);
    g.appendChild(r);
    panelBody.appendChild(g);
    def._panel = def._panel || {};
    def._panel.visRef = { cb };
  }

  /* buttons */
  const g = document.createElement('div');
  g.className = 'prop-group';
  const br = document.createElement('div');
  br.className = 'btn-row';
  const rb = document.createElement('button');
  rb.className = 'btn';
  rb.textContent = 'Reset part';
  rb.addEventListener('click', () => resetPart(def));
  const dh = document.createElement('button');
  dh.className = 'btn danger';
  dh.textContent = 'Deselect';
  dh.addEventListener('click', () => select(null));
  br.appendChild(rb);
  br.appendChild(dh);
  g.appendChild(br);
  panelBody.appendChild(g);

  const help = document.createElement('div');
  help.className = 'help-box';
  help.innerHTML = '<b>How to use</b><br>Drag the gizmo arrows to move, or switch to Rotate / Scale.<br><b>Mouse:</b> left-drag on empty space to orbit.<br><b>Touch:</b> drag with one finger to orbit, pinch to zoom.';
  panelBody.appendChild(help);
}

function refreshPanel() {
  const def = panelDef;
  if (!def || !def._panel) return;
  if (def._panel.posRefs) {
    for (const k of ['x', 'y', 'z']) {
      const ref = def._panel.posRefs[k];
      ref.input.value = def.group.position[k];
      ref.val.textContent = def.group.position[k].toFixed(2);
    }
  }
  if (def._panel.rotRef) {
    const deg = THREE.MathUtils.radToDeg(def.group.rotation.y);
    def._panel.rotRef.input.value = deg;
    def._panel.rotRef.val.textContent = `${deg}°`;
  }
  if (def._panel.scaleRef) {
    def._panel.scaleRef.input.value = def.group.scale.x;
    def._panel.scaleRef.val.textContent = `${def.group.scale.x.toFixed(2)}×`;
  }
}

function resetPart(def) {
  const d = def.default;
  def.base.copy(d.base);
  def.restQuat.copy(d.quat);
  def.restScale.copy(d.scale);
  def.opacity = d.opacity;
  def.hidden = d.hidden;
  for (const m of def.materials) {
    m.color.set(d.color);
    m.opacity = d.opacity;
    m.transparent = d.opacity < 1;
  }
  applyExplode();
  if (state.selected === def) {
    select(def);
  } else {
    buildPanel(null);
  }
  scheduleSave();
}

/* capture defaults once */
for (const def of parts.values()) {
  const m = def.materials.find((x) => x && x.color);
  def.opacity = def.opacity ?? 1;
  def.default = {
    base: def.base.clone(),
    quat: def.restQuat.clone(),
    scale: def.restScale.clone(),
    color: m ? '#' + m.color.getHexString() : '#ffffff',
    opacity: def.opacity,
    hidden: def.hidden,
  };
}

/* ---------- save / load ---------- */
function serialize() {
  const out = {
    version: 1,
    settings: { explode: state.explode, xray: state.xray, showInternals: state.showInternals, load: state.load },
    parts: {},
  };
  for (const [id, def] of parts) {
    const m = def.materials.find((x) => x && x.color);
    out.parts[id] = {
      p: [def.base.x, def.base.y, def.base.z],
      q: [def.restQuat.x, def.restQuat.y, def.restQuat.z, def.restQuat.w],
      s: [def.restScale.x, def.restScale.y, def.restScale.z],
      c: m ? '#' + m.color.getHexString() : null,
      o: def.opacity,
      h: def.hidden,
    };
  }
  return JSON.stringify(out, null, 2);
}

function applySaved(data) {
  try {
    state.explode = clamp(data.settings.explode, 0, 100);
    state.load = clamp(data.settings.load, 0, 100);
    document.getElementById('explodeSlider').value = state.explode;
    document.getElementById('loadSlider').value = state.load;
    for (const [id, p] of Object.entries(data.parts || {})) {
      const def = parts.get(id);
      if (!def) continue;
      if (p.p) def.base.fromArray(p.p);
      if (p.q) def.restQuat.fromArray(p.q);
      if (p.s) def.restScale.fromArray(p.s);
      if (typeof p.o === 'number') def.opacity = p.o;
      if (typeof p.h === 'boolean') def.hidden = p.h;
      if (p.c) for (const m of def.materials) if (m && m.color) m.color.set(p.c);
    }
    setXray(!!data.settings.xray);
    setInternals(!!data.settings.showInternals);
    applyExplode();
    refreshAllOpacities();
    if (state.selected) refreshPanel();
    setStatus('Scene loaded');
  } catch (err) {
    setStatus('Failed to load scene');
    console.error(err);
  }
}

function refreshAllOpacities() {
  for (const def of parts.values()) {
    for (const m of def.materials) {
      m.opacity = state.xray && def.xrayFriendly && !def.internals ? Math.min(0.16, def.opacity) : def.opacity;
      m.transparent = m.opacity < 1;
      m.needsUpdate = true;
    }
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, serialize()); } catch (e) { /* ignore */ }
  }, 300);
}

function download(content, filename, type) {
  const blob = new Blob([content], { type: type || 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- status / gauges ---------- */
function setStatus(text) {
  document.getElementById('statusText').textContent = text;
}

function updateGauges() {
  const load = state.load;
  const temp = 40 + load * 0.55;
  const g = parts.get('gauge');
  if (g && g.needle) {
    g.needle.rotation.z = -Math.PI / 2 + (load / 100) * Math.PI;
  }
  document.getElementById('loadVal').textContent = `${Math.round(load)}%`;
  document.getElementById('oilTemp').textContent = `Oil ${Math.round(temp)}°C`;
}

/* ---------- toolbar wiring ---------- */
document.querySelectorAll('#modeGroup .tb-btn').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#modeGroup .tb-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    state.mode = b.dataset.mode;
    tc.setMode(state.mode);
  });
});

document.getElementById('explodeSlider').addEventListener('input', (e) => {
  state.explode = parseFloat(e.target.value);
  if (state.selected) {
    syncFromGroup(state.selected);
  }
  applyExplode();
  refreshPanel();
  scheduleSave();
});

document.getElementById('loadSlider').addEventListener('input', (e) => {
  state.load = parseFloat(e.target.value);
  updateGauges();
  scheduleSave();
});

document.getElementById('btnXray').addEventListener('click', () => setXray(!state.xray));
document.getElementById('btnInternals').addEventListener('click', () => setInternals(!state.showInternals));

document.getElementById('btnResetView').addEventListener('click', () => {
  camera.position.set(9.5, 6.5, 10.5);
  controls.target.set(0, 2.2, 0);
  controls.update();
});

document.getElementById('btnReset').addEventListener('click', () => {
  for (const def of parts.values()) resetPart(def);
  state.explode = 0;
  document.getElementById('explodeSlider').value = 0;
  setXray(false);
  setInternals(false);
  applyExplode();
  select(null);
  scheduleSave();
  setStatus('Transformer reset to factory layout');
});

document.getElementById('btnSave').addEventListener('click', () => {
  download(serialize(), 'transformer-scene.json', 'application/json');
  setStatus('Scene saved to transformer-scene.json');
});

document.getElementById('btnLoad').addEventListener('click', () => document.getElementById('fileInput').click());
document.getElementById('fileInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try { applySaved(JSON.parse(r.result)); } catch { setStatus('Invalid JSON file'); }
  };
  r.readAsText(f);
  e.target.value = '';
});

document.getElementById('btnShot').addEventListener('click', () => {
  download(renderer.domElement.toDataURL('image/png'), 'transformer-simulator.png', 'image/png');
  setStatus('Screenshot saved');
});

/* ---------- picking ---------- */
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (state.dragging) return;
  const def = pick(e);
  if (def) select(def);
});

/* ---------- panel collapse ---------- */
const panel = document.getElementById('panel');
document.getElementById('btnClosePanel').addEventListener('click', () => panel.classList.add('collapsed'));
document.getElementById('btnPanelToggle').addEventListener('click', () => panel.classList.toggle('collapsed'));

/* ---------- resize ---------- */
function onResize() {
  const w = container.clientWidth, h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);

/* ---------- main loop ---------- */
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  updateGauges();
  renderer.render(scene, camera);
}

/* ---------- boot ---------- */
setXray(false);
setInternals(false);
applyExplode();
updateGauges();
onResize();

try {
  const saved = localStorage.getItem(LS_KEY);
  if (saved) applySaved(JSON.parse(saved));
} catch (e) { /* ignore corrupted autosave */ }

/* restore autosaved selection is not kept; that's fine */
setStatus('Ready — click a component to select it');
document.body.dataset.booted = '1';
animate();

/* ---------- analytics ---------- */
const track = (name, params) => {
  if (window.EduLift) window.EduLift.track(name, Object.assign({ simulator: 'transformer-lab' }, params || {}));
};

track('simulator_opened');

const completionTracked = { save: false, shot: false };
document.getElementById('btnSave').addEventListener('click', () => {
  if (!completionTracked.save) { track('simulator_completed', { via: 'save' }); completionTracked.save = true; }
});
document.getElementById('btnShot').addEventListener('click', () => {
  if (!completionTracked.shot) { track('simulator_completed', { via: 'screenshot' }); completionTracked.shot = true; }
});
document.getElementById('btnLoad').addEventListener('click', () => track('scene_loaded'));
document.getElementById('btnReset').addEventListener('click', () => track('simulator_reset'));
document.getElementById('btnXray').addEventListener('click', () => track('view_toggled', { view: 'xray' }));
document.getElementById('btnInternals').addEventListener('click', () => track('view_toggled', { view: 'internals' }));

document.querySelectorAll('#notes .note h3').forEach((h3) => {
  h3.addEventListener('click', () => track('note_opened', { note: h3.textContent }));
});
