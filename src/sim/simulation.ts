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
import {
  ROLE_LABEL,
  STABLE_MAX_ROT_DEG_S,
  STABLE_MAX_SOG_KN,
  STABLE_SECONDS,
  checkRequirements,
  rateContact,
  starRating,
} from './evaluation';
import { FenderSet } from '../physics/fenders';

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
  /** wie lange das Boot bereits ruhig und vollständig festgemacht liegt [s] */
  stableFor: number;
  message: string;
  result: ManeuverResult | null;
}

/** Festgehaltenes Ergebnis eines erfolgreichen Anlegers. */
export interface ManeuverResult {
  scenarioId: string;
  scenarioName: string;
  berthId: string;
  berthLabel: string;
  yachtName: string;
  time: number;
  contacts: number;
  hardContacts: number;
  maxImpactKn: number;
  stars: 1 | 2 | 3;
  windKn: number;
  currentKn: number;
  date: string;
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
  fenders!: FenderSet;
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

  constructor(harbor: Harbor, cfg: YachtConfig, env: EnvironmentSettings = DEFAULT_ENV, lineSettings: LineSettings = DEFAULT_LINE_SETTINGS) {
    this.harbor = harbor;
    this.yachtConfig = cfg;
    this.env = new Environment(env);
    this.lines = new LineSystem(lineSettings);
    this.targetBerthId = harbor.defaultTarget;
    this.yacht = this.makeYacht();
    this.fenders = new FenderSet(this.yacht.model);
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
      stableFor: 0,
      message: '',
      result: null,
    };
  }

  reset(opts: { cfg?: YachtConfig; env?: EnvironmentSettings } = {}): void {
    if (opts.cfg) this.yachtConfig = opts.cfg;
    this.env.reset(opts.env);
    this.lines.clear();
    this.yacht = this.makeYacht();
    this.fenders = new FenderSet(this.yacht.model);
    this.time = 0;
    this.accumulator = 0;
    this.trail = [];
    this.log = [];
    this.activeContacts.clear();
    this.resetStatus();
    this.addLog('Manöver gestartet. Ziel: ' + (this.targetBerth?.label ?? '–'), 'info');
  }

  /** Anderes Szenario laden (setzt das Manöver zurück). */
  setHarbor(harbor: Harbor, targetBerthId = harbor.defaultTarget): void {
    this.harbor = harbor;
    this.collisions.setObstacles(harbor.piles, harbor.solids);
    this.targetBerthId = harbor.berths.some((b) => b.id === targetBerthId && !b.occupied) ? targetBerthId : harbor.defaultTarget;
    this.reset();
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
    const contactForces = this.collisions.update(y, this.fenders.colliders(this.time));
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
      // ein Fender und der Rumpf zählen getrennt; mehrere Rumpfpunkte am selben Hindernis einmal
      const key = `${c.via === 'fender' ? c.fenderId : 'hull'}|${c.obstacleId}`;
      now.add(key);
      if (this.activeContacts.has(key)) continue;
      const kn = c.approachSpeed / KN;
      this.status.maxImpactKn = Math.max(this.status.maxImpactKn, kn);
      const what = c.kind === 'pile' ? 'Dalbe' : c.kind === 'boat' ? 'anderes Boot' : c.kind === 'wall' ? 'Kaimauer' : 'Steg';
      const rating = rateContact(c.via, c.kind, kn);
      const by = c.via === 'fender' ? 'Fender an ' : '';
      if (rating === 'free') {
        if (c.via === 'fender' && kn >= 0.1) this.addLog(`Fender an ${what} (${kn.toFixed(1)} kn)`, 'info');
        else if (c.kind === 'pile') this.addLog(`Dalbe sanft berührt (${kn.toFixed(2)} kn) – ohne Abzug`, 'info');
        continue;
      }
      this.status.contacts++;
      if (rating === 'hard') {
        this.status.hardContacts++;
        this.addLog(`Harter Kontakt: ${by}${what} (${kn.toFixed(1)} kn)!`, 'bad');
      } else {
        this.addLog(`Berührung: ${by}${what} (${kn.toFixed(2)} kn)`, 'warn');
      }
    }
    this.activeContacts = now;
  }

  /**
   * Festgemacht, wenn das Boot in der Markierung liegt, alle geforderten
   * Leinen belegt und stramm sind, die Maschine ausgekuppelt ist und das Boot
   * STABLE_SECONDS lang ruhig liegt.
   */
  private evaluate(dt: number): void {
    const berth = this.targetBerth;
    if (!berth || this.status.completed) return;
    const y = this.yacht;
    const hull = y.outlineWorld(true);
    const inside = hull.filter((p) => insideWithTolerance(p, berth.poly, 0.4)).length / hull.length;
    // Schwerpunkt in der Markierung und der Rumpf weitgehend darin (Fender dürfen überstehen)
    this.status.inBerth = inside > 0.75 && pointInPolygon(y.state.pos, berth.poly);
    const reqs = checkRequirements(berth, y, this.lines.lines);
    const linesOk = reqs.every((r) => r.ok >= r.req.count);
    const calm = y.sogKn < STABLE_MAX_SOG_KN && Math.abs((y.state.r * 180) / Math.PI) < STABLE_MAX_ROT_DEG_S;
    const engineOk = y.state.gear === 0;
    const moored = this.status.inBerth && linesOk && engineOk;
    this.status.moored = moored;
    this.status.stableFor = moored && calm ? this.status.stableFor + dt : 0;

    if (this.status.stableFor >= STABLE_SECONDS) {
      const s = this.status;
      s.completed = true;
      s.completedAt = this.time;
      s.result = {
        scenarioId: this.harbor.id,
        scenarioName: this.harbor.name,
        berthId: berth.id,
        berthLabel: berth.label,
        yachtName: this.yachtConfig.name,
        time: this.time,
        contacts: s.contacts,
        hardContacts: s.hardContacts,
        maxImpactKn: s.maxImpactKn,
        stars: starRating(s.contacts, s.hardContacts),
        windKn: this.env.settings.windSpeedKn,
        currentKn: this.env.settings.currentSpeedKn,
        date: new Date().toISOString(),
      };
      s.message = `Festgemacht nach ${formatTime(this.time)} – ${'★'.repeat(s.result.stars)}${'☆'.repeat(3 - s.result.stars)} · Kontakte: ${s.contacts}, harte: ${s.hardContacts}`;
      this.addLog(s.message, 'good');
      return;
    }

    const todo: string[] = [];
    if (!this.status.inBerth) todo.push('Boot in die Markierung bringen');
    for (const r of reqs) {
      const missing = r.req.count - r.ok;
      if (missing <= 0) continue;
      if (r.slack.length) todo.push(`${ROLE_LABEL[r.req.role]} ${r.slack.map((l) => l.id).join(', ')} hängt durch – dichtholen`);
      else if (r.notCleated) todo.push(`${r.req.label} belegen`);
      else todo.push(`${missing > 1 ? `${missing}× ` : ''}${r.req.label} ausbringen`);
    }
    if (!engineOk) todo.push('Maschine auskuppeln');
    if (moored) {
      todo.push(calm ? `Liegt ruhig … ${Math.ceil(STABLE_SECONDS - this.status.stableFor)} s` : 'Boot zur Ruhe kommen lassen');
    }
    this.status.message = todo.join(' · ');
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
