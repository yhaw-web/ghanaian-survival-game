import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const viewport = document.getElementById('viewport');
const healthBar = document.getElementById('healthBar');
const staminaBar = document.getElementById('staminaBar');
const healthText = document.getElementById('healthText');
const staminaText = document.getElementById('staminaText');
const moneyText = document.getElementById('moneyText');
const missionTitle = document.getElementById('missionTitle');
const missionText = document.getElementById('missionText');
const objectiveText = document.getElementById('objectiveText');
const distanceText = document.getElementById('distanceText');
const inventoryList = document.getElementById('inventoryList');
const minimapCanvas = document.getElementById('minimap');
const miniCtx = minimapCanvas.getContext('2d');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ad3ff);
scene.fog = new THREE.Fog(0x9ad3ff, 50, 220);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.appendChild(renderer.domElement);

const hemiLight = new THREE.HemisphereLight(0xcfe6ff, 0x4d5f3a, 1.2);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff2cf, 1.35);
sunLight.position.set(25, 40, 18);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.left = -100;
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 180;
scene.add(sunLight);

const keys = {};
const touchState = { active: false, x: 0, y: 0 };
const WORLD_LIMIT = 110;

const player = {
  position: new THREE.Vector3(0, 1.15, 18),
  velocity: new THREE.Vector3(0, 0, 0),
  facing: new THREE.Vector3(0, 0, 1),
  health: 100,
  stamina: 100,
  money: 0,
  attackCooldown: 0,
  onGround: true,
  inventory: { supply: 0, food: 0, water: 0, scrap: 0 },
  group: new THREE.Group(),
};

const state = {
  paused: false,
  gameOver: false,
  missionIndex: 0,
  enemyKills: 0,
  lastTime: performance.now(),
};

const world = {
  colliders: [],
  vehicles: [],
  pedestrians: [],
  enemies: [],
  supplyCrates: [],
  marker: new THREE.Group(),
};

const missions = [
  { title: 'Explore the town', objective: 'Reach the Market Square', type: 'reach', target: new THREE.Vector3(0, 1.2, 18), radius: 7, reward: 25 },
  { title: 'Gather supplies', objective: 'Collect 3 supply crates', type: 'collect', goal: 3, reward: 50 },
  { title: 'Reach the bus terminal', objective: 'Head to the west bus stop', type: 'reach', target: new THREE.Vector3(-32, 1.2, -38), radius: 8, reward: 60 },
  { title: 'Clear the danger', objective: 'Defeat 2 raiders', type: 'defeat', goal: 2, reward: 90 },
  { title: 'Unlock the north district', objective: 'Reach the north gate', type: 'reach', target: new THREE.Vector3(26, 1.2, 70), radius: 9, reward: 140},
];

const ui = {
  pauseMenu: document.getElementById('pauseMenu'),
  gameOverOverlay: document.getElementById('gameOverOverlay'),
  resumeBtn: document.getElementById('resumeBtn'),
  restartBtn: document.getElementById('restartBtn'),
  restartFromPauseBtn: document.getElementById('restartFromPauseBtn'),
};

function createPlayerModel() {
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7bc2ff, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe4c7a1, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.44, 1.15, 4, 8), bodyMat);
  body.position.y = 1.1;
  body.castShadow = true;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), skinMat);
  head.position.y = 2.15;
  head.castShadow = true;

  player.group.add(body, head);
  scene.add(player.group);
}

function addGround() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 260),
    new THREE.MeshStandardMaterial({ color: 0x7bbf77, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

function createRoad(x, z, width, depth) {
  const road = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.08, depth),
    new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.92 })
  );
  road.position.set(x, 0.04, z);
  road.receiveShadow = true;
  scene.add(road);

  const lane = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.9, 0.02, 0.18),
    new THREE.MeshStandardMaterial({ color: 0xf4d76a, emissive: 0x342800, emissiveIntensity: 0.18 })
  );
  lane.position.set(x, 0.1, z);
  scene.add(lane);

  const sidewalk = new THREE.Mesh(
    new THREE.BoxGeometry(width + 4, 0.08, depth + 4),
    new THREE.MeshStandardMaterial({ color: 0x8ea2ac, roughness: 1 })
  );
  sidewalk.position.set(x, 0.03, z);
  sidewalk.receiveShadow = true;
  scene.add(sidewalk);
}

