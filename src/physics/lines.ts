/**
 * Festmacherleinen als elastische, nur auf Zug belastbare Seile mit
 * Dämpfung. Jede Leine verbindet eine Klampe an Bord mit einem Festpunkt an
 * Land (Dalben, Poller, Ring). Die Crew kann die Leine
 *  - von Hand halten (rutscht durch, wenn die Last die Haltekraft übersteigt),
 *  - dichtholen (einholen, solange die Zugkraft reicht),
 *  - fieren (kontrolliert nachgeben),
 *  - belegen (feste Länge; Eindampfen in die Leine möglich),
 *  - loswerfen.
 *
 * Eine Manöverleine (Kraftdreieck) läuft von einer Bordklampe um den
 * Festpunkt zurück zu einer zweiten Bordklampe und rutscht dort mit etwas
 * Reibung durch. Losgeworfen wird sie von Bord (über Slip einholen).
 */
import { nearestHullPoint } from './fenders';
import { clamp, dist, dot, norm, pointInPolygon, scale, sub, worldToBody, type Vec2 } from './vec';
import type { ExternalForce, Yacht } from './yacht';

export type LineMode = 'hand' | 'heave' | 'ease' | 'cleated';
export type AnchorKind = 'pile' | 'bollard' | 'ring';

export interface ShoreAnchor {
  id: string;
  kind: AnchorKind;
  pos: Vec2;
  label: string;
}

export interface LineSettings {
  /** Wurfweiten je Festpunkt-Typ [m] */
  throwRange: Record<AnchorKind, number>;
  /** Haltekraft beim Halten (Törn um Klampe/Poller, Crew hält gegen) [N] */
  handHoldForce: number;
  /** Maximale Zugkraft beim Dichtholen (kräftig bzw. über die Winsch) [N] */
  handPullForce: number;
  /** Bremskraft beim Fieren: die Leine läuft kontrolliert aus [N] */
  easeForce: number;
  /** Einholgeschwindigkeit [m/s] */
  heaveRate: number;
  /** Fiergeschwindigkeit [m/s] */
  easeRate: number;
  /** Maximale Leinenlänge [m] */
  maxLength: number;
  /** Dehnsteifigkeit EA [N] (Polyamid/Polyester-Festmacher) */
  axialStiffness: number;
  /** Bruchlast [N] */
  breakingLoad: number;
  /** Maximale Gesamtlänge der Manöverleine (beide Parten) [m] */
  slipMaxLength: number;
  /** Reibungsbeiwert der Leine um Dalbe/Poller (Umschlingung ~180°) */
  slipFriction: number;
  /** Losbrechkraft am Festpunkt, auch ohne Last [N] */
  slipBaseResistance: number;
}

export const DEFAULT_LINE_SETTINGS: LineSettings = {
  throwRange: { pile: 6, bollard: 7, ring: 1.8 },
  handHoldForce: 1500,
  handPullForce: 900,
  easeForce: 150,
  heaveRate: 0.45,
  easeRate: 0.5,
  maxLength: 25,
  axialStiffness: 60000,
  breakingLoad: 30000,
  slipMaxLength: 40,
  slipFriction: 0.1,
  slipBaseResistance: 60,
};

/**
 * Feste Part einer Manöverleine (Kraftdreieck): von der zweiten Klampe an
 * Bord zum Festpunkt. Dort läuft die Leine mit etwas Reibung durch.
 */
export interface SlipLeg {
  cleatId: string;
  /** ungedehnte Länge dieser Part [m] */
  length: number;
  tension: number;
  slack: number;
}

export interface MooringLine {
  id: number;
  cleatId: string;
  anchor: ShoreAnchor;
  /** ausgesteckte Länge (ungedehnt) [m] */
  length: number;
  mode: LineMode;
  tension: number;
  /** Momentane Überlänge (Durchhang) [m], > 0 = lose */
  slack: number;
  broken: boolean;
  /**
   * Nur bei Manöverleinen: die zweite, an Bord belegte Part. `cleatId`,
   * `length`, `tension` beschreiben dann die Holepart, an der die Crew
   * arbeitet; `slack` ist die Lose der ganzen Leine.
   */
  slip?: SlipLeg;
}

/** Kürzeste Wurfdistanz von der Bordkante (Deckskontur) zu einem Punkt [m]. */
export function throwDistance(yacht: Yacht, target: Vec2): number {
  const st = yacht.state;
  const body = worldToBody({ x: target.x - st.pos.x, y: target.y - st.pos.y }, st.psi);
  if (pointInPolygon(body, yacht.model.outline)) return 0;
  return nearestHullPoint(yacht.model.outline, body).dist;
}

export const isSlip =(l: MooringLine): l is MooringLine & { slip: SlipLeg } => !!l.slip;

/**
 * Leine rutscht durch (Hände, Klampe), sobald der Zug `limit` übersteigt:
 * Länge wächst höchstens um `maxStep`, zurückgegeben wird der begrenzte Zug.
 */
function slipAbove(line: MooringLine, tension: number, limit: number, k: number, maxStep: number): number {
  if (tension <= limit) return tension;
  line.length += Math.min((tension - limit) / k, maxStep);
  return limit;
}

