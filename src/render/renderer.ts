/**
 * 2D-Draufsicht auf Canvas. Nord oben, 1 Weltmeter = `camera.scale` Pixel.
 */
import type { Harbor } from '../harbor/harbor';
import { boatOutline } from '../harbor/harbor';
import { throwDistance, type MooringLine, type ShoreAnchor } from '../physics/lines';
import { KN, bodyToWorld, pointInPolygon, type Vec2 } from '../physics/vec';
import type { Simulation } from '../sim/simulation';

export interface Camera {
  x: number;
  y: number;
  scale: number;
  follow: boolean;
}

export interface Interaction {
  selectedCleat: string | null;
  hoverAnchor: ShoreAnchor | null;
  hoverCleat: string | null;
  selectedLine: number | null;
  showForces: boolean;
  flash: { text: string; until: number; pos: Vec2 } | null;
  /** Ballfender-Modus: nächster Klick auf den Rumpf setzt den Ballfender */
  placingBall: boolean;
  /** Vorschau der Ballfender-Position (Weltkoordinaten) */
  ballPreview: Vec2 | null;
  /** Manöverleine ausbringen: Klampe → Festpunkt → zweite Klampe */
  slipMode: boolean;
  /** Manöverleine: erste Klampe und Festpunkt schon gewählt */
  slipFrom: { cleat: string; anchor: ShoreAnchor } | null;
}

interface Particle {
  x: number;
  y: number;
  age: number;
}

