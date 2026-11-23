import { LitElement, html, svg, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { icon } from './icons';
import { key, label, time, stationSequence, type Train, type Station } from './domain';
import { rowDeviation } from './investigation-model';
import { corridorTrains, prioritizedTrains, type HeatMetric } from './timetable-analytics';
import { corridors } from './corridors';
import './timetable-advanced';

type View = 'distance' | 'heatmap' | 'lanes' | 'matrix' | 'deviation' | 'flow';
type Layer = 'both' | 'schedule' | 'observed';
type Labels = 'selected' | 'important' | 'all' | 'none';
const optionsKey = 'raide:timetable-options:v2';

export class Timetable extends LitElement {
  createRenderRoot() {
    return this;
  }
  @property({ attribute: false }) trains: Train[] = [];
  @property({ attribute: false }) stations = new Map<string, Station>();
  @property() selected = '';
  @property({ type: Number }) now = Date.now();
  @property({ type: Boolean }) expanded = false;
  @property({ type: Boolean }) focusSelected = false;
  @state() private corridor = 'west';
  @state() private minutes = 120;
  @state() private offset = 0;
  @state() private view: View = 'distance';
  @state() private matrixPage = 0;
  @state() private lineLimit = '24';
  @state() private lineLabels: Labels = 'important';
  @state() private layer: Layer = 'both';
  @state() private onlySelected = false;
  @state() private heatMetric: HeatMetric = 'delayed';
  @state() private laneSort: 'time' | 'delay' | 'number' = 'time';
  @state() private flowBucket = 15;
  @state() private flowStation = 'all';
  @state() private settingsOpen = false;
  connectedCallback() {
    super.connectedCallback();
    try {
      const stored = JSON.parse(localStorage.getItem(optionsKey) ?? 'null');
      if (!stored || typeof stored !== 'object') return;
      const choose = <T extends string>(value: unknown, choices: readonly T[], fallback: T) =>
        typeof value === 'string' && choices.includes(value as T) ? (value as T) : fallback;
      this.view = choose(
        stored.view,
        ['distance', 'heatmap', 'lanes', 'matrix', 'deviation', 'flow'],
        'distance',
      );
      this.lineLimit = choose(stored.lineLimit, ['12', '24', '48', 'all'], '24');
      this.lineLabels = choose(
        stored.lineLabels,
        ['selected', 'important', 'all', 'none'],
        'important',
      );
      this.layer = choose(stored.layer, ['both', 'schedule', 'observed'], 'both');
      this.onlySelected = stored.onlySelected === true;
      this.heatMetric = choose(stored.heatMetric, ['delayed', 'average', 'trains'], 'delayed');
      this.laneSort = choose(stored.laneSort, ['time', 'delay', 'number'], 'time');
      this.flowBucket = [15, 30, 60].includes(stored.flowBucket) ? stored.flowBucket : 15;
      this.flowStation = typeof stored.flowStation === 'string' ? stored.flowStation : 'all';
      this.minutes = [60, 120, 240].includes(stored.minutes) ? stored.minutes : 120;
      this.corridor =
        typeof stored.corridor === 'string' && corridors[stored.corridor]
          ? stored.corridor
          : 'west';
    } catch {
      /* Storage may be disabled; the application remains usable. */
    }
  }
  protected updated(changed: Map<string, unknown>) {
    if (
      [
        'view',
        'lineLimit',
        'lineLabels',
        'layer',
        'onlySelected',
        'heatMetric',
        'laneSort',
        'flowBucket',
        'flowStation',
        'minutes',
        'corridor',
      ].some((name) => changed.has(name))
    ) {
      try {
        localStorage.setItem(
          optionsKey,
          JSON.stringify({
            view: this.view,
            lineLimit: this.lineLimit,
            lineLabels: this.lineLabels,
            layer: this.layer,
            onlySelected: this.onlySelected,
            heatMetric: this.heatMetric,
            laneSort: this.laneSort,
            flowBucket: this.flowBucket,
            flowStation: this.flowStation,
            minutes: this.minutes,
            corridor: this.corridor === 'selected' ? 'west' : this.corridor,
          }),
        );
      } catch {
        /* Private mode or blocked storage: settings last only in this tab. */
      }
    }
  }
  private resetOptions() {
    this.view = 'distance';
    this.lineLimit = '24';
    this.lineLabels = 'important';
    this.layer = 'both';
    this.onlySelected = false;
    this.heatMetric = 'delayed';
    this.laneSort = 'time';
    this.flowBucket = 15;
    this.flowStation = 'all';
    this.minutes = 120;
    this.offset = 0;
  }
  protected willUpdate(changed: Map<string, unknown>) {
    if (this.focusSelected && (changed.has('focusSelected') || changed.has('selected'))) {
      this.corridor = 'selected';
      const picked = this.trains.find((t) => key(t) === this.selected);
      const next = picked?.timeTableRows.find(
        (r) =>
          !r.cancelled &&
          !r.actualTime &&
          Date.parse(r.liveEstimateTime ?? r.scheduledTime) >= this.now,
      );
      if (next) {
        const target = Date.parse(next.liveEstimateTime ?? next.scheduledTime);
        this.offset = Math.round((target - this.now) / 60000 - this.minutes / 2 + 30);
      }
    }
  }
  private select(k: string) {
    this.dispatchEvent(
      new CustomEvent('train-select', { detail: k, bubbles: true, composed: true }),
    );
  }
  private renderMatrix(codes: string[], relevant: Train[]) {
    const ordered = [...relevant].sort(
      (a, b) => Number(key(b) === this.selected) - Number(key(a) === this.selected),
    );
    const pages = Math.max(1, Math.ceil(ordered.length / 9));
    const page = Math.min(this.matrixPage, pages - 1);
    const shown = ordered.slice(page * 9, page * 9 + 9);
    return html`<div class="matrix-shell">
      <div class="matrix-toolbar">
        <div>
          <strong>Asema–juna-matriisi</strong
          ><span>Ennuste tai toteuma · pienellä aikataulun mukainen aika</span>
        </div>
        <div class="matrix-pagination">
          <span
            >${ordered.length ? `${page * 9 + 1}–${Math.min(page * 9 + 9, ordered.length)} / ${ordered.length}` : '0 / 0'}</span
          >
          <button
            aria-label="Edelliset junat"
            ?disabled=${page === 0}
            @click=${() => (this.matrixPage = Math.max(0, page - 1))}
          >
            ${icon('chevron', 15)}
          </button>
          <button
            aria-label="Seuraavat junat"
            ?disabled=${page >= pages - 1}
            @click=${() => (this.matrixPage = page + 1)}
          >
            ${icon('chevron', 15)}
          </button>
        </div>
      </div>
      ${
        shown.length
          ? html`<div class="matrix-scroll">
              <table class="matrix-table">
                <thead>
                  <tr>
                    <th scope="col">Liikennepaikka</th>
                    ${shown.map((t) => html`<th scope="col"><button class=${key(t) === this.selected ? 'selected' : ''} @click=${() => this.select(key(t))}>${label(t)}</button></th>`)}
                  </tr>
                </thead>
                <tbody>
                  ${codes.map(
                    (code) =>
                      html`<tr>
                        <th scope="row">
                          ${this.stations.get(code)?.stationName.replace(' asema', '') ?? code}
                        </th>
                        ${shown.map((t) => {
                          const r =
                            t.timeTableRows.find(
                              (row) => row.stationShortCode === code && row.type === 'ARRIVAL',
                            ) ?? t.timeTableRows.find((row) => row.stationShortCode === code);
                          if (!r) return html`<td class="matrix-empty">—</td>`;
                          const value = rowDeviation(r);
                          return html`<td
                            class=${`matrix-cell ${value !== null && value > 0 ? 'late' : value !== null && value < 0 ? 'early' : ''}`}
                          >
                            <strong
                              >${time(r.actualTime ?? r.liveEstimateTime ?? r.scheduledTime)}</strong
                            >
                            <small
                              >${r.actualTime ? 'Toteuma' : r.liveEstimateTime ? 'Ennuste' : 'Aikataulu'}
                              · ${time(r.scheduledTime)}</small
                            >
                            ${value === null ? nothing : html`<em>${value > 0 ? '+' : ''}${value} min</em>`}
                          </td>`;
                        })}
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>`
          : html`<div class="analysis-empty">
              Valitulle rataosalle ja aikavälille ei löytynyt junia.
            </div>`
      }
    </div>`;
  }
  private renderDeviation(picked: Train | undefined) {
    if (!picked)
      return html`<div class="analysis-empty">
        Valitse juna tarkastellaksesi ennusteen ja toteuman eroa aikataulusta.
      </div>`;
    const rows = picked.timeTableRows.filter(
      (r, i) => r.commercialStop && (r.type === 'ARRIVAL' || i === 0),
    );
    const max = Math.max(10, ...rows.map((r) => Math.abs(rowDeviation(r) ?? 0)));
    const width = 1260,
      center = 660,
      half = 435,
      top = 68,
      step = 36;
    const height = Math.max(170, rows.length * step + top + 35);
    return html`<div class="deviation-shell">
      <div class="deviation-info">
        <strong>${label(picked)} · Poikkeama aikataulusta</strong>
        <span
          >Negatiivinen = etuajassa · positiivinen = myöhässä. Toteumat ja ennusteet eroteltu.</span
        >
      </div>
      <svg
        viewBox=${`0 0 ${width} ${height}`}
        role="img"
        aria-label=${`${label(picked)}: jokaisen kaupallisen pysähdyksen aikataulupoikkeama minuutteina. Tiedot esitetty myös luettavana tekstinä.`}
      >
        <line
          x1=${center}
          y1="41"
          x2=${center}
          y2=${height - 20}
          stroke="#a9b6ca"
          stroke-dasharray="4 4"
          opacity=".65"
        />
        <text x=${center - 12} y="22" text-anchor="end" class="axis-label">Etuajassa</text>
        <text x=${center + 12} y="22" text-anchor="start" class="axis-label">Myöhässä</text>
        <text x=${center} y="38" text-anchor="middle" class="axis-label">0</text>
        ${rows.map((r, i) => {
          const value = rowDeviation(r),
            y = top + i * step;
          const bar = (Math.abs(value ?? 0) / max) * half;
          const x = value !== null && value < 0 ? center - bar : center;
          return svg`<g><line x1="208" x2="1125" y1=${y + 12} y2=${y + 12} stroke="#28394d" stroke-width=".6"/>
            <text x="190" y=${y + 3} text-anchor="end" class="axis-label">${this.stations.get(r.stationShortCode)?.stationName.replace(' asema', '') ?? r.stationShortCode}</text>
            <text x="206" y=${y + 3} class="axis-label">${time(r.scheduledTime)}</text>
            ${
              value === null
                ? svg`<text x=${center + 10} y=${y + 3} class="axis-label">${r.cancelled ? 'Peruttu' : 'Ei toteumaa tai ennustetta'}</text>`
                : svg`<rect x=${x} y=${y - 10} width=${Math.max(bar, 1)} height="18" rx="3" fill=${value > 0 ? '#e5a967' : value < 0 ? '#70c8b0' : '#809fb0'}/>
              <text x=${value < 0 ? x - 10 : center + bar + 10} y=${y + 3} text-anchor=${value < 0 ? 'end' : 'start'} class="deviation-label">${value > 0 ? '+' : ''}${value} min · ${time(r.actualTime ?? r.liveEstimateTime)}</text>`
            }
            <title>${r.stationShortCode}, aikataulu ${time(r.scheduledTime)}, ${r.actualTime ? 'toteuma' : r.liveEstimateTime ? 'ennuste' : 'ei tietoa'} ${r.actualTime || r.liveEstimateTime ? time(r.actualTime ?? r.liveEstimateTime) : ''}</title>
          </g>`;
        })}
      </svg>
      <div class="deviation-accessible">
        <table>
          <caption>
            Poikkeamat luettavana taulukkona
          </caption>
          <thead>
            <tr>
              <th>Liikennepaikka</th>
              <th>Aikataulu</th>
              <th>Ennuste tai toteuma</th>
              <th>Poikkeama</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (r) =>
                html`<tr>
                  <td>
                    ${this.stations.get(r.stationShortCode)?.stationName ?? r.stationShortCode}
                  </td>
                  <td>${time(r.scheduledTime)}</td>
                  <td>
                    ${r.actualTime || r.liveEstimateTime ? time(r.actualTime ?? r.liveEstimateTime) : '—'}
                  </td>
                  <td>${rowDeviation(r) ?? 'Ei tietoa'}</td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
    </div>`;
  }
  render() {
    const picked = this.trains.find((t) => key(t) === this.selected);
    const seq =
      this.corridor === 'selected' && picked
        ? stationSequence(picked).filter(
            (c, i, a) =>
              i === 0 ||
              i === a.length - 1 ||
              picked.timeTableRows.some((r) => r.stationShortCode === c && r.commercialStop),
          )
        : (corridors[this.corridor]?.stations ?? corridors.west.stations);
    const codes = seq.filter((c) => this.stations.has(c));
    const minT = this.now - 30 * 60000 + this.offset * 60000,
      maxT = minT + this.minutes * 60000;
    const width = 1260,
      height = this.expanded ? 500 : 260,
      left = 120,
      right = 32,
      top = 30,
      bottom = 24;
    const plotW = width - left - right,
      plotH = height - top - bottom;
    const distances: number[] = [0];
    for (let i = 1; i < codes.length; i++) {
      const a = this.stations.get(codes[i - 1])!,
        b = this.stations.get(codes[i])!;
      const d = Math.hypot(
        (a.longitude - b.longitude) * Math.cos(((a.latitude + b.latitude) * Math.PI) / 360),
        a.latitude - b.latitude,
      );
      distances.push(distances[i - 1] + d);
    }
    const total = distances.at(-1) || 1;
    const y = (c: string) => top + ((distances[codes.indexOf(c)] ?? 0) / total) * plotH;
    const x = (v: number) => left + ((v - minT) / (maxT - minT)) * plotW;
    const ticks: number[] = [];
    const step = this.minutes > 180 ? 30 * 60000 : 15 * 60000;
    for (let t = Math.ceil(minT / step) * step; t <= maxT; t += step) ticks.push(t);
    const occupied: { x: number; y: number; width: number }[] = [];
    const relevant = corridorTrains(this.trains, codes, minT, maxT);
    const prioritized = prioritizedTrains(relevant, this.selected, this.now);
    const limit = this.lineLimit === 'all' ? Infinity : Number(this.lineLimit);
    const lineTrains = this.onlySelected
      ? prioritized.filter((t) => key(t) === this.selected)
      : prioritized.slice(0, limit);
    const importantLabels = new Set(prioritized.slice(0, 9).map(key));
    return html`<section class="panel timetable-panel" data-corridor=${this.corridor}>
      <div class="panel-heading chart-heading">
        <h2>
          ${icon('chart', 18)} Graafinen aikataulu
          <span class="count">${relevant.length} junaa</span>
        </h2>
        <div class="chart-options">
          <label
            ><span class="sr-only">Valitse rataosa</span
            ><select
              aria-label="Valitse rataosa"
              .value=${this.corridor}
              @change=${(e: Event) => (this.corridor = (e.target as HTMLSelectElement).value)}
            >
              ${Object.entries(corridors).map(([k, v]) => html`<option value=${k} ?selected=${this.corridor === k}>${v.name}</option>`)}${picked ? html`<option value="selected" ?selected=${this.corridor === 'selected'}>Valitun junan reitti</option>` : nothing}
            </select></label
          ><select
            aria-label="Aikaväli"
            .value=${String(this.minutes)}
            @change=${(e: Event) => (this.minutes = Number((e.target as HTMLSelectElement).value))}
          >
            <option value="60">1 tunti</option>
            <option value="120">2 tuntia</option>
            <option value="240">4 tuntia</option></select
          ><button
            class="icon-button"
            aria-label="Edellinen tunti"
            @click=${() => (this.offset -= 60)}
          >
            <span class="rotate-180">${icon('chevron', 16)}</span></button
          ><button class="text-button now-button" @click=${() => (this.offset = 0)}>Nyt</button
          ><button
            class="icon-button"
            aria-label="Seuraava tunti"
            @click=${() => (this.offset += 60)}
          >
            ${icon('chevron', 16)}
          </button>
        </div>
      </div>
      <div class="chart-modes" role="group" aria-label="Aikataulun esitystapa">
        <button
          class=${this.view === 'distance' ? 'active' : ''}
          aria-pressed=${this.view === 'distance'}
          @click=${() => (this.view = 'distance')}
        >
          ${icon('chart', 15)} Aika–paikka
        </button>
        <button
          class=${this.view === 'heatmap' ? 'active' : ''}
          aria-pressed=${this.view === 'heatmap'}
          @click=${() => (this.view = 'heatmap')}
        >
          ${icon('filter', 15)} Asemaviiveet
        </button>
        <button
          class=${this.view === 'lanes' ? 'active' : ''}
          aria-pressed=${this.view === 'lanes'}
          @click=${() => (this.view = 'lanes')}
        >
          ${icon('train', 15)} Junien aikajanat
        </button>
        <button
          class=${this.view === 'matrix' ? 'active' : ''}
          aria-pressed=${this.view === 'matrix'}
          @click=${() => {
            this.view = 'matrix';
            this.matrixPage = 0;
          }}
        >
          ${icon('layers', 15)} Asemamatriisi
        </button>
        <button
          class=${this.view === 'deviation' ? 'active' : ''}
          aria-pressed=${this.view === 'deviation'}
          @click=${() => (this.view = 'deviation')}
        >
          ${icon('target', 15)} Poikkeamat
        </button>
        <button
          class=${this.view === 'flow' ? 'active' : ''}
          aria-pressed=${this.view === 'flow'}
          @click=${() => (this.view = 'flow')}
        >
          ${icon('chart', 15)} Liikennevirta
        </button>
      </div>
      <div class="chart-preferences">
        <span
          >${picked ? `Valittu juna: ${label(picked)}` : 'Valitse juna tarkempaa vertailua varten'}
          · ${corridors[this.corridor]?.name ?? 'Valitun junan reitti'}</span
        >
        <button
          class=${this.settingsOpen ? 'active' : ''}
          aria-expanded=${this.settingsOpen}
          @click=${() => (this.settingsOpen = !this.settingsOpen)}
        >
          ${icon('settings', 15)} Näyttöasetukset ${icon('down', 13)}
        </button>
      </div>
      ${
        this.settingsOpen
          ? html`<div class="chart-settings" role="group" aria-label="Visualisoinnin asetukset">
              ${
                this.view === 'distance'
                  ? html`<label
                        >Näytettävät junat
                        <select
                          aria-label="Näytettävien junien määrä"
                          .value=${this.lineLimit}
                          @change=${(e: Event) => (this.lineLimit = (e.target as HTMLSelectElement).value)}
                        >
                          <option value="12">12 junaa</option>
                          <option value="24">24 junaa</option>
                          <option value="48">48 junaa</option>
                          <option value="all">Kaikki junat</option>
                        </select></label
                      >
                      <label
                        >Junan tunnukset
                        <select
                          aria-label="Junatunnusten näkyvyys"
                          .value=${this.lineLabels}
                          @change=${(e: Event) => (this.lineLabels = (e.target as HTMLSelectElement).value as Labels)}
                        >
                          <option value="selected">Vain valitun</option>
                          <option value="important">Tärkeimmät</option>
                          <option value="all">Mahdollisimman monta</option>
                          <option value="none">Piilota tunnukset</option>
                        </select></label
                      >
                      <label
                        >Piirtotaso
                        <select
                          aria-label="Aikataulun piirtotasot"
                          .value=${this.layer}
                          @change=${(e: Event) => (this.layer = (e.target as HTMLSelectElement).value as Layer)}
                        >
                          <option value="both">Aikataulu ja ennuste/toteuma</option>
                          <option value="schedule">Vain aikataulu</option>
                          <option value="observed">Vain ennuste/toteuma</option>
                        </select></label
                      >
                      <label class="chart-setting-checkbox"
                        ><input
                          type="checkbox"
                          .checked=${this.onlySelected}
                          @change=${(e: Event) => (this.onlySelected = (e.target as HTMLInputElement).checked)}
                        />
                        Vain valittu juna</label
                      >`
                  : nothing
              }
              ${
                this.view === 'heatmap'
                  ? html`<label
                      >Värin merkitys
                      <select
                        aria-label="Viivekartan mittari"
                        .value=${this.heatMetric}
                        @change=${(e: Event) => (this.heatMetric = (e.target as HTMLSelectElement).value as HeatMetric)}
                      >
                        <option value="delayed">Myöhässä olevat junat</option>
                        <option value="average">Keskimääräinen viive</option>
                        <option value="trains">Junien määrä</option>
                      </select></label
                    >`
                  : nothing
              }
              ${
                this.view === 'lanes'
                  ? html`<label
                      >Järjestä aikajanat
                      <select
                        aria-label="Aikajanojen järjestys"
                        .value=${this.laneSort}
                        @change=${(e: Event) => (this.laneSort = (e.target as HTMLSelectElement).value as 'time' | 'delay' | 'number')}
                      >
                        <option value="time">Reitin alkuajan mukaan</option>
                        <option value="delay">Havaitun viiveen mukaan</option>
                        <option value="number">Junan numeron mukaan</option>
                      </select></label
                    >`
                  : nothing
              }
              ${
                this.view === 'flow'
                  ? html`<label
                        >Liikennepaikka
                        <select
                          aria-label="Liikennevirran liikennepaikka"
                          .value=${codes.includes(this.flowStation) ? this.flowStation : 'all'}
                          @change=${(e: Event) => (this.flowStation = (e.target as HTMLSelectElement).value)}
                        >
                          <option value="all">Koko rataosa</option>
                          ${codes.map((c) => html`<option value=${c}>${this.stations.get(c)?.stationName ?? c}</option>`)}
                        </select></label
                      >
                      <label
                        >Aikajakso
                        <select
                          aria-label="Liikennevirran aikajakso"
                          .value=${String(this.flowBucket)}
                          @change=${(e: Event) => (this.flowBucket = Number((e.target as HTMLSelectElement).value))}
                        >
                          <option value="15">15 min</option>
                          <option value="30">30 min</option>
                          <option value="60">60 min</option>
                        </select></label
                      >`
                  : nothing
              }
              <button class="chart-reset" @click=${() => this.resetOptions()}>
                Palauta oletusasetukset
              </button>
              <span class="chart-saved">Asetukset tallentuvat tähän selaimeen</span>
            </div>`
          : nothing
      }
      ${this.view === 'distance' && relevant.length > lineTrains.length ? html`<div class="chart-scope-note" role="status">${icon('info', 14)} Näytetään ${lineTrains.length}/${relevant.length} junaa. Voit muuttaa määrää kohdasta Näyttöasetukset. Valittu juna pysyy ensisijaisena.</div>` : nothing}
      <div class="chart-wrap">
        ${
          this.view === 'matrix'
            ? this.renderMatrix(codes, relevant)
            : this.view === 'deviation'
              ? this.renderDeviation(picked)
              : this.view === 'heatmap'
                ? html`<raide-heatmap
                    .trains=${this.trains}
                    .codes=${codes}
                    .stations=${this.stations}
                    .selected=${this.selected}
                    .from=${minT}
                    .to=${maxT}
                    .metric=${this.heatMetric}
                  ></raide-heatmap>`
                : this.view === 'lanes'
                  ? html`<raide-train-lanes
                      .trains=${relevant}
                      .codes=${codes}
                      .stations=${this.stations}
                      .selected=${this.selected}
                      .from=${minT}
                      .to=${maxT}
                      .sort=${this.laneSort}
                    ></raide-train-lanes>`
                  : this.view === 'flow'
                    ? html`<raide-traffic-flow
                        .trains=${this.trains}
                        .codes=${codes}
                        .stations=${this.stations}
                        .selected=${this.selected}
                        .from=${minT}
                        .to=${maxT}
                        .stationFilter=${codes.includes(this.flowStation) ? this.flowStation : 'all'}
                        .bucket=${this.flowBucket}
                      ></raide-traffic-flow>`
                    : html`<svg
                        viewBox=${`0 0 ${width} ${height}`}
                        role="group"
                        aria-label="Graafinen aikataulu: vaaka-akselilla aika, pystyakselilla liikennepaikat. Välimatkat on arvioitu koordinaateista. Junien tiedot ovat saatavilla myös junaluettelossa."
                      >
                        <defs>
                          <clipPath id="chart-clip">
                            <rect x=${left} y=${top - 8} width=${plotW} height=${plotH + 16} />
                          </clipPath>
                        </defs>
                        ${ticks.map((t) => svg`<g><line x1=${x(t)} x2=${x(t)} y1=${top} y2=${height - bottom} class="chart-grid"/><text x=${x(t)} y="15" text-anchor="middle" class="axis-label">${time(t)}</text></g>`)}${codes.filter((c, i) => i === 0 || i === codes.length - 1 || (y(c) - y(codes[i - 1]) >= 13 && y(codes[Math.min(i + 1, codes.length - 1)]) - y(c) >= 13)).map((c) => svg`<g><line x1=${left} x2=${width - right} y1=${y(c)} y2=${y(c)} class="chart-grid"/><text x=${left - 14} y=${y(c) + 4} text-anchor="end" class="axis-label">${this.stations.get(c)?.stationName.replace(' asema', '') ?? c}</text></g>`)}
                        <g clip-path="url(#chart-clip)">
                          ${[
                            ...lineTrains.filter((t) => key(t) !== this.selected),
                            ...lineTrains.filter((t) => key(t) === this.selected),
                          ].map((t) => {
                            const rows = t.timeTableRows.filter((r) =>
                              codes.includes(r.stationShortCode),
                            );
                            const selected = key(t) === this.selected;
                            const hasObserved = rows.some(
                              (r) => r.actualTime || r.liveEstimateTime,
                            );
                            const allowLabel =
                              this.lineLabels !== 'none' &&
                              (selected ||
                                this.lineLabels === 'all' ||
                                (this.lineLabels === 'important' && importantLabels.has(key(t))));
                            const points = (actual: boolean) =>
                              rows
                                .map(
                                  (r) =>
                                    `${x(Date.parse(actual ? (r.actualTime ?? r.liveEstimateTime ?? r.scheduledTime) : r.scheduledTime))},${y(r.stationShortCode)}`,
                                )
                                .join(' ');
                            const visible = rows.filter(
                              (r) =>
                                Date.parse(r.actualTime ?? r.liveEstimateTime ?? r.scheduledTime) >
                                  minT &&
                                Date.parse(r.actualTime ?? r.liveEstimateTime ?? r.scheduledTime) <
                                  maxT,
                            );
                            let mid = allowLabel
                              ? visible[Math.floor(visible.length / 2)]
                              : undefined;
                            if (mid && !selected) {
                              const anchor = {
                                x:
                                  x(
                                    Date.parse(
                                      mid.actualTime ?? mid.liveEstimateTime ?? mid.scheduledTime,
                                    ),
                                  ) + 5,
                                y: y(mid.stationShortCode) - 7,
                                width: label(t).length * 7,
                              };
                              const span =
                                Math.max(...rows.map((r) => y(r.stationShortCode))) -
                                Math.min(...rows.map((r) => y(r.stationShortCode)));
                              if (
                                span < 20 ||
                                occupied.some(
                                  (a) =>
                                    Math.abs(a.y - anchor.y) < 14 &&
                                    anchor.x < a.x + a.width + 8 &&
                                    a.x < anchor.x + anchor.width + 8,
                                )
                              )
                                mid = undefined as any;
                              else occupied.push(anchor);
                            }
                            const color = selected
                              ? '#8bf0c9'
                              : t.trainCategory === 'Cargo'
                                ? '#ae9fe1'
                                : t.trainCategory === 'Commuter'
                                  ? '#76a5cd'
                                  : '#5c9ee0';
                            return svg`<g class="chart-train ${selected ? 'selected' : ''}" role="button" tabindex="0" aria-label=${`Valitse ${label(t)}`} @click=${() => this.select(key(t))} @keydown=${(
                              e: KeyboardEvent,
                            ) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                this.select(key(t));
                              }
                            }}>${this.layer !== 'observed' ? svg`<polyline points=${points(false)} fill="none" stroke=${color} opacity=${selected ? '.6' : '.22'} stroke-dasharray="4 4" stroke-width=${selected ? '1.4' : '1'}/>` : nothing}<polyline points=${points(true)} fill="none" stroke="transparent" stroke-width="10"/>${this.layer !== 'schedule' && hasObserved ? svg`<polyline points=${points(true)} fill="none" stroke=${color} opacity=${selected ? '1' : this.lineLimit === 'all' ? '.22' : '.53'} stroke-width=${selected ? '3.2' : '1.35'}/>` : nothing}${mid ? svg`<text x=${x(Date.parse(mid.actualTime ?? mid.liveEstimateTime ?? mid.scheduledTime)) + 5} y=${y(mid.stationShortCode) - 7} class="chart-train-label" fill=${color}>${label(t)}</text>` : nothing}<title>${label(t)}</title></g>`;
                          })}${x(this.now) >= left && x(this.now) <= width - right ? svg`<line x1=${x(this.now)} x2=${x(this.now)} y1=${top - 10} y2=${height - bottom + 5} stroke="#87edc4" stroke-dasharray="3 4" opacity=".65"/><rect x=${x(this.now) - 17} y=${height - bottom + 4} width="34" height="18" rx="3" fill="#87edc4"/><text x=${x(this.now)} y=${height - bottom + 16} text-anchor="middle" class="now-label">NYT</text>` : nothing}
                        </g>
                        ${!relevant.length ? svg`<text x=${width / 2} y=${height / 2} text-anchor="middle" class="axis-label">Valitulla aikavälillä ei ole junia. Valitse toinen rataosa tai aikaväli.</text>` : nothing}
                      </svg>`
        }
      </div>
      <div class="chart-footer">
        ${this.view === 'distance' ? html`<span><i class="legend-line dashed"></i>Aikataulu</span><span><i class="legend-line"></i>Toteuma / ennuste</span>` : nothing}
        <span class="muted"
          >Ajat Suomen ajassa ·
          ${this.view === 'distance' ? 'Etäisyydet arvioituja, eivät ratakilometrejä' : 'Aineisto: aikataulut, ennusteet ja toteumat'}</span
        >
      </div>
    </section>`;
  }
}
customElements.define('raide-timetable', Timetable);