function createBuilding(x, z, width, depth, height, color, label) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color, roughness: 0.92 })
  );
  mesh.position.set(x, height / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.08, 0.5, depth * 1.08),
    new THREE.MeshStandardMaterial({ color: 0x735b33, roughness: 0.8 })
  );
  roof.position.set(x, height + 0.25, z);
  roof.castShadow = true;
  scene.add(roof);

  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(1.3, width * 0.6), 0.55, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xf4d38e, emissive: 0x200d00, emissiveIntensity: 0.2 })
  );
  sign.position.set(x, height * 0.82, z + depth / 2 + 0.12);
  scene.add(sign);

  // floating text sign
  const texCanvas = document.createElement('canvas');
  texCanvas.width = 256;
  texCanvas.height = 64;
  const ctx = texCanvas.getContext('2d');
  ctx.fillStyle = '#12222b';
  ctx.fillRect(0, 0, texCanvas.width, texCanvas.height);
  ctx.fillStyle = '#f7e5b7';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, texCanvas.width / 2, texCanvas.height / 2);

  const spriteMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(texCanvas), transparent: true });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.position.set(x, height * 0.82, z + depth / 2 + 0.3);
  sprite.scale.set(3.4, 0.9, 1);
  scene.add(sprite);

  world.colliders.push({ x, z, w: width + 1.2, d: depth + 1.2, h: height });
}

function addStreetlight(x, z) {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, 5.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x3e3e44, roughness: 0.9 })
  );
  pole.position.set(x, 2.65, z);
  pole.castShadow = true;
  scene.add(pole);

  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.34, 0.52),
    new THREE.MeshStandardMaterial({ color: 0xf7f4d9, emissive: 0xffd76a, emissiveIntensity: 1.2 })
  );
  lamp.position.set(x, 5.16, z);
  lamp.castShadow = true;
  scene.add(lamp);
}

function addTree(x, z, scale = 1) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18 * scale, 0.24 * scale, 1.8 * scale, 8),
    new THREE.MeshStandardMaterial({ color: 0x6d4f34, roughness: 1 })
  );
  trunk.position.set(x, 0.9 * scale, z);
  trunk.castShadow = true;
  scene.add(trunk);

  const leaves = new THREE.Mesh(
    new THREE.SphereGeometry(1.2 * scale, 14, 14),
    new THREE.MeshStandardMaterial({ color: 0x3d8d58, roughness: 0.9 })
  );
  leaves.position.set(x, 2.2 * scale, z);
  leaves.castShadow = true;
  scene.add(leaves);
}

