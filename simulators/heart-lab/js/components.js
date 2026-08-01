import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 *  Building blocks for the 3D circulatory system.
 *  Heart (4 chambers + 4 valves + coronary arteries), great vessels,
 *  lungs, capillary beds and the blood-flow path curves.
 * ------------------------------------------------------------------ */

const C = {
  muscle: 0xc9262f,
  muscleDark: 0x9c1e27,
  arterial: 0xd63a3a,
  arterialBright: 0xe14b4b,
  venous: 0x2f6bc4,
  mixed: 0x7a4fd0,
  lung: 0xf0a0b0,
  chamberOx: 0xc22c35,
  chamberDeox: 0x3a4fa8,
  septum: 0xb07d8a,
  valveRing: 0xd9cfc0,
  valveFlap: 0xe8c9c0,
  cap: 0xc4588a,
  body: 0x7f8b99,
};

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: opts.metalness ?? 0.12,
    roughness: opts.roughness ?? 0.55,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
}

function mesh(geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], parent = null) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  if (rot[0]) m.rotation.x = rot[0];
  if (rot[1]) m.rotation.y = rot[1];
  if (rot[2]) m.rotation.z = rot[2];
  if (parent) parent.add(m);
  return m;
}

/* A blood vessel built as a tube along a smooth curve. */
function tube(points, radius, mat, tubularSegments = 48, radialSegments = 10) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const geo = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
  const m = new THREE.Mesh(geo, mat);
  return { mesh: m, curve };
}

/* ------------------------------------------------------------------ */

