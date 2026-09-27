/**
 * Umweltmodell: Wind mit Böen und Winddrehern (Ornstein-Uhlenbeck-Prozesse)
 * sowie Strömung. Wind wird meteorologisch angegeben (Richtung, AUS der er
 * kommt), Strömung ozeanographisch (Richtung, IN die sie setzt).
 */
import { KN, compassDir, gaussian, makeRng, scale, type Vec2 } from './vec';

export interface EnvironmentSettings {
  windSpeedKn: number;
  windFromDeg: number;
  /** Böigkeit 0 … 1 (0.3 = Böen ca. ±30 %) */
  gustiness: number;
  /** Standardabweichung Winddreher [°] */
  windShiftDeg: number;
  currentSpeedKn: number;
  currentTowardDeg: number;
  seed: number;
}

export const DEFAULT_ENV: EnvironmentSettings = {
  windSpeedKn: 12,
  windFromDeg: 200,
  gustiness: 0.25,
  windShiftDeg: 8,
  currentSpeedKn: 0.3,
  currentTowardDeg: 90,
  seed: 42,
};

export class Environment {
  settings: EnvironmentSettings;
  private rng: () => number;
  private gust = 0; // OU-Zustand Geschwindigkeit
  private shift = 0; // OU-Zustand Richtung
  /** Aktueller Wind als Vektor der Luftbewegung (Ost, Nord) [m/s] */
  wind: Vec2 = { x: 0, y: 0 };
  windSpeed = 0;
  windFromDeg = 0;

  constructor(settings: EnvironmentSettings) {
    this.settings = { ...settings };
    this.rng = makeRng(settings.seed);
    this.update(0);
  }

  reset(settings?: EnvironmentSettings): void {
    if (settings) this.settings = { ...settings };
    this.rng = makeRng(this.settings.seed);
    this.gust = 0;
    this.shift = 0;
    this.update(0);
  }

  update(dt: number): void {
    const s = this.settings;
    if (dt > 0) {
      // Ornstein-Uhlenbeck: dx = -x/τ dt + σ·sqrt(2/τ) dW
      const tauG = 7;
      const tauS = 25;
      this.gust += (-this.gust / tauG) * dt + Math.sqrt((2 * dt) / tauG) * gaussian(this.rng);
      this.shift += (-this.shift / tauS) * dt + Math.sqrt((2 * dt) / tauS) * gaussian(this.rng);
    }
    const factor = Math.max(0.15, 1 + s.gustiness * this.gust);
    this.windSpeed = s.windSpeedKn * KN * factor;
    this.windFromDeg = s.windFromDeg + s.windShiftDeg * this.shift;
    // Luft strömt in Richtung (from + 180°)
    this.wind = scale(compassDir(this.windFromDeg + 180), this.windSpeed);
  }

  /** Strömung an einer Position (derzeit homogen) [m/s], Vektor (Ost, Nord). */
  currentAt(_p: Vec2): Vec2 {
    return scale(compassDir(this.settings.currentTowardDeg), this.settings.currentSpeedKn * KN);
  }

  /** Wind an einer Position (derzeit homogen, ohne Abdeckung) [m/s]. */
  windAt(_p: Vec2): Vec2 {
    return this.wind;
  }
}