function buildTown() {
  addGround();
  createRoad(0, 0, 120, 26);
  createRoad(0, 42, 120, 26);
  createRoad(0, -44, 120, 26);
  createRoad(46, 0, 26, 120);
  createRoad(-46, 0, 26, 120);
  createRoad(0, 82, 120, 22);

  const buildings = [
    { x: -24, z: -18, w: 12, d: 12, h: 9, color: 0xd1c7b8, label: 'Shop' },
    { x: -58, z: -18, w: 18, d: 14, h: 10, color: 0xc4d0df, label: 'House' },
    { x: -58, z: 18, w: 16, d: 14, h: 9, color: 0xe6c88d, label: 'Bakery' },
    { x: -16, z: 28, w: 16, d: 12, h: 10, color: 0xf0d1a5, label: 'Clinic' },
    { x: 18, z: 28, w: 17, d: 12, h: 10, color: 0xd9c0b6, label: 'Store' },
    { x: 54, z: 16, w: 18, d: 14, h: 12, color: 0xc3d9b5, label: 'Books' },
    { x: 62, z: -22, w: 20, d: 16, h: 11, color: 0xd7d0b0, label: 'Market' },
    { x: -26, z: -52, w: 14, d: 12, h: 8, color: 0xd6d8cc, label: 'Station' },
    { x: 24, z: -52, w: 18, d: 15, h: 9, color: 0xe0bd8b, label: 'Cafe' },
    { x: 16, z: 68, w: 18, d: 14, h: 11, color: 0xbcc9d9, label: 'House' },
    { x: -20, z: 68, w: 18, d: 14, h: 10, color: 0xe9d29f, label: 'School' },
    { x: 52, z: 68, w: 20, d: 16, h: 12, color: 0xd4d7ad, label: 'Office' },
  ];

  buildings.forEach((b) => createBuilding(b.x, b.z, b.w, b.d, b.h, b.color, b.label));

  for (let i = -70; i <= 70; i += 12) {
    addStreetlight(i, -18);
    addStreetlight(i, 24);
    addStreetlight(i, 82);
    addStreetlight(-18, i);
    addStreetlight(18, i);
  }

  for (let i = -90; i <= 90; i += 18) {
    addTree(i, 50, 1.08);
    addTree(i, -60, 1.08);
    addTree(72, i * 0.8, 1.08);
    addTree(-72, i * 0.8, 1.08);
  }

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x5d574d, roughness: 1 });
  for (const [x, z, w, d] of [[0, 110, 120, 1.2], [0, -110, 120, 1.2], [110, 0, 1.2, 220], [-110, 0, 1.2, 220]]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 2.5, d), wallMat);
    mesh.position.set(x, 1.25, z);
    scene.add(mesh);
  }
}

function createVehicle(x, z, lane = 'z') {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.6, 3.4),
    new THREE.MeshStandardMaterial({ color: 0x2d78d7, roughness: 0.8 })
  );
  body.position.y = 0.75;
  body.castShadow = true;

  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.8, 1.7),
    new THREE.MeshStandardMaterial({ color: 0xeef3ff, roughness: 0.6 })
  );
  cab.position.y = 1.2;
  cab.castShadow = true;

  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 1 });
  const wheelOffsets = [[-0.8, 0.28, 1.1], [0.8, 0.28, 1.1], [-0.8, 0.28, -1.1], [0.8, 0.28, -1.1]];
  wheelOffsets.forEach(([wx, wy, wz]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, wy, wz);
    wheel.castShadow = true;
    group.add(wheel);
  });

  group.add(body, cab);
  group.position.set(x, 0, z);
  group.rotation.y = lane === 'z' ? Math.PI : Math.PI / 2;
  scene.add(group);

  world.vehicles.push({ mesh: group, lane, direction: lane === 'z' ? 1 : -1, speed: 12 + Math.random() * 8 });
}

function createPedestrian(x, z, color = 0xf0d2a1) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.1, 4, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  body.position.y = 1.1;
  body.castShadow = true;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), new THREE.MeshStandardMaterial({ color: 0xe2bf9d, roughness: 0.9 }));
  head.position.y = 1.95;
  head.castShadow = true;

  group.add(body, head);
  group.position.set(x, 0, z);
  scene.add(group);

  world.pedestrians.push({ mesh: group, home: new THREE.Vector3(x, 0, z), drift: Math.random() * Math.PI * 2, speed: 1.8 + Math.random() * 1.4, radius: 8 + Math.random() * 10 });
}