export class LineSystem {
  lines: MooringLine[] = [];
  settings: LineSettings;
  private nextId = 1;
  events: string[] = [];

  constructor(settings: LineSettings = DEFAULT_LINE_SETTINGS) {
    this.settings = settings;
  }

  /**
   * Prüft, ob die Leine geworfen/gelegt werden kann. Die Crew läuft mit der
   * auf der Klampe belegten Leine an Deck zur günstigsten Stelle und wirft
   * von der Bordkante: Die Wurfweite zählt ab dem nächsten Punkt des Rumpfs,
   * die Leine muss aber von der Klampe bis zum Festpunkt reichen.
   * `distance` ist die Wurfdistanz, `cleatDistance` der Abstand zur Klampe.
   */
  canReach(
    yacht: Yacht,
    cleatId: string,
    anchor: ShoreAnchor,
  ): { ok: boolean; distance: number; range: number; cleatDistance: number } {
    const c = yacht.cleatWorld(cleatId);
    const range = this.settings.throwRange[anchor.kind];
    if (!c) return { ok: false, distance: Infinity, range, cleatDistance: Infinity };
    const cleatDistance = dist(c, anchor.pos);
    const d = throwDistance(yacht, anchor.pos);
    return { ok: d <= range && cleatDistance + 0.4 <= this.settings.maxLength, distance: d, range, cleatDistance };
  }

  /** Leine ausbringen. Gibt null zurück, wenn außer Reichweite. */
  attach(yacht: Yacht, cleatId: string, anchor: ShoreAnchor): MooringLine | null {
    const reach = this.canReach(yacht, cleatId, anchor);
    if (!reach.ok) return null;
    const line: MooringLine = {
      id: this.nextId++,
      cleatId,
      anchor,
      // etwas Lose: die Leine liegt nach dem Wurf nicht sofort steif
      length: Math.min(this.settings.maxLength, reach.cleatDistance + 0.4),
      mode: 'hand',
      tension: 0,
      slack: 0.4,
      broken: false,
    };
    this.lines.push(line);
    return line;
  }

  /**
   * Leine direkt belegt anlegen (z. B. Startzustand beim Ablegen): ohne
   * Wurfweiten-Prüfung, auf aktuelle Distanz, stramm.
   */
  attachDirect(yacht: Yacht, cleatId: string, anchor: ShoreAnchor): MooringLine | null {
    const c = yacht.cleatWorld(cleatId);
    if (!c) return null;
    const line: MooringLine = {
      id: this.nextId++,
      cleatId,
      anchor,
      length: Math.max(0.3, dist(c, anchor.pos)),
      mode: 'cleated',
      tension: 0,
      slack: 0,
      broken: false,
    };
    this.lines.push(line);
    return line;
  }

  /**
   * Manöverleine (Kraftdreieck) ausbringen: von `fixedCleatId` um den
   * Festpunkt herum zurück an Bord auf `workCleatId`. Die Bucht wird von der
   * ersten Klampe aus über den Festpunkt geworfen bzw. gelegt; die feste
   * Part ist belegt, an der Holepart arbeitet die Crew.
   */
  attachSlip(yacht: Yacht, fixedCleatId: string, anchor: ShoreAnchor, workCleatId: string): MooringLine | null {
    if (fixedCleatId === workCleatId) return null;
    const reach = this.canReach(yacht, fixedCleatId, anchor);
    const w = yacht.cleatWorld(workCleatId);
    if (!reach.ok || !w) return null;
    const dFixed = reach.cleatDistance;
    const dWork = dist(w, anchor.pos);
    if (dFixed + dWork + 0.6 > this.settings.slipMaxLength) return null;
    const line: MooringLine = {
      id: this.nextId++,
      cleatId: workCleatId,
      anchor,
      length: dWork + 0.4,
      mode: 'hand',
      tension: 0,
      slack: 0.6,
      broken: false,
      slip: { cleatId: fixedCleatId, length: dFixed + 0.2, tension: 0, slack: 0.2 },
    };
    this.lines.push(line);
    return line;
  }

  release(id: number): void {
    this.lines = this.lines.filter((l) => l.id !== id);
  }

  setMode(id: number, mode: LineMode): void {
    const l = this.lines.find((k) => k.id === id);
    if (l) l.mode = mode;
  }

  clear(): void {
    this.lines = [];
  }

