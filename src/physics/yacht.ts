/**
 * Manövriermodell einer Yacht mit 3 Freiheitsgraden (Längs, Quer, Gieren)
 * nach Fossen (NED/Body-Konvention) mit
 *  - Starrkörper- und hydrodynamischer Zusatzmasse inkl. Kopplung (m26),
 *    Coriolis/Zentripetal- und Munk-Moment (Massenträgheit),
 *  - Rumpfwiderstand (Reibung + Wellenwiderstand über Froude-Zahl),
 *  - Querumströmung des Lateralplans in Streifen (Kiel und Rumpf; ergibt
 *    Drehpunkt, Gierdämpfung und Abdriften bei Fahrt null),
 *  - Kiel und Ruder als Tragflügel mit Stall und Rückwärtsanströmung,
 *  - Propellerschub mit Fortschrittsgrad, Getriebe mit Schaltverzögerung,
 *    Radeffekt, Schraubenstrahl auf das Ruder,
 *  - Wind mit richtungsabhängigem Angriffspunkt (Bug fällt ab),
 *  - Strömung (alle hydrodynamischen Kräfte mit Fahrt durchs Wasser),
 *  - äußeren Kräften (Leinen, Kontakte).
 */
import { DEG, KN, bodyToWorld, clamp, cross, worldToBody, type Vec2 } from './vec';
import { RHO_AIR, RHO_WATER, buildYachtModel, type FoilParams, type YachtModel } from './yachtModel';
import type { YachtConfig } from './yachtConfig';

export interface YachtControls {
  /** Gashebel -1 (voll zurück) … 0 (neutral) … +1 (voll voraus) */
  throttle: number;
  /** Steuerrad -1 (hart Bb) … +1 (hart Stb) */
  helm: number;
  /** Bugstrahlruder -1 (Bug nach Bb), 0, +1 (Bug nach Stb) */
  thruster: number;
}

export interface YachtState {
  pos: Vec2;
  psi: number;
  /** Geschwindigkeit über Grund im Body-System [m/s] */
  u: number;
  v: number;
  /** Drehrate [rad/s] */
  r: number;
  rudder: number; // [rad], + = Boot dreht (vorwärts) nach Stb
  gear: -1 | 0 | 1;
  shiftTimer: number;
  rpm: number; // Anteil 0 … 1
}

export interface ExternalForce {
  /** Angriffspunkt in Weltkoordinaten */
  point: Vec2;
  /** Kraft in Weltkoordinaten [N] */
  force: Vec2;
}

/** Einzelkraft für Visualisierung/Debug (Body-System, Angriffspunkt relativ SP). */
export interface ForceArrow {
  kind: 'thrust' | 'propwalk' | 'rudder' | 'keel' | 'hull' | 'wind' | 'thruster' | 'external';
  at: Vec2;
  f: Vec2;
}

export interface ForceBreakdown {
  X: number;
  Y: number;
  N: number;
  arrows: ForceArrow[];
  thrust: number;
  slipstream: number;
  apparentWind: Vec2; // Body, Luft relativ Boot [m/s]
  waterSpeed: Vec2; // Body, Fahrt durchs Wasser [m/s]
}

/** Hebelbereich um 0, in dem das Getriebe in Neutral steht */
export const NEUTRAL_ZONE = 0.1;
/** Hebelstellung „eingekuppelt, Standgas“ (knapp hinter der Neutral-Rastung) */
export const IDLE_LEVER = NEUTRAL_ZONE + 0.01;
/**
 * Empirische Modellbeiwerte an einer Stelle, damit sie gegen Messungen
 * (Drehkreis, Aufstoppweg, Driftgeschwindigkeit) kalibriert werden können.
 */
