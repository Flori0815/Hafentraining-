import { SCENARIOS, buildScenario, type Harbor } from './harbor/harbor';
import { DEFAULT_ENV, type EnvironmentSettings } from './physics/environment';
import { DEFAULT_LINE_SETTINGS, type LineMode, type LineSettings, type ShoreAnchor } from './physics/lines';
import { KN, clamp, worldToBody, type Vec2 } from './physics/vec';
import { BALL_FENDER, nearestHullPoint, type FenderSide } from './physics/fenders';
import { IDLE_LEVER, NEUTRAL_ZONE } from './physics/yacht';
import { SAILING_YACHT_36, cloneConfig, validateConfig, type YachtConfig } from './physics/yachtConfig';
import { Renderer, type Interaction } from './render/renderer';
import { Simulation, formatTime } from './sim/simulation';
import { load, save } from './ui/storage';
import { addResult, bestFor, loadResults } from './ui/results';
import { YachtEditor } from './ui/yachtEditor';

// ---------------------------------------------------------------------------
// Zustand laden
// ---------------------------------------------------------------------------
let harbor: Harbor = buildScenario(load<{ id: string }>('scenario', { id: SCENARIOS[0].id }).id);
const envSettings: EnvironmentSettings = load('env', DEFAULT_ENV);
// Gespeichert werden nur die im Dialog einstellbaren Wurfweiten; alle Kräfte
// kommen immer aus den aktuellen Standardwerten.
const lineSettings: LineSettings = cloneLineSettings(DEFAULT_LINE_SETTINGS);
Object.assign(lineSettings.throwRange, load('lines', { throwRange: lineSettings.throwRange }).throwRange);
let yachtCfg: YachtConfig = load<YachtConfig>('yacht', cloneConfig(SAILING_YACHT_36));
if (validateConfig(yachtCfg).length || yachtCfg.schemaVersion !== 1) yachtCfg = cloneConfig(SAILING_YACHT_36);
// Liegeplatz je Szenario merken
const targetKey = (scenarioId: string) => `target.${scenarioId}`;
const savedTarget = load<{ id: string }>(targetKey(harbor.id), { id: harbor.defaultTarget }).id;

function cloneLineSettings(s: LineSettings): LineSettings {
  return { ...s, throwRange: { ...s.throwRange } };
}

const sim = new Simulation(harbor, yachtCfg, envSettings, lineSettings);
if (harbor.berths.some((b) => b.id === savedTarget && !b.occupied)) sim.targetBerthId = savedTarget;
sim.reset();

document.getElementById('brand-sub')!.textContent = harbor.name;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
renderer.camera.x = sim.yacht.state.pos.x;
renderer.camera.y = sim.yacht.state.pos.y;

