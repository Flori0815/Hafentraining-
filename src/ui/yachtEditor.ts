/**
 * Formular-Editor für YachtConfig. Die Felder sind als Schema beschrieben,
 * damit neue Parameter mit einer Zeile ergänzt werden können.
 */
import { PRESETS, cloneConfig, defaultCleats, validateConfig, type YachtConfig } from '../physics/yachtConfig';
import { SOURCES, kickTurn, propWalkAstern, runBench, speeds, turningCircle, type CheckResult, type TurnResult } from '../physics/validation';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (v: number, unit: string) => (Number.isNaN(v) ? '–' : `${v.toFixed(unit === 'L' || unit === '' ? 2 : 1)}${unit && unit !== '' ? ` ${unit}` : ''}`);

/** Bahn im Drehkreis als kleine Skizze (SVG), Bootslänge als Maßstab. */
function turnSketch(t: TurnResult, loa: number): string {
  if (t.track.length < 2) return '';
  const xs = t.track.map((p) => p.x);
  const ys = t.track.map((p) => p.y);
  const pad = loa * 0.6;
  const x0 = Math.min(...xs, 0) - pad;
  const x1 = Math.max(...xs, 0) + pad;
  const y0 = Math.min(...ys, 0) - pad;
  const y1 = Math.max(...ys, 0) + pad;
  const w = 220;
  const sc = w / Math.max(x1 - x0, y1 - y0);
  const P = (p: { x: number; y: number }) => `${((p.x - x0) * sc).toFixed(1)},${((y1 - p.y) * sc).toFixed(1)}`;
  const path = t.track.map(P).join(' ');
  const bar = loa * sc;
  return `<svg class="bench-sketch" viewBox="0 0 ${w} ${w}" width="${w}" height="${w}" role="img" aria-label="Bahn im Drehkreis">
    <polyline points="${path}" fill="none" stroke="#38bdf8" stroke-width="2"/>
    <circle cx="${P({ x: 0, y: 0 }).split(',')[0]}" cy="${P({ x: 0, y: 0 }).split(',')[1]}" r="3.5" fill="#fbbf24"/>
    <line x1="8" y1="${w - 10}" x2="${8 + bar}" y2="${w - 10}" stroke="#e2e8f0" stroke-width="2"/>
    <text x="8" y="${w - 14}" fill="#e2e8f0" font-size="10">1 Bootslänge</text>
  </svg>`;
}

function checksTable(checks: CheckResult[]): string {
  const rows = checks
    .map((c) => {
      const src = c.sources.map((k) => SOURCES[k]).filter(Boolean).map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join('<br>');
      return `<tr class="${c.verdict}"><td>${c.verdict === 'ok' ? '✓' : '⚠'}</td><td>${esc(c.label)}<div class="basis">${esc(c.basis)}${src ? `<div class="src">${src}</div>` : ''}</div></td><td class="num">${fmt(c.value, c.unit)}</td><td class="num">${fmt(c.range[0], c.unit)} … ${fmt(c.range[1], c.unit)}</td></tr>`;
    })
    .join('');
  return `<table class="bench"><thead><tr><th></th><th>Manöver</th><th>Simulation</th><th>Referenz</th></tr></thead><tbody>${rows}</tbody></table>`;
}

type FieldType = 'number' | 'select' | 'checkbox' | 'text';

interface Field {
  path: string;
  label: string;
  type?: FieldType;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  options?: [string, string][];
}

interface Group {
  title: string;
  fields: Field[];
}