export const TUNING = {
  /** Anteil des potentialtheoretischen Munk-Moments (viskose Abminderung) */
  munk: 0.5,
  /** Geschwindigkeit im Schraubenstrahl am Ruder / Fernfeld-Zusatzgeschw. */
  slipstream: 0.6,
  /** Radeffekt-Querkraft / Schub (voraus, achteraus) */
  propWalkAhead: 0.03,
  propWalkAstern: 0.3,
  /** Querumströmungsbeiwert Rumpf / Kiel */
  hullCrossCd: 0.8,
  keelCrossCd: 1.1,
  /** Linearer Rumpfauftrieb bei Schräganströmung */
  hullLift: 1,
  /** Windkraftbeiwerte längs / quer (Yachten typ. 0.6–0.8 / 0.8–0.9) */
  windCx: 0.75,
  windCy: 0.85,
};

/**
 * Normal- und Sehnenkraft auf ein Foil (Foil-System: c = Sehne nach vorn,
 * n = quer). s = Bewegung des Foils relativ zum Wasser. Deckt alle
 * Anströmwinkel ab (Vorwärts-, Quer-, Rückwärtsanströmung).
 */
export function foilForce(sc: number, sn: number, area: number, p: FoilParams): { fc: number; fn: number } {
  const s2 = sc * sc + sn * sn;
  if (s2 < 1e-10) return { fc: 0, fn: 0 };
  const s = Math.sqrt(s2);
  const q = 0.5 * RHO_WATER * s2;
  const sinA = sn / s;
  const cosA = sc / s;
  const reversed = cosA < 0;
  const aEff = Math.asin(Math.min(1, Math.abs(sinA))); // 0 … π/2
  let stall = 1;
  if (aEff > p.stallRad) stall = Math.max(0.45, 1 - ((aEff - p.stallRad) / (12 * DEG)) * 0.55);
  const eff = p.efficiency * (reversed ? p.reverseEff : 1);
  const cn = p.clAlpha * sinA * Math.abs(cosA) * stall * eff + p.crossCd * sinA * Math.abs(sinA);
  return { fc: -q * area * p.cd0 * cosA, fn: -q * area * cn };
}

/** Widerstandsbeiwert Rumpf in Abhängigkeit der Froude-Zahl. */
export function hullResistanceCoeff(fn: number): number {
  return 0.0045 + 0.012 * Math.pow(Math.abs(fn) / 0.4, 6);
}

export class Yacht {
  model: YachtModel;
  state: YachtState;
  controls: YachtControls = { throttle: 0, helm: 0, thruster: 0 };
  last: ForceBreakdown | null = null;

  constructor(cfg: YachtConfig, pos: Vec2 = { x: 0, y: 0 }, headingDeg = 0, speedKn = 0) {
    this.model = buildYachtModel(cfg);
    this.state = {
      pos: { ...pos },
      psi: headingDeg * DEG,
      u: speedKn * KN,
      v: 0,
      r: 0,
      rudder: 0,
      gear: 0,
      shiftTimer: 0,
      rpm: cfg.engine.idleFraction,
    };
  }

  /** Aktueller Propellerschub [N] (+ voraus) bei Fahrt durchs Wasser ur. */
  thrustAt(ur: number): number {
    const st = this.state;
    const m = this.model;
    if (st.gear === 0) return 0;
    const n = st.rpm;
    const ua = ur * 0.9; // Nachstrom
    const tb = m.bollardThrust;
    const vp = m.pitchSpeed;
    if (st.gear > 0) {
      const t = tb * (n * n - (n * ua) / vp);
      return clamp(t, -0.3 * tb * n * n, 1.3 * tb * n * n);
    }
    const eff = this.model.cfg.engine.reverseEfficiency;
    const t = eff * tb * (n * n - (n * -ua) / vp);
    return -clamp(t, -0.3 * eff * tb * n * n, 1.3 * eff * tb * n * n);
  }

