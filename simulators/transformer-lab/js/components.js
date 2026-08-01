import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 *  Building blocks for the 3D power transformer.
 *  Every "part" is a THREE.Group registered in the `parts` map with
 *  metadata used by the app for selection, editing and save/load.
 * ------------------------------------------------------------------ */

const P = {
  tank: 0x4c5d70,
  lid: 0x445463,
  conservator: 0x46576a,
  porcelain: 0xf2efe6,
  steel: 0x8b95a1,
  dark: 0x232b34,
  copper: 0xb87333,
  copperDark: 0x9c5f28,
  core: 0x9aa1ab,
  oil: 0xd97b29,
  green: 0x3e6d55,
  blue: 0x2f6f9f,
};

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: opts.metalness ?? 0.35,
    roughness: opts.roughness ?? 0.5,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
}

function trim() {
  return std(0x3a4856, { metalness: 0.55, roughness: 0.4 });
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

/* A "grand" porcelain bushing built from a lathe profile. */
function bushingGeometry(height, baseR) {
  const h = height;
  const pts = [
    new THREE.Vector2(0.02, 0),
    new THREE.Vector2(baseR * 0.62, 0),
    new THREE.Vector2(baseR, 0.02),
    new THREE.Vector2(baseR * 1.05, 0.10),
    new THREE.Vector2(baseR * 1.12, 0.32),
    new THREE.Vector2(baseR * 1.0, h * 0.55),
    new THREE.Vector2(baseR * 0.72, h * 0.72),
    new THREE.Vector2(baseR * 0.66, h * 0.85),
    new THREE.Vector2(baseR * 0.42, h * 0.96),
    new THREE.Vector2(baseR * 0.30, h),
  ];
  return new THREE.LatheGeometry(pts, 24);
}

/* Radiator bank: header pipes + fins. Origin at bank centre. */
function makeRadiator(mat, w, h, d) {
  const g = new THREE.Group();
  const finMat = std(mat, { metalness: 0.5, roughness: 0.45 });
  const pipeMat = std(mat, { metalness: 0.6, roughness: 0.35 });
  const nFins = 10;
  const finT = 0.05;
  const gap = d / nFins;
  for (let i = 0; i < nFins; i++) {
    const z = (i - (nFins - 1) / 2) * gap;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(finT, h, d * 0.92), finMat);
    fin.position.set(0, 0, z);
    g.add(fin);
  }
  const pipeGeo = new THREE.CylinderGeometry(w * 0.32, w * 0.32, d, 16);
  const t = new THREE.Mesh(pipeGeo, pipeMat);
  t.rotation.x = Math.PI / 2;
  t.position.set(0, h / 2 + w * 0.36, 0);
  g.add(t);
  const b = t.clone();
  b.position.y = -(h / 2 + w * 0.36);
  g.add(b);
  return { group: g, materials: [finMat, pipeMat] };
}

function makeNameplateTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 640;
  const x = c.getContext('2d');
  x.fillStyle = '#f4f1e6';
  x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#1b2430';
  x.lineWidth = 18;
  x.strokeRect(24, 24, c.width - 48, c.height - 48);
  x.fillStyle = '#1b2430';
  x.font = 'bold 92px Arial, sans-serif';
  x.textAlign = 'center';
  x.fillText('GRAND POWER', c.width / 2, 170);
  x.font = 'bold 64px Arial, sans-serif';
  x.fillText('TRANSFORMER', c.width / 2, 300);
  x.font = '48px Consolas, monospace';
  x.fillText('20 MVA - 115 kV / 20 kV', c.width / 2, 400);
  x.fillText('SN: TL-2026-01', c.width / 2, 480);
  x.fillStyle = '#7a5c10';
  x.font = '40px Arial';
  x.fillText('⚡ DANGER · HV', c.width / 2, 560);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

/* ------------------------------------------------------------------ */

