/**
 * Festmacherleinen als elastische, nur auf Zug belastbare Seile mit
 * Dämpfung. Jede Leine verbindet eine Klampe an Bord mit einem Festpunkt an
 * Land (Dalben, Poller, Ring). Die Crew kann die Leine
 *  - von Hand halten (rutscht durch, wenn die Last die Haltekraft übersteigt),
 *  - dichtholen (einholen, solange die Zugkraft reicht),
 *  - fieren (kontrolliert nachgeben),
 *  - belegen (feste Länge; Eindampfen in die Leine möglich),
 *  - loswerfen.
 */
import { clamp, dist, dot, norm, scale, sub, type Vec2 } from './vec';
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
};

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
}

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

  /** Prüft, ob die Leine geworfen/gelegt werden kann. */
  canReach(yacht: Yacht, cleatId: string, anchor: ShoreAnchor): { ok: boolean; distance: number; range: number } {
    const c = yacht.cleatWorld(cleatId);
    const range = this.settings.throwRange[anchor.kind];
    if (!c) return { ok: false, distance: Infinity, range };
    const d = dist(c, anchor.pos);
    return { ok: d <= range, distance: d, range };
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
      length: Math.min(this.settings.maxLength, reach.distance + 0.4),
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
      const cleat = yacht.model.cleats.find((c) => c.id === line.cleatId);
      if (!cleat) continue;
      const p = yacht.toWorld(cleat.pos);
      const d = sub(line.anchor.pos, p);
      const distance = Math.hypot(d.x, d.y);
      const dir = norm(d); // zeigt vom Boot zum Festpunkt
      const vp = yacht.pointVelocity(cleat.pos);
      // Änderungsrate des Abstands (positiv = Leine wird länger gezogen)
      const dDist = -dot(vp, dir);

      const L = Math.max(0.3, line.length);
      const k = s.axialStiffness / L;
      const stretch = distance - L;
      let tension = 0;
      if (stretch > 0) {
        const c = 2 * 0.25 * Math.sqrt(k * yacht.model.mass);
        tension = Math.max(0, k * stretch + c * dDist);
      }

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
      line.length = clamp(line.length, 0.3, s.maxLength);
      if (line.length >= s.maxLength && line.mode !== 'cleated' && tension > s.handHoldForce) {
        // Ende der Leine erreicht – gilt dann als belegt (Stopperstek am Ende)
        line.mode = 'cleated';
        this.events.push(`Leine ${line.id}: Ende erreicht`);
      }
      if (tension > s.breakingLoad) {
        line.broken = true;
        this.events.push(`Leine ${line.id} gebrochen!`);
      }
      line.tension = tension;
      line.slack = Math.max(0, L - distance);
      if (tension > 0) forces.push({ point: p, force: scale(dir, tension) });
    }
    this.lines = this.lines.filter((l) => !l.broken);
    return forces;
  }
}