const ia: Interaction = {
  selectedCleat: null,
  hoverAnchor: null,
  hoverCleat: null,
  selectedLine: null,
  showForces: false,
  flash: null,
  placingBall: false,
  ballPreview: null,
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// Steuerung: Tastatur + Bedienelemente
// ---------------------------------------------------------------------------
const keys = new Set<string>();
let throttleDetent = false; // Hebel ist in Neutral eingerastet, bis Taste losgelassen
const throttleInput = $<HTMLInputElement>('ctl-throttle');
const helmInput = $<HTMLInputElement>('ctl-helm');

function setThrottle(v: number): void {
  sim.yacht.controls.throttle = clamp(v, -1, 1);
  throttleInput.value = String(Math.round(sim.yacht.controls.throttle * 100));
}
function setHelm(v: number): void {
  sim.yacht.controls.helm = clamp(v, -1, 1);
  helmInput.value = String(Math.round(sim.yacht.controls.helm * 100));
}

throttleInput.addEventListener('input', () => {
  let v = Number(throttleInput.value) / 100;
  if (Math.abs(v) < 0.06) v = 0; // Rastung
  sim.yacht.controls.throttle = v;
});
helmInput.addEventListener('input', () => {
  sim.yacht.controls.helm = Number(helmInput.value) / 100;
});
$('btn-center').addEventListener('click', () => setHelm(0));
$('btn-idle-fwd').addEventListener('click', () => setThrottle(IDLE_LEVER));
$('btn-neutral').addEventListener('click', () => setThrottle(0));
$('btn-idle-back').addEventListener('click', () => setThrottle(-IDLE_LEVER));

function bindThruster(id: string, dir: number): void {
  const b = $(id);
  const on = (e: PointerEvent) => {
    e.preventDefault();
    // Finger darf beim Halten leicht verrutschen, ohne dass der Schub abbricht
    b.setPointerCapture(e.pointerId);
    sim.yacht.controls.thruster = dir;
    b.classList.add('active');
  };
  const off = () => {
    if (sim.yacht.controls.thruster === dir) sim.yacht.controls.thruster = 0;
    b.classList.remove('active');
  };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('lostpointercapture', off);
  // Langes Drücken öffnet auf Mobilgeräten sonst Kontextmenü/Textauswahl
  b.addEventListener('contextmenu', (e) => e.preventDefault());
}
bindThruster('btn-bt-p', -1);
bindThruster('btn-bt-s', 1);

const LINE_KEYS: Record<string, LineMode | 'release'> = { g: 'hand', h: 'heave', f: 'ease', b: 'cleated', l: 'release' };

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('dialog, input, select, textarea') && !(e.target as HTMLElement).matches('input[type=range]')) return;
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  // Shift+↑/↓: direkt eingekuppelt im Standgas (nicht als gehaltene Gas-Taste werten)
  if (e.shiftKey && (k === 'arrowup' || k === 'arrowdown')) {
    if (!e.repeat) setThrottle(k === 'arrowup' ? IDLE_LEVER : -IDLE_LEVER);
    return;
  }
  if (e.repeat && !['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) return;
  keys.add(k);
  switch (k) {
    case ' ':
      setThrottle(0);
      break;
    case 'c':
      setHelm(0);
      break;
    case 'q':
      sim.yacht.controls.thruster = -1;
      break;
    case 'e':
      sim.yacht.controls.thruster = 1;
      break;
    case 'p':
      togglePause();
      break;
    case 'r':
      restart();
      break;
    case 'v':
      toggleFollow();
      break;
    case 'k':
      toggleForces();
      break;
    case 't':
      cycleSpeed();
      break;
    case '?':
      $<HTMLDialogElement>('dlg-help').showModal();
      break;
    case 'escape':
      ia.selectedCleat = null;
      ia.selectedLine = null;
      setPlacingBall(false);
      break;
    case 'u':
      toggleFenders('p');
      break;
    case 'i':
      toggleFenders('s');
      break;
    case 'o':
      setPlacingBall(!ia.placingBall);
      break;
    case '+':
      renderer.zoomAt({ x: renderer.width / 2, y: renderer.height / 2 }, 1.2);
      break;
    case '-':
      renderer.zoomAt({ x: renderer.width / 2, y: renderer.height / 2 }, 1 / 1.2);
      break;
    default:
      if (/^[1-9]$/.test(k)) {
        const id = Number(k);
        const l = sim.lines.lines.find((x) => x.id === id) ?? sim.lines.lines[id - 1];
        ia.selectedLine = l ? l.id : null;
      } else if (k in LINE_KEYS && ia.selectedLine !== null) {
        lineAction(ia.selectedLine, LINE_KEYS[k]);
      }
  }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  if (k === 'arrowup' || k === 'arrowdown' || k === 'w' || k === 's') throttleDetent = false;
  if ((k === 'q' && sim.yacht.controls.thruster < 0) || (k === 'e' && sim.yacht.controls.thruster > 0)) sim.yacht.controls.thruster = 0;
});
window.addEventListener('blur', () => keys.clear());

function applyHeldKeys(dt: number): void {
  const c = sim.yacht.controls;
  const up = keys.has('arrowup') || keys.has('w');
  const down = keys.has('arrowdown') || keys.has('s');
  if ((up || down) && !throttleDetent) {
    const before = c.throttle;
    let next = before + (up ? 1 : -1) * 0.7 * dt;
    // Einrasten in Neutral beim Durchfahren
    if ((before > 0 && next <= 0) || (before < 0 && next >= 0)) {
      next = 0;
      throttleDetent = true;
    }
    setThrottle(next);
  }
  const left = keys.has('arrowleft') || keys.has('a');
  const right = keys.has('arrowright') || keys.has('d');
  if (left !== right) setHelm(c.helm + (right ? 1 : -1) * 1.1 * dt);
}