function createEnemy(x, z) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.25, 4, 10), new THREE.MeshStandardMaterial({ color: 0x9e1d1d, roughness: 0.9 }));
  body.position.y = 1.15;
  body.castShadow = true;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), new THREE.MeshStandardMaterial({ color: 0xffd7a5, roughness: 0.9 }));
  head.position.y = 2.15;
  head.castShadow = true;

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff4e4e, emissive: 0x7a0101, emissiveIntensity: 1.4 });
  const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), eyeMat);
  leftEye.position.set(-0.08, 2.2, 0.26);
  const rightEye = leftEye.clone();
  rightEye.position.x = 0.08;

  group.add(body, head, leftEye, rightEye);
  group.position.set(x, 0, z);
  scene.add(group);

  world.enemies.push({ mesh: group, health: 55, speed: 2.3, aggroRange: 12, attackRange: 2.1, attackCooldown: 0, wanderAngle: Math.random() * Math.PI * 2, home: new THREE.Vector3(x, 0, z), dead: false });
}

function createSupplyCrate(x, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x6c905b, emissive: 0x1a3115, emissiveIntensity: 0.35 })
  );
  mesh.position.set(x, 0.7, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.06, 8, 18),
    new THREE.MeshStandardMaterial({ color: 0x8ae5ad, emissive: 0x93f3c7, emissiveIntensity: 1.2 })
  );
  glow.rotation.x = Math.PI / 2;
  glow.position.set(x, 1.5, z);
  scene.add(glow);

  world.supplyCrates.push({ mesh, glow, collected: false, x, z });
}

function setupWorld() {
  buildTown();

  const cratePositions = [[-30, 6], [18, -8], [60, 58], [-68, 68], [28, -70], [-66, -54]];
  cratePositions.forEach(([x, z]) => createSupplyCrate(x, z));

  createVehicle(-28, 0, 'z');
  createVehicle(28, 0, 'z');
  createVehicle(0, -80, 'x');
  createVehicle(0, 80, 'x');

  for (let i = 0; i < 18; i++) {
    const x = -70 + Math.random() * 140;
    const z = -70 + Math.random() * 140;
    if (Math.abs(x) < 18 && Math.abs(z) < 22) continue;
    createPedestrian(x, z, i % 2 === 0 ? 0xf0d4a0 : 0x8aa3d5);
  }

  createEnemy(-18, -60);
  createEnemy(42, 62);
  createEnemy(-58, 52);
}

function createMissionMarker() {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.5, 0.12, 8, 30),
    new THREE.MeshStandardMaterial({ color: 0x7ef5ff, emissive: 0x4dd8ff, emissiveIntensity: 1.8 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.2;

  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x7ef0d6, emissive: 0x2c8d7b, emissiveIntensity: 0.5 })
  );
  pillar.position.y = 0.8;

  world.marker.add(ring, pillar);
  world.marker.visible = false;
  scene.add(world.marker);
}

function getNearestSupplyPosition() {
  const remaining = world.supplyCrates.filter((crate) => !crate.collected);
  if (!remaining.length) return null;
  let nearest = remaining[0];
  let best = Number.POSITIVE_INFINITY;
  for (const crate of remaining) {
    const d = player.position.distanceTo(new THREE.Vector3(crate.x, 0.7, crate.z));
    if (d < best) {
      best = d;
      nearest = crate;
    }
  }
  return new THREE.Vector3(nearest.x, 0.7, nearest.z);
}

function updateMissionMarker() {
  const mission = missions[state.missionIndex];
  if (!mission) {
    world.marker.visible = false;
    return;
  }

  const target = mission.type === 'collect' ? getNearestSupplyPosition() ?? mission.target : mission.target;
  world.marker.visible = true;
  world.marker.position.copy(target);
}

