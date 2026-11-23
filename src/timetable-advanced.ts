import { LitElement, html, svg, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { key, label, time, type Station, type Train } from './domain';
import { rowDeviation } from './investigation-model';
import {
  heatValue,
  heatRow,
  makeFlow,
  makeHeatmap,
  prioritizedTrains,
  trainLaneDeviation,
  trainLaneDelayLabel,
  trainSpan,
  type ChartCell,
  type HeatMetric,
} from './timetable-analytics';
import { icon } from './icons';

abstract class ChartElement extends LitElement {
  createRenderRoot() {
    return this;
  }
  @property({ attribute: false }) trains: Train[] = [];
  @property({ attribute: false }) codes: string[] = [];
  @property({ attribute: false }) stations = new Map<string, Station>();
  @property() selected = '';
  @property({ type: Number }) from = Date.now() - 30 * 60000;
  @property({ type: Number }) to = Date.now() + 90 * 60000;
  protected stationName(code: string) {
    return this.stations.get(code)?.stationName.replace(/ asema$/, '') ?? code;
  }
  protected select(train: Train) {
    this.dispatchEvent(
      new CustomEvent('train-select', { detail: key(train), bubbles: true, composed: true }),
    );
  }
}

export class HeatmapView extends ChartElement {
  @property() metric: HeatMetric = 'delayed';
  @state() private activeCell = '';
  @state() private showAll = false;
  render() {
    const cells = makeHeatmap(this.trains, this.codes, this.from, this.to);
    const cols = this.codes.length ? cells.length / this.codes.length : 0;
    const max = Math.max(1, ...cells.map((cell) => heatValue(cell, this.metric)));
    const busiest = [...cells].sort(
      (a, b) => heatValue(b, this.metric) - heatValue(a, this.metric) || b.count - a.count,
    )[0];
    const active =
      cells.find((cell) => `${cell.station}/${cell.start}` === this.activeCell) ?? busiest;
    const valueLabel =
      this.metric === 'delayed'
        ? 'myöhässä olevaa junaa'
        : this.metric === 'average'
          ? 'myöhässä olevien keskimääräinen viive (min)'
          : 'junaa';
    const cellValue = (cell: ChartCell) => {
      if (!cell.count) return '·';
      if (this.metric !== 'trains' && !cell.known) return '?';
      if (this.metric === 'average' && !cell.delayed) return '—';
      const value = heatValue(cell, this.metric);
      return this.metric === 'average' ? Math.round(value) : value;
    };
    return html`<div class="advanced-visual heatmap-shell">
      <div class="visual-intro">
        <div>
          <strong>Viiveet aikataulupisteittäin</strong>
          <p>
            Liikennepaikka × 15 minuuttia · julkaistut saapumis- ja lähtötapahtumat, ei junien
            maantieteellisiä sijainteja. Valitse ruutu nähdäksesi junat ja tiedon alkuperä.
          </p>
        </div>
        <div class="visual-legend">
          <i class="heat-swatch"></i> Suurempi arvo = voimakkaampi väri · ? = viive tuntematon · · =
          ei tapahtumia
        </div>
      </div>
      ${
        cells.length
          ? html`<div class="heatmap-scroll">
              <div
                class="heatmap-grid"
                style=${`grid-template-columns: 158px repeat(${cols}, minmax(57px, 1fr));`}
              >
                <div class="heat-corner">Liikennepaikka</div>
                ${cells.slice(0, cols).map((c) => html`<span class="heat-time">${time(c.start)}</span>`)}
                ${this.codes.map(
                  (code) =>
                    html`<div class="heat-station">${this.stationName(code)}</div>
                      ${cells
                        .filter((c) => c.station === code)
                        .map((cell) => {
                          const amount = heatValue(cell, this.metric);
                          const intensity =
                            cell.known || this.metric === 'trains'
                              ? amount > 0
                                ? 0.12 + (0.73 * amount) / max
                                : 0
                              : 0;
                          const activeKey = `${cell.station}/${cell.start}`;
                          return html`<button
                            class="heat-cell ${this.activeCell === activeKey ? 'selected' : ''} ${cell.count === 0 ? 'empty' : ''} ${cell.count > 0 && !cell.known && this.metric !== 'trains' ? 'unknown' : ''}"
                            style=${`--heat-alpha:${intensity.toFixed(3)};`}
                            aria-pressed=${this.activeCell === activeKey}
                            aria-label=${`${this.stationName(code)}, ${time(cell.start)}, ${cell.count} junaa, ${cellValue(cell)} ${valueLabel}; ${cell.known} junan aikaero tiedossa, ${cell.scheduled} ilman toteumaa tai ennustetta`}
                            @click=${() => {
                              this.activeCell = activeKey;
                              this.showAll = false;
                            }}
                          >
                            <strong>${cellValue(cell)}</strong
                            >${cell.known < cell.count && cell.count > 0 ? html`<small title="Osa aikaeroista tuntemattomia">*</small>` : nothing}
                          </button>`;
                        })}`,
                )}
              </div>
            </div>`
          : html`<div class="analysis-empty">Tällä rataosalla ei ole esitettävää aineistoa.</div>`
      }
      ${
        active
          ? html`<div class="heat-inspector">
              <div class="heat-inspector-heading">
                <div>
                  <span class="eyebrow">VALITUN AIKARUUDUN TIEDOT</span>
                  <h3>
                    ${this.stationName(active.station)}
                    <span>${time(active.start)} · ${active.count} junaa</span>
                  </h3>
                </div>
                <div class="heat-inspector-summary">
                  <strong>${cellValue(active)} ${valueLabel}</strong>
                  <small
                    >${active.actual} toteumaa · ${active.estimated} ennustetta ·
                    ${active.scheduled} vain aikataulu</small
                  >
                  <small>Viive tiedossa ${active.known}/${active.count} junalle</small>
                </div>
              </div>
              <div class="heat-inspector-trains">
                ${active.trains.slice(0, this.showAll ? 100 : 12).map(
                  (train) =>
                    html`<button @click=${() => this.select(train)}>
                      <strong>${label(train)}</strong
                      ><span
                        >${train.trainCategory === 'Cargo' ? 'Tavaraliikenne' : train.trainCategory === 'Commuter' ? 'Lähiliikenne' : 'Kaukoliikenne'}</span
                      >
                      <span class="mini-delay"
                        >${(() => {
                          const r = heatRow(
                            train,
                            active.station,
                            active.start,
                            active.start + 900000,
                          );
                          const d = r ? rowDeviation(r) : null;
                          return d === null ? 'Ei viivetietoa' : `${d > 0 ? '+' : ''}${d} min`;
                        })()}</span
                      >${icon('chevron', 13)}
                    </button>`,
                )}
                ${!active.trains.length ? html`<p>Ei junia tässä aikaruudussa.</p>` : nothing}
              </div>
              ${active.trains.length > 12 ? html`<button class="queue-more" @click=${() => (this.showAll = !this.showAll)}>${this.showAll ? 'Näytä vähemmän' : `Näytä kaikki (${active.trains.length})`}</button>` : nothing}
            </div>`
          : nothing
      }
      <p class="visual-footnote">
        Vain julkaistuihin aikataulutapahtumiin perustuva ryhmittely; ei raiteiden varaustietoa.
        Keskiarvo lasketaan vain positiivisista, tunnetuista viiveistä. * Osa aikaeroista puuttuu;
        tuntematonta viivettä ei tulkita nollaksi. Jos saman junan saapumiselta puuttuu viivetieto,
        tunnettu lähtöhavainto voi edustaa aikaruutua. Peruutetut tapahtumat eivät sisälly.
      </p>
    </div>`;
  }
}
customElements.define('raide-heatmap', HeatmapView);

export class TrainLanesView extends ChartElement {
  @property() sort: 'time' | 'delay' | 'number' = 'time';
  @state() private page = 0;
  render() {
    const allowed = new Set(this.codes);
    const mid = (this.from + this.to) / 2;
    const score = (train: Train) => trainLaneDeviation(train, allowed, mid);
    const ordered = prioritizedTrains(this.trains, this.selected, (this.from + this.to) / 2).sort(
      (a, b) => {
        if (key(a) === this.selected) return -1;
        if (key(b) === this.selected) return 1;
        if (this.sort === 'number') return a.trainNumber - b.trainNumber;
        if (this.sort === 'delay') {
          const aDelay = score(a);
          const bDelay = score(b);
          return aDelay === null
            ? bDelay === null
              ? 0
              : 1
            : bDelay === null
              ? -1
              : bDelay - aDelay;
        }
        return (
          (trainSpan(a, allowed)?.observedStart ?? Infinity) -
          (trainSpan(b, allowed)?.observedStart ?? Infinity)
        );
      },
    );
    const pageCount = Math.max(1, Math.ceil(ordered.length / 15));
    const page = Math.min(this.page, pageCount - 1);
    const shown = ordered.slice(page * 15, page * 15 + 15);
    const width = 1260,
      left = 145,
      right = 95,
      top = 53,
      step = 34;
    const height = Math.max(190, top + shown.length * step + 30);
    const x = (t: number) =>
      left + ((t - this.from) / (this.to - this.from)) * (width - left - right);
    const clip = (t: number) => Math.max(left, Math.min(width - right, x(t)));
    const gridStep = this.to - this.from > 180 * 60000 ? 30 * 60000 : 15 * 60000;
    const ticks: number[] = [];
    for (let t = Math.ceil(this.from / gridStep) * gridStep; t <= this.to; t += gridStep)
      ticks.push(t);
    return html`<div class="advanced-visual lanes-shell">
      <div class="visual-intro">
        <div>
          <strong>Junakohtaiset aikajanat</strong>
          <p>
            Yksi juna rivillä. Katkoviiva = aikataulu; värillinen jakso = viimeisin ennuste/toteuma.
          </p>
        </div>
        <div class="lane-pagination">
          <span
            >${ordered.length ? `${page * 15 + 1}–${Math.min(page * 15 + 15, ordered.length)}/${ordered.length}` : '0/0'}</span
          >
          <button
            aria-label="Edelliset junat"
            ?disabled=${page === 0}
            @click=${() => (this.page = Math.max(0, page - 1))}
          >
            ${icon('chevron', 15)}
          </button>
          <button
            aria-label="Seuraavat junat"
            ?disabled=${page === pageCount - 1}
            @click=${() => (this.page = page + 1)}
          >
            ${icon('chevron', 15)}
          </button>
        </div>
      </div>
      ${
        shown.length
          ? html`<svg
              viewBox=${`0 0 ${width} ${height}`}
              role="group"
              aria-label="Junien aikajanojen vertailu, valitse juna klikkaamalla riviä"
            >
              ${ticks.map((t) => svg`<g><line x1=${x(t)} y1=${top - 17} x2=${x(t)} y2=${height - 25} class="chart-grid"/><text x=${x(t)} y="22" class="axis-label" text-anchor="middle">${time(t)}</text></g>`)}
              ${shown.map((train, i) => {
                const range = trainSpan(train, allowed),
                  y = top + i * step;
                const highlighted = key(train) === this.selected;
                const hasObserved = train.timeTableRows.some(
                  (r) => allowed.has(r.stationShortCode) && (r.actualTime || r.liveEstimateTime),
                );
                const shade = highlighted
                  ? '#8bf0c9'
                  : train.trainCategory === 'Cargo'
                    ? '#b9a2e5'
                    : train.trainCategory === 'Commuter'
                      ? '#81b9db'
                      : '#66a7e0';
                return svg`<g role="button" tabindex="0" class=${`lane-row ${highlighted ? 'selected' : ''}`} aria-label=${`Valitse ${label(train)}`} @click=${() => this.select(train)} @keydown=${(
                  e: KeyboardEvent,
                ) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.select(train);
                  }
                }}>
            <rect x="0" y=${y - 18} width=${width} height=${step} fill=${highlighted ? '#1d393b' : 'transparent'}/>
            <line x1=${left} x2=${width - right} y1=${y + 16} y2=${y + 16} class="chart-grid"/>
            <text x=${left - 15} y=${y + 5} text-anchor="end" fill=${highlighted ? '#b9f6e4' : '#bed1df'} class="lane-name">${label(train)}</text>
            ${
              range
                ? svg`<rect x=${clip(range.scheduledStart)} y=${y - 7} width=${Math.max(1, clip(range.scheduledEnd) - clip(range.scheduledStart))} height="4" fill="#748b9d" opacity=".85" rx="2"/>
              ${hasObserved ? svg`<rect x=${clip(range.observedStart)} y=${y + 1} width=${Math.max(1, clip(range.observedEnd) - clip(range.observedStart))} height="7" rx="3" fill=${shade}/>` : nothing}`
                : nothing
            }
            <text x=${width - right + 13} y=${y + 4} class="lane-delay">${trainLaneDelayLabel(score(train))}</text>
            <title>${label(train)} · valitse junan tiedot</title>
          </g>`;
              })}
            </svg>`
          : html`<div class="analysis-empty">Tällä aikaikkunalla ei ole junia.</div>`
      }
      <p class="visual-footnote">
        Jaksojen alku- ja päätepisteet ovat valitun rataosan liikennepaikkoja. Aikajanoista ei voida
        päätellä raidevarausta tai turvallista kohtaamista.
      </p>
    </div>`;
  }
}
customElements.define('raide-train-lanes', TrainLanesView);

export class TrafficFlowView extends ChartElement {
  @property() stationFilter = 'all';
  @property({ type: Number }) bucket = 15;
  render() {
    const stations =
      this.stationFilter === 'all'
        ? this.codes
        : this.codes.filter((c) => c === this.stationFilter);
    const data = makeFlow(this.trains, stations, this.from, this.to, this.bucket);
    const max = Math.max(1, ...data.map((d) => Math.max(d.arrivals, d.departures)));
    const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((part) => Math.round(max * part)))];
    const width = 1260,
      left = 68,
      right = 20,
      top = 38,
      bottom = 60,
      plotHeight = 220;
    const span = (width - left - right) / Math.max(1, data.length);
    const barWidth = Math.max(4, Math.min(24, span * 0.34));
    const y = (count: number) => top + plotHeight - (count / max) * plotHeight;
    return html`<div class="advanced-visual flow-shell">
      <div class="visual-intro">
        <div>
          <strong>Saapumis- ja lähtövirta</strong>
          <p>
            Liikennepaikkojen kaupallisten pysähdysten tapahtumamäärät · ${this.bucket} min
            jaksoissa.
          </p>
        </div>
        <div class="flow-legend">
          <span><i class="flow-arrivals"></i>Saapumiset</span
          ><span><i class="flow-departures"></i>Lähdöt</span>
        </div>
      </div>
      <svg
        viewBox=${`0 0 ${width} ${top + plotHeight + bottom}`}
        role="img"
        aria-label="Saapumisten ja lähtöjen määrät aikajaksoittain"
      >
        ${ticks.map((value) => svg`<g><line x1=${left} x2=${width - right} y1=${y(value)} y2=${y(value)} class="chart-grid"/><text x=${left - 10} y=${y(value) + 4} text-anchor="end" class="axis-label">${value}</text></g>`)}
        ${data.map((item, i) => {
          const center = left + span * (i + 0.5);
          return svg`<g><rect x=${center - barWidth - 2} y=${y(item.arrivals)} width=${barWidth} height=${Math.max(0, top + plotHeight - y(item.arrivals))} rx="3" fill="#69b6d6"/>
            <rect x=${center + 2} y=${y(item.departures)} width=${barWidth} height=${Math.max(0, top + plotHeight - y(item.departures))} rx="3" fill="#7cd5bd"/>
            <text x=${center} y=${top + plotHeight + 22} text-anchor="middle" class="axis-label">${time(item.start)}</text>
            <title>${time(item.start)} · ${item.arrivals} saapumista · ${item.departures} lähtöä</title></g>`;
        })}
      </svg>
      <div class="flow-summary">
        <strong>${data.reduce((s, d) => s + d.arrivals, 0)} saapumista</strong
        ><strong>${data.reduce((s, d) => s + d.departures, 0)} lähtöä</strong
        ><span
          >${this.stationFilter === 'all' ? 'Kaikki valitun rataosan liikennepaikat' : this.stationName(this.stationFilter)}</span
        >
      </div>
      <p class="visual-footnote">
        Pylväät laskevat aikataulun, ennusteen tai toteuman mukaisia kaupallisia pysähdystapahtumia.
        Ne eivät kuvaa raidekapasiteettia.
      </p>
    </div>`;
  }
}
customElements.define('raide-traffic-flow', TrafficFlowView);