// ---------------------------------------------------------------------------
// Zeiger: Klampen/Festpunkte wählen, Karte schieben, zoomen
// ---------------------------------------------------------------------------
const pointers = new Map<number, Vec2>();
let dragStart: Vec2 | null = null;
let dragMoved = false;
let pinchDist = 0;

function screenPos(e: PointerEvent | WheelEvent): Vec2 {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function pick(s: Vec2): { cleat: string | null; anchor: ShoreAnchor | null } {
  let cleat: string | null = null;
  let best = 14;
  for (const c of sim.yacht.model.cleats) {
    const p = renderer.toScreen(sim.yacht.toWorld(c.pos));
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (d < best) {
      best = d;
      cleat = c.id;
    }
  }
  let anchor: ShoreAnchor | null = null;
  let bestA = 14;
  for (const a of sim.harbor.anchors) {
    const p = renderer.toScreen(a.pos);
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (d < bestA) {
      bestA = d;
      anchor = a;
    }
  }
  // Klampe am Boot hat Vorrang, wenn beide nah sind
  if (cleat && anchor && best <= bestA) anchor = null;
  return { cleat, anchor };
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, screenPos(e));
  if (pointers.size === 1) {
    dragStart = screenPos(e);
    dragMoved = false;
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    dragMoved = true;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const s = screenPos(e);
  if (pointers.has(e.pointerId)) {
    const prev = pointers.get(e.pointerId)!;
    pointers.set(e.pointerId, s);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) renderer.zoomAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d / pinchDist);
      pinchDist = d;
      return;
    }
    if (dragStart && (dragMoved || Math.hypot(s.x - dragStart.x, s.y - dragStart.y) > 5)) {
      if (!dragMoved) {
        dragMoved = true;
        setFollow(false);
      }
      renderer.camera.x -= (s.x - prev.x) / renderer.camera.scale;
      renderer.camera.y += (s.y - prev.y) / renderer.camera.scale;
    }
    return;
  }
  ia.ballPreview = ia.placingBall ? ballPreviewAt(s) : null;
  const p = pick(s);
  ia.hoverCleat = p.cleat;
  ia.hoverAnchor = p.anchor;
  canvas.style.cursor = ia.placingBall ? 'copy' : p.cleat || p.anchor ? 'pointer' : 'crosshair';
});

canvas.addEventListener('pointerup', (e) => {
  const s = screenPos(e);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (!dragMoved && pointers.size === 0) handleClick(s);
  if (pointers.size === 0) dragStart = null;
});
canvas.addEventListener('pointercancel', (e) => {
  pointers.delete(e.pointerId);
  dragStart = null;
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    renderer.zoomAt(screenPos(e), Math.exp(-e.deltaY * 0.0015));
  },
  { passive: false },
);

function handleClick(s: Vec2): void {
  if (ia.placingBall) {
    const w = renderer.toWorld(s);
    const st = sim.yacht.state;
    const body = worldToBody({ x: w.x - st.pos.x, y: w.y - st.pos.y }, st.psi);
    if (sim.fenders.placeBall(sim.yacht.model, body, sim.time)) {
      sim.addLog('Ballfender wird ausgebracht …', 'info');
      setPlacingBall(false);
    } else {
      flash('Näher am Rumpf klicken', w);
    }
    return;
  }
  const p = pick(s);
  if (p.cleat) {
    ia.selectedCleat = ia.selectedCleat === p.cleat ? null : p.cleat;
    return;
  }
  if (p.anchor) {
    if (!ia.selectedCleat) {
      flash('Erst eine Klampe am Boot wählen', p.anchor.pos);
      return;
    }
    const reach = sim.lines.canReach(sim.yacht, ia.selectedCleat, p.anchor);
    const cleatName = sim.yacht.model.cleats.find((c) => c.id === ia.selectedCleat)?.name ?? '';
    if (!reach.ok) {
      const how = p.anchor.kind === 'ring' ? 'Reichweite' : 'Wurfweite';
      flash(`Zu weit: ${reach.distance.toFixed(1)} m (${how} ${reach.range} m)`, p.anchor.pos);
      sim.addLog(`Wurf von ${cleatName} zu ${p.anchor.label} zu weit (${reach.distance.toFixed(1)} m)`, 'warn');
      return;
    }
    const line = sim.lines.attach(sim.yacht, ia.selectedCleat, p.anchor);
    if (line) {
      sim.addLog(`Leine ${line.id}: ${cleatName} → ${p.anchor.label} (${reach.distance.toFixed(1)} m), von Hand gehalten`, 'info');
      ia.selectedLine = line.id;
      ia.selectedCleat = null;
    }
    return;
  }
  ia.selectedCleat = null;
}