const GROUPS: Group[] = [
  {
    title: 'Allgemein',
    fields: [{ path: 'name', label: 'Name', type: 'text' }],
  },
  {
    title: 'Rumpf',
    fields: [
      { path: 'hull.loa', label: 'Länge ü. a. (LOA)', unit: 'm', step: 0.05, min: 5, max: 25 },
      { path: 'hull.lwl', label: 'Länge Wasserlinie', unit: 'm', step: 0.05, min: 4, max: 25 },
      { path: 'hull.beam', label: 'Breite', unit: 'm', step: 0.05, min: 1.5, max: 7 },
      { path: 'hull.displacement', label: 'Verdrängung', unit: 'kg', step: 100, min: 500, max: 40000 },
      { path: 'hull.canoeDraft', label: 'Rumpftiefgang (ohne Kiel)', unit: 'm', step: 0.05, min: 0.2, max: 1.5 },
      { path: 'hull.freeboard', label: 'Freibord', unit: 'm', step: 0.05, min: 0.5, max: 2.5 },
      { path: 'hull.transomRatio', label: 'Heckbreite / Breite', step: 0.05, min: 0.2, max: 1 },
      { path: 'hull.lcg', label: 'Gewichtsschwerpunkt (+ vorn)', unit: 'm', step: 0.05, min: -3, max: 3 },
      { path: 'hull.gyrationRatio', label: 'Trägheitsradius / LOA', step: 0.01, min: 0.18, max: 0.32 },
    ],
  },
  {
    title: 'Kiel',
    fields: [
      {
        path: 'keel.type',
        label: 'Kielform',
        type: 'select',
        options: [
          ['fin', 'Flossenkiel'],
          ['bulb', 'Bombenkiel'],
          ['long', 'Langkiel'],
          ['bilge', 'Kimmkiel (2 Flossen)'],
        ],
      },
      { path: 'keel.draft', label: 'Tiefgang gesamt', unit: 'm', step: 0.05, min: 0.4, max: 4 },
      { path: 'keel.chord', label: 'Kiel-Profiltiefe (Länge)', unit: 'm', step: 0.05, min: 0.3, max: 10 },
      { path: 'keel.x', label: 'Kielmitte (+ vorn v. LOA-Mitte)', unit: 'm', step: 0.05, min: -5, max: 5 },
    ],
  },
  {
    title: 'Ruder',
    fields: [
      {
        path: 'rudder.type',
        label: 'Ruderart',
        type: 'select',
        options: [
          ['spade', 'Spatenruder'],
          ['skeg', 'Skegruder'],
          ['keelHung', 'am Kiel angehängt'],
        ],
      },
      {
        path: 'rudder.arrangement',
        label: 'Anordnung',
        type: 'select',
        options: [
          ['single', 'Einzelruder (im Schraubenstrahl)'],
          ['twin', 'Doppelruder (Strahl läuft dazwischen)'],
        ],
      },
      { path: 'rudder.area', label: 'Ruderfläche (gesamt)', unit: 'm²', step: 0.02, min: 0.1, max: 3 },
      { path: 'rudder.span', label: 'Ruderspannweite', unit: 'm', step: 0.05, min: 0.3, max: 3 },
      { path: 'rudder.x', label: 'Ruderposition (+ vorn)', unit: 'm', step: 0.05, min: -12, max: 0 },
      { path: 'rudder.maxAngleDeg', label: 'max. Ruderwinkel', unit: '°', step: 1, min: 15, max: 45 },
      { path: 'rudder.rateDegPerS', label: 'Ruderlegegeschw.', unit: '°/s', step: 1, min: 5, max: 90 },
    ],
  },
  {
    title: 'Maschine & Propeller',
    fields: [
      { path: 'engine.powerKw', label: 'Leistung', unit: 'kW', step: 1, min: 2, max: 300 },
      { path: 'engine.propDiameter', label: 'Propeller-Ø', unit: 'm', step: 0.01, min: 0.2, max: 1 },
      { path: 'engine.propPitch', label: 'Steigung', unit: 'm', step: 0.01, min: 0.1, max: 1 },
      { path: 'engine.maxPropRpm', label: 'Propellerdrehzahl max.', unit: '1/min', step: 50, min: 400, max: 4000 },
      {
        path: 'engine.propRotation',
        label: 'Drehrichtung (voraus, von achtern)',
        type: 'select',
        options: [
          ['right', 'rechtsdrehend'],
          ['left', 'linksdrehend'],
        ],
      },
      {
        path: 'engine.drive',
        label: 'Antrieb',
        type: 'select',
        options: [
          ['shaft', 'Welle'],
          ['saildrive', 'Saildrive'],
        ],
      },
      { path: 'engine.propX', label: 'Propellerposition (+ vorn)', unit: 'm', step: 0.05, min: -12, max: 2 },
      { path: 'engine.reverseEfficiency', label: 'Rückwärtsschub-Anteil', step: 0.05, min: 0.2, max: 1 },
      { path: 'engine.propWalk', label: 'Radeffekt-Faktor', step: 0.1, min: 0, max: 3 },
      { path: 'engine.idleFraction', label: 'Leerlauf / Maximaldrehzahl', step: 0.02, min: 0.15, max: 0.5 },
      { path: 'engine.shiftDelay', label: 'Schaltzeit', unit: 's', step: 0.1, min: 0, max: 3 },
    ],
  },
  {
    title: 'Windangriff',
    fields: [
      { path: 'windage.lateralArea', label: 'Seitenfläche', unit: 'm²', step: 0.5, min: 2, max: 150 },
      { path: 'windage.frontalArea', label: 'Frontfläche', unit: 'm²', step: 0.5, min: 1, max: 60 },
      { path: 'windage.ceX', label: 'Angriffspunkt querab (+ vorn)', unit: 'm', step: 0.05, min: -5, max: 5 },
      { path: 'windage.ceShift', label: 'Wanderung zum Luv-Ende', unit: 'm', step: 0.05, min: 0, max: 5 },
    ],
  },
  {
    title: 'Bugstrahlruder',
    fields: [
      { path: 'bowThruster.enabled', label: 'vorhanden', type: 'checkbox' },
      { path: 'bowThruster.thrust', label: 'Schub', unit: 'N', step: 50, min: 100, max: 5000 },
      { path: 'bowThruster.x', label: 'Position (+ vorn)', unit: 'm', step: 0.05, min: 0, max: 12 },
    ],
  },
];

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