  /** Aktuatoren (Ruder, Getriebe, Drehzahl) nachführen. */
  updateActuators(dt: number): void {
    const st = this.state;
    const cfg = this.model.cfg;
    const c = this.controls;
    // Ruder mit begrenzter Legegeschwindigkeit
    const target = clamp(c.helm, -1, 1) * cfg.rudder.maxAngleDeg * DEG;
    const maxStep = cfg.rudder.rateDegPerS * DEG * dt;
    st.rudder += clamp(target - st.rudder, -maxStep, maxStep);

    // Getriebe: Wechsel nur über Neutral mit Schaltzeit
    const lever = clamp(c.throttle, -1, 1);
    const wanted: -1 | 0 | 1 = lever > NEUTRAL_ZONE ? 1 : lever < -NEUTRAL_ZONE ? -1 : 0;
    // shiftTimer = Zeit, die der Schaltvorgang in Richtung `wanted` schon läuft
    if (wanted !== st.gear) {
      if (st.gear !== 0) {
        st.gear = 0; // sofort auskuppeln
        st.shiftTimer = 0;
      } else {
        st.shiftTimer += dt;
        if (st.shiftTimer >= cfg.engine.shiftDelay && st.rpm < cfg.engine.idleFraction + 0.15) {
          st.gear = wanted;
          st.shiftTimer = 0;
        }
      }
    } else {
      st.shiftTimer = 0;
    }
    // Drehzahl: nur eingekuppelt Gas geben (Schalten bei Leerlauf)
    const idle = cfg.engine.idleFraction;
    let rpmTarget = idle;
    if (st.gear !== 0 && wanted === st.gear) {
      rpmTarget = idle + (1 - idle) * ((Math.abs(lever) - NEUTRAL_ZONE) / (1 - NEUTRAL_ZONE));
    }
    const k = 1 - Math.exp(-dt / cfg.engine.spoolTime);
    st.rpm += (rpmTarget - st.rpm) * k;
  }