// ---------------------------------------------------------------------------
// Fender
// ---------------------------------------------------------------------------
function toggleFenders(side: FenderSide): void {
  const st = sim.fenders.sideState(side, sim.time);
  const out = st.out === 0;
  sim.fenders.setSide(side, out, sim.time);
  sim.addLog(`Fender ${side === 'p' ? 'Bb' : 'Stb'} ${out ? 'werden ausgebracht …' : 'eingeholt'}`, 'info');
}

function setPlacingBall(on: boolean): void {
  ia.placingBall = on;
  if (!on) ia.ballPreview = null;
  $('btn-fender-ball').classList.toggle('on', on);
  canvas.style.cursor = on ? 'copy' : 'crosshair';
}

/** Vorschau: Ballfender an der Rumpfstelle, die dem Zeiger am nächsten ist. */
function ballPreviewAt(s: Vec2): Vec2 | null {
  const w = renderer.toWorld(s);
  const st = sim.yacht.state;
  const body = worldToBody({ x: w.x - st.pos.x, y: w.y - st.pos.y }, st.psi);
  const e = nearestHullPoint(sim.yacht.model.outline, body);
  if (e.dist > 2.5) return null;
  const r = BALL_FENDER.r;
  return sim.yacht.toWorld({ x: e.p.x + e.n.x * r, y: e.p.y + e.n.y * r });
}

$('btn-fender-p').addEventListener('click', () => toggleFenders('p'));
$('btn-fender-s').addEventListener('click', () => toggleFenders('s'));
$('btn-fender-ball').addEventListener('click', () => setPlacingBall(!ia.placingBall));
$('btn-fender-ball-off').addEventListener('click', () => {
  if (sim.fenders.ball) sim.addLog('Ballfender eingeholt', 'info');
  sim.fenders.removeBall();
});

function renderFenders(): void {
  const state = (side: FenderSide) => {
    const s = sim.fenders.sideState(side, sim.time);
    return s.out === 0 ? 'verstaut' : s.active < s.out ? `${s.active}/${s.out} …` : `${s.active} hängen`;
  };
  const p = sim.fenders.sideState('p', sim.time);
  const sb = sim.fenders.sideState('s', sim.time);
  $('btn-fender-p').textContent = p.out ? 'Bb einholen' : 'Bb raus';
  $('btn-fender-s').textContent = sb.out ? 'Stb einholen' : 'Stb raus';
  $('btn-fender-p').classList.toggle('on', p.out > 0);
  $('btn-fender-s').classList.toggle('on', sb.out > 0);
  const b = sim.fenders.ball;
  const ball = !b ? 'nicht gesetzt' : sim.time < b.readyAt ? 'wird gebracht …' : 'hängt';
  $('fender-state').textContent = `Bb: ${state('p')} · Stb: ${state('s')} · Ballfender: ${ball}`;
  ($('btn-fender-ball-off') as HTMLButtonElement).disabled = !b;
  $('btn-fender-ball').textContent = ia.placingBall ? 'Stelle am Rumpf anklicken…' : b ? 'Ballfender versetzen' : 'Ballfender setzen';
}

function flash(text: string, pos: Vec2): void {
  ia.flash = { text, pos, until: performance.now() + 2200 };
}

function lineAction(id: number, act: LineMode | 'release'): void {
  const l = sim.lines.lines.find((x) => x.id === id);
  if (!l) return;
  if (act === 'release') {
    sim.lines.release(id);
    sim.addLog(`Leine ${id} losgeworfen`, 'info');
    if (ia.selectedLine === id) ia.selectedLine = null;
  } else {
    sim.lines.setMode(id, act);
    const names: Record<LineMode, string> = { hand: 'von Hand gehalten', heave: 'wird dichtgeholt', ease: 'wird gefiert', cleated: 'belegt' };
    sim.addLog(`Leine ${id} ${names[act]}`, 'info');
  }
  linesSignature = '';
}

