/**
 * Simulation: verbindet Yacht, Umwelt, Leinen, Kontakte und Hafen, führt die
 * Integration mit festem Zeitschritt aus und bewertet das Manöver.
 */
import { CollisionSystem } from '../physics/collision';
import { DEFAULT_ENV, Environment, type EnvironmentSettings } from '../physics/environment';
import { DEFAULT_LINE_SETTINGS, LineSystem, type LineSettings } from '../physics/lines';
import { KN, closestOnSegment, dist, pointInPolygon, type Vec2 } from '../physics/vec';
import { Yacht } from '../physics/yacht';
import type { YachtConfig } from '../physics/yachtConfig';
import type { Berth, Harbor } from '../harbor/harbor';

export const PHYSICS_DT = 1 / 240;

export interface ManeuverStatus {
  time: number;
  contacts: number;
  hardContacts: number;
  maxImpactKn: number;
  inBerth: boolean;
  moored: boolean;
  completed: boolean;
  completedAt: number | null;
  message: string;
}

export interface LogEvent {
  t: number;
  text: string;
  level: 'info' | 'warn' | 'bad' | 'good';
}

export class Simulation {
  harbor: Harbor;
  yachtConfig: YachtConfig;
  yacht: Yacht;
  env: Environment;
  lines: LineSystem;
  collisions = new CollisionSystem();
  targetBerthId: string;
  time = 0;
  paused = false;
  timeScale = 1;
  status!: ManeuverStatus;
  log: LogEvent[] = [];
  /** Kielwasser-Spur (Heck-Positionen) */
  trail: Vec2[] = [];
  private accumulator = 0;
  private activeContacts = new Set<string>();
  private trailTimer = 0;
  private mooredTimer = 0;

  constructor(harbor: Harbor, cfg: YachtConfig, env: EnvironmentSettings = DEFAULT_ENV, lineSettings: LineSettings = DEFAULT_LINE_SETTINGS) {
    this.harbor = harbor;
    this.yachtConfig = cfg;
    this.env = new Environment(env);
    this.lines = new LineSystem(lineSettings);
    this.targetBerthId = harbor.defaultTarget;
    this.yacht = this.makeYacht();
    this.collisions.setObstacles(harbor.piles, harbor.solids);
    this.resetStatus();
  }

  private makeYacht(): Yacht {
    const s = this.harbor.start;
    return new Yacht(this.yachtConfig, s.pos, s.headingDeg, s.speedKn);
  }

  private resetStatus(): void {
    this.status = {
      time: 0,
      contacts: 0,
      hardContacts: 0,
      maxImpactKn: 0,
      inBerth: false,
      moored: false,
      completed: false,
      completedAt: null,
      message: '',
    };
  }

  reset(opts: { cfg?: YachtConfig; env?: EnvironmentSettings } = {}): void {
    if (opts.cfg) this.yachtConfig = opts.cfg;
    this.env.reset(opts.env);
    this.lines.clear();
    this.yacht = this.makeYacht();
    this.time = 0;
    this.accumulator = 0;
    this.trail = [];
    this.log = [];
    this.activeContacts.clear();
    this.mooredTimer = 0;
    this.resetStatus();
    this.addLog('Manöver gestartet. Ziel: ' + (this.targetBerth?.label ?? '–'), 'info');
  }

  get targetBerth(): Berth | undefined {
    return this.harbor.berths.find((b) => b.id === this.targetBerthId);
  }

  addLog(text: string, level: LogEvent['level'] = 'info'): void {
    this.log.push({ t: this.time, text, level });
    if (this.log.length > 200) this.log.shift();
  }

  /** Echtzeit-Fortschritt (Sekunden Wandzeit). */
  advance(realDt: number): void {
    if (this.paused) return;
    this.accumulator += Math.min(realDt, 0.1) * this.timeScale;
    let steps = 0;
    while (this.accumulator >= PHYSICS_DT && steps < 2000) {
      this.stepOnce();
      this.accumulator -= PHYSICS_DT;
      steps++;
    }
  }