  /** Alle Kräfte im Body-System (bezogen auf den Schwerpunkt). */
  computeForces(current: Vec2, wind: Vec2, external: ExternalForce[]): ForceBreakdown {
    const m = this.model;
    const cfg = m.cfg;
    const st = this.state;
    const arrows: ForceArrow[] = [];
    let X = 0;
    let Y = 0;
    let N = 0;
    const apply = (kind: ForceArrow['kind'], at: Vec2, fx: number, fy: number) => {
      X += fx;
      Y += fy;
      N += at.x * fy - at.y * fx;
      arrows.push({ kind, at, f: { x: fx, y: fy } });
    };

    // Relativgeschwindigkeit zum Wasser
    const cb = worldToBody(current, st.psi);
    const ur = st.u - cb.x;
    const vr = st.v - cb.y;
    const r = st.r;

    // --- Rumpf längs: Reibung + Wellenwiderstand --------------------------------
    const fnum = ur / Math.sqrt(9.81 * cfg.hull.lwl);
    const ct = hullResistanceCoeff(fnum) * (ur < 0 ? 1.4 : 1);
    const xh = -0.5 * RHO_WATER * m.wettedArea * ct * ur * Math.abs(ur) - 40 * ur;

    // --- Lateralplan-Streifen (Querumströmung) ----------------------------------
    let yh = 0;
    let nh = 0;
    const uAbs = Math.abs(ur);
    for (const s of m.strips) {
      const vl = vr + s.x * r;
      const cd = TUNING.hullCrossCd + (TUNING.keelCrossCd - TUNING.hullCrossCd) * s.cd;
      const dY = -0.5 * RHO_WATER * s.depth * s.dx * vl * (cd * Math.abs(vl) + s.liftCoeff * TUNING.hullLift * uAbs);
      yh += dY;
      nh += s.x * dY;
    }
    // kleine lineare Dämpfung (Viskosität, Wellenbildung bei langsamer Fahrt)
    yh += -250 * vr;
    nh += -800 * r;
    X += xh;
    Y += yh;
    N += nh;
    arrows.push({ kind: 'hull', at: { x: 0, y: 0 }, f: { x: xh, y: yh } });

    // --- Kiel als Tragflügel ----------------------------------------------------
    // Lange Kiele in Segmente entlang der Sehne teilen: jeder Abschnitt sieht
    // seine eigene Anströmung (v + x·r) → Gierdämpfung durch Kielauftrieb.
    {
      const k = m.keel;
      const nSeg = m.keelSegments;
      let fx = 0;
      let fy = 0;
      let nk = 0;
      for (let i = 0; i < nSeg; i++) {
        const xs = k.x + m.cfg.keel.chord * ((i + 0.5) / nSeg - 0.5);
        const f = foilForce(ur, vr + xs * r, k.area / nSeg, k);
        fx += f.fc;
        fy += f.fn;
        nk += xs * f.fn;
      }
      X += fx;
      Y += fy;
      N += nk;
      arrows.push({ kind: 'keel', at: { x: Math.abs(fy) > 1e-6 ? nk / fy : k.x, y: 0 }, f: { x: fx, y: fy } });
    }

    // --- Propeller, Radeffekt ---------------------------------------------------
    const thrust = this.thrustAt(ur);
    let slip = 0;
    if (thrust !== 0) {
      apply('thrust', { x: m.propX, y: 0 }, thrust, 0);
      const ahead = thrust > 0;
      const rotSign = cfg.engine.propRotation === 'right' ? 1 : -1;
      // Rechtsdrehend: voraus Heck nach Stb, achteraus Heck nach Bb
      const coef = (ahead ? TUNING.propWalkAhead : TUNING.propWalkAstern) * cfg.engine.propWalk;
      const fade = 1 / (1 + Math.pow(ur / 1.5, 2));
      const side = (ahead ? 1 : -1) * rotSign * coef * Math.abs(thrust) * fade;
      apply('propwalk', { x: m.propX, y: 0 }, 0, side);
      if (ahead) {
        const ua = Math.max(0, ur * 0.9);
        const D = cfg.engine.propDiameter;
        slip = TUNING.slipstream * (Math.sqrt(ua * ua + (8 * thrust) / (RHO_WATER * Math.PI * D * D)) - ua);
      }
    }

    // --- Ruder (Teil im Schraubenstrahl, Rest in freier Anströmung) ----------------
    {
      const p = m.rudder;
      const d = st.rudder;
      // Sehne um -d gedreht: Vorderkante nach Bb, Hinterkante nach Stb bei d > 0
      const cx = Math.cos(d);
      const cy = -Math.sin(d);
      const nx = Math.sin(d);
      const ny = Math.cos(d);
      const addFoil = (sx: number, sy: number, area: number) => {
        const sc = sx * cx + sy * cy;
        const sn = sx * nx + sy * ny;
        const f = foilForce(sc, sn, area, p);
        return { x: f.fc * cx + f.fn * nx, y: f.fc * cy + f.fn * ny };
      };
      const sy = vr + p.x * r;
      const wash = m.rudderInWash;
      const f1 = addFoil(ur, sy, p.area * (1 - wash));
      const f2 = addFoil(ur + slip, sy, p.area * wash);
      apply('rudder', { x: p.x, y: 0 }, f1.x + f2.x, f1.y + f2.y);
    }

    // --- Bugstrahlruder -----------------------------------------------------------
    if (cfg.bowThruster.enabled && this.controls.thruster !== 0) {
      const fade = 1 / (1 + Math.pow(ur / 1.0, 2));
      apply('thruster', { x: m.bowThrusterX, y: 0 }, 0, clamp(this.controls.thruster, -1, 1) * cfg.bowThruster.thrust * fade);
    }

    // --- Wind ------------------------------------------------------------------------
    const wb = worldToBody(wind, st.psi);
    const ax = wb.x - st.u; // Luft relativ zum Boot (über Grund)
    const ay = wb.y - st.v;
    const aw = Math.hypot(ax, ay);
    if (aw > 1e-3) {
      const q = 0.5 * RHO_AIR * aw;
      const fx = q * cfg.windage.frontalArea * TUNING.windCx * ax;
      const fy = q * cfg.windage.lateralArea * TUNING.windCy * ay;
      // Angriffspunkt wandert zum Luv-Ende (Wind von vorn: nach vorn)
      const ce = m.windCeX + cfg.windage.ceShift * (-ax / aw);
      apply('wind', { x: ce, y: 0 }, fx, fy);
      // aerodynamische Gierdämpfung
      N += -0.5 * RHO_AIR * cfg.windage.lateralArea * Math.pow(cfg.hull.loa, 2) * 0.02 * r * Math.abs(r) * cfg.hull.loa;
    }

    // --- Äußere Kräfte (Leinen, Kontakte) ------------------------------------------
    for (const e of external) {
      const rel = worldToBody({ x: e.point.x - st.pos.x, y: e.point.y - st.pos.y }, st.psi);
      const fb = worldToBody(e.force, st.psi);
      X += fb.x;
      Y += fb.y;
      N += cross(rel, fb);
      arrows.push({ kind: 'external', at: rel, f: fb });
    }

    return {
      X,
      Y,
      N,
      arrows,
      thrust,
      slipstream: slip,
      apparentWind: { x: ax, y: ay },
      waterSpeed: { x: ur, y: vr },
    };
  }

