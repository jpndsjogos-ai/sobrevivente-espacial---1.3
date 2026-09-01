// ===== Sobrevivente Espacial - estilo Vampire Survivors, 100% offline =====

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ---------- Estado global ----------
let state = 'menu'; // menu | playing | paused | levelup | gameover
let lastTime = 0;
let elapsed = 0; // segundos de sobrevivência
let killCount = 0;
let spawnTimer = 0;
let spawnInterval = 1.4;

const world = { w: 4000, h: 4000 }; // mundo grande, câmera segue a nave

// ---------- Utilidades ----------
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function rand(min, max) { return Math.random() * (max - min) + min; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return m + ':' + s;
}

// ================= ÁUDIO (100% sintetizado, sem arquivos externos) =================
// Trilha original em estilo chiptune "inspirada" em shmups de SNES (não reproduz
// nenhuma melodia existente) + efeitos sonoros gerados via Web Audio API.

let musicOn = true, sfxOn = true;
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('survivorSettings'));
    if (s) { musicOn = s.music !== false; sfxOn = s.sfx !== false; }
  } catch (e) {}
}
function saveSettings() {
  try { localStorage.setItem('survivorSettings', JSON.stringify({ music: musicOn, sfx: sfxOn })); } catch (e) {}
}
loadSettings();

let actx = null;
function initAudio() {
  if (actx) return;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
}

function playTone(freq, duration, type, vol, freqEnd) {
  if (!sfxOn || !actx) return;
  try {
    const osc = actx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, actx.currentTime);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), actx.currentTime + duration);
    const gain = actx.createGain();
    gain.gain.setValueAtTime(vol, actx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + duration);
    osc.connect(gain); gain.connect(actx.destination);
    osc.start(); osc.stop(actx.currentTime + duration);
  } catch (e) {}
}