  stepOnce(): void {
    const dt = PHYSICS_DT;
    this.env.update(dt);
    const y = this.yacht;
    const lineForces = this.lines.update(y, dt);
    const contactForces = this.collisions.update(y);
    const current = this.env.currentAt(y.state.pos);
    const wind = this.env.windAt(y.state.pos);
    y.step(dt, current, wind, [...lineForces, ...contactForces]);
    this.time += dt;
    this.status.time = this.time;
    for (const e of this.lines.events) this.addLog(e, 'warn');
    this.lines.events = [];
    this.trackContacts();
    this.evaluate(dt);
    this.trailTimer += dt;
    if (this.trailTimer > 0.5) {
      this.trailTimer = 0;
      this.trail.push({ ...y.state.pos });
      if (this.trail.length > 600) this.trail.shift();
    }
  }

  private trackContacts(): void {
    const now = new Set<string>();
    for (const c of this.collisions.contacts) {
      now.add(c.obstacleId);
      if (!this.activeContacts.has(c.obstacleId)) {
        const kn = c.approachSpeed / KN;
        this.status.contacts++;
        this.status.maxImpactKn = Math.max(this.status.maxImpactKn, kn);
        const what = c.kind === 'pile' ? 'Dalbe' : c.kind === 'boat' ? 'anderes Boot' : c.kind === 'wall' ? 'Kaimauer' : 'Steg';
        if (kn > 0.5) {
          this.status.hardContacts++;
          this.addLog(`Harter Kontakt mit ${what} (${kn.toFixed(1)} kn)!`, 'bad');
        } else {
          this.addLog(`Berührung ${what} (${kn.toFixed(2)} kn)`, 'warn');
        }
      }
    }
    this.activeContacts = now;
  }

  /** Festgemacht, wenn Boot in der Zielbox, fast still, Bug- und Heckleinen belegt. */
  private evaluate(dt: number): void {
    const berth = this.targetBerth;
    if (!berth || this.status.completed) return;
    const hull = this.yacht.outlineWorld(true);
    const inside = hull.filter((p) => insideWithTolerance(p, berth.poly, 0.4)).length / hull.length;
    // Schwerpunkt in der Box und der Rumpf weitgehend darin (Fender dürfen überstehen)
    this.status.inBerth = inside > 0.75 && pointInPolygon(this.yacht.state.pos, berth.poly);
    const cleated = this.lines.lines.filter((l) => l.mode === 'cleated');
    const toPier = cleated.filter((l) => l.anchor.kind !== 'pile' && berth.pierAnchors.includes(l.anchor.id));
    const toPiles = cleated.filter((l) => l.anchor.kind === 'pile' && berth.pileAnchors.includes(l.anchor.id));
    const slow = this.yacht.sogKn < 0.15;
    const engineOk = this.yacht.state.gear === 0;
    const moored = this.status.inBerth && toPier.length >= 2 && toPiles.length >= 2 && slow && engineOk;
    this.status.moored = moored;
    if (moored) {
      this.mooredTimer += dt;
      if (this.mooredTimer > 3) {
        this.status.completed = true;
        this.status.completedAt = this.time;
        this.status.message = `Festgemacht nach ${formatTime(this.time)} – Kontakte: ${this.status.contacts}, harte: ${this.status.hardContacts}`;
        this.addLog(this.status.message, 'good');
      }
    } else {
      this.mooredTimer = 0;
      const missing: string[] = [];
      if (!this.status.inBerth) missing.push('Boot in Zielbox bringen');
      if (toPier.length < 2) missing.push(`${2 - toPier.length}× Leine zum Steg belegen`);
      if (toPiles.length < 2) missing.push(`${2 - toPiles.length}× Leine zu den Dalben belegen`);
      if (!engineOk) missing.push('Maschine auskuppeln');
      else if (!slow) missing.push('Boot zur Ruhe kommen lassen');
      this.status.message = missing.join(' · ');
    }
  }
}

/** Punkt im Polygon oder höchstens `tol` Meter außerhalb (Fender, Scheuerleiste). */
function insideWithTolerance(p: Vec2, poly: Vec2[], tol: number): boolean {
  if (pointInPolygon(p, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    if (dist(p, closestOnSegment(p, poly[i], poly[(i + 1) % poly.length])) <= tol) return true;
  }
  return false;
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