  /** Einen Zeitschritt integrieren (semi-implizites Euler-Verfahren). */
  step(dt: number, current: Vec2, wind: Vec2, external: ExternalForce[]): void {
    this.updateActuators(dt);
    const m = this.model;
    const st = this.state;
    const F = this.computeForces(current, wind, external);
    this.last = F;

    const cb = worldToBody(current, st.psi);
    const u = st.u;
    const v = st.v;
    const r = st.r;
    const ur = u - cb.x;
    const vr = v - cb.y;
    // Coriolis/Zentripetal: Starrkörper mit Grundgeschwindigkeit,
    // Zusatzmasse mit Relativgeschwindigkeit (Fossen 2011, Kap. 6/10)
    const cX = m.mass * v * r + m.m22 * vr * r + m.m26 * r * r;
    const cY = -m.mass * u * r - m.m11 * ur * r;
    // Munk-Moment: nur Kanu-Körper (Kiel und Ruder heben ihres über die
    // Kutta-Bedingung / Auftrieb auf), viskos abgemindert.
    const cN = -TUNING.munk * ((m.m22Hull - m.m11) * ur * vr + m.m26Hull * ur * r);
    // Zusatzmasse reagiert auf Änderung der Relativgeschwindigkeit; bei
    // homogener, zeitlich konstanter Strömung dreht nur ν_c im Body-System:
    // ν̇_c = [r·vc, -r·uc]. Das kompensieren wir auf der rechten Seite.
    const aX = F.X + cX + m.m11 * (r * cb.y);
    const aY = F.Y + cY + m.m22 * (-r * cb.x);
    const aN = F.N + cN + m.m26 * (-r * cb.x);
    const Mi = m.mInv;
    const du = Mi[0] * aX + Mi[1] * aY + Mi[2] * aN;
    const dv = Mi[3] * aX + Mi[4] * aY + Mi[5] * aN;
    const dr = Mi[6] * aX + Mi[7] * aY + Mi[8] * aN;
    st.u += du * dt;
    st.v += dv * dt;
    st.r += dr * dt;
    const w = bodyToWorld({ x: st.u, y: st.v }, st.psi);
    st.pos.x += w.x * dt;
    st.pos.y += w.y * dt;
    st.psi += st.r * dt;
    if (st.psi > Math.PI * 2) st.psi -= Math.PI * 2;
    if (st.psi < 0) st.psi += Math.PI * 2;
  }

  /** Body-Punkt → Weltkoordinaten. */
  toWorld(p: Vec2): Vec2 {
    const w = bodyToWorld(p, this.state.psi);
    return { x: this.state.pos.x + w.x, y: this.state.pos.y + w.y };
  }

  /** Geschwindigkeit (über Grund) eines Body-Punkts in Weltkoordinaten. */
  pointVelocity(p: Vec2): Vec2 {
    const st = this.state;
    return bodyToWorld({ x: st.u - st.r * p.y, y: st.v + st.r * p.x }, st.psi);
  }

  outlineWorld(collision = false): Vec2[] {
    return (collision ? this.model.collisionOutline : this.model.outline).map((p) => this.toWorld(p));
  }

  cleatWorld(id: string): Vec2 | null {
    const c = this.model.cleats.find((k) => k.id === id);
    return c ? this.toWorld(c.pos) : null;
  }

  get sogKn(): number {
    return Math.hypot(this.state.u, this.state.v) / KN;
  }

  get headingDeg(): number {
    return ((this.state.psi / DEG) % 360 + 360) % 360;
  }
}