// ---------------------------------------------------------------------------
// Buttons oben
// ---------------------------------------------------------------------------
const SPEEDS = [0.5, 1, 2, 4];
function togglePause(): void {
  sim.paused = !sim.paused;
  $('btn-pause').textContent = sim.paused ? '▶ Weiter' : '⏸ Pause';
}
function cycleSpeed(): void {
  const i = (SPEEDS.indexOf(sim.timeScale) + 1) % SPEEDS.length;
  sim.timeScale = SPEEDS[i];
  $('btn-speed').textContent = `${sim.timeScale}×`;
}
function setFollow(on: boolean): void {
  renderer.camera.follow = on;
  $('btn-follow').classList.toggle('on', on);
}
function toggleFollow(): void {
  setFollow(!renderer.camera.follow);
}
function toggleForces(): void {
  ia.showForces = !ia.showForces;
  $('btn-forces').classList.toggle('on', ia.showForces);
}
function restart(): void {
  sim.reset({ cfg: yachtCfg, env: envSettings });
  setThrottle(0);
  setHelm(0);
  ia.selectedCleat = null;
  ia.selectedLine = null;
  setPlacingBall(false);
  bannerShown = false;
  $('banner').hidden = true;
  $('thruster-box').hidden = !yachtCfg.bowThruster.enabled;
  setFollow(true);
  linesSignature = '';
}

$('btn-reset').addEventListener('click', restart);
$('btn-pause').addEventListener('click', togglePause);
$('btn-speed').addEventListener('click', cycleSpeed);
$('btn-follow').addEventListener('click', toggleFollow);
$('btn-forces').addEventListener('click', toggleForces);
$('btn-help').addEventListener('click', () => $<HTMLDialogElement>('dlg-help').showModal());
$('thruster-box').hidden = !yachtCfg.bowThruster.enabled;

// Yacht-Editor
const editor = new YachtEditor(yachtCfg, (cfg) => {
  yachtCfg = cfg;
  save('yacht', cfg);
  sim.addLog(`Yacht: ${cfg.name}`, 'info');
  restart();
});
$('btn-yacht').addEventListener('click', () => editor.open(yachtCfg));

// Bedingungen
const envForm = $<HTMLFormElement>('form-env');
const targetSel = $<HTMLSelectElement>('sel-target');
const scenarioSel = $<HTMLSelectElement>('sel-scenario');
scenarioSel.innerHTML = SCENARIOS.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');

/** Liegeplatz-Auswahl für ein Szenario füllen (freie Plätze, Längsseits zuerst). */
function fillTargets(h: Harbor, selected: string): void {
  const free = h.berths.filter((b) => !b.occupied).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'alongside' ? -1 : 1));
  targetSel.innerHTML = free.map((b) => `<option value="${b.id}">${b.label}</option>`).join('');
  targetSel.value = free.some((b) => b.id === selected) ? selected : h.defaultTarget;
}
let dialogHarbor: Harbor = harbor;
scenarioSel.addEventListener('change', () => {
  dialogHarbor = scenarioSel.value === harbor.id ? harbor : buildScenario(scenarioSel.value);
  fillTargets(dialogHarbor, load<{ id: string }>(targetKey(dialogHarbor.id), { id: dialogHarbor.defaultTarget }).id);
});

const ENV_PRESETS: Record<string, Partial<EnvironmentSettings>> = {
  calm: { windSpeedKn: 0, gustiness: 0, currentSpeedKn: 0 },
  cross: { windSpeedKn: 15, windFromDeg: 270, gustiness: 0.3, windShiftDeg: 8, currentSpeedKn: 0.2, currentTowardDeg: 90 },
  behind: { windSpeedKn: 12, windFromDeg: 180, gustiness: 0.25, windShiftDeg: 10, currentSpeedKn: 0, currentTowardDeg: 0 },
  storm: { windSpeedKn: 25, windFromDeg: 240, gustiness: 0.4, windShiftDeg: 12, currentSpeedKn: 0.5, currentTowardDeg: 60 },
};

function fillEnvForm(s: EnvironmentSettings): void {
  const f = envForm.elements as unknown as Record<string, HTMLInputElement>;
  (Object.keys(DEFAULT_ENV) as (keyof EnvironmentSettings)[]).forEach((k) => {
    if (f[k]) f[k].value = String(s[k]);
  });
  f.throwPile.value = String(lineSettings.throwRange.pile);
  f.throwBollard.value = String(lineSettings.throwRange.bollard);
}