const C = {
  water: '#1d5e7e',
  waterDeep: '#184f6b',
  grid: 'rgba(255,255,255,0.045)',
  pier: '#b89a6e',
  pierEdge: '#8a6f4b',
  plank: 'rgba(0,0,0,0.12)',
  wall: '#9aa1a6',
  pile: '#3b2a1c',
  pileTop: '#6b4d33',
  berth: 'rgba(255,255,255,0.10)',
  target: 'rgba(120,255,170,0.22)',
  targetEdge: 'rgba(120,255,170,0.85)',
  hull: '#f7f5ef',
  hullEdge: '#2b3a44',
  deck: '#d9cfb8',
  own: '#ffffff',
  cleat: '#c7ccd1',
  cleatSel: '#ffd24a',
  lineSlack: '#f3e7c4',
};

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  camera: Camera = { x: 0, y: -25, scale: 14, follow: true };
  private particles: Particle[] = [];
  private windParticles: (Particle & { life: number })[] = [];
  private washParticles: Particle[] = [];
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D nicht verfügbar');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
  }

  get width(): number {
    return this.canvas.width / this.dpr;
  }

  get height(): number {
    return this.canvas.height / this.dpr;
  }

  toScreen(p: Vec2): Vec2 {
    return {
      x: this.width / 2 + (p.x - this.camera.x) * this.camera.scale,
      y: this.height / 2 - (p.y - this.camera.y) * this.camera.scale,
    };
  }

  toWorld(s: Vec2): Vec2 {
    return {
      x: this.camera.x + (s.x - this.width / 2) / this.camera.scale,
      y: this.camera.y - (s.y - this.height / 2) / this.camera.scale,
    };
  }

  zoomAt(screen: Vec2, factor: number): void {
    const before = this.toWorld(screen);
    this.camera.scale = Math.min(80, Math.max(3, this.camera.scale * factor));
    const after = this.toWorld(screen);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
  }

  private path(poly: Vec2[]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    poly.forEach((p, i) => {
      const s = this.toScreen(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
  }

  render(sim: Simulation, ia: Interaction, realDt: number): void {
    const ctx = this.ctx;
    const y = sim.yacht;
    if (this.camera.follow) {
      // weich nachführen, leicht in Fahrtrichtung vorausschauen
      const ahead = bodyToWorld({ x: Math.max(-4, Math.min(8, y.state.u * 3)), y: 0 }, y.state.psi);
      const tx = y.state.pos.x + ahead.x;
      const ty = y.state.pos.y + ahead.y;
      const k = 1 - Math.exp(-realDt * 2.5);
      this.camera.x += (tx - this.camera.x) * k;
      this.camera.y += (ty - this.camera.y) * k;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.water;
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawGrid();
    this.drawCurrent(sim, realDt);
    this.drawWind(sim, realDt);
    // Ablegen: Zielzone statt Liegeplatz markieren
    this.drawHarbor(sim.harbor, sim.goalZone ? null : sim.targetBerthId);
    if (sim.goalZone) this.drawGoalZone(sim.goalZone);
    this.drawTrail(sim.trail);
    this.drawWash(sim, realDt);
    this.drawYacht(sim, ia);
    this.drawFenders(sim, ia);
    this.drawLines(sim, ia);
    this.drawCrew(sim);
    this.drawAnchors(sim, ia);
    this.drawContacts(sim);
    if (ia.showForces) this.drawForces(sim);
    this.drawOverlay(sim, ia);
  }

  private drawGrid(): void {
    const ctx = this.ctx;
    const step = this.camera.scale > 8 ? 5 : 10;
    const tl = this.toWorld({ x: 0, y: 0 });
    const br = this.toWorld({ x: this.width, y: this.height });
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(tl.x / step) * step; x < br.x; x += step) {
      const s = this.toScreen({ x, y: 0 });
      ctx.moveTo(s.x, 0);
      ctx.lineTo(s.x, this.height);
    }
    for (let yy = Math.floor(br.y / step) * step; yy < tl.y; yy += step) {
      const s = this.toScreen({ x: 0, y: yy });
      ctx.moveTo(0, s.y);
      ctx.lineTo(this.width, s.y);
    }
    ctx.stroke();
  }

  /**
   * Windstreifen auf dem Wasser: ziehen mit Windrichtung und
   * Windgeschwindigkeit; Dichte nach Windstärke, in Böen kräftiger.
   * Stege und Boote werden darüber gezeichnet (Streifen nur auf dem Wasser).
   */
  private drawWind(sim: Simulation, dt: number): void {
    const env = sim.env;
    const baseKn = env.settings.windSpeedKn;
    const w = env.windAt(sim.yacht.state.pos);
    const sp = Math.hypot(w.x, w.y);
    const target = sp > 0.05 ? Math.round(Math.min(220, baseKn * 8)) : 0;
    const tl = this.toWorld({ x: 0, y: 0 });
    const br = this.toWorld({ x: this.width, y: this.height });
    const spawn = () => ({
      x: tl.x + Math.random() * (br.x - tl.x),
      y: br.y + Math.random() * (tl.y - br.y),
      age: 0,
      life: 1.2 + Math.random() * 1.8,
    });
    while (this.windParticles.length < target) {
      const p = spawn();
      p.age = Math.random() * p.life;
      this.windParticles.push(p);
    }
    if (this.windParticles.length > target) this.windParticles.length = target;
    if (target === 0) return;

    const ctx = this.ctx;
    const ux = w.x / sp;
    const uy = w.y / sp;
    const run = sim.paused ? 0 : sim.timeScale;
    // Böenfaktor: aktuelle / eingestellte Windgeschwindigkeit
    const gust = baseKn > 0 ? sp / (baseKn * KN) : 1;
    const baseAlpha = Math.min(0.4, 0.08 + 0.2 * (baseKn / 20) * gust);
    const len = Math.max(6, sp * 0.35 * this.camera.scale);
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    for (const p of this.windParticles) {
      p.x += w.x * dt * run;
      p.y += w.y * dt * run;
      p.age += dt * (run || 1);
      if (p.age > p.life || p.x < tl.x - 10 || p.x > br.x + 10 || p.y > tl.y + 10 || p.y < br.y - 10) {
        Object.assign(p, spawn());
      }
      // weich ein- und ausblenden
      const t = p.age / p.life;
      const a = baseAlpha * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
      if (a < 0.01) continue;
      const s = this.toScreen(p);
      ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - ux * len, s.y + uy * len);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  private drawCurrent(sim: Simulation, dt: number): void {
    const cur = sim.env.currentAt(sim.yacht.state.pos);
    const sp = Math.hypot(cur.x, cur.y);
    const tl = this.toWorld({ x: 0, y: 0 });
    const br = this.toWorld({ x: this.width, y: this.height });
    const target = sp > 0.01 ? 160 : 0;
    while (this.particles.length < target) {
      this.particles.push({ x: tl.x + Math.random() * (br.x - tl.x), y: br.y + Math.random() * (tl.y - br.y), age: Math.random() * 6 });
    }
    if (this.particles.length > target) this.particles.length = target;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(210,235,255,0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const vis = Math.max(0.25, sp) * (sim.paused ? 0 : sim.timeScale);
    for (const p of this.particles) {
      p.x += (cur.x / sp) * vis * dt * 1.0;
      p.y += (cur.y / sp) * vis * dt * 1.0;
      p.age += dt;
      if (p.age > 6 || p.x < tl.x - 5 || p.x > br.x + 5 || p.y > tl.y + 5 || p.y < br.y - 5) {
        p.x = tl.x + Math.random() * (br.x - tl.x);
        p.y = br.y + Math.random() * (tl.y - br.y);
        p.age = 0;
      }
      const s = this.toScreen(p);
      const len = 4 + sp * 8;
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - (cur.x / sp) * len, s.y + (cur.y / sp) * len);
    }
    ctx.stroke();
  }

  private drawGoalZone(zone: Vec2[]): void {
    const ctx = this.ctx;
    this.path(zone);
    ctx.fillStyle = C.target;
    ctx.fill();
    ctx.setLineDash([8, 5]);
    ctx.strokeStyle = C.targetEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    const n = zone.length;
    const c = zone.reduce((a, p) => ({ x: a.x + p.x / n, y: a.y + p.y / n }), { x: 0, y: 0 });
    const s = this.toScreen(c);
    ctx.fillStyle = C.targetEdge;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ZIEL', s.x, s.y);
  }

  private drawHarbor(h: Harbor, targetId: string | null): void {
    const ctx = this.ctx;
    // Boxen
    for (const b of h.berths) {
      this.path(b.poly);
      if (b.id === targetId) {
        ctx.fillStyle = C.target;
        ctx.fill();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = C.targetEdge;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // Stege und Mauern
    for (const s of h.solids) {
      if (s.kind === 'boat') continue;
      this.path(s.poly);
      ctx.fillStyle = s.kind === 'pier' ? C.pier : C.wall;
      ctx.fill();
      ctx.strokeStyle = C.pierEdge;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (s.kind === 'pier' && this.camera.scale > 7) {
        // Planken
        const xs = s.poly.map((p) => p.x);
        const ys = s.poly.map((p) => p.y);
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs);
        const y0 = Math.min(...ys);
        const y1 = Math.max(...ys);
        ctx.strokeStyle = C.plank;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = Math.ceil(x0 / 0.6) * 0.6; x < x1; x += 0.6) {
          const a = this.toScreen({ x, y: y0 });
          const b = this.toScreen({ x, y: y1 });
          if (a.x < -2 || a.x > this.width + 2) continue;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      }
    }
    // fremde Boote
    for (const b of h.boats) {
      const poly = boatOutline(b, 14);
      this.path(poly);
      ctx.fillStyle = b.color;
      ctx.fill();
      ctx.strokeStyle = C.hullEdge;
      ctx.lineWidth = 1;
      ctx.stroke();
      // Cockpit + Mast
      const psi = (b.headingDeg * Math.PI) / 180;
      const toW = (bx: number, by: number) => {
        const w = bodyToWorld({ x: bx, y: by }, psi);
        return { x: b.pos.x + w.x, y: b.pos.y + w.y };
      };
      this.path([toW(-b.loa * 0.42, -b.beam * 0.3), toW(-b.loa * 0.12, -b.beam * 0.3), toW(-b.loa * 0.12, b.beam * 0.3), toW(-b.loa * 0.42, b.beam * 0.3)]);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fill();
      const m = this.toScreen(toW(b.loa * 0.08, 0));
      ctx.fillStyle = '#6d7880';
      ctx.beginPath();
      ctx.arc(m.x, m.y, Math.max(1.5, 0.09 * this.camera.scale), 0, Math.PI * 2);
      ctx.fill();
    }
    // Dalben
    for (const p of h.piles) {
      const s = this.toScreen(p.pos);
      const r = Math.max(2.5, p.radius * this.camera.scale);
      ctx.fillStyle = C.pile;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.pileTop;
      ctx.beginPath();
      ctx.arc(s.x - r * 0.2, s.y - r * 0.2, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawTrail(trail: Vec2[]): void {
    if (trail.length < 2) return;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    trail.forEach((p, i) => {
      const s = this.toScreen(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawWash(sim: Simulation, dt: number): void {
    const y = sim.yacht;
    const F = y.last;
    const ctx = this.ctx;
    if (F && Math.abs(F.thrust) > 30 && !sim.paused) {
      const n = Math.min(4, Math.abs(F.thrust) / 400);
      for (let i = 0; i < n; i++) {
        const p = y.toWorld({ x: y.model.propX, y: (Math.random() - 0.5) * 0.3 });
        this.washParticles.push({ x: p.x, y: p.y, age: F.thrust > 0 ? 0 : -1 });
      }
    }
    const aft = bodyToWorld({ x: -1, y: 0 }, y.state.psi);
    ctx.fillStyle = 'rgba(235,248,255,0.35)';
    for (const p of this.washParticles) {
      const dir = p.age >= 0 ? 1 : -1;
      const age = Math.abs(p.age);
      const sp = (2.5 * Math.exp(-age)) * dir * sim.timeScale * (sim.paused ? 0 : 1);
      p.x += aft.x * sp * dt + (Math.random() - 0.5) * 0.05;
      p.y += aft.y * sp * dt + (Math.random() - 0.5) * 0.05;
      p.age = dir * (age + dt);
      const s = this.toScreen(p);
      const r = Math.max(1, (0.12 + age * 0.15) * this.camera.scale * 0.5);
      ctx.globalAlpha = Math.max(0, 1 - age / 2.5);
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.washParticles = this.washParticles.filter((p) => Math.abs(p.age) < 2.5);
  }

  private drawYacht(sim: Simulation, ia: Interaction): void {
    const ctx = this.ctx;
    const y = sim.yacht;
    const m = y.model;
    const cfg = m.cfg;
    const lcg = cfg.hull.lcg;
    // Kiel und Ruder (unter Wasser, gestrichelt)
    const kc = cfg.keel.chord;
    const kx = cfg.keel.x - lcg;
    const kw = cfg.keel.type === 'long' ? 0.18 : 0.12;
    const keelPoly = [
      { x: kx - kc / 2, y: -kw },
      { x: kx + kc / 2, y: -kw * 0.6 },
      { x: kx + kc / 2, y: kw * 0.6 },
      { x: kx - kc / 2, y: kw },
    ].map((p) => y.toWorld(p));
    // Rumpf
    this.path(y.outlineWorld());
    ctx.fillStyle = C.own;
    ctx.fill();
    ctx.strokeStyle = C.hullEdge;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Deck / Aufbau
    const L = cfg.hull.loa;
    const B = cfg.hull.beam;
    const cab = [
      { x: 0.2 * L, y: -0.26 * B },
      { x: 0.02 * L, y: -0.32 * B },
      { x: -0.12 * L, y: -0.32 * B },
      { x: -0.12 * L, y: 0.32 * B },
      { x: 0.02 * L, y: 0.32 * B },
      { x: 0.2 * L, y: 0.26 * B },
    ].map((p) => y.toWorld({ x: p.x - lcg, y: p.y }));
    this.path(cab);
    ctx.fillStyle = C.deck;
    ctx.fill();
    const cockpit = [
      { x: -0.14 * L, y: -0.28 * B },
      { x: -0.4 * L, y: -0.26 * B },
      { x: -0.4 * L, y: 0.26 * B },
      { x: -0.14 * L, y: 0.28 * B },
    ].map((p) => y.toWorld({ x: p.x - lcg, y: p.y }));
    this.path(cockpit);
    ctx.fillStyle = 'rgba(40,60,70,0.12)';
    ctx.fill();
    // Kiel gestrichelt
    this.path(keelPoly);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(30,50,60,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    // Ruderblatt
    const d = y.state.rudder;
    // Sehne zeigt nach vorn (cos d, -sin d); Hinterkante geht bei d > 0 nach Stb
    const rc = cfg.rudder.area / cfg.rudder.span;
    const rx = m.rudder.x;
    const a = y.toWorld({ x: rx + rc * 0.25 * Math.cos(d), y: -rc * 0.25 * Math.sin(d) });
    const b = y.toWorld({ x: rx - rc * 0.75 * Math.cos(d), y: rc * 0.75 * Math.sin(d) });
    const sa = this.toScreen(a);
    const sb = this.toScreen(b);
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = Math.max(2, 0.06 * this.camera.scale);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    // Mast
    const mast = this.toScreen(y.toWorld({ x: 0.08 * L - lcg, y: 0 }));
    ctx.fillStyle = '#56626b';
    ctx.beginPath();
    ctx.arc(mast.x, mast.y, Math.max(2, 0.1 * this.camera.scale), 0, Math.PI * 2);
    ctx.fill();
    // Steuerrad
    const wheel = this.toScreen(y.toWorld({ x: -0.36 * L - lcg, y: 0 }));
    ctx.strokeStyle = '#56626b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(wheel.x, wheel.y, Math.max(2, 0.35 * this.camera.scale), 0, Math.PI * 2);
    ctx.stroke();
    // Klampen
    for (const c of m.cleats) {
      const s = this.toScreen(y.toWorld(c.pos));
      const sel = ia.selectedCleat === c.id;
      const hov = ia.hoverCleat === c.id;
      ctx.fillStyle = sel ? C.cleatSel : hov ? '#ffffff' : C.cleat;
      ctx.strokeStyle = '#2b3a44';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, sel || hov ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private lineColor(l: MooringLine, maxLoad: number): string {
    if (l.tension <= 1) return C.lineSlack;
    const t = Math.min(1, l.tension / maxLoad);
    const r = Math.round(120 + 135 * t);
    const g = Math.round(230 - 170 * t);
    return `rgb(${r},${g},80)`;
  }

  /** Fender: hängend voll, während die Crew sie ausbringt halbtransparent. */
  private drawFenders(sim: Simulation, ia: Interaction): void {
    const ctx = this.ctx;
    const y = sim.yacht;
    const touching = new Set(sim.collisions.contacts.filter((c) => c.via === 'fender').map((c) => c.fenderId));
    for (const f of sim.fenders.all()) {
      if (!f.out) continue;
      const s = this.toScreen(y.toWorld(f.pos));
      const r = Math.max(f.kind === 'ball' ? 4 : 2.5, f.r * this.camera.scale);
      const ready = sim.time >= f.readyAt;
      ctx.globalAlpha = ready ? 1 : 0.35;
      ctx.fillStyle = f.kind === 'ball' ? '#f97316' : '#2f6fdb';
      ctx.strokeStyle = touching.has(f.id) ? '#fde047' : 'rgba(10,20,30,0.8)';
      ctx.lineWidth = touching.has(f.id) ? 2.5 : 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (ia.placingBall && ia.ballPreview) {
      const s = this.toScreen(ia.ballPreview);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(4, 0.3 * this.camera.scale), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** Einhand: Skipper an Deck; Warnung, solange das Ruder unbesetzt ist. */
  private drawCrew(sim: Simulation): void {
    const c = sim.crew;
    if (c.mode !== 'solo') return;
    const ctx = this.ctx;
    const y = sim.yacht;
    const s = this.toScreen(y.toWorld(c.pos));
    const r = Math.max(4, 0.28 * this.camera.scale);
    ctx.fillStyle = c.atHelm ? '#38bdf8' : '#fbbf24';
    ctx.strokeStyle = '#0b1620';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (!c.atHelm) {
      const h = this.toScreen(y.toWorld(c.helm));
      ctx.strokeStyle = 'rgba(251,191,36,0.9)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      this.label('Ruder unbesetzt', h.x + 12, h.y + 14);
    }
  }

  /** Leine zwischen zwei Bildschirmpunkten; Durchhang als Bogen (seitlich treibende Lose). */
  private strokeRope(a: Vec2, b: Vec2, slack: number, color: string, width: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (slack > 0.02) {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dl = Math.hypot(dx, dy) || 1;
      const sag = Math.min(3, Math.sqrt((slack * dl) / this.camera.scale) * 0.8) * this.camera.scale;
      ctx.quadraticCurveTo(mx - (dy / dl) * sag, my + (dx / dl) * sag, b.x, b.y);
    } else {
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  private drawLines(sim: Simulation, ia: Interaction): void {
    const ctx = this.ctx;
    const y = sim.yacht;
    if (ia.slipFrom) {
      // Vorschau: Bucht liegt schon über dem Festpunkt, zweite Klampe fehlt noch
      const c = y.cleatWorld(ia.slipFrom.cleat);
      if (c) {
        ctx.setLineDash([4, 4]);
        this.strokeRope(this.toScreen(c), this.toScreen(ia.slipFrom.anchor.pos), 0.5, '#fbbf24', 2);
        ctx.setLineDash([]);
      }
    }
    for (const l of sim.lines.lines) {
      const cleat = y.model.cleats.find((c) => c.id === l.cleatId);
      if (!cleat) continue;
      const a = this.toScreen(y.toWorld(cleat.pos));
      const b = this.toScreen(l.anchor.pos);
      const width = ia.selectedLine === l.id ? 3.5 : 2;
      if (l.slip) {
        // Manöverleine: feste Part von der zweiten Klampe zum Festpunkt, gestrichelt markiert
        const fc = y.cleatWorld(l.slip.cleatId);
        if (fc) {
          ctx.setLineDash([7, 3]);
          this.strokeRope(this.toScreen(fc), b, l.slip.slack, this.lineColor({ ...l, tension: l.slip.tension }, 3000), width);
          this.strokeRope(a, b, l.slack, this.lineColor(l, 3000), width);
          ctx.setLineDash([]);
          // Umlenkung am Festpunkt
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(b.x, b.y, Math.max(5, 0.28 * this.camera.scale), 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        this.strokeRope(a, b, l.slack, this.lineColor(l, 3000), width);
      }
      // Nummer
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const lx = a.x + (b.x - a.x) * 0.35;
      const ly = a.y + (b.y - a.y) * 0.35;
      ctx.beginPath();
      ctx.arc(lx, ly, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(l.id), lx, ly + 0.5);
    }
  }

  private drawAnchors(sim: Simulation, ia: Interaction): void {
    const ctx = this.ctx;
    const y = sim.yacht;
    const sel = ia.selectedCleat;
    const cleatPos = sel ? y.cleatWorld(sel) : null;
    if (cleatPos) {
      // Wurfweiten je Festpunkt-Typ: geworfen wird von der Bordkante, wohin die Crew mit der Leine läuft
      const ranges = sim.lines.settings.throwRange;
      const uniq = Array.from(new Set([ranges.pile, ranges.bollard, ranges.ring])).sort((a, b) => b - a);
      const outline = y.model.outline;
      for (const r of uniq) {
        const pts = offsetOutline(outline, r).map((p) => this.toScreen(y.toWorld(p)));
        ctx.strokeStyle = 'rgba(255,210,74,0.55)';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        // Beschriftung querab an Stb
        const lp = this.toScreen(y.toWorld({ x: 0, y: y.model.cfg.hull.beam / 2 + r }));
        ctx.fillStyle = 'rgba(255,210,74,0.8)';
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${r} m`, lp.x + 3, lp.y - 3);
      }
    }
    for (const an of sim.harbor.anchors) {
      if (an.kind === 'pile' && !cleatPos && ia.hoverAnchor?.id !== an.id) continue;
      const s = this.toScreen(an.pos);
      if (s.x < -20 || s.y < -20 || s.x > this.width + 20 || s.y > this.height + 20) continue;
      let reach = false;
      if (sel) reach = sim.lines.canReach(y, sel, an).ok;
      const hov = ia.hoverAnchor?.id === an.id;
      if (an.kind === 'pile') {
        ctx.strokeStyle = reach ? '#7dff9e' : 'rgba(255,255,255,0.35)';
        ctx.lineWidth = hov ? 3 : 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(6, 0.35 * this.camera.scale), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const w = Math.max(3, 0.18 * this.camera.scale);
        ctx.fillStyle = cleatPos ? (reach ? '#7dff9e' : '#6b6b6b') : '#3d3d3d';
        ctx.fillRect(s.x - w, s.y - w / 2.5, w * 2, w / 1.25);
        if (hov) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.strokeRect(s.x - w - 2, s.y - w / 2.5 - 2, w * 2 + 4, w / 1.25 + 4);
        }
      }
    }
    if (ia.hoverAnchor) {
      const s = this.toScreen(ia.hoverAnchor.pos);
      let txt = ia.hoverAnchor.label;
      if (cleatPos) txt += ` · Wurf ${throwDistance(y, ia.hoverAnchor.pos).toFixed(1)} m`;
      this.label(txt, s.x + 10, s.y - 12);
    }
  }

  private label(txt: string, x: number, y: number): void {
    const ctx = this.ctx;
    ctx.font = '12px system-ui, sans-serif';
    const w = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(10,20,28,0.8)';
    ctx.fillRect(x - 4, y - 11, w + 8, 16);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(txt, x, y + 1);
  }

  private drawContacts(sim: Simulation): void {
    const ctx = this.ctx;
    for (const c of sim.collisions.contacts) {
      const s = this.toScreen(c.point);
      const hard = c.approachSpeed > 0.5 * KN;
      ctx.fillStyle = hard ? 'rgba(255,60,60,0.85)' : 'rgba(255,180,60,0.8)';
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5 + Math.min(10, c.force / 400), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawForces(sim: Simulation): void {
    const F = sim.yacht.last;
    if (!F) return;
    const y = sim.yacht;
    const colors: Record<string, string> = {
      thrust: '#4ade80',
      propwalk: '#f472b6',
      rudder: '#f87171',
      keel: '#60a5fa',
      hull: '#94a3b8',
      wind: '#fbbf24',
      thruster: '#a78bfa',
      external: '#fde68a',
    };
    const k = 0.004; // m pro N
    for (const a of F.arrows) {
      const mag = Math.hypot(a.f.x, a.f.y);
      if (mag < 15) continue;
      const p0 = y.toWorld(a.at);
      const fw = bodyToWorld(a.f, y.state.psi);
      const scale = Math.min(1, 8 / (mag * k)) * k;
      const p1 = { x: p0.x + fw.x * scale, y: p0.y + fw.y * scale };
      this.arrow(this.toScreen(p0), this.toScreen(p1), colors[a.kind] ?? '#fff');
    }
  }

  private arrow(a: Vec2, b: Vec2, color: string): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - 8 * Math.cos(ang - 0.4), b.y - 8 * Math.sin(ang - 0.4));
    ctx.lineTo(b.x - 8 * Math.cos(ang + 0.4), b.y - 8 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  /** Kompass mit Wind- und Strömungspfeil, Maßstab. */
  private drawOverlay(sim: Simulation, ia: Interaction): void {
    const ctx = this.ctx;
    const cx = 62;
    const cy = 62;
    const R = 46;
    ctx.fillStyle = 'rgba(10,22,32,0.72)';
    ctx.beginPath();
    ctx.arc(cx, cy, R + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', cx, cy - R + 9);
    // Wind: Pfeil zeigt, wohin der Wind weht; Fähnchen am Luv-Ende
    const w = sim.env;
    const wa = (w.windFromDeg * Math.PI) / 180;
    const from = { x: cx + Math.sin(wa) * (R - 4), y: cy - Math.cos(wa) * (R - 4) };
    const to = { x: cx - Math.sin(wa) * (R - 16), y: cy + Math.cos(wa) * (R - 16) };
    this.arrow(from, to, '#fbbf24');
    // Strömung
    const cur = sim.env.settings;
    if (cur.currentSpeedKn > 0.01) {
      const ca = (cur.currentTowardDeg * Math.PI) / 180;
      const l = Math.min(R - 12, 14 + cur.currentSpeedKn * 14);
      this.arrow({ x: cx - Math.sin(ca) * l * 0.4, y: cy + Math.cos(ca) * l * 0.4 }, { x: cx + Math.sin(ca) * l, y: cy - Math.cos(ca) * l }, '#67e8f9');
    }
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'left';
    ctx.fillText(`Wind ${(w.windSpeed / KN).toFixed(0)} kn`, 12, cy + R + 22);
    ctx.fillStyle = '#67e8f9';
    ctx.fillText(`Strom ${cur.currentSpeedKn.toFixed(1)} kn`, 12, cy + R + 37);

    // Maßstab
    const m = this.camera.scale > 20 ? 5 : 10;
    const px = m * this.camera.scale;
    const bx = 16;
    const by = this.height - 18;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by - 5);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + px, by);
    ctx.lineTo(bx + px, by - 5);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(`${m} m`, bx + px + 6, by - 2);

    if (ia.flash && performance.now() < ia.flash.until) {
      const s = this.toScreen(ia.flash.pos);
      this.label(ia.flash.text, s.x + 12, s.y + 20);
    }
    if (sim.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Pause', this.width / 2, this.height / 2);
    }
  }
}

/** Kontur um `r` Meter nach außen versetzt (Bordkante + Wurfweite), in Bootskoordinaten. */
function offsetOutline(outline: Vec2[], r: number): Vec2[] {
  const n = outline.length;
  return outline.map((p, i) => {
    const a = outline[(i - 1 + n) % n];
    const b = outline[(i + 1) % n];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    let nx = ty / l;
    let ny = -tx / l;
    if (pointInPolygon({ x: p.x + nx * 0.01, y: p.y + ny * 0.01 }, outline)) {
      nx = -nx;
      ny = -ny;
    }
    return { x: p.x + nx * r, y: p.y + ny * r };
  });
}