function updateHUD() {
  const healthPct = THREE.MathUtils.clamp(player.health, 0, 100);
  const staminaPct = THREE.MathUtils.clamp(player.stamina, 0, 100);
  healthBar.style.width = `${healthPct}%`;
  staminaBar.style.width = `${staminaPct}%`;
  healthText.textContent = `${Math.ceil(healthPct)} / 100`;
  staminaText.textContent = `${Math.ceil(staminaPct)} / 100`;
  moneyText.textContent = `GH₵ ${player.money}`;

  const mission = missions[state.missionIndex];
  if (!mission) {
    missionTitle.textContent = 'Town Secure';
    missionText.textContent = 'All missions complete';
    objectiveText.textContent = 'You have survived and unlocked the full town.';
    distanceText.textContent = 'Distance: 0m';
    inventoryList.innerHTML = Object.entries(player.inventory)
      .map(([key, value]) => `<div class="inventory-item"><span>${key[0].toUpperCase() + key.slice(1)}</span><strong>${value}</strong></div>`)
      .join('');
    return;
  }

  missionTitle.textContent = `Mission ${state.missionIndex + 1}`;
  missionText.textContent = mission.title;

  let objective = mission.objective;
  if (mission.type === 'collect') objective += ` (${player.inventory.supply}/${mission.goal})`;
  if (mission.type === 'defeat') objective += ` (${state.enemyKills}/${mission.goal})`;
  objectiveText.textContent = `Objective: ${objective}`;

  let target = mission.target;
  if (mission.type === 'collect') target = getNearestSupplyPosition() ?? target;
  const distance = player.position.distanceTo(target);
  distanceText.textContent = `Distance: ${Math.max(0, Math.round(distance))}m`;

  inventoryList.innerHTML = Object.entries(player.inventory)
    .map(([key, value]) => `<div class="inventory-item"><span>${key[0].toUpperCase() + key.slice(1)}</span><strong>${value}</strong></div>`)
    .join('');
}

function handleCollisions() {
  const radius = 0.85;
  for (const c of world.colliders) {
    const dx = player.position.x - c.x;
    const dz = player.position.z - c.z;
    const insideX = Math.abs(dx) < c.w / 2 + radius;
    const insideZ = Math.abs(dz) < c.d / 2 + radius;
    if (insideX && insideZ) {
      const overlapX = c.w / 2 + radius - Math.abs(dx);
      const overlapZ = c.d / 2 + radius - Math.abs(dz);
      if (overlapX < overlapZ) {
        player.position.x += dx > 0 ? overlapX : -overlapX;
      } else {
        player.position.z += dz > 0 ? overlapZ : -overlapZ;
      }
    }
  }

  player.position.x = THREE.MathUtils.clamp(player.position.x, -WORLD_LIMIT, WORLD_LIMIT);
  player.position.z = THREE.MathUtils.clamp(player.position.z, -WORLD_LIMIT, WORLD_LIMIT);
}

function handlePickupCollection() {
  for (const crate of world.supplyCrates) {
    if (crate.collected) continue;
    const dist = player.position.distanceTo(new THREE.Vector3(crate.x, 0.7, crate.z));
    if (dist < 2) {
      crate.collected = true;
      crate.mesh.visible = false;
      crate.glow.visible = false;
      player.inventory.supply += 1;
      player.money += 8;
    }
  }
}

function completeMission() {
  const mission = missions[state.missionIndex];
  if (!mission) return;
  player.money += mission.reward;
  state.missionIndex += 1;
  if (state.missionIndex < missions.length) {
    updateMissionMarker();
  } else {
    world.marker.visible = false;
  }
}

function updateMissionProgress() {
  const mission = missions[state.missionIndex];
  if (!mission) return;

  if (mission.type === 'reach') {
    if (player.position.distanceTo(mission.target) <= mission.radius) completeMission();
  } else if (mission.type === 'collect') {
    if (player.inventory.supply >= mission.goal) completeMission();
  } else if (mission.type === 'defeat') {
    if (state.enemyKills >= mission.goal) completeMission();
  }
}