envForm.querySelectorAll<HTMLButtonElement>('[data-env]').forEach((b) =>
  b.addEventListener('click', () => {
    const p = ENV_PRESETS[b.dataset.env!];
    fillEnvForm({ ...readEnvForm(), ...p });
  }),
);

function readEnvForm(): EnvironmentSettings {
  const f = envForm.elements as unknown as Record<string, HTMLInputElement>;
  const num = (k: string, fb: number) => {
    const v = Number(f[k].value);
    return Number.isFinite(v) ? v : fb;
  };
  return {
    windSpeedKn: clamp(num('windSpeedKn', 0), 0, 60),
    windFromDeg: num('windFromDeg', 0),
    gustiness: clamp(num('gustiness', 0), 0, 1),
    windShiftDeg: clamp(num('windShiftDeg', 0), 0, 90),
    currentSpeedKn: clamp(num('currentSpeedKn', 0), 0, 6),
    currentTowardDeg: num('currentTowardDeg', 0),
    seed: envSettings.seed,
  };
}

$('btn-env').addEventListener('click', () => {
  fillEnvForm(envSettings);
  dialogHarbor = harbor;
  scenarioSel.value = harbor.id;
  fillTargets(harbor, sim.targetBerthId);
  $<HTMLDialogElement>('dlg-env').showModal();
});
envForm.addEventListener('submit', (ev) => {
  const submitter = (ev as SubmitEvent).submitter as HTMLButtonElement | null;
  if (submitter?.value !== 'apply') return;
  Object.assign(envSettings, readEnvForm());
  const f = envForm.elements as unknown as Record<string, HTMLInputElement>;
  lineSettings.throwRange.pile = clamp(Number(f.throwPile.value) || 6, 1, 15);
  lineSettings.throwRange.bollard = clamp(Number(f.throwBollard.value) || 7, 1, 15);
  if (dialogHarbor.id !== harbor.id) {
    harbor = dialogHarbor;
    sim.setHarbor(harbor, targetSel.value);
    $('brand-sub').textContent = harbor.name;
  } else {
    sim.targetBerthId = targetSel.value;
  }
  save('env', envSettings);
  save('lines', { throwRange: lineSettings.throwRange });
  save('scenario', { id: harbor.id });
  save(targetKey(harbor.id), { id: sim.targetBerthId });
  restart();
});

// ---------------------------------------------------------------------------
// Anzeige
// ---------------------------------------------------------------------------
let linesSignature = '';
// zuletzt angezeigter Eintrag (Anzahl allein reicht nicht: Neustart, 200er-Limit)
let lastLogEntry: unknown = null;
let bannerShown = false;
let bestSignature = '';

/** Bestleistung für den aktuellen Liegeplatz anzeigen. */
function renderBest(): void {
  const sig = `${harbor.id}|${sim.targetBerthId}`;
  if (sig === bestSignature) return;
  bestSignature = sig;
  const best = bestFor(loadResults(), harbor.id, sim.targetBerthId);
  $('best').textContent = best
    ? `Bestleistung: ${'★'.repeat(best.stars)}${'☆'.repeat(3 - best.stars)} in ${formatTime(best.time)} (${best.contacts} Kontakte, ${new Date(best.date).toLocaleDateString('de-DE')})`
    : 'Noch kein Ergebnis für diesen Liegeplatz.';
}
const MODE_LABEL: Record<LineMode, string> = { hand: 'Hand', heave: 'Holen', ease: 'Fieren', cleated: 'Belegt' };

