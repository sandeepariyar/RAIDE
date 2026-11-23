import { LitElement, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { corridors } from './corridors';
import {
  delay,
  endpoints,
  key,
  label,
  time,
  type Location,
  type Station,
  type Train,
} from './domain';
import { icon } from './icons';
import './schematic.css';
import './components';
import {
  bestCorridorForTrain,
  journeyStops,
  schematicApproaches,
  summarizeCorridors,
  trainsOnCorridor,
  upcomingCorridorPoints,
} from './network-analytics';

type TrafficView = 'map' | 'schematic' | 'rata' | 'corridors' | 'journey';
const storageKey = 'raide:traffic-view:v1';
const modes: { id: TrafficView; title: string; hint: string; symbol: string }[] = [
  { id: 'map', title: 'Kartta', hint: 'Missä junat ovat?', symbol: 'map' },
  { id: 'schematic', title: 'Linjakaavio', hint: 'Mitä rataosalla tapahtuu?', symbol: 'layers' },
  {
    id: 'rata',
    title: 'Ratakaavio',
    hint: 'Junien seuraavat aikataulupisteet reitillä',
    symbol: 'train',
  },
  { id: 'corridors', title: 'Rataosat', hint: 'Missä on poikkeamia?', symbol: 'target' },
  { id: 'journey', title: 'Junan kulku', hint: 'Miten valittu juna etenee?', symbol: 'train' },
];

function readSettings(): { view: TrafficView; corridor: string } {
  const defaults = { view: 'map' as TrafficView, corridor: 'west' };
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(storageKey);
    if (!raw) return defaults;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return defaults;
    const values = data as { view?: unknown; corridor?: unknown };
    return {
      view: modes.some((m) => m.id === values.view) ? (values.view as TrafficView) : defaults.view,
      corridor:
        typeof values.corridor === 'string' && values.corridor in corridors
          ? values.corridor
          : defaults.corridor,
    };
  } catch {
    return defaults;
  }
}

export class TrafficViews extends LitElement {
  createRenderRoot() {
    return this;
  }
  @property({ attribute: false }) trains: Train[] = [];
  @property({ attribute: false }) network: Train[] = [];
  @property({ attribute: false }) locations: Location[] = [];
  @property({ attribute: false }) stations = new Map<string, Station>();
  @property({ attribute: false }) geography: unknown = null;
  @property() selected = '';
  @property() region = 'all';
  @property({ type: Number }) now = Date.now();
  @property({ type: Boolean }) showStations = true;
  @state() private view: TrafficView = readSettings().view;
  @state() private corridor = readSettings().corridor;
  @state() private expandedStation = '';
  @state() private showPassThrough = false;
  @state() private showAllSchematic = false;
  @state() private expandedRata = false;