export function buildTransformer(scene) {
  const parts = new Map();

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
      defaultOpacity: 1,
    }, cfg);

    if (!def.group) {
      def.group = new THREE.Group();
    }
    def.group.position.copy(def.base);
    def.group.quaternion.copy(def.restQuat);
    def.group.scale.copy(def.restScale);

    def.group.visible = !def.hidden;
    scene.add(def.group);
    parts.set(def.id, def);
    return def;
  }

  /* ---------------- BASE & TANK ---------------- */

  const baseDef = register({
    id: 'base',
    label: 'Base Frame',
    type: 'structure',
    desc: 'Steel channel base with transport wheels. The transformer sits on this frame.',
    base: new THREE.Vector3(0, 0.22, 0),
    explodeDir: new THREE.Vector3(0, 0, 0),
    movable: false,
    rotatable: false,
    materials: [],
  });
  const baseMat = std(P.dark, { metalness: 0.6, roughness: 0.5 });
  const wheelMat = std(0x1a1f26, { metalness: 0.7, roughness: 0.5 });
  [-1.75, 1.75].forEach((bx) => {
    mesh(new THREE.BoxGeometry(0.32, 0.42, 2.7), baseMat, [bx, 0, 0], [0, 0, 0], baseDef.group);
  });
  [-1.75, 1.75].forEach((bx) => {
    [-0.95, 0.95].forEach((bz) => {
      mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 18), wheelMat,
        [bx, -0.14, bz], [Math.PI / 2, 0, 0], baseDef.group);
    });
  });
  baseDef.materials = [baseMat, wheelMat];

  const tankDef = register({
    id: 'tank',
    label: 'Main Tank',
    type: 'structure',
    desc: 'The oil-filled steel tank that houses the core and windings. Main body of the transformer.',
    base: new THREE.Vector3(0, 1.95, 0),
    explodeDir: new THREE.Vector3(0, 0, 0),
    movable: false,
    rotatable: false,
    scalable: false,
    materials: [],
  });
  const tankMat = std(P.tank, { metalness: 0.5, roughness: 0.45 });
  mesh(new THREE.BoxGeometry(4.0, 3.1, 2.6), tankMat, [0, 0, 0], [0, 0, 0], tankDef.group);
  const trimMat = trim();
  mesh(new THREE.BoxGeometry(4.12, 0.08, 2.72), trimMat, [0, -1.56, 0], [0, 0, 0], tankDef.group);
  mesh(new THREE.BoxGeometry(4.12, 0.08, 2.72), trimMat, [0, 1.56, 0], [0, 0, 0], tankDef.group);
  tankDef.materials = [tankMat, trimMat];

  const lidDef = register({
    id: 'lid',
    label: 'Tank Cover / Lid',
    type: 'structure',
    desc: 'Removable cover plate. All bushings, conservator supports and instruments mount onto it.',
    base: new THREE.Vector3(0, 3.5, 0),
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 2.0,
    materials: [],
  });
  const lidMat = std(P.lid, { metalness: 0.5, roughness: 0.5 });
  const lidTrim = trim();
  mesh(new THREE.BoxGeometry(4.24, 0.16, 2.84), lidMat, [0, 0.06, 0], [0, 0, 0], lidDef.group);
  mesh(new THREE.BoxGeometry(4.4, 0.1, 3.0), lidTrim, [0, 0.15, 0], [0, 0, 0], lidDef.group);
  lidDef.materials = [lidMat, lidTrim];

  /* ---------------- CONSERVATOR & BREATHER ---------------- */

  const conservatorDef = register({
    id: 'conservator',
    label: 'Conservator (Oil Tank)',
    type: 'oil system',
    desc: 'Expansion tank mounted above the main tank. Allows the insulating oil to expand and contract with temperature.',
    base: new THREE.Vector3(0, 4.42, 0),
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 1.8,
    materials: [],
  });
  const consMat = std(P.conservator, { metalness: 0.55, roughness: 0.4 });
  const pipeMat = std(P.steel, { metalness: 0.7, roughness: 0.3 });
  const consTrim = trim();
  [-0.6, 0.6].forEach((sx) => {
    mesh(new THREE.BoxGeometry(0.18, 0.4, 0.18), pipeMat, [sx, 0.1, 0], [0, 0, 0], conservatorDef.group);
  });
  mesh(new THREE.CylinderGeometry(0.72, 0.72, 2.3, 28), consMat, [0, 0, 0],
    [Math.PI / 2, 0, 0], conservatorDef.group);
  /* end caps */
  [-1.15, 1.15].forEach((ez) => {
    mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.1, 28), consTrim, [0, 0, ez],
      [Math.PI / 2, 0, 0], conservatorDef.group);
  });
  /* oil level gauge on top */
  mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.4, 14), std(0xcfd8e3),
    [0, 0.9, -0.4], [0, 0, 0], conservatorDef.group);
  conservatorDef.materials = [consMat, pipeMat, consTrim];

  const breatherDef = register({
    id: 'breather',
    label: 'Silica-gel Breather',
    type: 'oil system',
    desc: 'Removes moisture from the air drawn into the conservator. The gel changes colour from blue to pink when saturated.',
    base: new THREE.Vector3(0, 3.72, 1.32),
    explodeDir: new THREE.Vector3(0, -1, 0),
    explodeDist: 1.2,
    materials: [],
  });
  const breathPipe = std(P.steel, { metalness: 0.7, roughness: 0.3 });
  mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 12), breathPipe, [0, 0.55, 0],
    [0, 0, 0], breatherDef.group);
  const glassMat = std(P.oil, { transparent: true, opacity: 0.75, metalness: 0.1, roughness: 0.3 });
  mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.62, 20), glassMat, [0, 0.05, 0],
    [0, 0, 0], breatherDef.group);
  mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 20), breathPipe, [0, 0.36, 0], [0, 0, 0], breatherDef.group);
  mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 20), breathPipe, [0, -0.28, 0], [0, 0, 0], breatherDef.group);
  breatherDef.materials = [breathPipe, glassMat];

  /* ---------------- BUSHINGS ---------------- */

  function makeBushings(defId, label, x, zs, height, baseR, desc) {
    const def = register({
      id: defId,
      label,
      type: 'insulation',
      desc,
      base: new THREE.Vector3(0, 3.66, 0),
      explodeDir: new THREE.Vector3(0, 1, 0),
      explodeDist: 2.4,
      materials: [],
    });
    const porcelainMat = std(P.porcelain, { metalness: 0.05, roughness: 0.25 });
    const bushTrim = trim();
    const br = bushingGeometry(height, baseR);
    zs.forEach((z) => {
      const g = new THREE.Group();
      mesh(br, porcelainMat, [x, 0, z], [0, 0, 0], g);
      mesh(new THREE.CylinderGeometry(baseR * 1.4, baseR * 1.5, 0.12, 20), bushTrim,
        [x, -0.04, z], [0, 0, 0], g);
      mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), std(0xd8a33c, { metalness: 0.8, roughness: 0.3 }),
        [x, height, z], [0, 0, 0], g);
      def.group.add(g);
    });
    def.materials = [porcelainMat, bushTrim];
    return def;
  }

  makeBushings('bushing_hv', 'HV Bushings (115 kV)', -1.25, [-0.9, 0, 0.9], 1.7, 0.24,
    'Three high-voltage bushings. Porcelain insulators carry the 115 kV line conductors down through the cover into the tank.');

  makeBushings('bushing_lv', 'LV Bushings (20 kV)', 1.25, [-0.9, 0, 0.9], 0.95, 0.2,
    'Three low-voltage bushings that connect the secondary windings to the switchgear.');

  /* ---------------- RADIATORS & FANS ---------------- */

  function makeRadiators(side, x, zOffsets) {
    const def = register({
      id: side === 'l' ? 'radiators_l' : 'radiators_r',
      label: side === 'l' ? 'Radiators (Left bank)' : 'Radiators (Right bank)',
      type: 'cooling',
      desc: 'Oil-to-air radiators. Hot oil rises into the headers, cools in the fins and sinks back into the tank.',
      base: new THREE.Vector3(x, 1.62, 0),
      explodeDir: new THREE.Vector3(side === 'l' ? -1 : 1, 0, 0),
      explodeDist: 1.6,
      materials: [],
    });
    const radMat = P.dark;
    const mats = [];
    zOffsets.forEach((z) => {
      const bank = makeRadiator(radMat, 0.34, 2.35, 1.5);
      bank.group.position.set(0, 0, z);
      def.group.add(bank.group);
      mats.push(...bank.materials);
    });
    def.materials = mats;
    return def;
  }
  makeRadiators('l', -2.27, [-0.75, 0.75]);
  makeRadiators('r', 2.27, [-0.75, 0.75]);

  function makeFan(id, label, x, z) {
    const def = register({
      id, label,
      type: 'cooling',
      desc: 'Axial cooling fan that forces air through the radiator fins, increasing heat dissipation at high load.',
      base: new THREE.Vector3(x, 0.32, z),
      explodeDir: new THREE.Vector3(0, -1, 0),
      explodeDist: 1.3,
      materials: [],
    });
    const housingMat = std(P.dark, { metalness: 0.55, roughness: 0.5 });
    const bladeMat = std(0x3a4a5e, { metalness: 0.4, roughness: 0.5 });
    const fanTrim = trim();
    mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 24), housingMat, [0, 0, 0],
      [Math.PI / 2, 0, 0], def.group);
    mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.2, 6), bladeMat, [0, 0, 0],
      [Math.PI / 2, 0, 0], def.group);
    mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), fanTrim, [0, 0, 0], [0, 0, 0], def.group);
    def.materials = [housingMat, bladeMat, fanTrim];
    return def;
  }
  makeFan('fan_l1', 'Cooling Fan L1', -2.3, -0.75);
  makeFan('fan_l2', 'Cooling Fan L2', -2.3, 0.75);
  makeFan('fan_r1', 'Cooling Fan R1', 2.3, -0.75);
  makeFan('fan_r2', 'Cooling Fan R2', 2.3, 0.75);

  /* ---------------- TAP CHANGER & CONTROL CABINET ---------------- */

  const oltcDef = register({
    id: 'oltc',
    label: 'On-Load Tap Changer (OLTC)',
    type: 'voltage control',
    desc: 'Allows the turns ratio to be changed while the transformer is energised, keeping the secondary voltage stable.',
    base: new THREE.Vector3(1.0, 1.62, 1.6),
    explodeDir: new THREE.Vector3(0, 0, 1),
    explodeDist: 1.6,
    materials: [],
  });
  const oltcMat = std(0x36434f, { metalness: 0.45, roughness: 0.5 });
  const oltcDoor = std(P.blue, { metalness: 0.3, roughness: 0.55 });
  mesh(new THREE.BoxGeometry(0.85, 1.35, 0.6), oltcMat, [0, -0.05, 0], [0, 0, 0], oltcDef.group);
  mesh(new THREE.BoxGeometry(0.72, 1.2, 0.06), oltcDoor, [0, -0.05, 0.33], [0, 0, 0], oltcDef.group);
  mesh(new THREE.BoxGeometry(0.4, 0.5, 0.5), oltcMat, [0, 0.85, 0], [0, 0, 0], oltcDef.group);
  mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8), std(0xd8a33c),
    [0.12, 0.85, 0.26], [0, 0, 0], oltcDef.group);
  mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8), std(0xd8a33c),
    [-0.12, 0.85, 0.26], [0, 0, 0], oltcDef.group);
  oltcDef.materials = [oltcMat, oltcDoor];

  const cabinetDef = register({
    id: 'cabinet',
    label: 'Control / Protection Cabinet',
    type: 'control',
    desc: 'Houses relays, protection and monitoring devices, WTI & OTI gauges and control wiring.',
    base: new THREE.Vector3(-1.0, 2.55, 1.6),
    explodeDir: new THREE.Vector3(0, 0, 1),
    explodeDist: 1.6,
    materials: [],
  });
  const cabMat = std(0x36434f, { metalness: 0.45, roughness: 0.5 });
  mesh(new THREE.BoxGeometry(0.9, 1.5, 0.5), cabMat, [0, 0, 0], [0, 0, 0], cabinetDef.group);
  mesh(new THREE.BoxGeometry(0.78, 1.36, 0.05), oltcDoor, [0, 0, 0.27], [0, 0, 0], cabinetDef.group);
  mesh(new THREE.BoxGeometry(0.3, 0.22, 0.06), std(P.green), [0, 0.35, 0.26], [0, 0, 0], cabinetDef.group);
  mesh(new THREE.BoxGeometry(0.3, 0.22, 0.06), std(P.blue), [0, -0.1, 0.26], [0, 0, 0], cabinetDef.group);
  mesh(new THREE.BoxGeometry(0.3, 0.22, 0.06), std(0xa33b2e), [0, -0.55, 0.26], [0, 0, 0], cabinetDef.group);
  cabinetDef.materials = [cabMat];

  /* ---------------- INSTRUMENTS ---------------- */

  const gaugeDef = register({
    id: 'gauge',
    label: 'Oil Temperature Gauge (WTI)',
    type: 'instrument',
    desc: 'Shows the top-oil temperature. The needle moves with the Load slider.',
    base: new THREE.Vector3(0.3, 3.06, 1.34),
    explodeDir: new THREE.Vector3(0, 0, 1),
    explodeDist: 1.2,
    movable: false,
    rotatable: false,
    materials: [],
  });
  const gaugeBody = std(0x2a323b, { metalness: 0.4, roughness: 0.5 });
  mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 20), gaugeBody, [0, 0, 0],
    [Math.PI / 2, 0, 0], gaugeDef.group);
  mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 20), std(0xf4f1e6), [0, 0, 0.08],
    [Math.PI / 2, 0, 0], gaugeDef.group);
  const needle = mesh(new THREE.BoxGeometry(0.016, 0.085, 0.004), std(0xc0392b),
    [0, 0.035, 0.095], [0, 0, 0], gaugeDef.group);
  gaugeDef.needle = needle;
  gaugeDef.materials = [gaugeBody];

  const nameplateDef = register({
    id: 'nameplate',
    label: 'Nameplate',
    type: 'instrument',
    desc: 'Rated data: power, voltages, currents, impedance and oil weight. Every transformer has one.',
    base: new THREE.Vector3(-0.42, 1.15, 1.31),
    explodeDir: new THREE.Vector3(0, 0, 1),
    explodeDist: 1.0,
    materials: [],
  });
  const npMat = new THREE.MeshStandardMaterial({
    map: makeNameplateTexture(),
    roughness: 0.6, metalness: 0.05,
  });
  const np = mesh(new THREE.BoxGeometry(0.72, 0.45, 0.05), npMat, [0, 0, 0], [0, 0, 0], nameplateDef.group);
  np.scale.z = 1;
  nameplateDef.materials = [npMat];
  nameplateDef.colorable = false;

  const groundDef = register({
    id: 'ground',
    label: 'Ground / Earth Terminal',
    type: 'safety',
    desc: 'Earthing connection that bonds the tank to ground for safety.',
    base: new THREE.Vector3(0.55, 0.32, 1.34),
    explodeDir: new THREE.Vector3(0, 0, 1),
    explodeDist: 0.9,
    materials: [],
  });
  const copperMat = std(0xc98a2d, { metalness: 0.85, roughness: 0.3 });
  mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 10), copperMat, [0, 0, 0],
    [0, 0, 0], groundDef.group);
  mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 14), copperMat, [0, 0.26, 0],
    [0, 0, 0], groundDef.group);
  groundDef.materials = [copperMat];

  const drainDef = register({
    id: 'drain',
    label: 'Oil Drain Valve',
    type: 'oil system',
    desc: 'Valve at the bottom of the tank used for sampling and draining oil.',
    base: new THREE.Vector3(-0.6, 0.6, 1.36),
    explodeDir: new THREE.Vector3(0, 0, 1),
    explodeDist: 0.9,
    materials: [],
  });
  mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 14), copperMat, [0, 0, 0],
    [Math.PI / 2, 0, 0], drainDef.group);
  mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 16), copperMat, [0, 0, 0.12],
    [Math.PI / 2, 0, 0], drainDef.group);
  drainDef.materials = [copperMat];

  /* ---------------- INTERNALS: CORE, WINDINGS, OIL ---------------- */

  const internals = new THREE.Group();
  internals.name = 'internals';
  internals.visible = false;
  scene.add(internals);

  /* internals live inside the `internals` group so one flag hides them all */
  function registerInternal(cfg) {
    const def = register(cfg);
    scene.remove(def.group);
    internals.add(def.group);
    return def;
  }

  const coreDef = registerInternal({
    id: 'core',
    label: 'Magnetic Core',
    type: 'internals',
    desc: 'Laminated silicon-steel core. Three limbs carry the magnetic flux linking the windings.',
    base: new THREE.Vector3(0, 1.95, 0),
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 1.6,
    internals: true,
    materials: [],
  });
  const coreMat = std(P.core, { metalness: 0.55, roughness: 0.4 });
  mesh(new THREE.BoxGeometry(3.05, 0.5, 0.72), coreMat, [0, -1.25, 0], [0, 0, 0], coreDef.group);
  mesh(new THREE.BoxGeometry(3.05, 0.5, 0.72), coreMat, [0, 1.25, 0], [0, 0, 0], coreDef.group);
  [-0.85, 0, 0.85].forEach((lx) => {
    mesh(new THREE.BoxGeometry(0.56, 1.95, 0.72), coreMat, [lx, 0, 0], [0, 0, 0], coreDef.group);
  });
  coreDef.materials = [coreMat];

  const windingDef = registerInternal({
    id: 'winding',
    label: 'Windings (HV + LV)',
    type: 'internals',
    desc: 'Concentric copper windings around each core limb. HV outside, LV inside, separated by paper insulation.',
    base: new THREE.Vector3(0, 1.95, 0),
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 2.4,
    internals: true,
    materials: [],
  });
  const hvMat = std(P.copperDark, { metalness: 0.75, roughness: 0.3 });
  const lvMat = std(P.copper, { metalness: 0.8, roughness: 0.3 });
  const pressMat = std(0x8a6d3b, { metalness: 0.2, roughness: 0.7 });
  [-0.85, 0, 0.85].forEach((lx) => {
    mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.9, 24), hvMat, [lx, 0, 0],
      [0, 0, 0], windingDef.group);
    mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.72, 24), lvMat, [lx, 0, 0],
      [0, 0, 0], windingDef.group);
    mesh(new THREE.CylinderGeometry(0.54, 0.54, 0.14, 24), pressMat, [lx, 1.0, 0],
      [0, 0, 0], windingDef.group);
    mesh(new THREE.CylinderGeometry(0.54, 0.54, 0.14, 24), pressMat, [lx, -1.0, 0],
      [0, 0, 0], windingDef.group);
  });
  windingDef.materials = [hvMat, lvMat, pressMat];

  const oilDef = registerInternal({
    id: 'oil',
    label: 'Insulating Oil',
    type: 'internals',
    desc: 'Mineral oil fills the tank. It insulates and cools the core & windings.',
    base: new THREE.Vector3(0, 1.95, 0),
    explodeDir: new THREE.Vector3(0, 1, 0),
    explodeDist: 0.8,
    internals: true,
    materials: [],
  });
  const oilMat = std(P.oil, {
    transparent: true, opacity: 0.28, metalness: 0.05, roughness: 0.2, side: THREE.DoubleSide,
  });
  mesh(new THREE.BoxGeometry(3.9, 2.75, 2.5), oilMat, [0, 0, 0], [0, 0, 0], oilDef.group);
  oilDef.materials = [oilMat];
  oilDef.xrayFriendly = false;

  /* expose every part to raycasting now that all meshes exist */
  for (const def of parts.values()) {
    def.group.traverse((o) => { if (o.isMesh) o.userData.partId = def.id; });
  }

  return { parts, internals };
}