function renderLines(): void {
  const el = $('lines');
  const sig = sim.lines.lines.map((l) => `${l.id}:${l.mode}`).join(',') + '|' + ia.selectedLine;
  if (sig !== linesSignature) {
    linesSignature = sig;
    el.innerHTML = sim.lines.lines
      .map((l) => {
        const cleat = sim.yacht.model.cleats.find((c) => c.id === l.cleatId)?.name ?? l.cleatId;
        const btn = (mode: LineMode, label: string, key: string) =>
          `<button data-line="${l.id}" data-act="${mode}" class="${l.mode === mode ? 'on' : ''}" title="${label} (${key})">${label}</button>`;
        return `<div class="line-card ${ia.selectedLine === l.id ? 'sel' : ''}" data-card="${l.id}">
          <div class="head"><b>${l.id} · ${cleat} → ${l.anchor.label}</b><span>${MODE_LABEL[l.mode]}</span></div>
          <div class="meta" data-meta="${l.id}"></div>
          <div class="tension"><div data-bar="${l.id}"></div></div>
          <div class="btns">${btn('hand', 'Halten', 'G')}${btn('heave', 'Holen', 'H')}${btn('ease', 'Fieren', 'F')}${btn('cleated', 'Belegen', 'B')}
          <button data-line="${l.id}" data-act="release" class="release" title="Loswerfen (L)">Los</button></div></div>`;
      })
      .join('');
  }
  for (const l of sim.lines.lines) {
    const meta = el.querySelector<HTMLElement>(`[data-meta="${l.id}"]`);
    const bar = el.querySelector<HTMLElement>(`[data-bar="${l.id}"]`);
    if (meta) meta.textContent = `Länge ${l.length.toFixed(1)} m · ${l.slack > 0.05 ? `lose ${l.slack.toFixed(1)} m` : 'steif'} · Zug ${Math.round(l.tension)} N`;
    if (bar) bar.style.width = `${Math.min(100, (l.tension / 3000) * 100)}%`;
  }
  const hint = $('line-hint');
  if (ia.selectedCleat) {
    const name = sim.yacht.model.cleats.find((c) => c.id === ia.selectedCleat)?.name;
    hint.textContent = `${name} gewählt – jetzt Dalbe oder Stegklampe anklicken (grün = in Wurfweite).`;
    hint.classList.add('active');
  } else {
    hint.textContent = sim.lines.lines.length
      ? 'Leine wählen (1–9), dann G/H/F/B/L. Neue Leine: Klampe am Boot anklicken.'
      : 'Klampe am Boot anklicken, dann Dalbe oder Klampe an Land (innerhalb der Wurfweite).';
    hint.classList.remove('active');
  }
}

$('lines').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const b = t.closest<HTMLButtonElement>('button[data-act]');
  if (b) {
    lineAction(Number(b.dataset.line), b.dataset.act as LineMode | 'release');
    return;
  }
  const card = t.closest<HTMLElement>('[data-card]');
  if (card) {
    ia.selectedLine = Number(card.dataset.card);
    linesSignature = '';
  }
});

