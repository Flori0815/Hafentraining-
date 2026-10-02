import { SCENARIOS, buildScenario, type Harbor } from './harbor/harbor';
import { DEFAULT_ENV, type EnvironmentSettings } from './physics/environment';
import { DEFAULT_LINE_SETTINGS, MAX_SLIP_LINES, type LineMode, type LineSettings, type ShoreAnchor } from './physics/lines';
import { KN, clamp, worldToBody, type Vec2 } from './physics/vec';
import { BALL_FENDER, nearestHullPoint, type FenderSide } from './physics/fenders';
import { CREW_MODE_LABEL, type CrewMode } from './sim/crew';
import {
  cleatName,
  orderBall,
  orderBallRemove,
  orderFenders,
  orderLeadAft,
  orderLine,
  orderPrepare,
  orderPrepareSlip,
  orderPreparedLeadAft,
  orderSlip,
  orderThrow,
  orderUnprepare,
  prepBlocked,
} from './sim/orders';
import { IDLE_LEVER, NEUTRAL_ZONE } from './physics/yacht';
import { PRESETS, SAILING_YACHT_36, cloneConfig, validateConfig, type YachtConfig } from './physics/yachtConfig';
import { Renderer, type Interaction } from './render/renderer';
import { Simulation, formatTime } from './sim/simulation';
import { load, save } from './ui/storage';
import { addResult, bestFor, bestForTask, loadResults } from './ui/results';
import { findTask, nextTask } from './tasks/catalog';
import { DIFFICULTY_LABEL, taskEnv, type TaskDef } from './tasks/types';
import { TasksDialog, difficultyDots, starsText } from './ui/tasksDialog';
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
sim.crewMode = load<{ mode: CrewMode }>('crew', { mode: 'crew' }).mode === 'solo' ? 'solo' : 'crew';
if (harbor.berths.some((b) => b.id === savedTarget && !b.occupied)) sim.targetBerthId = savedTarget;
sim.reset();

// Aktive Aufgabe (null = freies Training)
let activeTask: TaskDef | null = findTask(load<{ id: string | null }>('task', { id: null }).id) ?? null;

/** Yacht einer Aufgabe: vorgegebene Vorlage oder die eigene Yacht. */
function taskYacht(t: TaskDef): YachtConfig {
  const p = t.yacht ? PRESETS.find((x) => x.id === t.yacht) : undefined;
  return p ? cloneConfig(p) : yachtCfg;
}

if (activeTask) {
  harbor = buildScenario(activeTask.harbor);
  sim.setTask(activeTask, harbor, taskYacht(activeTask), taskEnv(activeTask));
}

