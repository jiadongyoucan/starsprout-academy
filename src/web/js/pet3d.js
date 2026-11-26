import * as THREE from './vendor/three.module.min.js';

const PALETTE = {
  bunny: { body: 0xfff4e2, shade: 0xecd7b8, inner: 0xfbcfe8, accent: 0xf9a8d4 },
  fox: { body: 0xfdba74, shade: 0xf59e0b, inner: 0xfed7aa, accent: 0xfb923c },
  dragon: { body: 0xa7f3d0, shade: 0x6ee7b7, inner: 0xfde68a, accent: 0x34d399 },
};
const MOOD_FACE = {
  happy: { eye: 0.9, mouth: 0.35 },
  excited: { eye: 1.15, mouth: 0.8 },
  hungry: { eye: 1.05, mouth: 0.9 },
  sleepy: { eye: 0.08, mouth: 0.2 },
  missing: { eye: 1.0, mouth: 0.1 },
};

function mat(color, rough = 0.82) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }); }
function ball(parent, color, r, x, y, z, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), mat(color));
  mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function capsule(parent, color, r, len, x, y, z, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), mat(color));
  mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.castShadow = true; parent.add(mesh); return mesh;
}
function spriteText(text, color = '#ef476f', size = 0.42) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d'); ctx.font = '86px "Apple Color Emoji","PingFang SC",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.setScalar(size); return sprite;
}