function triggerAttack() {
  if (player.attackCooldown > 0 || state.gameOver || state.paused) return;
  player.attackCooldown = 0.5;

  const attackRange = 3;
  for (const enemy of world.enemies) {
    if (enemy.dead) continue;
    const toEnemy = enemy.mesh.position.clone().sub(player.position);
    const dist = toEnemy.length();
    const facingDot = player.facing.clone().normalize().dot(toEnemy.clone().normalize());
    if (dist < attackRange && facingDot > 0.15) {
      enemy.health -= 26;
      if (enemy.health <= 0) {
        enemy.dead = true;
        enemy.mesh.visible = false;
        state.enemyKills += 1;
        player.money += 20;
      }
    }
  }
}

function applyDamage(amount) {
  player.health = Math.max(0, player.health - amount);
  if (player.health <= 0) {
    state.gameOver = true;
    ui.gameOverOverlay.classList.remove('hidden');
    ui.pauseMenu.classList.add('hidden');
  }
}

function updateEnemies(dt) {
  for (const enemy of world.enemies) {
    if (enemy.dead) continue;

    const toPlayer = player.position.clone().sub(enemy.mesh.position);
    const dist = toPlayer.length();
    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);

    if (dist < enemy.aggroRange) {
      const dir = toPlayer.clone().setY(0).normalize();
      enemy.mesh.position.addScaledVector(dir, enemy.speed * dt * 0.85);
      enemy.mesh.rotation.y = Math.atan2(dir.x, dir.z);
      if (dist < 2.2 && enemy.attackCooldown <= 0) {
        enemy.attackCooldown = 1.4;
        applyDamage(12);
      }
    } else {
      enemy.wanderAngle += dt * 0.9;
      const dir = new THREE.Vector3(Math.sin(enemy.wanderAngle), 0, Math.cos(enemy.wanderAngle));
      enemy.mesh.position.addScaledVector(dir, enemy.speed * dt * 0.4);
      enemy.mesh.rotation.y = Math.atan2(dir.x, dir.z);
      const homeDist = enemy.mesh.position.distanceTo(enemy.home);
      if (homeDist > 18) {
        const back = enemy.home.clone().sub(enemy.mesh.position).setY(0).normalize();
        enemy.mesh.position.addScaledVector(back, enemy.speed * dt * 1.1);
      }
    }
  }
}

function updatePedestrians(dt) {
  for (const ped of world.pedestrians) {
    ped.drift += dt * 0.7;
    const dir = new THREE.Vector3(Math.sin(ped.drift), 0, Math.cos(ped.drift));
    ped.mesh.position.addScaledVector(dir, ped.speed * dt * 0.5);
    ped.mesh.rotation.y = Math.atan2(dir.x, dir.z);

    const homeDist = ped.mesh.position.distanceTo(ped.home);
    if (homeDist > ped.radius) {
      const reverse = ped.home.clone().sub(ped.mesh.position).setY(0).normalize();
      ped.mesh.position.addScaledVector(reverse, ped.speed * dt * 0.9);
    }
  }
}

function updateVehicles(dt) {
  for (const v of world.vehicles) {
    if (v.lane === 'z') {
      v.mesh.position.z += v.direction * v.speed * dt;
      if (v.mesh.position.z > 92 || v.mesh.position.z < -92) v.direction *= -1;
    } else {
      v.mesh.position.x += v.direction * v.speed * dt;
      if (v.mesh.position.x > 92 || v.mesh.position.x < -92) v.direction *= -1;
    }
  }
}