function updateHeader(): void {
  document.getElementById('brand-sub')!.textContent = activeTask ? `Aufgabe: ${activeTask.title}` : `Freies Training · ${harbor.name}`;
}
updateHeader();

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
  slipMode: false,
  slipFrom: null,
  prepMode: null,
  prepFrom: null,
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
  if (e.repeat && !['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ',', '.', 'x', 'y'].includes(k)) return;
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
      setSlipMode(false);
      setPrepMode(null);
      break;
    case 'j':
      setPrepMode(ia.prepMode === 'line' ? null : 'line');
      break;
    case 'n':
      setPrepMode(ia.prepMode === 'slip' ? null : 'slip');
      break;
    case 'm':
      setSlipMode(!ia.slipMode);
      break;
    case 'z':
      sim.crew.returnToHelm();
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
  // Lenken mit den Manöverleinen: , / . halten
  const sl = keys.has(',');
  const sr = keys.has('.');
  if (sl !== sr && sim.lines.cockpitPair(sim.yacht)) setSteer(sim.lines.steer + (sr ? 1 : -1) * 0.8 * dt);
  const em = keys.has('x');
  const el = keys.has('y');
  if (em !== el && sim.lines.cockpitPair(sim.yacht)) setEase(sim.lines.ease + (em ? 1 : -1) * 0.6 * dt);
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
    const err = orderBall(sim, body);
    if (err) flash(err, w);
    else setPlacingBall(false);
    return;
  }
  const p = pick(s);
  if (ia.prepMode) {
    if (p.cleat) prepClick(p.cleat);
    else if (p.anchor) flash('Vorbereiten: Klampe am Boot anklicken', p.anchor.pos);
    return;
  }
  if (p.cleat && ia.slipFrom) {
    completeSlip(p.cleat);
    return;
  }
  if (p.cleat) {
    ia.selectedCleat = ia.selectedCleat === p.cleat ? null : p.cleat;
    return;
  }
  if (p.anchor) {
    if (!ia.selectedCleat) {
      flash('Erst eine Klampe am Boot wählen', p.anchor.pos);
      return;
    }
    const ready = sim.lines.preparedAt(ia.selectedCleat);
    if (ia.slipMode && !ready?.slip) {
      if (sim.lines.slipsInUse >= MAX_SLIP_LINES) {
        flash(`Beide Manöverleinen sind schon in Gebrauch (${MAX_SLIP_LINES} an Bord)`, p.anchor.pos);
        return;
      }
      // Bucht kommt über den Festpunkt – jetzt die zweite Klampe für die Holepart
      ia.slipFrom = { cleat: ia.selectedCleat, anchor: p.anchor };
      ia.selectedCleat = null;
      return;
    }
    // vorbereitete Leine an der Klampe: nur noch werfen (Manöverleine samt Holepart)
    const err = orderThrow(sim, ia.selectedCleat, p.anchor);
    if (err) flash(err, p.anchor.pos);
    else {
      ia.selectedCleat = null;
      if (ready?.slip) setSlipMode(false);
    }
    return;
  }
  ia.selectedCleat = null;
}

function setPrepMode(mode: 'line' | 'slip' | null): void {
  if (mode) {
    const blocked = prepBlocked(sim);
    if (blocked) {
      flash(blocked, sim.yacht.state.pos);
      mode = null;
    }
  }
  ia.prepMode = mode;
  ia.prepFrom = null;
  if (mode) {
    setSlipMode(false);
    ia.selectedCleat = null;
  }
  $('btn-prep-line').classList.toggle('on', mode === 'line');
  $('btn-prep-slip').classList.toggle('on', mode === 'slip');
}

/** Klick auf eine Klampe beim Vorbereiten. */
function prepClick(cleat: string): void {
  const at = sim.yacht.cleatWorld(cleat) ?? sim.yacht.state.pos;
  if (ia.prepMode === 'line') {
    const err = orderPrepare(sim, cleat);
    if (err) flash(err, at);
    return;
  }
  if (!ia.prepFrom) {
    if (sim.lines.preparedAt(cleat)) {
      flash(`An ${cleatName(sim, cleat)} liegt schon eine Leine bereit`, at);
      return;
    }
    ia.prepFrom = cleat;
    return;
  }
  const err = orderPrepareSlip(sim, ia.prepFrom, cleat);
  if (err) {
    flash(err, at);
    return;
  }
  setPrepMode(null);
}

$('btn-prep-line').addEventListener('click', () => setPrepMode(ia.prepMode === 'line' ? null : 'line'));
$('btn-prep-slip').addEventListener('click', () => setPrepMode(ia.prepMode === 'slip' ? null : 'slip'));
$('prepared').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-prep]');
  if (!b) return;
  const id = Number(b.dataset.prep);
  if (b.dataset.act === 'aft') {
    const err = orderPreparedLeadAft(sim, id);
    if (err) flash(err, sim.yacht.state.pos);
  } else orderUnprepare(sim, id);
  preparedSignature = '';
});

let preparedSignature = '';
function renderPrepared(): void {
  const list = sim.lines.prepared;
  const sig = JSON.stringify(list);
  if (sig === preparedSignature) return;
  preparedSignature = sig;
  $('prepared').innerHTML = list
    .map((p) => {
      const what = p.slip
        ? `Manöverleine ${cleatName(sim, p.cleatId)} → ${p.slip.cockpit ? 'Cockpit' : cleatName(sim, p.slip.workCleatId)}`
        : `Festmacher an ${cleatName(sim, p.cleatId)}`;
      const aft = p.slip && !p.slip.cockpit ? `<button type="button" data-prep="${p.id}" data-act="aft" title="Holepart schon ins Cockpit führen">→ Cockpit</button>` : '';
      return `<li><span>🪢 ${escapeHtml(what)} – bereit</span>${aft}<button type="button" data-prep="${p.id}" data-act="stow" title="Leine wieder wegstauen">wegstauen</button></li>`;
    })
    .join('');
}