function renderLog(): void {
  const last = sim.log[sim.log.length - 1] ?? null;
  if (last === lastLogEntry) return;
  lastLogEntry = last;
  const el = $('log');
  el.innerHTML = sim.log
    .slice(-60)
    .reverse()
    .map((e) => `<li class="${e.level}"><span class="t">${formatTime(e.t)}</span>${escapeHtml(e.text)}</li>`)
    .join('');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function fmtDeg(d: number): string {
  return String(Math.round(((d % 360) + 360) % 360)).padStart(3, '0') + '°';
}

function renderPanel(): void {
  const y = sim.yacht;
  const st = y.state;
  const F = y.last;
  const cfg = y.model.cfg;
  $('in-sog').textContent = `${y.sogKn.toFixed(1)} kn`;
  const stw = F ? Math.hypot(F.waterSpeed.x, F.waterSpeed.y) / KN : 0;
  $('in-stw').textContent = `${stw.toFixed(1)} kn${F && F.waterSpeed.x < -0.05 ? ' achteraus' : ''}`;
  $('in-hdg').textContent = fmtDeg(y.headingDeg);
  const rot = (st.r * 180) / Math.PI;
  $('in-rot').textContent = `${Math.abs(rot).toFixed(1)} °/s ${rot > 0.2 ? 'Stb' : rot < -0.2 ? 'Bb' : ''}`;
  const gear = st.gear > 0 ? 'Voraus' : st.gear < 0 ? 'Zurück' : 'Neutral';
  const shifting = st.gear === 0 && Math.abs(y.controls.throttle) > 0.1 ? ' (schaltet…)' : '';
  const rpm = Math.round(800 + (st.rpm - cfg.engine.idleFraction) / (1 - cfg.engine.idleFraction) * 2400);
  $('in-engine').textContent = `${gear}${shifting} · ${rpm} U/min`;
  $('in-thrust').textContent = `${Math.round(F?.thrust ?? 0)} N`;
  $('in-tw').textContent = `${(sim.env.windSpeed / KN).toFixed(0)} kn aus ${fmtDeg(sim.env.windFromDeg)}`;
  if (F) {
    const aw = Math.hypot(F.apparentWind.x, F.apparentWind.y) / KN;
    // Einfallswinkel relativ zum Bug (von wo der Wind kommt)
    const ang = (Math.atan2(-F.apparentWind.y, -F.apparentWind.x) * 180) / Math.PI;
    const side = ang > 2 ? 'Stb' : ang < -2 ? 'Bb' : '';
    $('in-aw').textContent = `${aw.toFixed(0)} kn · ${Math.abs(ang).toFixed(0)}° ${side}`;
  }
  const rd = st.rudder / ((cfg.rudder.maxAngleDeg * Math.PI) / 180);
  const bar = $('in-rudder-bar');
  bar.style.left = `${50 + Math.min(0, rd) * 50}%`;
  bar.style.width = `${Math.abs(rd) * 50}%`;
  // Schieberegler mit dem Steuerzustand abgleichen (außer während der Bedienung)
  if (document.activeElement !== throttleInput) throttleInput.value = String(Math.round(y.controls.throttle * 100));
  if (document.activeElement !== helmInput) helmInput.value = String(Math.round(y.controls.helm * 100));
  const thr = y.controls.throttle;
  const atIdle = Math.abs(Math.abs(thr) - IDLE_LEVER) < 0.006;
  $('out-throttle').textContent =
    Math.abs(thr) <= NEUTRAL_ZONE ? 'N' : `${thr > 0 ? 'V' : 'Z'} ${atIdle ? 'Leerl.' : `${Math.round(Math.abs(thr) * 100)}%`}`;
  $('btn-idle-fwd').classList.toggle('on', atIdle && thr > 0);
  $('btn-neutral').classList.toggle('on', Math.abs(thr) <= NEUTRAL_ZONE);
  $('btn-idle-back').classList.toggle('on', atIdle && thr < 0);
  const rdeg = (st.rudder * 180) / Math.PI;
  $('out-helm').textContent = Math.abs(rdeg) < 0.5 ? 'Ruder mittschiffs' : `Ruder ${Math.abs(rdeg).toFixed(0)}° ${rdeg > 0 ? 'Stb' : 'Bb'}`;

  const s = sim.status;
  $('task-target').textContent = `Ziel: ${sim.targetBerth?.label ?? '–'}`;
  $('task-msg').textContent = s.completed ? '✔ ' + s.message : s.message;
  $('st-time').textContent = formatTime(s.time);
  $('st-contacts').textContent = `${s.contacts} (${s.hardContacts} hart)`;
  $('st-impact').textContent = `${s.maxImpactKn.toFixed(1)} kn`;
  if (s.completed && !bannerShown) {
    bannerShown = true;
    const newBest = s.result ? addResult(s.result) : false;
    const b = $('banner');
    b.textContent = '⚓ ' + s.message + (newBest ? ' · Neue Bestleistung!' : '');
    b.hidden = false;
    bestSignature = '';
  }
  renderBest();
  renderFenders();
  renderLines();
  renderLog();
}

// Kollision ohne Ausweg: Boot außerhalb des Hafenbereichs
function checkBounds(): void {
  const p = sim.yacht.state.pos;
  const b = sim.harbor.bounds;
  if (p.x < b.minX - 20 || p.x > b.maxX + 20 || p.y < b.minY - 20 || p.y > b.maxY + 20) {
    if (!sim.paused) {
      sim.addLog('Hafenbereich verlassen – Neustart mit R', 'warn');
      togglePause();
    }
  }
}

// ---------------------------------------------------------------------------
// Hauptschleife
// ---------------------------------------------------------------------------
let last = performance.now();
let panelTimer = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // Während ein Dialog offen ist, steht die Simulation
  if (!document.querySelector('dialog[open]')) {
    applyHeldKeys(dt);
    sim.advance(dt);
  }
  checkBounds();
  renderer.render(sim, ia, dt);
  panelTimer += dt;
  if (panelTimer > 0.1) {
    panelTimer = 0;
    renderPanel();
  }
  requestAnimationFrame(frame);
}

new ResizeObserver(() => renderer.resize()).observe(canvas);
renderPanel();
requestAnimationFrame(frame);

if (!load<{ seen: boolean }>('help', { seen: false }).seen) {
  $<HTMLDialogElement>('dlg-help').showModal();
  save('help', { seen: true });
}

// Zugriff für Debugging in der Konsole
(window as unknown as { sim: Simulation; renderer: Renderer }).sim = sim;
(window as unknown as { renderer: Renderer }).renderer = renderer;