  /**
   * Leinenkräfte berechnen und Leinenlängen gemäß Modus nachführen.
   * Liefert äußere Kräfte auf die Yacht.
   */
  update(yacht: Yacht, dt: number): ExternalForce[] {
    const s = this.settings;
    const forces: ExternalForce[] = [];
    for (const line of this.lines) {
      const work = this.leg(yacht, line.cleatId, line.anchor, line.length);
      if (!work) continue;
      const fixed = line.slip ? this.leg(yacht, line.slip.cleatId, line.anchor, line.slip.length) : null;
      if (line.slip && !fixed) continue;
      const { p, dir, distance, k } = work;
      const L = Math.max(0.3, line.length);
      let tension = work.tension;

      // Crew/Modus: Länge anpassen
      switch (line.mode) {
        case 'hand':
          tension = slipAbove(line, tension, s.handHoldForce, k, 1.5 * dt);
          break;
        case 'heave':
          if (tension < s.handPullForce) {
            // unter Last wird langsamer eingeholt
            line.length -= s.heaveRate * (1 - tension / s.handPullForce) * dt;
          } else {
            tension = slipAbove(line, tension, s.handHoldForce, k, 1.5 * dt);
          }
          break;
        case 'ease':
          // kontrolliert auslaufen lassen: Zug bleibt gering
          if (tension > s.easeForce) tension = slipAbove(line, tension, s.easeForce, k, 2.5 * dt);
          else if (tension > 20) line.length += s.easeRate * dt;
          break;
        case 'cleated':
          break;
      }
      let fixedTension = 0;
      if (line.slip && fixed) {
        const r = this.slide(line, line.slip, tension, fixed.tension, k, fixed.k, dt);
        tension = r.work;
        fixedTension = r.fixed;
      }
      const maxLen = line.slip ? s.slipMaxLength - line.slip.length : s.maxLength;
      line.length = clamp(line.length, 0.3, maxLen);
      if (line.length >= maxLen && line.mode !== 'cleated' && tension > s.handHoldForce) {
        // Ende der Leine erreicht – gilt dann als belegt (Stopperstek am Ende)
        line.mode = 'cleated';
        this.events.push(`Leine ${line.id}: Ende erreicht`);
      }
      if (Math.max(tension, fixedTension) > s.breakingLoad) {
        line.broken = true;
        this.events.push(`Leine ${line.id} gebrochen!`);
      }
      line.tension = tension;
      line.slack = Math.max(0, L - distance);
      if (tension > 0) forces.push({ point: p, force: scale(dir, tension) });
      if (line.slip && fixed) {
        const leg = line.slip;
        leg.tension = fixedTension;
        leg.slack = Math.max(0, leg.length - fixed.distance);
        // Lose der ganzen Leine: sie rutscht um den Festpunkt, beide Parten zählen
        line.slack = Math.max(0, L + leg.length - distance - fixed.distance);
        if (fixedTension > 0) forces.push({ point: fixed.p, force: scale(fixed.dir, fixedTension) });
      }
    }
    this.lines = this.lines.filter((l) => !l.broken);
    return forces;
  }

  /** Elastischer Zug in einer Part zwischen Bordklampe und Festpunkt. */
  private leg(yacht: Yacht, cleatId: string, anchor: ShoreAnchor, length: number) {
    const cleat = yacht.model.cleats.find((c) => c.id === cleatId);
    if (!cleat) return null;
    const p = yacht.toWorld(cleat.pos);
    const d = sub(anchor.pos, p);
    const distance = Math.hypot(d.x, d.y);
    const dir = norm(d); // zeigt vom Boot zum Festpunkt
    const vp = yacht.pointVelocity(cleat.pos);
    // Änderungsrate des Abstands (positiv = Leine wird länger gezogen)
    const dDist = -dot(vp, dir);
    const L = Math.max(0.3, length);
    const k = this.settings.axialStiffness / L;
    const stretch = distance - L;
    let tension = 0;
    if (stretch > 0) {
      const c = 2 * 0.25 * Math.sqrt(k * yacht.model.mass);
      tension = Math.max(0, k * stretch + c * dDist);
    }
    return { p, dir, distance, k, tension };
  }

  /**
   * Manöverleine: Die Leine rutscht um den Festpunkt von der stärker zur
   * schwächer belasteten Part, sobald der Zugunterschied die Reibung
   * übersteigt (Seilreibung, Umschlingung ~180°, plus Losbrechkraft).
   * Gibt die Züge nach dem Durchrutschen zurück.
   */
  private slide(line: MooringLine, leg: SlipLeg, work: number, fixed: number, kWork: number, kFixed: number, dt: number) {
    const s = this.settings;
    const low = Math.min(work, fixed);
    const resistance = s.slipBaseResistance + low * (Math.exp(s.slipFriction * Math.PI) - 1);
    const diff = fixed - work;
    if (Math.abs(diff) <= resistance) return { work, fixed };
    // eine lose Part nimmt beim Nachrutschen zunächst keinen Zug auf
    const kIn = diff > 0 ? (work > 0 ? kWork : 0) : fixed > 0 ? kFixed : 0;
    const kOut = diff > 0 ? kFixed : kWork;
    const step = Math.min((Math.abs(diff) - resistance) / (kIn + kOut), 3 * dt);
    if (diff > 0) {
      // Zug in der festen Part überwiegt: Leine läuft zur festen Part hin
      const d = Math.min(step, line.length - 0.3);
      leg.length += d;
      line.length -= d;
      return { work: work + kIn * d, fixed: fixed - kOut * d };
    }
    const d = Math.min(step, leg.length - 0.3);
    leg.length -= d;
    line.length += d;
    return { work: work - kOut * d, fixed: fixed + kIn * d };
  }
}