function setSlipMode(on: boolean): void {
  ia.slipMode = on;
  ia.slipFrom = null;
  $('btn-slip').classList.toggle('on', on);
  if (on && ia.prepMode) setPrepMode(null);
}

/** Manöverleine fertig ausbringen: Holepart auf die zweite Klampe. */
function completeSlip(workCleat: string): void {
  const from = ia.slipFrom!;
  const err = orderSlip(sim, from.cleat, from.anchor, workCleat);
  if (err) {
    flash(err, from.anchor.pos);
    return;
  }
  setSlipMode(false);
}

// ---------------------------------------------------------------------------
// Fender
// ---------------------------------------------------------------------------
function toggleFenders(side: FenderSide): void {
  orderFenders(sim, side);
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
$('btn-fender-ball-off').addEventListener('click', () => orderBallRemove(sim));

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

type LineAct = LineMode | 'release' | 'aft' | 'noaft';

function lineAction(id: number, act: LineAct): void {
  if (act === 'aft' || act === 'noaft') orderLeadAft(sim, id, act === 'aft');
  else orderLine(sim, id, act);
  linesSignature = '';
}

sim.onLineAttached = (l) => {
  ia.selectedLine = l.id;
  linesSignature = '';
};

// ---------------------------------------------------------------------------
// Besatzung und Lenken mit Manöverleinen
// ---------------------------------------------------------------------------
const steerInput = $<HTMLInputElement>('ctl-steer');

function setSteer(v: number): void {
  sim.lines.steer = clamp(v, -1, 1);
  steerInput.value = String(Math.round(sim.lines.steer * 100));
}
steerInput.addEventListener('input', () => {
  let v = Number(steerInput.value) / 100;
  if (Math.abs(v) < 0.04) v = 0;
  sim.lines.steer = v;
});
const easeInput = $<HTMLInputElement>('ctl-ease');
function setEase(v: number): void {
  sim.lines.ease = clamp(v, 0, 1);
  easeInput.value = String(Math.round(sim.lines.ease * 100));
}
easeInput.addEventListener('input', () => {
  sim.lines.ease = Number(easeInput.value) / 100;
});
$('btn-steer-hold').addEventListener('click', () => {
  setSteer(0);
  setEase(0);
});

function updateCrewButton(): void {
  const mode = sim.effectiveCrewMode;
  const b = $<HTMLButtonElement>('btn-crew');
  b.textContent = mode === 'solo' ? '👤 Einhand' : '👥 Mannschaft';
  b.classList.toggle('on', mode === 'solo');
  b.disabled = !!activeTask?.crew;
  b.title = activeTask?.crew
    ? `Die Aufgabe gibt die Besatzung vor: ${CREW_MODE_LABEL[mode]}`
    : 'Besatzung umschalten: Mannschaft oder Einhand (startet das Manöver neu)';
}
$('btn-crew').addEventListener('click', () => {
  if (activeTask?.crew) return;
  sim.crewMode = sim.crewMode === 'solo' ? 'crew' : 'solo';
  save('crew', { mode: sim.crewMode });
  restart();
});
$('btn-helm-return').addEventListener('click', () => sim.crew.returnToHelm());

function renderCrew(): void {
  const c = sim.crew;
  const solo = c.mode === 'solo';
  const el = $('crew-state');
  const away = solo && !c.atHelm;
  el.textContent = solo ? `Einhand – Skipper ${c.activity}${away ? ' · Ruder unbesetzt!' : ''}` : c.activity;
  el.classList.toggle('crew-warn', away);
  $('btn-helm-return').hidden = !solo;
  ($('btn-helm-return') as HTMLButtonElement).disabled = c.atHelm && !c.busy;
  updateCrewButton();
  // Regler zum Lenken erscheint, wenn beide Manöverleinen im Cockpit liegen
  const pair = sim.lines.cockpitPair(sim.yacht);
  $('slip-steer').hidden = !pair;
  if (pair) {
    $('steer-l').textContent = `◀ ${pair[0].id} fieren`;
    $('steer-r').textContent = `${pair[1].id} fieren ▶`;
    const [a, b] = sim.lines.cockpitEase();
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    $('out-steer').textContent =
      a < 0.02 && b < 0.02 ? 'Manöverleinen halten' : `fieren: Leine ${pair[0].id} ${pct(a)} · Leine ${pair[1].id} ${pct(b)}`;
    if (document.activeElement !== steerInput) steerInput.value = String(Math.round(sim.lines.steer * 100));
    if (document.activeElement !== easeInput) easeInput.value = String(Math.round(sim.lines.ease * 100));
  }
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
  if (activeTask) sim.reset({ cfg: taskYacht(activeTask), env: taskEnv(activeTask) });
  else sim.reset({ cfg: yachtCfg, env: envSettings });
  resetUi();
}

/** Bedienelemente und Anzeigen nach einem (Neu-)Start zurücksetzen. */
function resetUi(): void {
  setThrottle(0);
  setHelm(0);
  ia.selectedCleat = null;
  ia.selectedLine = null;
  setPlacingBall(false);
  setSlipMode(false);
  setPrepMode(null);
  setSteer(0);
  setEase(0);
  bannerShown = false;
  $('banner').hidden = true;
  $('thruster-box').hidden = !sim.yachtConfig.bowThruster.enabled;
  setFollow(true);
  linesSignature = '';
  bestSignature = '';
}

// ---------------------------------------------------------------------------
// Aufgaben
// ---------------------------------------------------------------------------
function startTask(t: TaskDef): void {
  activeTask = t;
  harbor = buildScenario(t.harbor);
  sim.setTask(t, harbor, taskYacht(t), taskEnv(t));
  save('task', { id: t.id });
  updateHeader();
  resetUi();
  sim.paused = false;
  $('btn-pause').textContent = '⏸ Pause';
}

function startFreePlay(): void {
  activeTask = null;
  save('task', { id: null });
  harbor = buildScenario(load<{ id: string }>('scenario', { id: SCENARIOS[0].id }).id);
  sim.setHarbor(harbor, load<{ id: string }>(targetKey(harbor.id), { id: harbor.defaultTarget }).id);
  updateHeader();
  restart();
}

const tasksDialog = new TasksDialog(startTask, startFreePlay, () => activeTask?.id ?? null);
$('btn-tasks').addEventListener('click', () => tasksDialog.open());
$('btn-tasks-panel').addEventListener('click', () => tasksDialog.open());
$('btn-next-task').addEventListener('click', () => {
  const n = activeTask && nextTask(activeTask.id);
  if (n) startTask(n);
});

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
  $('env-task-note').hidden = !activeTask;
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
  // Übernehmen = freies Training (beendet eine aktive Aufgabe)
  activeTask = null;
  save('task', { id: null });
  harbor = dialogHarbor;
  sim.setHarbor(harbor, targetSel.value);
  updateHeader();
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
  const sig = `${activeTask?.id ?? ''}|${harbor.id}|${sim.targetBerthId}`;
  if (sig === bestSignature) return;
  bestSignature = sig;
  const results = loadResults();
  const best = activeTask ? bestForTask(results, activeTask.id) : bestFor(results, harbor.id, sim.targetBerthId);
  $('best').textContent = best
    ? `Bestleistung: ${starsText(best.stars)} in ${formatTime(best.time)} (${best.contacts} Kontakte, ${new Date(best.date).toLocaleDateString('de-DE')})`
    : activeTask
      ? 'Noch nicht gelöst.'
      : 'Noch kein Ergebnis für diesen Liegeplatz.';
}