function createNoiseBuffer(duration) {
  const bufferSize = Math.floor(actx.sampleRate * duration);
  const buffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
function playNoise(duration, filterFreq, vol) {
  if (!sfxOn || !actx) return;
  try {
    const src = actx.createBufferSource();
    src.buffer = createNoiseBuffer(duration);
    const filter = actx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = actx.createGain();
    gain.gain.setValueAtTime(vol, actx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + duration);
    src.connect(filter); filter.connect(gain); gain.connect(actx.destination);
    src.start(); src.stop(actx.currentTime + duration);
  } catch (e) {}
}

let lastHitSfxTime = 0, lastExplosionSfxTime = 0, lastPickupSfxTime = 0;
function sfxShoot() { playTone(720, 0.07, 'square', 0.05, 260); }
function sfxHit() {
  const now = performance.now();
  if (now - lastHitSfxTime < 40) return;
  lastHitSfxTime = now;
  playNoise(0.06, 1200, 0.05);
}
function sfxExplosion() {
  const now = performance.now();
  if (now - lastExplosionSfxTime < 60) return;
  lastExplosionSfxTime = now;
  playNoise(0.3, 500, 0.16);
  playTone(110, 0.22, 'triangle', 0.1, 40);
}
function sfxBossExplosion() {
  playNoise(0.6, 400, 0.28);
  playTone(80, 0.5, 'sawtooth', 0.2, 30);
}
function sfxLevelUp() {
  playTone(523.25, 0.09, 'square', 0.1);
  setTimeout(() => playTone(659.25, 0.09, 'square', 0.1), 90);
  setTimeout(() => playTone(783.99, 0.14, 'square', 0.12), 180);
}
function sfxBossAppear() {
  playTone(90, 0.5, 'sawtooth', 0.15, 50);
  playNoise(0.5, 300, 0.1);
}
function sfxPickup() {
  const now = performance.now();
  if (now - lastPickupSfxTime < 50) return;
  lastPickupSfxTime = now;
  playTone(1046.5, 0.05, 'sine', 0.04);
}
function sfxClick() { playTone(500, 0.05, 'square', 0.05); }
function sfxPause() { playTone(300, 0.06, 'square', 0.05); }
function sfxGameOver() {
  playTone(400, 0.2, 'triangle', 0.12, 120);
  setTimeout(() => playTone(300, 0.25, 'triangle', 0.12, 80), 180);
  setTimeout(() => playTone(200, 0.35, 'triangle', 0.14, 50), 380);
}

// Música de fundo: sequenciador simples com "lookahead" (padrão da Web Audio API)
let musicTimerId = null;
let currentStep = 0;
let nextNoteTime = 0;
const MUSIC_TEMPO = 150;
const STEP_DUR = 60 / MUSIC_TEMPO / 2;
const SCHEDULE_AHEAD = 0.15;
const LOOKAHEAD_MS = 25;
const BASS_PATTERN = [82.41,82.41,82.41,82.41,110.00,110.00,82.41,82.41,98.00,98.00,82.41,82.41,110.00,110.00,123.47,123.47];
const LEAD_PATTERN = [659.25,null,783.99,null,659.25,587.33,null,659.25,783.99,null,987.77,null,880.00,783.99,null,659.25];

function playScheduledTone(freq, duration, type, vol, time) {
  if (!actx) return;
  const osc = actx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);
  const gain = actx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(vol, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(gain); gain.connect(actx.destination);
  osc.start(time); osc.stop(time + duration + 0.02);
}
function scheduleStep(step, time) {
  playScheduledTone(BASS_PATTERN[step], STEP_DUR * 0.9, 'triangle', 0.06, time);
  const lead = LEAD_PATTERN[step];
  if (lead) playScheduledTone(lead, STEP_DUR * 0.5, 'square', 0.045, time);
}
function musicScheduler() {
  while (nextNoteTime < actx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(currentStep, nextNoteTime);
    nextNoteTime += STEP_DUR;
    currentStep = (currentStep + 1) % BASS_PATTERN.length;
  }
  musicTimerId = setTimeout(musicScheduler, LOOKAHEAD_MS);
}
function startMusic() {
  if (!musicOn || !actx || musicTimerId) return;
  currentStep = 0;
  nextNoteTime = actx.currentTime + 0.05;
  musicScheduler();
}
function stopMusic() {
  if (musicTimerId) { clearTimeout(musicTimerId); musicTimerId = null; }
}

// ================= RANKING (local, baseado em kills) =================
function loadRanking() {
  try { return JSON.parse(localStorage.getItem('survivorRanking')) || []; } catch (e) { return []; }
}
function saveRankingList(list) {
  try { localStorage.setItem('survivorRanking', JSON.stringify(list)); } catch (e) {}
}
function submitScore(kills, level, timeSec) {
  const list = loadRanking();
  list.push({ kills, level, time: timeSec, date: new Date().toLocaleDateString('pt-BR') });
  list.sort((a, b) => b.kills - a.kills);
  const top = list.slice(0, 10);
  saveRankingList(top);
  return top;
}
function renderRanking() {
  const list = loadRanking();
  const el = document.getElementById('rankingList');
  el.innerHTML = '';
  if (list.length === 0) {
    el.innerHTML = '<li class="emptyRank">Nenhum recorde ainda. Jogue para entrar no ranking!</li>';
    return;
  }
  list.forEach((r, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="rankPos">${i + 1}º</span><span class="rankKills">${r.kills} kills</span><span class="rankMeta">Nv.${r.level} · ${formatTime(r.time)} · ${r.date}</span>`;
    el.appendChild(li);
  });
}

// ---------- Fundo espacial (estrelas, brilhos, estrelas cadentes) ----------
const STAR_COUNT = 260;
const stars = [];
for (let i = 0; i < STAR_COUNT; i++) {
  stars.push({ x: rand(0, world.w), y: rand(0, world.h), r: rand(0.6, 2.2), phase: rand(0, Math.PI * 2), tw: rand(0.6, 2.2) });
}
const SPARK_COUNT = 20;
const sparkles = [];
for (let i = 0; i < SPARK_COUNT; i++) {
  sparkles.push({ x: rand(0, world.w), y: rand(0, world.h), size: rand(7, 15), phase: rand(0, Math.PI * 2) });
}
let shootingStars = [];
let shootingTimer = rand(2, 5);

function updateBackground(dt) {
  shootingTimer -= dt;
  if (shootingTimer <= 0) {
    shootingTimer = rand(3, 7);
    const fromLeft = Math.random() < 0.5;
    shootingStars.push({
      x: fromLeft ? -40 : canvas.width + 40, y: rand(0, canvas.height * 0.5),
      vx: (fromLeft ? 1 : -1) * rand(360, 520), vy: rand(160, 240), life: 1
    });
  }
  shootingStars.forEach(s => { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt * 0.7; });
  shootingStars = shootingStars.filter(s => s.life > 0);
}

function drawBackground(camX, camY, time) {
  const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  g.addColorStop(0, '#100b28'); g.addColorStop(0.45, '#4a1a86');
  g.addColorStop(0.75, '#5c1f9e'); g.addColorStop(1, '#160c33');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const glow = ctx.createRadialGradient(canvas.width * 0.4, canvas.height * 0.35, 0, canvas.width * 0.4, canvas.height * 0.35, Math.max(canvas.width, canvas.height) * 0.7);
  glow.addColorStop(0, 'rgba(150,80,220,0.35)'); glow.addColorStop(1, 'rgba(150,80,220,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  stars.forEach(s => {
    const sx = s.x - camX, sy = s.y - camY;
    if (sx < -10 || sy < -10 || sx > canvas.width + 10 || sy > canvas.height + 10) return;
    ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(time * s.tw + s.phase));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(sx, sy, s.r, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;

  sparkles.forEach(sp => {
    const sx = sp.x - camX, sy = sp.y - camY;
    if (sx < -20 || sy < -20 || sx > canvas.width + 20 || sy > canvas.height + 20) return;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.globalAlpha = 0.25 + 0.55 * Math.abs(Math.sin(time * 1.4 + sp.phase));
    ctx.fillStyle = '#ffffff';
    const s = sp.size;
    ctx.beginPath();
    ctx.moveTo(0, -s); ctx.lineTo(s * 0.18, -s * 0.18); ctx.lineTo(s, 0); ctx.lineTo(s * 0.18, s * 0.18);
    ctx.lineTo(0, s); ctx.lineTo(-s * 0.18, s * 0.18); ctx.lineTo(-s, 0); ctx.lineTo(-s * 0.18, -s * 0.18);
    ctx.closePath(); ctx.fill(); ctx.restore();
  });
  ctx.globalAlpha = 1;

  shootingStars.forEach(s => {
    const grad = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 0.12, s.y - s.vy * 0.12);
    grad.addColorStop(0, `rgba(255,255,255,${s.life})`); grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = grad; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.12, s.y - s.vy * 0.12); ctx.stroke();
  });
}

// ---------- Jogador (nave espacial) ----------
const player = {
  x: world.w / 2, y: world.h / 2, radius: 16, angle: -Math.PI / 2,
  speed: 190, hp: 100, maxHp: 100, level: 1, xp: 0, xpToNext: 10,
  damage: 10, fireRate: 0.6, fireTimer: 0, range: 260, projectileSpeed: 420,
  multishot: 1, pierce: 1, regen: 0,
  twinGuns: false, hasShield: false, hasArmor: false, turboThruster: false, chromeHull: false,
  shipUpgradesTaken: new Set(), gunToggle: false, thrusting: false
};

let enemies = [];
let projectiles = [];
let orbs = [];
let particles = [];
let bossThresholdsSpawned = new Set();
let activeBoss = null;

// ---------- Controles ----------
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === 'Escape') {
    if (state === 'playing') document.getElementById('pauseBtn').click();
    else if (state === 'paused') document.getElementById('resumeBtn').click();
  }
});
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

let joyVec = { x: 0, y: 0 };
let joyActive = false;
const joystickZone = document.getElementById('joystickZone');
const joystickBase = document.getElementById('joystickBase');
const joystickStick = document.getElementById('joystickStick');
let joyOrigin = { x: 0, y: 0 };

function joyStart(clientX, clientY) {
  joyActive = true;
  joyOrigin = { x: clientX, y: clientY };
  joystickBase.style.display = 'block';
  joystickBase.style.left = (clientX - 55) + 'px';
  joystickBase.style.top = (clientY - 55) + 'px';
  joystickStick.style.left = '32px'; joystickStick.style.top = '32px';
}
function joyMove(clientX, clientY) {
  if (!joyActive) return;
  let dx = clientX - joyOrigin.x, dy = clientY - joyOrigin.y;
  const maxDist = 45;
  const distv = Math.min(Math.hypot(dx, dy), maxDist);
  const angle = Math.atan2(dy, dx);
  const sx = Math.cos(angle) * distv, sy = Math.sin(angle) * distv;
  joystickStick.style.left = (32 + sx) + 'px'; joystickStick.style.top = (32 + sy) + 'px';
  joyVec.x = Math.cos(angle) * (distv / maxDist); joyVec.y = Math.sin(angle) * (distv / maxDist);
}
function joyEnd() { joyActive = false; joyVec = { x: 0, y: 0 }; joystickBase.style.display = 'none'; }

joystickZone.addEventListener('touchstart', e => { const t = e.changedTouches[0]; joyStart(t.clientX, t.clientY); });
joystickZone.addEventListener('touchmove', e => { const t = e.changedTouches[0]; joyMove(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
joystickZone.addEventListener('touchend', joyEnd);
joystickZone.addEventListener('touchcancel', joyEnd);

// ---------- Formas dos asteroides ----------
function makeAsteroidShape(n, minS, maxS) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push({ ang: (i / n) * Math.PI * 2, rad: rand(minS, maxS) });
  return pts;
}

// ---------- Bosses com aparência de elementos químicos ----------
const BOSS_ELEMENTS = [
  { symbol: 'Fe', name: 'Ferro',      color: '#c1440e', glow: '#ff9a4d' },
  { symbol: 'Ti', name: 'Titânio',    color: '#b9bec4', glow: '#eef3f7' },
  { symbol: 'U',  name: 'Urânio',     color: '#4caf1f', glow: '#8dff4d' },
  { symbol: 'Pu', name: 'Plutônio',   color: '#7d3cff', glow: '#c9a6ff' },
  { symbol: 'Os', name: 'Ósmio',      color: '#3d8bbd', glow: '#a0e2ff' },
  { symbol: 'Ir', name: 'Irídio',     color: '#d8d8de', glow: '#ffffff' },
  { symbol: 'W',  name: 'Tungstênio', color: '#5c5c5c', glow: '#b5b5b5' },
  { symbol: 'Pd', name: 'Paládio',    color: '#d9d3b8', glow: '#fff8dc' },
  { symbol: 'Rh', name: 'Ródio',      color: '#ff6ec7', glow: '#ffc2ea' },
  { symbol: 'Pt', name: 'Platina',    color: '#e5e4e2', glow: '#ffffff' }
];

const BOSS_START_LEVEL = 10;
const BOSS_INTERVAL = 3;

function asteroidBaseHp(level) { return 18 + level * 7; }
function asteroidBaseSpeed(level) { return 60 + Math.min(level, 25) * 2.5; }
function asteroidRadius(level) { return 13 + Math.min(level, 30) * 0.55; }

function spawnBoss(level) {
  const tierIndex = Math.floor((level - BOSS_START_LEVEL) / BOSS_INTERVAL);
  const elem = BOSS_ELEMENTS[tierIndex % BOSS_ELEMENTS.length];
  const baseHp = asteroidBaseHp(BOSS_START_LEVEL);
  let hp = baseHp * 50;
  for (let i = 0; i < tierIndex; i++) hp *= 5;

  const angle = rand(0, Math.PI * 2);
  const spawnDist = 600;
  const x = clamp(player.x + Math.cos(angle) * spawnDist, 60, world.w - 60);
  const y = clamp(player.y + Math.sin(angle) * spawnDist, 60, world.h - 60);
  const radius = 68 + Math.min(tierIndex, 6) * 9;

  const boss = {
    x, y, radius, hp, maxHp: hp,
    speed: 44 + tierIndex * 2, damage: 28 + tierIndex * 6,
    isBoss: true, color: elem.color, glow: elem.glow, symbol: elem.symbol, name: elem.name,
    rot: 0, rotSpeed: rand(-0.12, 0.12),
    shapePoints: makeAsteroidShape(16, 0.75, 1.12), hitFlash: 0
  };
  enemies.push(boss);
  activeBoss = boss;
  showBossAlert(elem.name, elem.symbol);
  sfxBossAppear();
}

function maybeSpawnBoss(level) {
  if (level < BOSS_START_LEVEL) return;
  if ((level - BOSS_START_LEVEL) % BOSS_INTERVAL !== 0) return;
  if (bossThresholdsSpawned.has(level)) return;
  bossThresholdsSpawned.add(level);
  spawnBoss(level);
}

function showBossAlert(name, symbol) {
  const el = document.getElementById('bossAlert');
  el.textContent = `⚠ Boss de ${symbol} — ${name} apareceu!`;
  el.classList.remove('hidden'); el.classList.add('show');
  clearTimeout(showBossAlert._t);
  showBossAlert._t = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 400);
  }, 3200);
}

// ---------- Spawn de asteroides comuns ----------
function spawnEnemy() {
  const angle = rand(0, Math.PI * 2);
  const spawnDist = 520;
  const x = clamp(player.x + Math.cos(angle) * spawnDist, 20, world.w - 20);
  const y = clamp(player.y + Math.sin(angle) * spawnDist, 20, world.h - 20);

  const level = player.level;
  const isFast = Math.random() < 0.18;
  const baseHp = asteroidBaseHp(level);
  const baseSpeed = asteroidBaseSpeed(level);
  const baseRadius = asteroidRadius(level);

  enemies.push({
    x, y,
    radius: isFast ? baseRadius * 0.68 : baseRadius,
    hp: isFast ? baseHp * 0.55 : baseHp,
    maxHp: isFast ? baseHp * 0.55 : baseHp,
    speed: isFast ? baseSpeed * 1.6 : baseSpeed,
    damage: 8 + Math.floor(level / 3) * 2,
    color: isFast ? '#e0a94a' : (level > 18 ? '#9b8f89' : level > 9 ? '#8f8479' : '#7d7669'),
    isBoss: false, rot: rand(0, Math.PI * 2), rotSpeed: rand(-0.6, 0.6) * (isFast ? 1.4 : 1),
    shapePoints: makeAsteroidShape(9, 0.72, 1.18), hitFlash: 0
  });
}

// ---------- Visual dos projéteis (evolui com o nível) ----------
function projectileVisual(level) {
  if (level >= 25) return { size: 8, color: 'rainbow', glow: 26, trail: true, rings: 2 };
  if (level >= 15) return { size: 7, color: '#ff6ec7', glow: 20, trail: true, rings: 1 };
  if (level >= 10) return { size: 6, color: '#a685ff', glow: 14, trail: true, rings: 0 };
  if (level >= 5)  return { size: 5, color: '#7CFAFF', glow: 8,  trail: false, rings: 0 };
  return { size: 4, color: '#ffe66d', glow: 0, trail: false, rings: 0 };
}

// ---------- Ataque automático ----------
function tryFire(dt) {
  player.fireTimer -= dt;
  if (player.fireTimer > 0) return;
  if (enemies.length === 0) return;

  const inRange = enemies.map(e => ({ e, d: dist(player, e) })).filter(o => o.d <= player.range).sort((a, b) => a.d - b.d);
  if (inRange.length === 0) return;

  player.fireTimer = player.fireRate;
  const visual = projectileVisual(player.level);
  sfxShoot();

  const targets = inRange.slice(0, player.multishot);
  targets.forEach(({ e }) => {
    const angle = Math.atan2(e.y - player.y, e.x - player.x);
    let originX = player.x, originY = player.y;
    if (player.twinGuns) {
      player.gunToggle = !player.gunToggle;
      const perp = angle + Math.PI / 2;
      const off = player.gunToggle ? 10 : -10;
      originX += Math.cos(perp) * off; originY += Math.sin(perp) * off;
    }
    projectiles.push({
      x: originX, y: originY,
      vx: Math.cos(angle) * player.projectileSpeed, vy: Math.sin(angle) * player.projectileSpeed,
      damage: player.damage, pierce: player.pierce, radius: visual.size, life: 1.4, visual
    });
  });
}

// ---------- Upgrades ----------
const UPGRADE_POOL = [
  { id: 'dmg', icon: '⚔️', name: 'Dano +', desc: '+35% dano', apply: p => p.damage *= 1.35 },
  { id: 'rate', icon: '⚡', name: 'Veloc. Ataque', desc: '-15% recarga', apply: p => p.fireRate = Math.max(0.12, p.fireRate * 0.85) },
  { id: 'speed', icon: '🚀', name: 'Velocidade', desc: '+15% movimento', apply: p => p.speed *= 1.15 },
  { id: 'hp', icon: '❤️', name: 'Vida Máx.', desc: '+25 HP e cura', apply: p => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); } },
  { id: 'range', icon: '🎯', name: 'Alcance', desc: '+20% alcance', apply: p => p.range *= 1.2 },
  { id: 'multi', icon: '✳️', name: 'Multi-tiro', desc: '+1 projétil', apply: p => p.multishot += 1 },
  { id: 'pierce', icon: '🗡️', name: 'Perfuração', desc: '+1 perfuração', apply: p => p.pierce += 1 },
  { id: 'regen', icon: '💚', name: 'Regeneração', desc: '+0.5 HP/seg', apply: p => p.regen += 0.5 }
];

// upgrades visuais + funcionais da nave, liberados a partir do nível 20
const SHIP_UPGRADES = [
  { id: 'twinGuns', icon: '🔫', name: 'Canhões Gêmeos', desc: 'Visual: canhões duplos + dano', apply: p => { p.twinGuns = true; p.damage *= 1.15; } },
  { id: 'shield', icon: '🛡️', name: 'Escudo de Energia', desc: 'Visual: escudo + regeneração', apply: p => { p.hasShield = true; p.regen += 1; } },
  { id: 'armor', icon: '⚙️', name: 'Blindagem Reforçada', desc: 'Visual: placas + vida máx.', apply: p => { p.hasArmor = true; p.maxHp += 40; p.hp += 40; } },
  { id: 'turbo', icon: '🔥', name: 'Motor Turbo', desc: 'Visual: chama maior + velocidade', apply: p => { p.turboThruster = true; p.speed *= 1.2; } },
  { id: 'chrome', icon: '✨', name: 'Casco Cromado', desc: 'Visual: nave dourada + perfuração', apply: p => { p.chromeHull = true; p.pierce += 1; } }
];

function openLevelUp() {
  state = 'levelup';
  sfxLevelUp();
  document.getElementById('levelUpScreen').classList.remove('hidden');
  const choicesEl = document.getElementById('upgradeChoices');
  choicesEl.innerHTML = '';

  let pool = [...UPGRADE_POOL];
  if (player.level >= 20) {
    const shipAvail = SHIP_UPGRADES.filter(u => !player.shipUpgradesTaken.has(u.id));
    pool = pool.concat(shipAvail);
  }

  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
  shuffled.forEach(up => {
    const isShip = SHIP_UPGRADES.some(u => u.id === up.id);
    const card = document.createElement('div');
    card.className = 'upgradeCard' + (isShip ? ' shipUpgradeCard' : '');
    card.innerHTML = `<div class="icon">${up.icon}</div><div class="name">${up.name}</div><div class="desc">${up.desc}</div>`;
    card.onclick = () => {
      up.apply(player);
      if (isShip) player.shipUpgradesTaken.add(up.id);
      sfxClick();
      document.getElementById('levelUpScreen').classList.add('hidden');
      state = 'playing';
    };
    choicesEl.appendChild(card);
  });
}

function gainXp(amount) {
  player.xp += amount;
  if (player.xp >= player.xpToNext) {
    player.xp -= player.xpToNext;
    player.level += 1;
    player.xpToNext = Math.floor(player.xpToNext * 1.28 + 6);
    maybeSpawnBoss(player.level);
    openLevelUp();
  }
}

// ---------- Loop principal ----------
function update(dt) {
  if (state !== 'playing') return;

  elapsed += dt;
  updateBackground(dt);

  spawnInterval = Math.max(0.28, 1.4 - elapsed * 0.008);
  spawnTimer += dt;
  if (spawnTimer >= spawnInterval) {
    spawnTimer = 0;
    spawnEnemy();
    if (elapsed > 60 && Math.random() < 0.3) spawnEnemy();
  }

  let mx = 0, my = 0;
  if (keys['w'] || keys['arrowup']) my -= 1;
  if (keys['s'] || keys['arrowdown']) my += 1;
  if (keys['a'] || keys['arrowleft']) mx -= 1;
  if (keys['d'] || keys['arrowright']) mx += 1;
  if (joyActive) { mx = joyVec.x; my = joyVec.y; }

  const mlen = Math.hypot(mx, my);
  if (mlen > 0.05) {
    mx /= (mlen > 1 ? mlen : 1); my /= (mlen > 1 ? mlen : 1);
    player.x = clamp(player.x + mx * player.speed * dt, player.radius, world.w - player.radius);
    player.y = clamp(player.y + my * player.speed * dt, player.radius, world.h - player.radius);
    player.angle = Math.atan2(my, mx);
    player.thrusting = true;
  } else {
    player.thrusting = false;
  }

  if (player.regen > 0) player.hp = Math.min(player.maxHp, player.hp + player.regen * dt);

  tryFire(dt);

  enemies.forEach(e => {
    const angle = Math.atan2(player.y - e.y, player.x - e.x);
    e.x += Math.cos(angle) * e.speed * dt; e.y += Math.sin(angle) * e.speed * dt;
    e.rot += e.rotSpeed * dt;
    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (dist(player, e) < player.radius + e.radius) player.hp -= e.damage * dt;
  });

  projectiles.forEach(p => {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.visual.trail && Math.random() < 0.5) {
      const c = p.visual.color === 'rainbow' ? `hsl(${(performance.now() / 4) % 360},100%,65%)` : p.visual.color;
      particles.push({ x: p.x, y: p.y, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.25, color: c });
    }
  });
  projectiles = projectiles.filter(p => p.life > 0 && p.pierce > 0);

  projectiles.forEach(p => {
    enemies.forEach(e => {
      if (p.pierce <= 0) return;
      if (dist(p, e) < p.radius + e.radius) {
        e.hp -= p.damage; e.hitFlash = 0.1; p.pierce -= 1;
        sfxHit();
      }
    });
  });

  const dead = enemies.filter(e => e.hp <= 0);
  dead.forEach(e => {
    killCount++;
    if (e.isBoss) {
      activeBoss = null;
      sfxBossExplosion();
      for (let i = 0; i < 8; i++) orbs.push({ x: e.x + rand(-30, 30), y: e.y + rand(-30, 30), radius: 8, value: 20 });
      for (let i = 0; i < 40; i++) particles.push({ x: e.x, y: e.y, vx: rand(-220, 220), vy: rand(-220, 220), life: 0.8, color: e.color });
    } else {
      sfxExplosion();
      let value = 3 + Math.floor(Math.random() * 3);
      let bonus = false;
      if (player.level >= 15 && Math.random() < 0.2) { value *= 2; bonus = true; }
      orbs.push({ x: e.x, y: e.y, radius: bonus ? 9 : 6, value, bonus });
      const n = bonus ? 10 : 6;
      for (let i = 0; i < n; i++) particles.push({ x: e.x, y: e.y, vx: rand(-90, 90), vy: rand(-90, 90), life: bonus ? 0.55 : 0.4, color: bonus ? '#ffd166' : e.color });
    }
  });
  enemies = enemies.filter(e => e.hp > 0);

  orbs.forEach(o => {
    const d = dist(player, o);
    if (d < 90) {
      const angle = Math.atan2(player.y - o.y, player.x - o.x);
      o.x += Math.cos(angle) * 260 * dt; o.y += Math.sin(angle) * 260 * dt;
    }
    if (d < player.radius + o.radius) {
      gainXp(o.value); o.collected = true; sfxPickup();
    }
  });
  orbs = orbs.filter(o => !o.collected);

  particles.forEach(pt => { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.life -= dt; });
  particles = particles.filter(pt => pt.life > 0);

  if (player.hp <= 0) triggerGameOver();

  updateHud();
}

function updateHud() {
  document.getElementById('hpBar').style.width = clamp((player.hp / player.maxHp) * 100, 0, 100) + '%';
  document.getElementById('levelInfo').textContent = 'Nv. ' + player.level;
  document.getElementById('timeInfo').textContent = formatTime(elapsed);
  document.getElementById('killInfo').textContent = 'Kills: ' + killCount;

  const bossBar = document.getElementById('bossBarWrap');
  if (activeBoss && activeBoss.hp > 0) {
    bossBar.classList.remove('hidden');
    document.getElementById('bossName').textContent = `${activeBoss.symbol} · ${activeBoss.name}`;
    document.getElementById('bossHpFill').style.width = clamp((activeBoss.hp / activeBoss.maxHp) * 100, 0, 100) + '%';
  } else {
    bossBar.classList.add('hidden');
  }
}

// ---------- Desenho ----------
function drawAsteroid(e, camX, camY) {
  ctx.save();
  ctx.translate(e.x - camX, e.y - camY);
  ctx.rotate(e.rot);
  if (e.isBoss) {
    const pulse = 1 + Math.sin(performance.now() / 260) * 0.03;
    ctx.shadowColor = e.glow; ctx.shadowBlur = 30; ctx.scale(pulse, pulse);
  }
  ctx.beginPath();
  e.shapePoints.forEach((pt, i) => {
    const r = e.radius * pt.rad;
    const px = Math.cos(pt.ang) * r, py = Math.sin(pt.ang) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : e.color;
  ctx.fill();
  ctx.strokeStyle = e.isBoss ? e.glow : 'rgba(0,0,0,0.35)';
  ctx.lineWidth = e.isBoss ? 3 : 1.5;
  ctx.stroke();
  ctx.restore();

  if (e.isBoss) {
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(14, e.radius * 0.55)}px Arial`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = e.glow; ctx.shadowBlur = 12;
    ctx.fillText(e.symbol, e.x - camX, e.y - camY);
    ctx.shadowBlur = 0;
  }
}

function metalGradient(offY, halfWidth, gold) {
  const g = ctx.createLinearGradient(0, offY - halfWidth, 0, offY + halfWidth);
  if (gold) {
    g.addColorStop(0, '#8a6a1f'); g.addColorStop(0.5, '#ffe9a8'); g.addColorStop(1, '#8a6a1f');
  } else {
    g.addColorStop(0, '#6f767e'); g.addColorStop(0.5, '#f2f5f7'); g.addColorStop(1, '#6f767e');
  }
  return g;
}
function noseGradient(offY, halfWidth) {
  const g = ctx.createLinearGradient(0, offY - halfWidth, 0, offY + halfWidth);
  g.addColorStop(0, '#a8360a'); g.addColorStop(0.5, '#ffb457'); g.addColorStop(1, '#a8360a');
  return g;
}
function drawRocketSegment(offY, xTail, xNoseTip, halfWidth, gold) {
  const xNoseBase = xNoseTip - halfWidth * 2.2;
  ctx.beginPath();
  ctx.moveTo(xTail + halfWidth * 0.3, offY - halfWidth);
  ctx.lineTo(xNoseBase, offY - halfWidth);
  ctx.lineTo(xNoseBase, offY + halfWidth);
  ctx.lineTo(xTail + halfWidth * 0.3, offY + halfWidth);
  ctx.quadraticCurveTo(xTail, offY + halfWidth, xTail, offY);
  ctx.quadraticCurveTo(xTail, offY - halfWidth, xTail + halfWidth * 0.3, offY - halfWidth);
  ctx.closePath();
  ctx.fillStyle = metalGradient(offY, halfWidth, gold);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();

  ctx.strokeStyle = 'rgba(20,20,25,0.5)'; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(xNoseBase, offY - halfWidth); ctx.lineTo(xNoseBase, offY + halfWidth); ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(xNoseBase, offY - halfWidth);
  ctx.quadraticCurveTo(xNoseTip, offY - halfWidth * 0.4, xNoseTip, offY);
  ctx.quadraticCurveTo(xNoseTip, offY + halfWidth * 0.4, xNoseBase, offY + halfWidth);
  ctx.closePath();
  ctx.fillStyle = noseGradient(offY, halfWidth);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
}
function drawWings(r) {
  ctx.fillStyle = '#aab0b6';
  ctx.strokeStyle = 'rgba(20,20,25,0.5)';
  ctx.lineWidth = 1.2;
  [1, -1].forEach(sign => {
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, sign * r * 0.32);
    ctx.lineTo(-r * 1.05, sign * r * 1.0);
    ctx.lineTo(-r * 0.75, sign * r * 0.34);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  });
}
function drawFlame(offY, xBase, len) {
  const flick = rand(0.75, 1.15);
  const grad = ctx.createLinearGradient(xBase, offY, xBase - len * flick, offY);
  grad.addColorStop(0, 'rgba(255,220,140,0.95)');
  grad.addColorStop(0.5, 'rgba(255,150,50,0.85)');
  grad.addColorStop(1, 'rgba(255,80,20,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(xBase, offY - 3);
  ctx.lineTo(xBase - len * flick, offY);
  ctx.lineTo(xBase, offY + 3);
  ctx.closePath();
  ctx.fill();
}

function drawShip(camX, camY) {
  const sx = player.x - camX, sy = player.y - camY;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(player.angle);
  const r = player.radius;

  if (player.hasShield) {
    const pulse = 1 + Math.sin(performance.now() / 200) * 0.08;
    ctx.save();
    ctx.scale(pulse, pulse);
    ctx.strokeStyle = 'rgba(120,220,255,0.55)';
    ctx.lineWidth = 2; ctx.shadowColor = '#78dcff'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.85, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  if (player.thrusting) {
    const boosted = player.turboThruster;
    drawFlame(0, -r * 0.95, boosted ? r * 1.7 : r * 1.15);
    drawFlame(r * 0.6, -r * 0.78, boosted ? r * 1.3 : r * 0.85);
    drawFlame(-r * 0.6, -r * 0.78, boosted ? r * 1.3 : r * 0.85);
  }

  drawWings(r);

  // propulsores laterais (boosters)
  drawRocketSegment(r * 0.6, -r * 0.78, r * 0.95, r * 0.16, false);
  drawRocketSegment(-r * 0.6, -r * 0.78, r * 0.95, r * 0.16, false);

  if (player.hasArmor) {
    ctx.fillStyle = '#5c6b7a'; ctx.strokeStyle = '#2c3742'; ctx.lineWidth = 1;
    [[-r * 0.15, r * 0.62], [-r * 0.15, -r * 0.62]].forEach(([px, py]) => {
      ctx.beginPath(); ctx.rect(px - r * 0.16, py - r * 0.12, r * 0.32, r * 0.24); ctx.fill(); ctx.stroke();
    });
  }

  // corpo principal (fuselagem + nariz)
  drawRocketSegment(0, -r * 0.95, r * 1.4, r * 0.32, player.chromeHull);

  if (player.twinGuns) {
    ctx.fillStyle = '#cfeeff'; ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
    [r * 0.16, -r * 0.16].forEach(offY => {
      ctx.beginPath(); ctx.rect(r * 0.95, offY - r * 0.05, r * 0.4, r * 0.1); ctx.fill(); ctx.stroke();
    });
  }

  // vigia
  ctx.fillStyle = '#dfe9ee'; ctx.strokeStyle = '#5a636a'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(r * 0.55, 0, r * 0.16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(r * 0.5, 0, r * 0.08, 0, Math.PI * 2); ctx.fillStyle = 'rgba(80,100,110,0.6)'; ctx.fill();

  ctx.restore();
}


function draw(time) {
  const camX = player.x - canvas.width / 2;
  const camY = player.y - canvas.height / 2;

  drawBackground(camX, camY, time);

  orbs.forEach(o => {
    const glowColor = o.bonus ? '#ffd166' : '#5ee0ff';
    ctx.fillStyle = glowColor; ctx.shadowColor = glowColor; ctx.shadowBlur = o.bonus ? 14 : 8;
    const rr = o.bonus ? o.radius + Math.sin(performance.now() / 120) * 1.5 : o.radius;
    ctx.beginPath(); ctx.arc(o.x - camX, o.y - camY, rr, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  });

  enemies.forEach(e => drawAsteroid(e, camX, camY));

  projectiles.forEach(p => {
    ctx.save();
    const color = p.visual.color === 'rainbow' ? `hsl(${(performance.now() / 4) % 360},100%,65%)` : p.visual.color;
    if (p.visual.glow > 0) { ctx.shadowColor = color; ctx.shadowBlur = p.visual.glow; }
    if (p.visual.rings > 0) {
      ctx.strokeStyle = color; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5;
      for (let i = 1; i <= p.visual.rings; i++) {
        const rr = p.radius + i * 4 + Math.sin(performance.now() / 90 + i) * 2;
        ctx.beginPath(); ctx.arc(p.x - camX, p.y - camY, rr, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(p.x - camX, p.y - camY, p.radius, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });

  particles.forEach(pt => {
    ctx.globalAlpha = clamp(pt.life / 0.4, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(pt.x - camX, pt.y - camY, 3, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;

  drawShip(camX, camY);

  const xpPct = clamp(player.xp / player.xpToNext, 0, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(0, canvas.height - 6, canvas.width, 6);
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(0, canvas.height - 6, canvas.width * xpPct, 6);
}

function loop(ts) {
  const dt = Math.min(0.05, (ts - lastTime) / 1000 || 0);
  lastTime = ts;
  update(dt);
  draw(ts / 1000);
  requestAnimationFrame(loop);
}

// ---------- Controle de estado do jogo ----------
function resetGame() {
  elapsed = 0; killCount = 0; spawnTimer = 0;
  enemies = []; projectiles = []; orbs = []; particles = []; shootingStars = [];
  bossThresholdsSpawned = new Set(); activeBoss = null;

  player.x = world.w / 2; player.y = world.h / 2; player.angle = -Math.PI / 2;
  player.hp = 100; player.maxHp = 100; player.level = 1; player.xp = 0; player.xpToNext = 10;
  player.damage = 10; player.fireRate = 0.6; player.fireTimer = 0; player.range = 260;
  player.multishot = 1; player.pierce = 1; player.regen = 0;
  player.twinGuns = false; player.hasShield = false; player.hasArmor = false;
  player.turboThruster = false; player.chromeHull = false;
  player.shipUpgradesTaken = new Set(); player.gunToggle = false; player.thrusting = false;
}

function triggerGameOver() {
  state = 'gameover';
  stopMusic();
  sfxGameOver();
  submitScore(killCount, player.level, elapsed);
  document.getElementById('finalStats').textContent = `Tempo: ${formatTime(elapsed)}  |  Nível: ${player.level}  |  Kills: ${killCount}`;
  document.getElementById('gameOverScreen').classList.remove('hidden');
  document.getElementById('pauseBtn').classList.add('hidden');
}

// ---------- Botões / UI ----------
function applySettingsUI() {
  const musicBtn = document.getElementById('musicToggleBtn');
  const sfxBtn = document.getElementById('sfxToggleBtn');
  musicBtn.textContent = musicOn ? '🎵 Música: Ligada' : '🔇 Música: Desligada';
  musicBtn.classList.toggle('off', !musicOn);
  sfxBtn.textContent = sfxOn ? '🔊 Efeitos: Ligados' : '🔇 Efeitos: Desligados';
  sfxBtn.classList.toggle('off', !sfxOn);
}

document.getElementById('startBtn').onclick = () => {
  initAudio();
  if (actx && actx.state === 'suspended') actx.resume();
  document.getElementById('startScreen').classList.add('hidden');
  resetGame();
  state = 'playing';
  document.getElementById('pauseBtn').classList.remove('hidden');
  sfxClick();
  if (musicOn) startMusic();
};

document.getElementById('restartBtn').onclick = () => {
  document.getElementById('gameOverScreen').classList.add('hidden');
  resetGame();
  state = 'playing';
  document.getElementById('pauseBtn').classList.remove('hidden');
  sfxClick();
  if (musicOn) startMusic();
};

document.getElementById('pauseBtn').onclick = () => {
  if (state !== 'playing') return;
  state = 'paused';
  document.getElementById('pauseScreen').classList.remove('hidden');
  document.getElementById('pauseBtn').classList.add('hidden');
  stopMusic();
  sfxPause();
};

document.getElementById('resumeBtn').onclick = () => {
  if (state !== 'paused') return;
  state = 'playing';
  document.getElementById('pauseScreen').classList.add('hidden');
  document.getElementById('pauseBtn').classList.remove('hidden');
  if (musicOn) startMusic();
  sfxClick();
};

document.getElementById('quitToMenuBtn').onclick = () => {
  state = 'menu';
  document.getElementById('pauseScreen').classList.add('hidden');
  document.getElementById('pauseBtn').classList.add('hidden');
  stopMusic();
  document.getElementById('startScreen').classList.remove('hidden');
  sfxClick();
};

document.getElementById('audioBtn').onclick = () => {
  initAudio();
  applySettingsUI();
  document.getElementById('settingsScreen').classList.remove('hidden');
  sfxClick();
};
document.getElementById('pauseAudioBtn').onclick = () => {
  applySettingsUI();
  document.getElementById('settingsScreen').classList.remove('hidden');
  sfxClick();
};
document.getElementById('closeSettingsBtn').onclick = () => {
  document.getElementById('settingsScreen').classList.add('hidden');
  sfxClick();
};

document.getElementById('musicToggleBtn').onclick = () => {
  musicOn = !musicOn;
  saveSettings();
  applySettingsUI();
  if (musicOn && state === 'playing') startMusic(); else stopMusic();
};
document.getElementById('sfxToggleBtn').onclick = () => {
  sfxOn = !sfxOn;
  saveSettings();
  applySettingsUI();
  if (sfxOn) { initAudio(); sfxClick(); }
};

document.getElementById('rankingBtn').onclick = () => {
  renderRanking();
  document.getElementById('rankingScreen').classList.remove('hidden');
  sfxClick();
};
document.getElementById('gameOverRankingBtn').onclick = () => {
  renderRanking();
  document.getElementById('rankingScreen').classList.remove('hidden');
  sfxClick();
};
document.getElementById('closeRankingBtn').onclick = () => {
  document.getElementById('rankingScreen').classList.add('hidden');
  sfxClick();
};

applySettingsUI();
requestAnimationFrame(loop);