function setPath(obj: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, obj as Record<string, unknown>);
  target[last] = value;
}

export class YachtEditor {
  private dialog: HTMLDialogElement;
  private fieldsEl: HTMLElement;
  private presetSel: HTMLSelectElement;
  private errorsEl: HTMLElement;
  private jsonEl: HTMLTextAreaElement;
  private working: YachtConfig;
  private onApply: (cfg: YachtConfig) => void;

  constructor(current: YachtConfig, onApply: (cfg: YachtConfig) => void) {
    this.dialog = document.getElementById('dlg-yacht') as HTMLDialogElement;
    this.fieldsEl = document.getElementById('yacht-fields')!;
    this.presetSel = document.getElementById('sel-preset') as HTMLSelectElement;
    this.errorsEl = document.getElementById('yacht-errors')!;
    this.jsonEl = document.getElementById('yacht-json') as HTMLTextAreaElement;
    this.working = cloneConfig(current);
    this.onApply = onApply;

    this.presetSel.innerHTML = PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('') + '<option value="custom">Eigene Yacht</option>';
    this.presetSel.addEventListener('change', () => {
      const v = this.presetSel.value;
      if (v !== 'custom') {
        this.working = cloneConfig(PRESETS[Number(v)]);
        this.renderFields();
      }
    });
    document.getElementById('btn-json-export')!.addEventListener('click', () => {
      this.readFields();
      this.jsonEl.value = JSON.stringify(this.working, null, 2);
    });
    document.getElementById('btn-json-import')!.addEventListener('click', () => {
      try {
        const parsed = JSON.parse(this.jsonEl.value) as YachtConfig;
        if (parsed.schemaVersion !== 1) throw new Error('Unbekannte schemaVersion');
        this.working = parsed;
        this.presetSel.value = 'custom';
        this.renderFields();
        this.errorsEl.textContent = '';
      } catch (e) {
        this.errorsEl.textContent = 'JSON ungültig: ' + (e as Error).message;
      }
    });
    const out = document.getElementById('bench-out')!;
    document.getElementById('btn-bench')!.addEventListener('click', () => {
      this.readFields();
      const errs = validateConfig(this.working);
      if (errs.length) {
        out.innerHTML = `<p class="errors">${esc(errs.join(' · '))}</p>`;
        return;
      }
      out.innerHTML = '<p class="hint">Prüfstand läuft …</p>';
      const cfg = cloneConfig(this.working);
      setTimeout(() => {
        const { checks, turn } = runBench(cfg);
        const ok = checks.filter((c) => c.verdict === 'ok').length;
        out.innerHTML = `<p><b>${esc(cfg.name)}</b>: ${ok}/${checks.length} im Referenzbereich</p>
          <div class="bench-wrap">${checksTable(checks)}<figure>${turnSketch(turn, cfg.hull.loa)}<figcaption>Bahn im Drehkreis (Hartruder Stb, Start ● )</figcaption></figure></div>`;
      }, 30);
    });
    document.getElementById('btn-bench-all')!.addEventListener('click', () => {
      const rows: string[] = [];
      const head = '<tr><th>Yacht</th><th>Kiel / Ruder / Antrieb</th><th>Vmax</th><th>Drehkreis</th><th>360°</th><th>Kick</th><th>Radeffekt 10 s</th></tr>';
      const KEEL: Record<string, string> = { fin: 'Flosse', bulb: 'Bombe', long: 'Langkiel', bilge: 'Kimm' };
      const RUD: Record<string, string> = { spade: 'Spaten', skeg: 'Skeg', keelHung: 'am Kiel' };
      out.innerHTML = '<p class="hint">Vergleich läuft …</p>';
      const step = (i: number) => {
        if (i >= PRESETS.length) {
          out.innerHTML = `<table class="bench compare"><thead>${head}</thead><tbody>${rows.join('')}</tbody></table>
            <p class="hint">Drehkreis = taktischer Durchmesser in Bootslängen bei Hartruder aus Manöverfahrt; Kick = Kursänderung aus dem Stand nach 3 s Gasstoß mit Hartruder.</p>`;
          return;
        }
        const c = PRESETS[i];
        const t = turningCircle(c);
        const r = `${KEEL[c.keel.type]} / ${c.rudder.arrangement === 'twin' ? 'Doppel-' : ''}${RUD[c.rudder.type]} / ${c.engine.drive === 'shaft' ? 'Welle' : 'Saildrive'}`;
        rows.push(
          `<tr><td>${esc(c.name)} <span class="hint">${(c.hull.loa / 0.3048).toFixed(0)} ft</span></td><td>${r}</td><td class="num">${speeds(c).max.toFixed(1)} kn</td><td class="num">${(t.tactical / c.hull.loa).toFixed(1)} L</td><td class="num">${Number.isNaN(t.t360) ? '–' : t.t360.toFixed(0) + ' s'}</td><td class="num">${kickTurn(c).heading.toFixed(0)}°</td><td class="num">${propWalkAstern(c).toFixed(0)}°</td></tr>`,
        );
        out.innerHTML = `<p class="hint">Vergleich läuft … ${i + 1}/${PRESETS.length}</p>`;
        setTimeout(() => step(i + 1), 10);
      };
      setTimeout(() => step(0), 10);
    });
    const form = document.getElementById('form-yacht') as HTMLFormElement;
    form.addEventListener('submit', (ev) => {
      const submitter = (ev as SubmitEvent).submitter as HTMLButtonElement | null;
      if (submitter?.value !== 'apply') return;
      this.readFields();
      const errs = validateConfig(this.working);
      if (errs.length) {
        ev.preventDefault();
        this.errorsEl.textContent = errs.join(' · ');
        return;
      }
      this.onApply(cloneConfig(this.working));
    });
  }