function updatePlayer(dt) {
  const moveX = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0) + touchState.x;
  const moveZ = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0) - touchState.y;

  const camForward = new THREE.Vector3();
  camera.getWorldDirection(camForward);
  camForward.y = 0;
  camForward.normalize();

  const camRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), camForward).normalize();
  const desired = new THREE.Vector3();
  desired.copy(camForward).multiplyScalar(moveZ);
  desired.addScaledVector(camRight, moveX);

  if (desired.lengthSq() > 0.001) {
    desired.normalize();
    player.facing.copy(desired);
  }

  const sprinting = (keys['ShiftLeft'] || keys['ShiftRight']) && player.stamina > 0 && (Math.abs(moveX) > 0.1 || Math.abs(moveZ) > 0.1);
  const speed = sprinting ? 8.5 : 5.2;
  const delta = desired.clone().multiplyScalar(speed * dt);
  player.position.x += delta.x;
  player.position.z += delta.z;

  if (keys['Space'] && player.onGround) {
    player.velocity.y = 6.6;
    player.onGround = false;
  }

  player.velocity.y -= 18 * dt;
  player.position.y += player.velocity.y * dt;
  if (player.position.y <= 1.15) {
    player.position.y = 1.15;
    player.velocity.y = 0;
    player.onGround = true;
  }

  if (sprinting) {
    player.stamina = Math.max(0, player.stamina - 25 * dt);
  } else {
    player.stamina = Math.min(100, player.stamina + 18 * dt);
  }

  player.attackCooldown = Math.max(0, player.attackCooldown - dt);
  player.group.position.copy(player.position);
  player.group.rotation.y = Math.atan2(player.facing.x, player.facing.z);

  handleCollisions();
  handlePickupCollection();
  updateMissionProgress();
}

function updateCamera() {
  const offset = player.facing.clone().multiplyScalar(-7.5).add(new THREE.Vector3(0, 3.7, 0));
  const targetPos = player.position.clone().add(offset);
  camera.position.lerp(targetPos, 0.12);
  camera.lookAt(player.position.clone().add(new THREE.Vector3(0, 1.8, 0)));
}

function updateMinimap() {
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const scale = 1.1;

  miniCtx.clearRect(0, 0, w, h);
  miniCtx.fillStyle = '#0e1d2a';
  miniCtx.fillRect(0, 0, w, h);

  miniCtx.strokeStyle = '#7cc0ff';
  miniCtx.lineWidth = 2;
  miniCtx.strokeRect(8, 8, w - 16, h - 16);

  const mission = missions[state.missionIndex];
  if (mission) {
    const target = mission.type === 'collect' ? getNearestSupplyPosition() ?? mission.target : mission.target;
    const px = cx + target.x * scale;
    const py = cy + target.z * scale;
    miniCtx.fillStyle = '#ffc857';
    miniCtx.fillRect(px - 4, py - 4, 8, 8);
  }

  for (const crate of world.supplyCrates) {
    if (!crate.collected) {
      const px = cx + crate.x * scale;
      const py = cy + crate.z * scale;
      miniCtx.fillStyle = '#7de2ad';
      miniCtx.beginPath();
      miniCtx.arc(px, py, 3, 0, Math.PI * 2);
      miniCtx.fill();
    }
  }

  for (const enemy of world.enemies) {
    if (!enemy.dead) {
      const px = cx + enemy.mesh.position.x * scale;
      const py = cy + enemy.mesh.position.z * scale;
      miniCtx.fillStyle = '#ff6b64';
      miniCtx.beginPath();
      miniCtx.arc(px, py, 3.5, 0, Math.PI * 2);
      miniCtx.fill();
    }
  }

  const px = cx + player.position.x * scale;
  const py = cy + player.position.z * scale;
  miniCtx.fillStyle = '#ffffff';
  miniCtx.beginPath();
  miniCtx.arc(px, py, 5, 0, Math.PI * 2);
  miniCtx.fill();

  miniCtx.strokeStyle = '#dfeaf9';
  miniCtx.beginPath();
  miniCtx.moveTo(cx, cy);
  miniCtx.lineTo(cx + Math.sin(player.group.rotation.y) * 30, cy + Math.cos(player.group.rotation.y) * 30);
  miniCtx.stroke();
}