/** Erfolgskriterien als Checkliste; nach dem Erfolg das Ergebnis. */
let checklistSignature = '';
function renderChecklist(): void {
  const s = sim.status;
  const msg = $('task-msg');
  msg.hidden = !s.completed;
  if (s.completed) msg.textContent = '✔ ' + s.message;
  const items = s.checklist;
  const sig = JSON.stringify(items);
  if (sig === checklistSignature) return;
  checklistSignature = sig;
  $('checklist').innerHTML = items
    .map((c) => {
      const extra = [c.progress, c.hint].filter(Boolean).join(' · ');
      return `<li class="${c.done ? 'done' : 'open'}"><span class="mark">${c.done ? '✓' : '○'}</span><span class="lbl">${escapeHtml(c.label)}</span>${
        extra ? `<span class="extra">${escapeHtml(extra)}</span>` : ''
      }</li>`;
    })
    .join('');
}

/** Aufgaben-Kopf im Panel: Titel, Schwierigkeit, Einweisung, „Nächste“. */
function renderTaskHeader(): void {
  const t = activeTask;
  const title = $('task-title');
  title.hidden = !t;
  $('task-brief-box').hidden = !t;
  if (t) {
    title.innerHTML = `<span class="diff" title="${DIFFICULTY_LABEL[t.difficulty]}">${difficultyDots(t.difficulty)}</span>${escapeHtml(t.title)}`;
    $('task-brief').textContent = t.briefing;
  }
  const goal = t?.goal;
  $('task-target').textContent =
    goal?.kind === 'depart' ? `Ziel: ablegen → ${goal.zoneLabel}` : `Ziel: ${sim.targetBerth?.label ?? '–'}`;
  $('btn-next-task').hidden = !(t && nextTask(t.id));
}
const MODE_LABEL: Record<LineMode, string> = { hand: 'Hand', heave: 'Holen', ease: 'Fieren', cleated: 'Belegt' };