  open(current: YachtConfig): void {
    this.working = cloneConfig(current);
    const idx = PRESETS.findIndex((p) => p.id === current.id && JSON.stringify(p) === JSON.stringify(current));
    this.presetSel.value = idx >= 0 ? String(idx) : 'custom';
    this.errorsEl.textContent = '';
    this.renderFields();
    this.dialog.showModal();
  }

  private renderFields(): void {
    const html = GROUPS.map((g) => {
      const inputs = g.fields
        .map((f) => {
          const v = getPath(this.working, f.path);
          const id = 'yf-' + f.path.replace(/\./g, '-');
          const unit = f.unit ? ` [${f.unit}]` : '';
          if (f.type === 'select') {
            const opts = f.options!.map(([val, lbl]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${lbl}</option>`).join('');
            return `<label>${f.label}<select id="${id}" data-path="${f.path}" data-type="select">${opts}</select></label>`;
          }
          if (f.type === 'checkbox') {
            return `<label>${f.label}<input id="${id}" type="checkbox" data-path="${f.path}" data-type="checkbox" ${v ? 'checked' : ''}/></label>`;
          }
          if (f.type === 'text') {
            return `<label>${f.label}<input id="${id}" type="text" data-path="${f.path}" data-type="text" value="${String(v).replace(/"/g, '&quot;')}"/></label>`;
          }
          return `<label>${f.label}${unit}<input id="${id}" type="number" data-path="${f.path}" data-type="number" step="${f.step ?? 'any'}" min="${f.min ?? ''}" max="${f.max ?? ''}" value="${v}"/></label>`;
        })
        .join('');
      return `<fieldset><legend>${g.title}</legend><div class="form-grid">${inputs}</div></fieldset>`;
    }).join('');
    this.fieldsEl.innerHTML = html;
    this.fieldsEl.querySelectorAll('input,select').forEach((el) =>
      el.addEventListener('change', () => {
        this.presetSel.value = 'custom';
      }),
    );
  }

  private readFields(): void {
    const oldLoa = this.working.hull.loa;
    const oldBeam = this.working.hull.beam;
    this.fieldsEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-path]').forEach((el) => {
      const path = el.dataset.path!;
      const type = el.dataset.type;
      let value: unknown;
      if (type === 'number') value = Number((el as HTMLInputElement).value);
      else if (type === 'checkbox') value = (el as HTMLInputElement).checked;
      else value = el.value;
      setPath(this.working, path, value);
    });
    // Klampen bei geänderten Hauptmaßen neu anordnen
    if (this.working.hull.loa !== oldLoa || this.working.hull.beam !== oldBeam) {
      this.working.cleats = defaultCleats(this.working.hull.loa, this.working.hull.beam);
    }
    if (this.presetSel.value === 'custom' && !this.working.id.startsWith('custom')) {
      this.working.id = 'custom-' + Date.now().toString(36);
    }
  }
}