  private saveSettings() {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ view: this.view, corridor: this.corridor }),
      );
    } catch {
      /* Private browsing / storage access denied: the views still work. */
    }
  }
  private setView(view: TrafficView) {
    this.view = view;
    this.saveSettings();
  }
  private setCorridor(value: string) {
    if (!(value in corridors)) return;
    this.corridor = value;
    this.expandedStation = '';
    this.saveSettings();
  }
  private emit(name: string, detail?: string) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  private station(code: string) {
    return this.stations.get(code)?.stationName.replace(/ asema$/, '') ?? code;
  }
  private openTrain(train: Train) {
    this.emit('train-select', key(train));
  }
  private makeMap() {
    return html`<raide-map
      .trains=${this.trains}
      .network=${this.network}
      .locations=${this.locations}
      .stations=${this.stations}
      .geography=${this.geography}
      .selected=${this.selected}
      .now=${this.now}
      .region=${this.region}
      .showStations=${this.showStations}
    ></raide-map>`;
  }
  private makeCorridors() {
    const summaries = summarizeCorridors(this.trains, this.locations, this.now);
    const total = summaries.filter((s) => s.serious || s.cancelled).length;
    return html`<div class="traffic-overview-view">
      <div class="traffic-view-intro">
        <span class="eyebrow">RATAVERKON TILANNEKUVA</span>
        <h3>Kuusi rataosaa. Yksi selkeä tilannekuva.</h3>
        <p>
          Jokaisessa kortissa näet reitin junat ja tiedossa olevat viiveet. Avaa rataosa
          tarkastellaksesi seuraavia aikataulupisteitä.
        </p>
      </div>
      <div class="traffic-summary-strip">
        <span><strong>${summaries.length}</strong> seurattavaa rataosaa</span>
        <span class="traffic-summary-attention"
          ><strong>${total}</strong> rataosaa, jolla yli 15 min viiveitä tai peruutuksia</span
        >
      </div>
      <div class="traffic-corridor-grid">
        ${summaries.map((summary) => {
          const seriousness = summary.serious || summary.cancelled;
          const share = summary.trains.length
            ? Math.round((summary.delayed / summary.trains.length) * 100)
            : 0;
          return html`<button
            class="traffic-corridor-card ${seriousness ? 'attention' : ''}"
            aria-label=${`${summary.name}: ${summary.trains.length} junaa, ${summary.delayed} yli viisi minuuttia myöhässä. Avaa linjakaavio.`}
            @click=${() => {
              this.setCorridor(summary.id);
              this.setView('schematic');
            }}
          >
            <span class="traffic-corridor-top"
              ><span class="traffic-corridor-id">${summary.id.toUpperCase()}</span>
              <span class="traffic-corridor-status"
                >${summary.cancelled ? `${summary.cancelled} peruttu` : summary.serious ? `${summary.serious} yli 15 min` : 'Seurannassa'}</span
              ></span
            >
            <strong>${summary.name}</strong>
            <span class="traffic-mini-line"
              ><i></i>${summary.stations.map(() => html`<b></b>`)}</span
            >
            <span class="traffic-corridor-metrics"
              ><span><b>${summary.trains.length}</b> junaa</span
              ><span><b>${summary.delayed}</b> myöhässä</span
              ><span><b>${summary.freshLocations}</b> GPS</span></span
            >
            <span class="traffic-corridor-bottom"
              ><span class="traffic-loadbar"><i style=${`width:${share}%`}></i></span
              ><span>Katso rataosaa ${icon('chevron', 14)}</span></span
            >
          </button>`;
        })}
      </div>
      <p class="traffic-data-caveat">
        Luvut perustuvat näkyvissä olevien junien aikataulureitteihin ja viimeisimpiin saatavilla
        oleviin GPS-havaintoihin. Sama juna voi kuulua useaan rataosaan. Ei kuvaa raiteiden
        varaustilannetta.
      </p>
    </div>`;
  }
  private makeSchematic() {
    const corridor = corridors[this.corridor];
    const approaches = upcomingCorridorPoints(
      this.trains,
      corridor.stations,
      this.now,
      corridor.qualifiers,
    );
    const members = trainsOnCorridor(this.trains, corridor.stations, corridor.qualifiers);
    const featured = members.find((train) => key(train) === this.selected);
    const selectedTrain = this.network.find((train) => key(train) === this.selected);
    const alternative = selectedTrain && bestCorridorForTrain(selectedTrain);
    return html`<div class="traffic-schematic-view">
      <div class="traffic-view-intro compact">
        <span class="eyebrow">LINJAKAAVIO / AIKATAULUSEURANTA</span>
        <h3>Junan seuraava aikataulupiste, asema asemalta.</h3>
        <p>
          Ei mittakaavassa. Junakortin sijainti määräytyy aikataulun, ennusteen ja toteuman
          perusteella — se ei ole GPS- tai raidevaraustieto.
        </p>
      </div>
      <div class="traffic-schematic-tools">
        <label
          >Rataosa
          <select
            aria-label="Valitse linjakaavion rataosa"
            .value=${this.corridor}
            @change=${(e: Event) => this.setCorridor((e.target as HTMLSelectElement).value)}
          >
            ${Object.entries(corridors).map(([id, value]) => html`<option value=${id} ?selected=${this.corridor === id}>${value.name}</option>`)}
          </select></label
        >
        <span class="traffic-schematic-count">${members.length} junaa reitillä</span>
      </div>
      ${
        !featured && alternative && alternative.id !== this.corridor
          ? html`<div class="traffic-follow-callout">
              Valittu juna ei ole tällä rataosalla.
              <button @click=${() => this.setCorridor(alternative.id)}>
                Näytä ${label(selectedTrain!)} sen rataosalla
              </button>
            </div>`
          : nothing
      }
      <div class="traffic-station-scroll">
        <div class="traffic-station-spine">
          ${corridor.stations.map((code, i) => {
            const items = approaches.get(code) ?? [];
            const expanded = this.expandedStation === code;
            const shown = expanded ? items : items.slice(0, 3);
            return html`<div class="traffic-station-row ${items.length ? 'has-service' : ''}">
              <div class="traffic-station-axis">
                <span class="traffic-axis-index">${String(i + 1).padStart(2, '0')}</span
                ><span class="traffic-axis-line"><i></i></span>
              </div>
              <div class="traffic-station-content">
                <div class="traffic-station-heading">
                  <strong>${this.station(code)}</strong
                  ><span
                    >${items.length ? `${items.length} tulossa` : 'Ei seuraavaa aikataulupistettä'}</span
                  >
                </div>
                ${
                  shown.length
                    ? html`<div class="traffic-approaches">
                        ${shown.map(
                          ({ train, expected, late, row }) =>
                            html`<button
                              class="traffic-train-chip ${key(train) === this.selected ? 'active' : ''} ${late !== null && late > 5 ? 'delayed' : ''}"
                              aria-pressed=${key(train) === this.selected}
                              title=${`${label(train)} · ${this.station(row.stationShortCode)} ${time(expected)}`}
                              @click=${() => this.openTrain(train)}
                            >
                              <b>${label(train)}</b
                              ><time>${time(expected)}</time
                              >${late !== null && late > 0 ? html`<em>+${late}</em>` : late === null ? html`<em class="no-estimate">?</em>` : nothing}
                            </button>`,
                        )}
                      </div>`
                    : nothing
                }
                ${items.length > 3 ? html`<button class="traffic-more" @click=${() => (this.expandedStation = expanded ? '' : code)}>${expanded ? 'Näytä vähemmän' : `Näytä kaikki ${items.length} junaa`}</button>` : nothing}
              </div>
            </div>`;
          })}
        </div>
      </div>
      <div class="traffic-view-footer">
        <span><i class="traffic-dot current"></i> Valittu juna</span
        ><span><i class="traffic-dot late"></i> Yli 5 min myöhässä</span
        ><span>Ajat Suomen aikaa</span>
      </div>
    </div>`;
  }
  private makeRata() {
    const corridor = corridors[this.corridor];
    const approaches = schematicApproaches(
      this.trains,
      corridor.stations,
      this.now,
      corridor.qualifiers,
    );
    const selected = approaches.find((approach) => key(approach.train) === this.selected);
    const selectedTrain = this.network.find((train) => key(train) === this.selected);
    const selectedOnCorridor =
      selectedTrain &&
      trainsOnCorridor([selectedTrain], corridor.stations, corridor.qualifiers).length > 0;
    const alternative =
      selectedTrain && !selectedOnCorridor ? bestCorridorForTrain(selectedTrain) : undefined;
    const stations = corridor.stations;
    const width = Math.max(940, 180 + (stations.length - 1) * 128);
    const x = (index: number) => 88 + (index * (width - 176)) / Math.max(1, stations.length - 1);
    const groups = new Map<string, typeof approaches>();
    for (const approach of approaches) {
      const id = `${approach.stationIndex}/${approach.direction}`;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id)!.push(approach);
    }
    const markers = [...groups.entries()].map(([id, items]) => ({
      id,
      items,
      leading: items.find((item) => key(item.train) === this.selected) ?? items[0],
    }));
    const shown = this.showAllSchematic ? approaches : approaches.slice(0, 12);
    return html`<div
      class="rail-schematic-view ${this.expandedRata ? 'is-expanded' : ''}"
      role=${this.expandedRata ? 'dialog' : 'region'}
      aria-modal=${this.expandedRata ? 'true' : nothing}
      aria-label="Ratakaavio, julkaistut asematapahtumat"
      @keydown=${(e: KeyboardEvent) => {
        if (!this.expandedRata) return;
        if (e.key === 'Escape') {
          this.expandedRata = false;
          e.stopPropagation();
        }
        if (e.key === 'Tab') {
          const visible = [
            ...this.querySelectorAll<HTMLElement>(
              '.rail-schematic-view.is-expanded button, .rail-schematic-view.is-expanded select, .rail-schematic-view.is-expanded [tabindex="0"]',
            ),
          ].filter((node) => node.getClientRects().length > 0);
          const first = visible[0],
            last = visible.at(-1);
          if (first && last && e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (first && last && !e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <div class="traffic-view-intro rail-schematic-intro">
        <span class="eyebrow">RATAKAAVIO / JULKAISTUT AIKATAULUPISTEET</span>
        <h3>Reitti, suunnat ja junat yhdellä silmäyksellä.</h3>
        <p>
          Valitse junamerkki tai seuraavan pisteen kortti. Näkymä perustuu julkaistuihin
          aikatauluihin ja ennusteisiin, ei sijaintiin raiteella.
        </p>
      </div>
      <div class="traffic-schematic-tools rail-schematic-tools">
        <label
          >Rataosa
          <select
            aria-label="Valitse ratakaavion rataosa"
            .value=${this.corridor}
            @change=${(e: Event) => this.setCorridor((e.target as HTMLSelectElement).value)}
          >
            ${Object.entries(corridors).map(([id, value]) => html`<option value=${id} ?selected=${id === this.corridor}>${value.name}</option>`)}
          </select>
        </label>
        <div class="rail-schematic-meta">
          <span><b>${approaches.length}</b> seuraavaa aikataulupistettä</span
          ><span><b>${stations.length}</b> liikennepaikkaa</span
          ><button
            class="rail-expand-button"
            aria-pressed=${this.expandedRata}
            @click=${() => (this.expandedRata = !this.expandedRata)}
          >
            ${icon(this.expandedRata ? 'close' : 'external', 14)}
            ${this.expandedRata ? 'Sulje laaja näkymä' : 'Laajenna näkymä'}
          </button>
        </div>
      </div>
      ${alternative && alternative.id !== this.corridor ? html`<div class="traffic-follow-callout">Valittu ${label(selectedTrain!)} ei kuulu tähän rataosaan. <button @click=${() => this.setCorridor(alternative.id)}>Seuraa junaa rataosalla ${alternative.corridor.name}</button></div>` : nothing}
      <div class="rail-notice" role="note">
        ${icon('info', 15)}
        <span
          ><strong>Periaatekaavio.</strong> Suuntakaistat ovat havainnollistavia, eivät todellisia
          raiteita, vaihteita, opastimia tai raidevarauksia. Junamerkki kertoo
          <strong>seuraavan julkaistun aikataulupisteen</strong> — ei junan nykyistä
          sijaintia.</span
        >
      </div>
      <div
        class="rail-schematic-scroll"
        role="region"
        tabindex="0"
        aria-label="Aikataulupisteiden kaavio, vieritä vaakasuunnassa nuolinäppäimillä"
      >
        <div class="rail-schematic-canvas" style=${`width:${width}px`}>
          <svg
            viewBox=${`0 0 ${width} 380`}
            width=${width}
            height="380"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <linearGradient id="rata-rail" x1="0" x2="1">
                <stop offset="0" stop-color="#3b758a" />
                <stop offset="0.5" stop-color="#8bcfc0" />
                <stop offset="1" stop-color="#3b758a" />
              </linearGradient>
              <pattern id="rata-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M32 0H0V32" fill="none" stroke="#2e4556" stroke-width=".7" opacity=".38" />
              </pattern>
            </defs>
            <rect x="0" y="0" width=${width} height="380" fill="url(#rata-grid)" />
            <text x="31" y="49" class="rail-svg-eyebrow">
              SUUNTA → ${this.station(stations.at(-1)!)}
            </text>
            <text x="31" y="348" class="rail-svg-eyebrow">
              ← SUUNTA ${this.station(stations[0])}
            </text>
            <path
              d=${`M ${x(0)} 206 L ${x(0) + 50} 112 H ${x(stations.length - 1) - 50} L ${x(stations.length - 1)} 206`}
              class="rail-branch"
            />
            <path
              d=${`M ${x(0)} 206 L ${x(0) + 50} 301 H ${x(stations.length - 1) - 50} L ${x(stations.length - 1)} 206`}
              class="rail-branch"
            />
            <path d=${`M ${x(0)} 206 H ${x(stations.length - 1)}`} class="rail-main-line" />
            ${stations.map(
              (code, index) =>
                html`<g>
                  <path d=${`M${x(index)} 157 V298`} class="rail-station-guide" />
                  <circle cx=${x(index)} cy="206" r="12" class="rail-station-outer" />
                  <circle cx=${x(index)} cy="206" r="4" class="rail-station-inner" />
                  <text x=${x(index)} y="235" class="rail-station-name" text-anchor="middle"
                    >${this.station(code).slice(0, 17)}</text
                  >
                  <text x=${x(index)} y="256" class="rail-station-code" text-anchor="middle"
                    >${code}</text
                  >
                </g>`,
            )}
          </svg>
          ${markers.map(
            ({ id, items, leading }) =>
              html`<button
                class="rail-train-marker ${leading.direction} ${key(leading.train) === this.selected ? 'active' : ''} ${leading.late !== null && leading.late > 5 ? 'late' : ''}"
                style=${`left:${x(leading.stationIndex)}px;top:${leading.direction === 'forward' ? 112 : 301}px;`}
                aria-label=${`${label(leading.train)}, seuraava aikataulupiste ${this.station(leading.row.stationShortCode)} ${time(leading.expected)}, ${leading.source === 'estimate' ? 'ennuste' : 'vain aikataulu'}${items.length > 1 ? `, ${items.length} junaa samassa ryhmässä` : ''}`}
                aria-pressed=${key(leading.train) === this.selected}
                title=${`${label(leading.train)} · ${this.station(leading.row.stationShortCode)} ${time(leading.expected)} · ${items.length > 1 ? `${items.length} junaa pisteellä` : 'Avaa juna'}`}
                @click=${() => this.openTrain(leading.train)}
              >
                ${icon('train', 12)}
                <b>${label(leading.train)}</b
                >${items.length > 1 ? html`<em>+${items.length - 1}</em>` : nothing}
              </button>`,
          )}
          ${
            selected
              ? html`<div
                  class="rail-selected-callout"
                  style=${`left:${Math.min(width - 190, Math.max(18, x(selected.stationIndex) - 90))}px;`}
                >
                  <b>VALITTU ${label(selected.train)}</b
                  ><span
                    >${this.station(selected.row.stationShortCode)} ${time(selected.expected)} ·
                    ${selected.source === 'estimate' ? 'Ennuste' : 'Aikataulu'}</span
                  >
                </div>`
              : nothing
          }
        </div>
      </div>
      <div class="rail-schematic-list">
        <div class="rail-list-heading">
          <div>
            <span class="eyebrow">JUNIEN SEURAAVAT PISTEET</span>
            <h4>
              ${approaches.length ? 'Seuraavaksi odotettavat tapahtumat' : 'Ei tulevia aikataulupisteitä tällä rataosalla'}
            </h4>
          </div>
          <span>Aikajärjestyksessä · Suomen aika</span>
        </div>
        <div class="rail-schematic-cards">
          ${shown.map(
            (point) =>
              html`<button
                class="rail-approach-card ${key(point.train) === this.selected ? 'active' : ''}"
                @click=${() => this.openTrain(point.train)}
                aria-pressed=${key(point.train) === this.selected}
              >
                <span class="rail-approach-icon">${icon('train', 15)}</span>
                <span class="rail-approach-main"
                  ><b>${label(point.train)}</b
                  ><small
                    >${this.station(point.row.stationShortCode)} ·
                    ${point.direction === 'forward' ? '→' : '←'}
                    ${point.source === 'estimate' ? 'Ennuste' : 'Aikataulu'}</small
                  ></span
                >
                <span class="rail-approach-time"
                  ><b>${time(point.expected)}</b
                  ><small
                    >${point.late === null ? 'Viive ei tiedossa' : point.late > 0 ? `+${point.late} min` : point.late < 0 ? `${point.late} min` : 'Ajallaan'}</small
                  ></span
                >
                ${icon('chevron', 13)}
              </button>`,
          )}
        </div>
        ${approaches.length > 12 ? html`<button class="rail-list-more" @click=${() => (this.showAllSchematic = !this.showAllSchematic)}>${this.showAllSchematic ? 'Näytä vähemmän' : `Näytä kaikki (${approaches.length})`} ${icon('chevron', 13)}</button>` : nothing}
        <p class="traffic-data-caveat">
          Suunta päätellään junan julkaistujen aikataulupisteiden järjestyksestä. Näyttö ei osoita
          liikennöintikelpoisuutta, kulkutietä, opastintilaa eikä todellista raiteistoa.
        </p>
      </div>
    </div>`;
  }
  private makeJourney() {
    const train = this.network.find((item) => key(item) === this.selected);
    if (!train)
      return html`<div class="traffic-journey-empty">
        ${icon('train', 38)}
        <h3>Valitse juna junaluettelosta</h3>
        <p>
          Junan kulku näyttää saman valitun junan aikataulun, toteumat ja seuraavat pysähdykset.
        </p>
      </div>`;
    const all = journeyStops(train);
    const shown = this.showPassThrough ? all : all.filter((stop) => stop.commercial);
    const next = shown.find((stop) => !stop.cancelled && stop.stage !== 'completed');
    const [start, end] = endpoints(train);
    const completed = shown.filter((stop) => stop.stage === 'completed').length;
    return html`<div class="traffic-journey-view">
      <div class="traffic-journey-hero">
        <span class="eyebrow">JUNAN KULKU / VALITTU PALVELU</span>
        <div class="traffic-journey-title">
          <h3>${label(train)}</h3>
          <raide-delay-badge
            .value=${delay(train, this.now)}
            .cancelled=${train.cancelled}
          ></raide-delay-badge>
        </div>
        <p>${this.station(start)} <span>→</span> ${this.station(end)}</p>
        <div class="traffic-journey-stats">
          <span><strong>${completed}/${shown.length}</strong> näytettyä pistettä toteutunut</span
          ><span><strong>${next ? this.station(next.code) : '—'}</strong> seuraava piste</span>
        </div>
        <div class="traffic-journey-progress">
          <i style=${`width:${shown.length ? (completed / shown.length) * 100 : 0}%`}></i>
        </div>
      </div>
      <div class="traffic-journey-controls">
        <label
          ><input
            type="checkbox"
            .checked=${this.showPassThrough}
            @change=${(e: Event) => (this.showPassThrough = (e.target as HTMLInputElement).checked)}
          />
          Näytä myös ohituspaikat</label
        >
        <button @click=${() => this.emit('open-timetable')}>
          Avaa graafinen aikataulu ${icon('chevron', 14)}
        </button>
        <button @click=${() => this.emit('open-journey')}>
          Avaa laaja etenemisnäkymä ${icon('chevron', 14)}
        </button>
      </div>
      <div class="traffic-journey-scroll">
        ${shown.map((stop) => {
          const isNext = stop === next;
          const style = stop.cancelled
            ? 'cancelled'
            : stop.stage === 'completed'
              ? 'completed'
              : stop.stage === 'at-station'
                ? 'at-station'
                : isNext
                  ? 'next'
                  : 'future';
          const planned = stop.arrival?.scheduledTime ?? stop.departure?.scheduledTime;
          const observed =
            stop.arrival?.actualTime ??
            stop.arrival?.liveEstimateTime ??
            stop.departure?.actualTime ??
            stop.departure?.liveEstimateTime;
          return html`<div class="traffic-journey-stop ${style}">
            <div class="traffic-journey-rail"><i></i></div>
            <div class="traffic-journey-stop-main">
              <strong>${this.station(stop.code)}</strong
              ><small
                >${stop.cancelled ? 'Peruttu' : stop.stage === 'completed' ? 'Toteutunut' : stop.stage === 'at-station' ? 'Asemalla' : isNext ? 'Seuraava' : stop.commercial ? 'Tulossa' : 'Ohituspaikka'}</small
              >
            </div>
            <div class="traffic-journey-times">
              <span><small>Aikataulu</small><b>${time(planned)}</b></span
              ><span
                ><small
                  >${stop.source === 'actual' ? 'Toteuma' : stop.source === 'estimate' ? 'Ennuste' : 'Ei ennustetta'}</small
                ><b>${observed ? time(observed) : '—'}</b></span
              >
              <span class="traffic-journey-deviation"
                >${stop.cancelled ? 'Peruttu' : stop.deviation === null ? '—' : `${stop.deviation > 0 ? '+' : ''}${stop.deviation} min`}</span
              >
            </div>
          </div>`;
        })}
        ${shown.length === 0 ? html`<p class="traffic-empty-list">Junalta ei ole saatu aikataulurivejä.</p>` : nothing}
      </div>
      <p class="traffic-data-caveat">
        Junan kulku perustuu julkaistuihin aikataulu-, ennuste- ja toteumatietoihin. Toteutuma ei
        ole jatkuva GPS-seuranta; puuttuvia ennusteita ei oleteta täsmällisiksi. Ei ajo-ohje.
      </p>
    </div>`;
  }
  render() {
    return html`<section
      class="panel traffic-explorer"
      aria-label="Junaliikenteen visualisoinnit"
      data-view=${this.view}
    >
      <header class="traffic-explorer-header">
        <div class="traffic-explorer-heading">
          <span class="traffic-explorer-icon">${icon('layers', 19)}</span>
          <div>
            <h2>Junaliikenne</h2>
            <small>Valitse sinulle sopiva näkymä</small>
          </div>
        </div>
        <div class="traffic-view-switch" role="group" aria-label="Valitse liikenteen esitystapa">
          ${modes.map((mode) => html`<button class=${this.view === mode.id ? 'active' : ''} aria-pressed=${this.view === mode.id} title=${mode.hint} @click=${() => this.setView(mode.id)}>${icon(mode.symbol, 15)}<span>${mode.title}</span></button>`)}
        </div>
      </header>
      <div class="traffic-stage">
        ${this.view === 'map' ? this.makeMap() : this.view === 'schematic' ? this.makeSchematic() : this.view === 'rata' ? this.makeRata() : this.view === 'corridors' ? this.makeCorridors() : this.makeJourney()}
      </div>
    </section>`;
  }
}
customElements.define('raide-traffic-views', TrafficViews);