function resetGame() {
  player.position.set(0, 1.15, 18);
  player.velocity.set(0, 0, 0);
  player.facing.set(0, 0, 1);
  player.health = 100;
  player.stamina = 100;
  player.money = 0;
  player.attackCooldown = 0;
  player.onGround = true;
  player.inventory = { supply: 0, food: 0, water: 0, scrap: 0 };

  state.paused = false;
  state.gameOver = false;
  state.missionIndex = 0;
  state.enemyKills = 0;

  ui.pauseMenu.classList.add('hidden');
  ui.gameOverOverlay.classList.add('hidden');

  world.enemies.forEach((enemy) => {
    enemy.dead = false;
    enemy.mesh.visible = true;
    enemy.health = 55;
    enemy.mesh.position.copy(enemy.home);
  });

  world.supplyCrates.forEach((crate) => {
    crate.collected = false;
    crate.mesh.visible = true;
    crate.glow.visible = true;
  });
}

function handlePauseToggle() {
  if (state.gameOver) return;
  state.paused = !state.paused;
  ui.pauseMenu.classList.toggle('hidden', !state.paused);
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape') handlePauseToggle();
  if (event.code === 'KeyE') triggerAttack();
  if (event.code === 'Space') {
    keys['Space'] = true;
    if (player.onGround && !state.paused && !state.gameOver) {
      player.velocity.y = 6.6;
      player.onGround = false;
    }
  }
  keys[event.code] = true;
});

window.addEventListener('keyup', (event) => {
  keys[event.code] = false;
});

window.addEventListener('pointerdown', (event) => {
  if (event.target === viewport || event.target === document.body) triggerAttack();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const joystickBase = document.getElementById('joystickBase');
const joystickKnob = document.getElementById('joystickKnob');

function clampJoystick(value, limit) {
  return Math.max(-limit, Math.min(limit, value));
}

joystickBase.addEventListener('pointerdown', (event) => {
  touchState.active = true;
  joystickBase.setPointerCapture(event.pointerId);
  updateJoystick(event);
});

joystickBase.addEventListener('pointermove', (event) => {
  if (!touchState.active) return;
  updateJoystick(event);
});

joystickBase.addEventListener('pointerup', () => {
  touchState.active = false;
  touchState.x = 0;
  touchState.y = 0;
  joystickKnob.style.left = '50%';
  joystickKnob.style.top = '50%';
});

function updateJoystick(event) {
  const rect = joystickBase.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;
  const dist = Math.min(Math.hypot(dx, dy), 42);
  const angle = Math.atan2(dy, dx);
  const knobX = Math.cos(angle) * dist;
  const knobY = Math.sin(angle) * dist;
  joystickKnob.style.left = `${50 + knobX * 1.55}%`;
  joystickKnob.style.top = `${50 + knobY * 1.55}%`;
  touchState.x = clampJoystick(knobX / 42, 1);
  touchState.y = clampJoystick(knobY / 42, 1);
}

ui.resumeBtn.addEventListener('click', () => {
  state.paused = false;
  ui.pauseMenu.classList.add('hidden');
});

ui.restartBtn.addEventListener('click', () => {
  resetGame();
});

ui.restartFromPauseBtn.addEventListener('click', () => {
  resetGame();
});

document.getElementById('jumpBtn').addEventListener('click', () => {
  if (player.onGround && !state.paused && !state.gameOver) {
    player.velocity.y = 6.6;
    player.onGround = false;
  }
});

document.getElementById('attackBtn').addEventListener('click', () => triggerAttack());
document.getElementById('pauseBtn').addEventListener('click', () => handlePauseToggle());

setupWorld();
createPlayerModel();
createMissionMarker();
resetGame();
updateMissionMarker();
updateHUD();

function animate(now) {
  const dt = Math.min((now - state.lastTime) / 1000, 0.033);
  state.lastTime = now;

  if (!state.paused && !state.gameOver) {
    updatePlayer(dt);
    updateEnemies(dt);
    updatePedestrians(dt);
    updateVehicles(dt);
    updateMissionMarker();
  }

  updateCamera();
  updateHUD();
  updateMinimap();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