export function createPet3D({ container, pet, compact = false, onPat = null }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch { return null; }
  const surface = renderer.domElement;
  surface.setAttribute('aria-label', `和${pet.name}互动：拖拽旋转，点击或按 Enter 摸摸`);
  surface.setAttribute('role', 'button');
  surface.setAttribute('aria-keyshortcuts', 'Enter Space');
  surface.classList.add('pet3d-webgl');
  container.appendChild(surface);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  const clock = new THREE.Clock();
  const world = new THREE.Group(); scene.add(world);

  // lights
  scene.add(new THREE.HemisphereLight(0xfff6e5, 0xb9d7cf, 1.5));
  const key = new THREE.DirectionalLight(0xffe2b7, 2.2); key.position.set(3, 6, 4); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -5; key.shadow.camera.right = 5; key.shadow.camera.top = 5; key.shadow.camera.bottom = -3; scene.add(key);
  const rim = new THREE.PointLight(0xcdb8ff, 20, 10); rim.position.set(-3, 2.5, 1); scene.add(rim);

  // room
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), mat(0xe9d6b8, 0.95));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), mat(0xf7ead5, 0.95));
  wall.position.set(0, 3, -3.2); scene.add(wall);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(2.1, 48), mat(0xf1c98d, 0.95));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.012, 0.2); rug.receiveShadow = true; scene.add(rug);
  const windowPane = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.6), new THREE.MeshBasicMaterial({ color: 0xa9ddff }));
  windowPane.position.set(-2.7, 2.75, -3.15); scene.add(windowPane);
  for (const [w, h, x, y] of [[2.35, 0.1, -2.7, 3.6], [2.35, 0.1, -2.7, 1.9], [0.1, 1.8, -3.82, 2.75], [0.1, 1.8, -1.58, 2.75]]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.09), mat(0xfffaf0)); frame.position.set(x, y, -3.08); scene.add(frame);
  }
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd45e }));
  sun.position.set(-2.7, 2.9, -3.02); scene.add(sun);
  // plant
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.2, 0.4, 16), mat(0xc47a4a)); pot.position.set(2.9, 0.2, -1.5); pot.castShadow = true; scene.add(pot);
  for (let i = 0; i < 5; i++) {
    const leaf = ball(scene, 0x69a95b, 0.18, 2.9 + Math.cos(i * 1.8) * 0.2, 0.55 + i * 0.12, -1.5 + Math.sin(i * 1.8) * 0.15, 0.8, 1.5, 0.5);
    leaf.rotation.z = i * 0.4;
  }

  const palette = PALETTE[pet.species] || PALETTE.bunny;
  const petGroup = new THREE.Group(); petGroup.position.y = 0.05; world.add(petGroup);
  ball(petGroup, palette.body, 0.85, 0, 0.95, 0, 1, 0.9, 0.85);
  ball(petGroup, 0xfffaf0, 0.52, 0, 0.8, 0.5, 1, 0.8, 0.5);
  const head = new THREE.Group(); head.position.set(0, 1.75, 0.05); petGroup.add(head);
  ball(head, palette.body, 0.6, 0, 0, 0, 1.05, 0.95, 1);
  // ears
  if (pet.species === 'bunny') {
    for (const s of [-1, 1]) {
      const ear = capsule(head, palette.body, 0.16, 0.62, s * 0.32, 0.72, -0.02, 0.08, 0, s * -0.18);
      capsule(ear, palette.inner, 0.085, 0.42, 0, 0.03, 0.14, 0, 0, 0);
    }
  } else if (pet.species === 'fox') {
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.62, 4), mat(palette.body));
      ear.position.set(s * 0.35, 0.65, -0.02); ear.rotation.z = s * -0.15; ear.castShadow = true; head.add(ear);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.34, 4), mat(palette.inner));
      inner.position.set(s * 0.35, 0.67, 0.13); inner.rotation.z = s * -0.15; head.add(inner);
    }
  } else {
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 7), mat(0xfde68a));
      horn.position.set(s * 0.28, 0.62, -0.1); horn.rotation.z = s * -0.25; head.add(horn);
    }
    ball(head, palette.accent, 0.1, 0, 0.7, 0.18);
  }
  // cheeks
  for (const s of [-1, 1]) ball(head, 0xfb7185, 0.13, s * 0.35, -0.08, 0.46, 1, 0.55, 0.25).material.transparent = true;
  // muzzle
  ball(head, 0xfffaf0, 0.27, 0, -0.12, 0.44, 1.1, 0.75, 0.6);
  const nose = ball(head, 0x3b2a1f, 0.055, 0, -0.02, 0.67, 1.2, 0.8, 0.5);
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(s * 0.23, 0.13, 0.57); head.add(eye);
    const white = ball(eye, 0xffffff, 0.105, 0, 0, 0, 1, 1.1, 0.6); white.material.roughness = 0.4;
    ball(eye, 0x2b2118, 0.062, s * 0.008, 0, 0.055, 1, 1.05, 0.6);
    ball(eye, 0xffffff, 0.018, s * 0.02, 0.025, 0.08);
    eyes.push(eye);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.022, 8, 20, Math.PI), mat(0x4a2b1c));
  mouth.position.set(0, -0.2, 0.63); mouth.rotation.z = Math.PI; head.add(mouth);
  // arms, feet, tail
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = capsule(petGroup, palette.body, 0.12, 0.28, s * 0.78, 0.9, 0.22, 0.1, 0, s * 0.8); arms.push(arm);
    ball(petGroup, palette.body, 0.2, s * 0.44, 0.12, 0.25, 1.1, 0.55, 1.25);
  }
  const tail = pet.species === 'fox' ? new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 10), mat(palette.body)) : ball(petGroup, palette.body, 0.2, 0.82, 0.65, -0.35, 1, 1, 1.4);
  if (pet.species === 'fox') { tail.position.set(0.78, 0.62, -0.4); tail.rotation.z = -1.1; tail.castShadow = true; petGroup.add(tail); }

  // accessories
  const accessoryGroup = new THREE.Group(); head.add(accessoryGroup);
  let capeMesh = null;
  function rebuildAccessories(equipped = []) {
    accessoryGroup.clear();
    if (capeMesh) { petGroup.remove(capeMesh); capeMesh = null; }
    if (equipped.includes('yellow-hat')) {
      const hat = new THREE.Group();
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 24), mat(0xf6b94a)); brim.position.y = 0.04; hat.add(brim);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 0.3, 20), mat(0xf6b94a)); crown.position.y = 0.2; hat.add(crown);
      hat.position.set(0, 0.55, 0); accessoryGroup.add(hat);
    }
    if (equipped.includes('round-glasses')) {
      for (const s of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 24), mat(0x4338ca, 0.4));
        ring.position.set(s * 0.23, 0.13, 0.64); accessoryGroup.add(ring);
      }
    }
    if (equipped.includes('flower-scarf')) {
      const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 8, 28), mat(0xfb7185));
      scarf.position.set(0, -0.55, 0); scarf.rotation.x = Math.PI / 2; accessoryGroup.add(scarf);
    }
    if (equipped.includes('star-cape')) {
      const cape = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.5), mat(0x6366f1));
      cape.position.set(0, 0.85, -0.55); cape.rotation.x = -0.2; petGroup.add(cape); capeMesh = cape;
    }
    if (equipped.includes('crown')) {
      for (let i = 0; i < 5; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 5), mat(0xfcd34d));
        spike.position.set((i - 2) * 0.12, 0.62, 0.15); accessoryGroup.add(spike);
      }
    }
  }
  rebuildAccessories(pet.equipped || []);

  const effects = new THREE.Group(); scene.add(effects);
  function spawnHeart(offset = 0) {
    const heart = spriteText('♥', '#ef476f', 0.3);
    heart.position.set((Math.random() - 0.5) * 0.8 + offset, 2.3, 0.6); effects.add(heart);
    hearts.push({ sprite: heart, life: 1.4, vy: 0.8 + Math.random() * 0.4 });
  }
  function spawnSparkle() {
    const z = spriteText('✨', '#7c6cf0', 0.32);
    z.position.set((Math.random() - 0.5) * 1.1, 1.0 + Math.random() * 0.8, 0.55); effects.add(z); sparkles.push({ sprite: z, life: 1.5, vy: 0.7 });
  }
  function spawnZzz() {
    const z = spriteText('Z', '#6366f1', 0.28);
    z.position.set(0.7, 2.2, 0.2); effects.add(z); zzzs.push({ sprite: z, life: 2.2, vy: 0.4 });
  }
  const hearts = []; const zzzs = []; const sparkles = [];
  let food = null;
  function spawnFood() {
    if (food) { effects.remove(food); food = null; }
    const group = new THREE.Group();
    const carrot = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.42, 10), mat(0xf97316)); carrot.rotation.z = Math.PI; group.add(carrot);
    for (let i = 0; i < 3; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 6), mat(0x65a30d));
      leaf.position.set(Math.cos(i * 2.1) * 0.08, 0.3, Math.sin(i * 2.1) * 0.08); leaf.rotation.z = i - 1; group.add(leaf);
    }
    group.position.set(0.75, 1.25, 1.0); effects.add(group); food = group;
  }
  let action = null; let actionStart = 0; let mood = pet.mood || 'happy'; let equipped = pet.equipped || [];
  function faceFor(name) {
    const f = name === 'feed' ? { eye: 1.15, mouth: 0.95 } : name === 'pet' ? { eye: 0.06, mouth: 0.25 } : name === 'sleep' ? { eye: 0.04, mouth: 0.1 } : name === 'play' ? { eye: 1.2, mouth: 0.9 } : MOOD_FACE[mood] || MOOD_FACE.happy;
    return f;
  }
  function playAction(name) {
    if (action && clock.elapsedTime - actionStart < 1.1) return;
    action = name; actionStart = clock.elapsedTime;
    if (name === 'feed') { spawnFood(); for (let i = 0; i < 3; i++) spawnHeart(); }
    if (name === 'pet') { for (let i = 0; i < 5; i++) spawnHeart(); }
    if (name === 'play') { for (let i = 0; i < 3; i++) spawnHeart(); }
    if (name === 'sleep') spawnZzz();
    if (name === 'clean') { for (let i = 0; i < 6; i++) spawnSparkle(); }
  }
  function setState(next) {
    if (!next) return;
    pet = { ...pet, ...next };
    mood = pet.mood || mood;
    if (JSON.stringify(pet.equipped || []) !== JSON.stringify(equipped)) { equipped = pet.equipped || []; rebuildAccessories(equipped); }
  }

  // interaction: orbit + tap
  let dragging = false; let lastX = 0; let lastY = 0; let moved = 0; let theta = 0; let phi = 0;
  const canvas = surface;
  canvas.style.touchAction = 'pan-y'; canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', e => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY; moved += Math.abs(dx) + Math.abs(dy);
    theta = Math.max(-0.7, Math.min(0.7, theta + dx * 0.005));
    phi = Math.max(-0.25, Math.min(0.35, phi + dy * 0.003));
    lastX = e.clientX; lastY = e.clientY; canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointerup', () => {
    dragging = false; canvas.style.cursor = 'grab';
    if (moved < 6) { playAction('pet'); if (onPat) onPat(); }
  });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  canvas.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playAction('pet'); if (onPat) onPat(); } });
  canvas.tabIndex = 0;

  function resize() {
    const w = container.clientWidth || 600; const h = container.clientHeight || 420;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  let raf = 0; let disposed = false; let lastBlink = 0; let blinkStart = -1; let visible = true;
  const io = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting !== false; }, { threshold: 0.05 }); io.observe(container);
  canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); container.dispatchEvent(new CustomEvent('pet3d-lost')); });
  function frame() {
    if (disposed) return; raf = requestAnimationFrame(frame);
    const dt = Math.min(0.04, clock.getDelta()); const t = clock.elapsedTime;
    const a = action ? t - actionStart : 99;
    // camera orbit
    const radius = compact ? 7.2 : 8.0;
    camera.position.set(Math.sin(theta) * radius, 2.0 + Math.sin(phi) * 2.2, Math.cos(theta) * radius);
    camera.lookAt(0, 1.15, 0);
    // idle + action pose
    const bounce = action === 'play' && a < 1.6 ? Math.abs(Math.sin(a * 8)) * 0.18 : 0;
    const breathe = Math.sin(t * 2.1) * 0.012;
    petGroup.position.y = 0.05 + bounce + breathe;
    petGroup.rotation.y = action === 'play' && a < 1.6 ? Math.sin(a * 5) * 0.45 : Math.sin(t * 0.7) * 0.03;
    head.rotation.z = action === 'pet' && a < 1.3 ? Math.sin(a * 4) * 0.12 : Math.sin(t * 0.9) * 0.02;
    const face = faceFor(action ? action : 'idle');
    const blink = blinkStart >= 0 && t - blinkStart < 0.13 ? 0.08 : 1;
    if (blinkStart < 0 && t - lastBlink > 3.4) { lastBlink = t; blinkStart = t; }
    if (blinkStart >= 0 && t - blinkStart > 0.14) blinkStart = -1;
    for (const eye of eyes) eye.scale.y = face.eye * blink;
    mouth.rotation.z = Math.PI + (mood === 'missing' ? 0.5 : 0) + (action === 'feed' && a < 2 ? Math.sin(a * 12) * 0.2 : 0);
    mouth.scale.setScalar(1 + face.mouth * 0.3);
    arms[0].rotation.z = 0.8 + Math.sin(t * 2.4) * 0.05; arms[1].rotation.z = -0.8 - Math.sin(t * 2.4) * 0.05;
    if (action === 'feed' && food) {
      const p = Math.min(1, a / 1.4);
      food.position.lerpVectors(new THREE.Vector3(0.9, 1.2, 1.0), new THREE.Vector3(0, 1.55, 0.75), p);
      food.rotation.y += dt * 4;
      if (p >= 1) { effects.remove(food); food = null; }
    }
    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i]; h.life -= dt; h.sprite.position.y += h.vy * dt; h.sprite.material.opacity = Math.max(0, h.life);
      if (h.life <= 0) { effects.remove(h.sprite); hearts.splice(i, 1); }
    }
    for (let i = sparkles.length - 1; i >= 0; i--) { const z = sparkles[i]; z.life -= dt; z.sprite.position.y += z.vy * dt; z.sprite.material.opacity = Math.max(0, z.life); if (z.life <= 0) { effects.remove(z.sprite); sparkles.splice(i, 1); } }
    for (let i = zzzs.length - 1; i >= 0; i--) {
      const z = zzzs[i]; z.life -= dt; z.sprite.position.y += z.vy * dt; z.sprite.position.x += dt * 0.15; z.sprite.material.opacity = Math.max(0, z.life / 2.2);
      if (z.life <= 0) { effects.remove(z.sprite); zzzs.splice(i, 1); }
    }
    if (action === 'sleep' && a > 2.2) { sleepPose(true); } else { sleepPose(false); }
    if (action && a > 3.4) { action = null; }
    renderer.render(scene, camera);
  }
  function sleepPose(on) { petGroup.rotation.x = on ? -0.16 : 0; petGroup.position.z = on ? -0.15 : 0; }
  frame();

  return {
    playAction, setState,
    orbit(delta) { theta = Math.max(-0.7, Math.min(0.7, theta + delta)); },
    get canvas() { return canvas; },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      if (typeof renderer.forceContextLoss === 'function') renderer.forceContextLoss();
      if (typeof renderer.dispose === 'function') renderer.dispose(); canvas.remove();
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
        for (const material of materials) { for (const value of Object.values(material)) { if (value?.isTexture) value.dispose(); } material.dispose(); }
      });
    },
  };
}