export function buildBody(scene) {
  const parts = new Map();
  const flowCurves = [];

  function register(cfg) {
    const def = Object.assign({
      base: new THREE.Vector3(),
      restQuat: new THREE.Quaternion(),
      restScale: new THREE.Vector3(1, 1, 1),
      explodeDir: new THREE.Vector3(0, 1, 0),
      explodeDist: 0,
      materials: [],
      movable: true,
      rotatable: true,
      scalable: true,
      colorable: true,
      hideable: true,
      hidden: false,
      internals: false,
      xrayFriendly: true,
    }, cfg);
    if (!def.group) def.group = new THREE.Group();
    def.group.position.copy(def.base);
    def.group.quaternion.copy(def.restQuat);
    def.group.scale.copy(def.restScale);
    def.group.visible = !def.hidden;
    scene.add(def.group);
    parts.set(def.id, def);
    return def;
  }

  /* helper: register a vessel part from multiple tube segments */
  function addVessel(def, segments, mat, kind) {
    const mats = [];
    for (const seg of segments) {
      const { mesh: m, curve } = tube(seg.pts, seg.r, mat);
      def.group.add(m);
      mats.push(mat);
      if (kind) flowCurves.push({ curve, kind, id: def.id });
    }
    def.materials = mats;
  }

  /* ---------------- HEART SHELL ---------------- */

  const heartDef = register({
    id: 'heart',
    label: 'Heart',
    type: 'pump',
    desc: 'The muscular pump. Two atria receive blood, two ventricles push it out through the pulmonary and systemic circuits.',
    base: new THREE.Vector3(0, 0, 0),
    explodeDir: new THREE.Vector3(0, 0, 0),
    movable: true,
    materials: [],
  });
  const muscleMat = std(C.muscle, { metalness: 0.1, roughness: 0.5 });
  const pulse = new THREE.Group();
  pulse.name = 'pulse';
  heartDef.group.add(pulse);

  /* ventricle mass */
  const vBody = mesh(new THREE.SphereGeometry(0.62, 32, 24), muscleMat, [-0.02, -0.18, 0.05], [0, 0, 0.18], pulse);
  vBody.scale.set(1.05, 1.18, 0.85);
  /* atria lobes */
  const la = mesh(new THREE.SphereGeometry(0.34, 24, 18), muscleMat, [-0.32, 0.44, -0.10], [0, 0, 0], pulse);
  la.scale.set(0.9, 0.75, 0.95);
  const ra = la.clone();
  ra.position.set(0.32, 0.44, -0.10);
  ra.scale.set(0.9, 0.78, 0.95);
  pulse.add(ra);
  /* apex */
  const apex = mesh(new THREE.ConeGeometry(0.22, 0.5, 20), muscleMat, [-0.16, -0.8, 0.12], [0, 0.3, -0.5], pulse);
  /* coronary groove hint */
  const grooveMat = std(C.muscleDark, { metalness: 0.1, roughness: 0.6 });
  mesh(new THREE.TorusGeometry(0.42, 0.05, 10, 28), grooveMat, [0, 0.05, -0.02], [Math.PI / 2, 0, 0], pulse);
  /* vessel stubs so connections look attached */
  const stubMat = std(C.arterial, { metalness: 0.2, roughness: 0.5 });
  mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.32, 16), stubMat, [0, 0.62, 0.22], [0.25, 0, 0], pulse);
  const pStub = std(C.mixed, { metalness: 0.2, roughness: 0.5 });
  mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.28, 16), pStub, [0.08, 0.6, 0.05], [0.45, 0, 0.2], pulse);
  heartDef.materials = [muscleMat, grooveMat, stubMat, pStub];

  /* ---------------- HEART CHAMBERS (internals) ---------------- */

  const internals = new THREE.Group();
  internals.name = 'internals';
  internals.visible = false;
  scene.add(internals);

  function registerInternal(cfg) {
    const def = register(cfg);
    scene.remove(def.group);
    internals.add(def.group);
    return def;
  }

  const oxMat = std(C.chamberOx, { transparent: true, opacity: 0.72, roughness: 0.4 });
  const deoxMat = std(C.chamberDeox, { transparent: true, opacity: 0.72, roughness: 0.4 });

  const raDef = registerInternal({
    id: 'ra',
    label: 'Right Atrium',
    type: 'chamber',
    desc: 'Receives deoxygenated blood from the superior and inferior vena cava and pushes it into the right ventricle.',
    base: new THREE.Vector3(0.34, 0.42, -0.05),
    explodeDir: new THREE.Vector3(1, 1, 0.3),
    explodeDist: 0.9,
    internals: true,
    materials: [],
  });
  const raM = mesh(new THREE.SphereGeometry(0.22, 20, 14), deoxMat, [0, 0, 0], [0, 0, 0], raDef.group);
  raM.scale.set(0.9, 0.85, 0.9);
  raDef.materials = [deoxMat];

  const rvDef = registerInternal({
    id: 'rv',
    label: 'Right Ventricle',
    type: 'chamber',
    desc: 'Pumps deoxygenated blood through the pulmonary valve into the pulmonary arteries, to the lungs for oxygenation.',
    base: new THREE.Vector3(0.28, -0.3, 0.1),
    explodeDir: new THREE.Vector3(1, -1, 0.3),
    explodeDist: 0.9,
    internals: true,
    materials: [],
  });
  const rvM = mesh(new THREE.SphereGeometry(0.27, 22, 16), deoxMat, [0, 0, 0], [0, 0, 0.15], rvDef.group);
  rvM.scale.set(0.95, 1.2, 0.9);
  rvDef.materials = [deoxMat];

  const laDef = registerInternal({
    id: 'la',
    label: 'Left Atrium',
    type: 'chamber',
    desc: 'Receives oxygenated blood from the four pulmonary veins and delivers it to the left ventricle through the mitral valve.',
    base: new THREE.Vector3(-0.34, 0.42, -0.05),
    explodeDir: new THREE.Vector3(-1, 1, 0.3),
    explodeDist: 0.9,
    internals: true,
    materials: [],
  });
  const laM = mesh(new THREE.SphereGeometry(0.22, 20, 14), oxMat, [0, 0, 0], [0, 0, 0], laDef.group);
  laM.scale.set(0.9, 0.85, 0.9);
  laDef.materials = [oxMat];

  const lvDef = registerInternal({
    id: 'lv',
    label: 'Left Ventricle',
    type: 'chamber',
    desc: 'The strongest chamber. Pumps oxygenated blood through the aortic valve into the aorta, then the whole body.',
    base: new THREE.Vector3(-0.3, -0.32, 0.1),
    explodeDir: new THREE.Vector3(-1, -1, 0.3),
    explodeDist: 0.9,
    internals: true,
    materials: [],
  });
  const lvM = mesh(new THREE.SphereGeometry(0.28, 22, 16), oxMat, [0, 0, 0], [0, 0, -0.15], lvDef.group);
  lvM.scale.set(0.95, 1.25, 0.9);
  lvDef.materials = [oxMat];

  const septumDef = registerInternal({
    id: 'septum',
    label: 'Interventricular Septum',
    type: 'chamber',
    desc: 'The muscular wall dividing the right and left sides of the heart so oxygenated and deoxygenated blood never mix.',
    base: new THREE.Vector3(0, -0.05, 0.1),
    explodeDir: new THREE.Vector3(0, 0, 1),
    explodeDist: 0.8,
    internals: true,
    materials: [],
  });
  const septumMat = std(C.septum, { roughness: 0.7 });
  mesh(new THREE.BoxGeometry(0.1, 0.9, 0.62), septumMat, [0, 0, 0], [0, 0, 0.12], septumDef.group);
  septumDef.materials = [septumMat];

  /* ---------------- HEART VALVES ---------------- */

  function makeValve(r) {
    const g = new THREE.Group();
    const ringMat = std(C.valveRing, { metalness: 0.4, roughness: 0.4 });
    const flapMat = std(C.valveFlap, { metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide });
    const ring = mesh(new THREE.TorusGeometry(r, 0.026, 10, 30), ringMat, [0, 0, 0], [0, 0, 0], g);
    const flaps = [];
    for (let k = 0; k < 3; k++) {
      const angle = (k * Math.PI * 2) / 3 + Math.PI / 6;
      const hinge = new THREE.Group();
      hinge.rotation.z = angle;
      const flap = mesh(new THREE.BoxGeometry(0.02, r * 0.72, r * 0.34), flapMat, [r * 0.46, 0, 0], [0, 0, 0], hinge);
      hinge.add(flap);
      g.add(hinge);
      flaps.push(flap);
    }
    return { group: g, flaps, ring };
  }

  function addValve(id, label, desc, pos, rot, systoleOpen) {
    const def = register({
      id, label,
      type: 'valve',
      desc,
      base: new THREE.Vector3(pos[0], pos[1], pos[2]),
      explodeDir: new THREE.Vector3(0, 0, 1),
      explodeDist: 0.5,
      systoleOpen: !!systoleOpen,
      materials: [],
    });
    const { group: vg, flaps, ring } = makeValve(0.16);
    vg.rotation.set(rot[0], rot[1], rot[2]);
    def.group.add(vg);
    def.valveFlaps = flaps;
    def.materials = [];
    vg.traverse((o) => { if (o.isMesh) def.materials.push(o.material); });
    return def;
  }

  addValve('valve_aortic', 'Aortic Valve', 'Between the left ventricle and the aorta. Opens during systole so oxygenated blood leaves the heart.',
    [0.02, 0.08, 0.32], [0.15, 0, 0], true);
  addValve('valve_pulmonary', 'Pulmonary Valve', 'Between the right ventricle and the pulmonary trunk. Opens during systole to send blood to the lungs.',
    [0.1, 0.1, 0.22], [0.4, 0, 0.15], true);
  addValve('valve_mitral', 'Mitral Valve', 'Between the left atrium and left ventricle. Two leaflets; opens during diastole.',
    [-0.24, 0.16, 0.12], [0.1, 0, 0], false);
  addValve('valve_tricuspid', 'Tricuspid Valve', 'Between the right atrium and right ventricle. Three leaflets; opens during diastole.',
    [0.26, 0.16, 0.1], [0.1, 0, 0], false);

  /* ---------------- GREAT VESSELS ---------------- */

  const aortaDef = register({
    id: 'aorta',
    label: 'Aorta',
    type: 'artery',
    desc: 'The largest artery. Ascending aorta arches over the heart and descends, distributing oxygenated blood to the whole body.',
    base: new THREE.Vector3(0, 0, 0),
    explodeDir: new THREE.Vector3(0.4, 0.9, -0.3),
    explodeDist: 1.4,
    materials: [],
  });
  addVessel(aortaDef, [
    { pts: [[0, -0.25, 0.3], [0.05, 0.25, 0.28], [0.2, 0.6, 0.18], [0.42, 0.85, 0.05]], r: 0.17 },
    { pts: [[0.42, 0.85, 0.05], [0.52, 0.98, -0.1], [0.42, 1.02, -0.32], [0.15, 1.0, -0.48], [-0.2, 0.92, -0.55], [-0.55, 0.72, -0.55], [-0.8, 0.45, -0.55]], r: 0.15 },
    { pts: [[-0.8, 0.45, -0.55], [-0.95, 0.0, -0.55], [-1.05, -0.7, -0.55], [-1.1, -1.4, -0.55], [-1.12, -2.0, -0.55]], r: 0.14 },
    { pts: [[-1.12, -2.0, -0.55], [-0.6, -2.55, -0.4]], r: 0.09 },
    { pts: [[-1.12, -2.0, -0.55], [-1.75, -2.55, -0.55]], r: 0.09 },
  ], std(C.arterial, { metalness: 0.15, roughness: 0.45 }), 'artery');

  const carotidDef = register({
    id: 'carotids',
    label: 'Carotid Arteries',
    type: 'artery',
    desc: 'Bring oxygenated blood up through the neck to the head and brain.',
    base: new THREE.Vector3(0, 0, 0),
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 1.3,
    materials: [],
  });
  addVessel(carotidDef, [
    { pts: [[0.3, 1.0, -0.25], [0.4, 1.45, -0.2], [0.45, 1.9, -0.15]], r: 0.06 },
    { pts: [[-0.3, 0.95, -0.5], [-0.35, 1.4, -0.45], [-0.38, 1.9, -0.4]], r: 0.06 },
  ], std(C.arterial, { metalness: 0.15, roughness: 0.45 }), 'artery');

  const subclavianDef = register({
    id: 'subclavian',
    label: 'Subclavian Arteries',
    type: 'artery',
    desc: 'Deliver oxygenated blood to the shoulders, arms and chest wall.',
    base: new THREE.Vector3(0, 0, 0),
    explodeDir: new THREE.Vector3(1, 0.3, 0),
    explodeDist: 1.3,
    materials: [],
  });
  addVessel(subclavianDef, [
    { pts: [[0.42, 0.9, 0.0], [0.9, 0.95, 0.1], [1.4, 0.98, 0.2]], r: 0.07 },
    { pts: [[-0.55, 0.8, -0.5], [-1.05, 0.85, -0.4], [-1.5, 0.9, -0.3]], r: 0.07 },
  ], std(C.arterial, { metalness: 0.15, roughness: 0.45 }), 'artery');

  const pulmArtDef = register({
    id: 'pulmonary_artery',
    label: 'Pulmonary Arteries',
    type: 'artery',
    desc: 'Carry deoxygenated blood from the right ventricle to the lungs, where CO\u2082 is released and O\u2082 is picked up.',
    base: new THREE.Vector3(0, 0, 0),
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 1.3,
    materials: [],
  });
  addVessel(pulmArtDef, [
    { pts: [[0, -0.25, 0.2], [0, 0.15, 0.18], [0, 0.42, 0.12]], r: 0.15 },
    { pts: [[0, 0.42, 0.12], [-0.6, 0.55, 0.12], [-1.3, 0.6, 0.1], [-1.9, 0.55, 0.05]], r: 0.11 },
    { pts: [[0, 0.42, 0.12], [0.6, 0.55, 0.12], [1.3, 0.6, 0.1], [1.9, 0.55, 0.05]], r: 0.11 },
  ], std(C.mixed, { metalness: 0.15, roughness: 0.45 }), 'vein');

  const pulmVeinDef = register({
    id: 'pulmonary_veins',
    label: 'Pulmonary Veins',
    type: 'vein',
    desc: 'Return freshly oxygenated blood from the lungs to the left atrium.',
    base: new THREE.Vector3(0, 0, 0),
    explodeDir: new THREE.Vector3(1, 0, 0),
    explodeDist: 1.2,
    materials: [],
  });
  addVessel(pulmVeinDef, [
    { pts: [[-1.9, 0.12, 0.0], [-1.3, 0.05, -0.05], [-0.7, 0.1, -0.08], [-0.28, 0.3, -0.15]], r: 0.1 },
    { pts: [[1.9, 0.12, 0.0], [1.3, 0.05, -0.05], [0.7, 0.1, -0.08], [0.28, 0.3, -0.15]], r: 0.1 },
  ], std(C.arterial, { metalness: 0.15, roughness: 0.45 }), 'artery');

  const svcDef = register({
    id: 'svc',
    label: 'Superior Vena Cava',
    type: 'vein',
    desc: 'Returns deoxygenated blood from the head, neck and arms to the right atrium.',
    base: new THREE.Vector3(0, 0, 0),
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 1.3,
    materials: [],
  });
  addVessel(svcDef, [
    { pts: [[0, 2.1, -0.35], [0, 1.5, -0.35], [0, 0.9, -0.32], [0, 0.5, -0.3]], r: 0.12 },
  ], std(C.venous, { metalness: 0.15, roughness: 0.45 }), 'vein');

  const ivcDef = register({
    id: 'ivc',
    label: 'Inferior Vena Cava',
    type: 'vein',
    desc: 'The largest vein. Returns deoxygenated blood from the lower body and legs to the right atrium.',
    base: new THREE.Vector3(0, 0, 0),
    explodeDir: new THREE.Vector3(0, -1, 0),
    explodeDist: 1.3,
    materials: [],
  });
  addVessel(ivcDef, [
    { pts: [[0, -2.3, -0.2], [0, -1.5, -0.25], [0, -0.6, -0.3], [0, 0.1, -0.32]], r: 0.13 },
    { pts: [[0, -2.3, -0.2], [-0.7, -2.5, -0.2]], r: 0.08 },
    { pts: [[0, -2.3, -0.2], [0.7, -2.5, -0.2]], r: 0.08 },
  ], std(C.venous, { metalness: 0.15, roughness: 0.45 }), 'vein');

  const coronaryDef = register({
    id: 'coronary',
    label: 'Coronary Arteries',
    type: 'artery',
    desc: 'Wrap around the heart surface and supply the heart muscle itself with oxygenated blood.',
    base: new THREE.Vector3(0, 0, 0),
    explodeDir: new THREE.Vector3(0, 0, 1),
    explodeDist: 0.8,
    materials: [],
  });
  addVessel(coronaryDef, [
    { pts: [[0.12, 0.35, 0.3], [0.35, 0.15, 0.28], [0.48, -0.15, 0.18], [0.5, -0.45, 0.05]], r: 0.035 },
    { pts: [[-0.05, 0.4, 0.25], [0.02, 0.1, 0.38], [-0.04, -0.3, 0.42], [-0.12, -0.65, 0.35]], r: 0.035 },
  ], std(C.arterialBright, { metalness: 0.2, roughness: 0.4 }), 'artery');

  /* ---------------- LUNGS & CAPILLARIES ---------------- */

  function makeLung(id, label, pos, scale) {
    const def = register({
      id, label,
      type: 'lung',
      desc: 'Where gas exchange happens. Deoxygenated blood enters via the pulmonary arteries and leaves fully oxygenated.',
      base: new THREE.Vector3(pos[0], pos[1], pos[2]),
      explodeDir: new THREE.Vector3(pos[0] > 0 ? 1 : -1, 0, 0),
      explodeDist: 1.6,
      materials: [],
    });
    const mat = std(C.lung, { transparent: true, opacity: 0.5, roughness: 0.7, side: THREE.DoubleSide });
    const lobe = mesh(new THREE.SphereGeometry(0.7, 24, 18), mat, [0, 0.1, 0], [0, 0, 0.15], def.group);
    lobe.scale.set(scale[0], scale[1], scale[2]);
    const lobe2 = mesh(new THREE.SphereGeometry(0.45, 20, 14), mat, [0, -0.5, 0.05], [0, 0, 0.15], def.group);
    lobe2.scale.set(scale[0] * 0.8, scale[1] * 0.55, scale[2] * 0.8);
    def.materials = [mat];
    return def;
  }
  makeLung('lung_left', 'Left Lung', [-2.35, 0.1, 0.0], [0.78, 1.0, 0.55]);
  makeLung('lung_right', 'Right Lung', [2.35, 0.1, 0.0], [0.82, 1.0, 0.6]);

  function makeCapillaries(id, label, x, desc) {
    const def = register({
      id, label,
      type: 'capillary',
      desc,
      base: new THREE.Vector3(x, 0.35, 0.0),
      explodeDir: new THREE.Vector3(x > 0 ? 1 : -1, 0, 0),
      explodeDist: 1.4,
      materials: [],
    });
    const capMat = std(C.cap, { metalness: 0.1, roughness: 0.5 });
    for (let k = 0; k < 7; k++) {
      const dirX = x > 0 ? -0.35 : 0.35;
      const pts = [
        [0, 0, 0],
        [dirX * 0.5, 0.25 - k * 0.06, 0.1 * Math.sin(k)],
        [dirX, 0.15 + Math.sin(k * 1.7) * 0.25, 0.15 * Math.cos(k * 2.1)],
      ];
      const seg = tube(pts, 0.022, capMat, 24, 6);
      def.group.add(seg.mesh);
      def.materials.push(capMat);
    }
    return def;
  }
  makeCapillaries('capillaries_l', 'Capillary Bed (Left Lung)', -1.75,
    'Tiny vessels surrounding the air sacs where oxygen and carbon dioxide are exchanged.');
  makeCapillaries('capillaries_r', 'Capillary Bed (Right Lung)', 1.75,
    'Tiny vessels surrounding the air sacs where oxygen and carbon dioxide are exchanged.');

  /* expose every part to raycasting now that all meshes exist */
  for (const def of parts.values()) {
    def.group.traverse((o) => { if (o.isMesh) o.userData.partId = def.id; });
  }

  return { parts, internals, pulse, flowCurves };
}