function renderLines(): void {
  const el = $('lines');
  if (ia.selectedLine !== null && !sim.lines.lines.some((l) => l.id === ia.selectedLine)) ia.selectedLine = null;
  const sig = sim.lines.lines.map((l) => `${l.id}:${l.mode}:${l.cockpit ? 1 : 0}`).join(',') + '|' + ia.selectedLine;
  if (sig !== linesSignature) {
    linesSignature = sig;
    el.innerHTML = sim.lines.lines
      .map((l) => {
        const title = l.slip
          ? `${l.id} · Manöverleine ${cleatName(sim, l.slip.cleatId)} ⇄ ${l.anchor.label} ⇄ ${l.cockpit ? 'Cockpit' : cleatName(sim, l.cleatId)}`
          : `${l.id} · ${cleatName(sim, l.cleatId)} → ${l.anchor.label}`;
        const aft = l.slip
          ? `<button data-line="${l.id}" data-act="${l.cockpit ? 'noaft' : 'aft'}" class="${l.cockpit ? 'on' : ''}" title="Holepart an Deck nach achtern ins Cockpit führen – Bedienung vom Ruder aus">${l.cockpit ? 'im Cockpit' : '→ Cockpit'}</button>`
          : '';
        const btn = (mode: LineMode, label: string, key: string) =>
          `<button data-line="${l.id}" data-act="${mode}" class="${l.mode === mode ? 'on' : ''}" title="${label} (${key})">${label}</button>`;
        return `<div class="line-card ${ia.selectedLine === l.id ? 'sel' : ''}" data-card="${l.id}">
          <div class="head"><b>${escapeHtml(title)}</b><span>${MODE_LABEL[l.mode]}</span></div>
          <div class="meta" data-meta="${l.id}"></div>
          <div class="tension"><div data-bar="${l.id}"></div></div>
          <div class="btns">${btn('hand', 'Halten', 'G')}${btn('heave', 'Holen', 'H')}${btn('ease', 'Fieren', 'F')}${btn('cleated', 'Belegen', 'B')}${aft}
          <button data-line="${l.id}" data-act="release" class="release" title="Loswerfen (L)">Los</button></div></div>`;
      })
      .join('');
  }
  for (const l of sim.lines.lines) {
    const meta = el.querySelector<HTMLElement>(`[data-meta="${l.id}"]`);
    const bar = el.querySelector<HTMLElement>(`[data-bar="${l.id}"]`);
    const loose = l.slack > 0.05 ? `lose ${l.slack.toFixed(1)} m` : 'steif';
    if (meta) {
      meta.textContent = l.slip
        ? `Länge ${(l.length + l.slip.length).toFixed(1)} m · ${loose} · Holepart ${Math.round(l.tension)} N · feste Part ${Math.round(l.slip.tension)} N`
        : `Länge ${l.length.toFixed(1)} m · ${loose} · Zug ${Math.round(l.tension)} N`;
    }
    const load = Math.max(l.tension, l.slip?.tension ?? 0);
    if (bar) bar.style.width = `${Math.min(100, (load / 3000) * 100)}%`;
  }
  renderPrepared();
  const hint = $('line-hint');
  if (ia.prepMode === 'line') {
    hint.textContent = 'Vorbereiten: Klampe anklicken – die Leine wird dort belegt und klar über die Reling gelegt.';
    hint.classList.add('active');
  } else if (ia.prepMode === 'slip') {
    hint.textContent = ia.prepFrom
      ? `Manöverleine an ${cleatName(sim, ia.prepFrom)} – jetzt die Klampe für die Holepart anklicken (dieselbe Klampe nochmal = doppelt über die Klampe, direkt ins Cockpit).`
      : 'Manöverleine vorbereiten: erste Klampe (feste Part) anklicken, dann die Klampe der Holepart.';
    hint.classList.add('active');
  } else if (ia.slipFrom) {
    hint.textContent = `Manöverleine liegt über ${ia.slipFrom.anchor.label} – jetzt die Klampe für die Holepart anklicken; dieselbe Klampe nochmal = doppelt über die Klampe direkt ins Cockpit (z. B. Achterklampe beim Rückwärts-Einparken).`;
    hint.classList.add('active');
  } else if (ia.slipMode && !ia.selectedCleat) {
    hint.textContent = 'Manöverleine: erste Klampe (feste Part) anklicken, dann Dalbe oder Stegklampe, dann die zweite Klampe.';
    hint.classList.add('active');
  } else if (ia.selectedCleat) {
    const name = cleatName(sim, ia.selectedCleat!);
    const ready = sim.lines.preparedAt(ia.selectedCleat!);
    hint.textContent = ready
      ? `${name}: ${ready.slip ? 'Manöverleine' : 'Leine'} liegt bereit – Dalbe oder Stegklampe anklicken, der Skipper muss nur noch werfen.`
      : `${name} gewählt – jetzt Dalbe oder Stegklampe anklicken (grün = in Wurfweite).`;
    hint.classList.add('active');
  } else {
    hint.textContent = sim.lines.lines.length
      ? 'Leine wählen (1–9), dann G/H/F/B/L. Neue Leine: Klampe am Boot anklicken.'
      : 'Klampe am Boot anklicken, dann Dalbe oder Klampe an Land (innerhalb der Wurfweite).';
    hint.classList.remove('active');
  }
}

$('btn-slip').addEventListener('click', () => setSlipMode(!ia.slipMode));

$('lines').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const b = t.closest<HTMLButtonElement>('button[data-act]');
  if (b) {
    lineAction(Number(b.dataset.line), b.dataset.act as LineAct);
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
  renderTaskHeader();
  renderChecklist();
  $('st-time').textContent = formatTime(s.time);
  $('st-contacts').textContent = `${s.contacts} (${s.hardContacts} hart)`;
  $('st-impact').textContent = `${s.maxImpactKn.toFixed(1)} kn`;
  if (s.completed && !bannerShown) {
    bannerShown = true;
    const newBest = s.result ? addResult(s.result) : false;
    const b = $('banner');
    b.textContent = '⚓ ' + s.message + (newBest ? ' · Neue Bestleistung!' : '');
    const next = activeTask && nextTask(activeTask.id);
    if (next) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `Nächste: ${next.title} →`;
      btn.addEventListener('click', () => startTask(next));
      b.appendChild(btn);
    }
    b.hidden = false;
    bestSignature = '';
  }
  renderBest();
  renderCrew();
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
