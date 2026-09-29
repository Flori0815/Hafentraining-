/**
 * Aufgaben-Dialog: Liste aller Aufgaben mit Schwierigkeit, Bedingungen und
 * Bestleistung; Filter nach Schwierigkeit. Skaliert mit dem Katalog.
 */
import { buildScenario } from '../harbor/harbor';
import { tasksByDifficulty } from '../tasks/catalog';
import { DIFFICULTY_LABEL, ORIENTATION_LABEL, taskEnv, type Difficulty, type TaskDef } from '../tasks/types';
import { formatTime } from '../sim/simulation';
import { bestForTask, loadResults } from './results';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function difficultyDots(d: Difficulty): string {
  return '●'.repeat(d) + '○'.repeat(5 - d);
}

export const starsText = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

/** Kurzbeschreibung von Ziel und Bedingungen einer Aufgabe. */
export function taskSummary(t: TaskDef): string {
  const h = buildScenario(t.harbor);
  const berth = h.berths.find((b) => b.id === t.goal.berth);
  const env = taskEnv(t);
  const parts: string[] = [];
  if (t.goal.kind === 'moor') {
    parts.push(`Anlegen: ${berth?.label ?? t.goal.berth}${t.goal.orientation ? `, ${ORIENTATION_LABEL[t.goal.orientation]}` : ''}`);
  } else {
    parts.push(`Ablegen aus ${berth?.label ?? t.goal.berth} → ${t.goal.zoneLabel}`);
  }
  parts.push(env.windSpeedKn > 0 ? `Wind ${env.windSpeedKn} kn aus ${Math.round(env.windFromDeg)}°${env.gustiness >= 0.3 ? ', böig' : ''}` : 'Flaute');
  if (env.currentSpeedKn > 0) parts.push(`Strom ${env.currentSpeedKn} kn`);
  if (t.yacht === 'sy36-long') parts.push('Langkieler');
  if (t.crew === 'solo') parts.push('Einhand');
  return parts.join(' · ');
}

export class TasksDialog {
  private dialog: HTMLDialogElement;
  private listEl: HTMLElement;
  private filterEl: HTMLElement;
  private progressEl: HTMLElement;
  private filter: Difficulty | 0 = 0;
  private kind: 'all' | 'moor' | 'depart' = 'all';
  private soloOnly = false;
  private onStart: (t: TaskDef) => void;
  private activeId: () => string | null;

  constructor(onStart: (t: TaskDef) => void, onFreePlay: () => void, activeId: () => string | null) {
    this.dialog = document.getElementById('dlg-tasks') as HTMLDialogElement;
    this.listEl = document.getElementById('task-list')!;
    this.filterEl = document.getElementById('task-filter')!;
    this.progressEl = document.getElementById('task-progress')!;
    this.onStart = onStart;
    this.activeId = activeId;
    this.filterEl.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button[data-solo]')) {
        this.soloOnly = !this.soloOnly;
        this.render();
        return;
      }
      const k = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-kind]');
      if (k) {
        this.kind = k.dataset.kind as 'all' | 'moor' | 'depart';
        this.render();
        return;
      }
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-diff]');
      if (!b) return;
      this.filter = Number(b.dataset.diff) as Difficulty | 0;
      this.render();
    });
    this.listEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-task]');
      if (!b) return;
      const t = tasksByDifficulty().find((x) => x.id === b.dataset.task);
      if (t) {
        this.dialog.close();
        this.onStart(t);
      }
    });
    document.getElementById('btn-free-play')!.addEventListener('click', () => {
      this.dialog.close();
      onFreePlay();
    });
  }

  open(): void {
    this.render();
    this.dialog.showModal();
  }

  private render(): void {
    const all = tasksByDifficulty();
    const results = loadResults();
    const best = new Map(all.map((t) => [t.id, bestForTask(results, t.id)]));
    const solved = all.filter((t) => best.get(t.id)).length;
    const stars = all.reduce((s, t) => s + (best.get(t.id)?.stars ?? 0), 0);
    this.progressEl.textContent = `${solved}/${all.length} gelöst · ${stars}/${all.length * 3} ★`;

    const pool = this.soloOnly ? all.filter((t) => t.crew === 'solo') : all;
    const ofKind = this.kind === 'all' ? pool : pool.filter((t) => t.goal.kind === this.kind);
    const counts = (d: Difficulty) => ofKind.filter((t) => t.difficulty === d).length;
    const chip = (d: Difficulty | 0, label: string) =>
      `<button type="button" data-diff="${d}" class="${this.filter === d ? 'on' : ''}">${label}</button>`;
    const kindChip = (k: 'all' | 'moor' | 'depart', label: string, n: number) =>
      `<button type="button" data-kind="${k}" class="${this.kind === k ? 'on' : ''}">${label} (${n})</button>`;
    const nKind = (k: 'moor' | 'depart') => pool.filter((t) => t.goal.kind === k).length;
    const nSolo = all.filter((t) => t.crew === 'solo').length;
    this.filterEl.innerHTML =
      `<div class="filter-row">${kindChip('all', 'Alle Arten', pool.length)}${kindChip('moor', '⚓ Anlegen', nKind('moor'))}${kindChip('depart', '⛵ Ablegen', nKind('depart'))}<button type="button" data-solo="1" class="${this.soloOnly ? 'on' : ''}" title="Nur Aufgaben für Einhandsegler">👤 Einhand (${nSolo})</button></div>` +
      `<div class="filter-row">${chip(0, `Alle Stufen (${ofKind.length})`)}${([1, 2, 3, 4, 5] as Difficulty[])
        .map((d) => chip(d, `${difficultyDots(d)} ${DIFFICULTY_LABEL[d]} (${counts(d)})`))
        .join('')}</div>`;

    const active = this.activeId();
    const shown = this.filter ? ofKind.filter((t) => t.difficulty === this.filter) : ofKind;
    this.listEl.innerHTML = shown
      .map((t) => {
        const b = best.get(t.id);
        const result = b
          ? `<span class="task-best">${starsText(b.stars)} ${formatTime(b.time)}</span>`
          : '<span class="task-open">offen</span>';
        const tags = (t.tags ?? []).map((x) => `<span class="tag">${esc(x)}</span>`).join('');
        return `<div class="task-card d${t.difficulty} ${t.id === active ? 'active' : ''}">
          <div class="task-head">
            <span class="diff" title="${DIFFICULTY_LABEL[t.difficulty]}">${difficultyDots(t.difficulty)}</span>
            <b>${t.goal.kind === 'depart' ? '⛵ ' : '⚓ '}${t.crew === 'solo' ? '👤 ' : ''}${esc(t.title)}</b>
            ${result}
          </div>
          <div class="task-sum">${esc(taskSummary(t))}</div>
          <div class="task-brief">${esc(t.briefing)}</div>
          <div class="task-foot"><div class="tags">${tags}</div><button type="button" class="primary" data-task="${t.id}">${t.id === active ? 'Neu starten' : 'Starten'}</button></div>
        </div>`;
      })
      .join('');
  }
}
