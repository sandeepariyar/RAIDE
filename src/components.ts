import { LitElement, html, svg, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { geoMercator, geoPath, geoArea } from 'd3-geo';
import { icon } from './icons';
import {
  gpsObservationAge,
  MAP_CENTER,
  mapViewBoxPoint,
  panMap,
  pinchMapAt,
  zoomMapAt,
  type MapPoint,
} from './hmi-interaction';
import './hmi.css';
import './composition';
import type { Composition } from './composition';
import {
  key,
  label,
  delay,
  endpoints,
  time,
  nextStop,
  stationSequence,
  type Train,
  type Station,
  type Location,
  type Notice,
  type Category,
} from './domain';
class LightElement extends LitElement {
  createRenderRoot() {
    return this;
  }
  emit(name: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
}
export class DelayBadge extends LightElement {
  @property({ type: Number }) value: number | null = null;
  @property({ type: Boolean }) cancelled = false;
  @property({ type: Boolean }) unknownDelay = false;
  render() {
    return html`<span
      class="delay-badge ${this.cancelled ? 'cancelled' : this.value === null ? 'unknown' : this.value > 5 ? 'late' : this.value > 0 ? 'minor' : 'ontime'}"
      >${this.cancelled ? 'Peruttu' : this.value === null ? (this.unknownDelay ? 'Myöhässä' : 'Ei ennustetta') : this.value > 0 ? `+${this.value} min` : this.value < 0 ? `${this.value} min` : 'Ajallaan'}</span
    >`;
  }
}
customElements.define('raide-delay-badge', DelayBadge);
export class DataStatus extends LightElement {
  @property() mode = 'live';
  @property() status = 'loading';
  @property() lastUpdated = '';
  render() {
    return html`<span
      class="data-status ${this.status === 'error' ? 'error' : this.mode === 'recorded' ? 'recorded' : ''}"
      ><span class="status-dot"></span
      >${this.mode === 'recorded' ? 'Tallenne' : this.status === 'loading' ? 'Yhdistetään' : this.status === 'error' ? 'Yhteyshäiriö' : 'Reaaliaikainen'}</span
    >`;
  }
}
customElements.define('raide-data-status', DataStatus);
export class TrainTable extends LightElement {
  @property({ attribute: false }) trains: Train[] = [];
  @property({ attribute: false }) stations = new Map<string, Station>();
  @property({ attribute: false }) locations: Location[] = [];
  @property({ type: Number }) now = Date.now();
  @property() selected = '';
  @property() sort = 'delay';
  @property() heading = 'Junat';
  @state() private limit = 80;
  render() {
    return html`<section class="panel train-panel" aria-label="Junaluettelo">
      <div class="panel-heading">
        <h2>
          ${icon('train', 18)} ${this.heading}<span class="count">${this.trains.length}</span>
        </h2>
        <label class="sort-label"
          ><span class="sr-only">Järjestä junat</span
          ><select
            aria-label="Järjestä junat"
            .value=${this.sort}
            @change=${(e: Event) => this.emit('sort-change', (e.target as HTMLSelectElement).value)}
          >
            <option value="delay">Myöhästyminen</option>
            <option value="number">Junan numero</option>
            <option value="next">Seuraava saapuminen</option>
          </select></label
        >
      </div>
      <div class="train-list scroll-area">
        <table>
          <thead>
            <tr>
              <th scope="col">Juna / reitti</th>
              <th scope="col">Seuraava pysähdys</th>
              <th scope="col">Tilanne</th>
            </tr>
          </thead>
          <tbody>
            ${this.trains.slice(0, this.limit).map((t) => {
              const [a, b] = endpoints(t);
              const stop = nextStop(t, this.now);
              return html`<tr class=${this.selected === key(t) ? 'selected' : ''}>
                <td>
                  <button
                    class="train-select"
                    aria-label=${`${label(t)} ${this.stations.get(a)?.stationName ?? a} – ${this.stations.get(b)?.stationName ?? b}. Näytä junan tiedot.`}
                    aria-pressed=${this.selected === key(t)}
                    @click=${() => this.emit('train-select', key(t))}
                  >
                    <strong
                      ><span
                        class="train-type ${t.trainCategory === 'Commuter' ? 'commuter' : t.trainCategory === 'Cargo' ? 'cargo' : ''}"
                        >${t.commuterLineID || t.trainType}</span
                      >
                      ${t.trainNumber}</strong
                    >
                    <span class="route-small"
                      >${this.stations.get(a)?.stationName ?? a} –
                      ${this.stations.get(b)?.stationName ?? b}</span
                    >
                  </button>
                </td>
                <td>
                  <span class="next-station"
                    >${stop ? (this.stations.get(stop.stationShortCode)?.stationName ?? stop.stationShortCode) : '—'}</span
                  ><span class="muted tiny"
                    >${stop ? time(stop.liveEstimateTime ?? stop.scheduledTime) : t.runningCurrently ? 'Liikenteessä' : 'Ei pysähdystietoa'}</span
                  >
                </td>
                <td>
                  <raide-delay-badge
                    .value=${delay(t, this.now)}
                    .cancelled=${t.cancelled}
                    .unknownDelay=${t.timeTableRows.some((r) => !r.actualTime && r.unknownDelay)}
                  ></raide-delay-badge>
                </td>
              </tr>`;
            })}
          </tbody>
        </table>
        ${
          !this.trains.length
            ? html`<div class="empty-state">
                ${icon('search', 26)}<strong>JUNIA EI LÖYTYNYT</strong>
                <p>Muuta hakua tai liikennelajia.</p>
              </div>`
            : nothing
        }${this.limit < this.trains.length ? html`<button class="load-more" @click=${() => (this.limit += 80)}>Näytä lisää (${this.trains.length - this.limit})</button>` : nothing}
      </div>
    </section>`;
  }
}
customElements.define('raide-train-table', TrainTable);
export class RailMap extends LightElement {
  @property({ attribute: false }) trains: Train[] = [];
  @property({ attribute: false }) network: Train[] = [];
  @property({ attribute: false }) locations: Location[] = [];
  @property({ attribute: false }) stations = new Map<string, Station>();
  @property({ attribute: false }) geography: any = null;
  @property() selected = '';
  @property({ type: Number }) now = Date.now();
  @property() region = 'all';
  @property({ type: Boolean }) showStations = true;
  @state() private zoom = 1;
  @state() private panX = 0;
  @state() private panY = 0;
  @state() private hover = '';
  private cachedNetwork: Train[] | undefined;
  private cachedStationMap: Map<string, Station> | undefined;
  private cachedSegments = new Map<string, [[number, number], [number, number]]>();
  private drag: { x: number; y: number; px: number; py: number; moved: boolean } | null = null;
  private activePointers = new Map<number, MapPoint>();
  private pinch: {
    firstDistance: number;
    anchor: MapPoint;
    viewport: { zoom: number; panX: number; panY: number };
  } | null = null;
  private projection = geoMercator().center([26, 65]).scale(1115).translate([390, 300]);
  private geoReady: any = null;
  private paths: { name: string; d: string }[] = [];
  private position(coords: [number, number]) {
    return this.projection(coords) ?? [0, 0];
  }
  private adjust(d: number, anchor: MapPoint = MAP_CENTER) {
    const next = zoomMapAt({ zoom: this.zoom, panX: this.panX, panY: this.panY }, d, anchor);
    this.zoom = next.zoom;
    this.panX = next.panX;
    this.panY = next.panY;
  }
  private resetViewport() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }
  private handleMapKeys(event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    const distance = event.shiftKey ? 90 : 42;
    const movement: Record<string, [number, number]> = {
      ArrowUp: [0, distance],
      ArrowDown: [0, -distance],
      ArrowLeft: [distance, 0],
      ArrowRight: [-distance, 0],
    };
    if (event.key in movement) {
      const [dx, dy] = movement[event.key];
      const next = panMap({ zoom: this.zoom, panX: this.panX, panY: this.panY }, dx, dy);
      this.panX = next.panX;
      this.panY = next.panY;
    } else if (['+', '=', 'Add'].includes(event.key)) this.adjust(1.25);
    else if (['-', '_', 'Subtract'].includes(event.key)) this.adjust(1 / 1.25);
    else if (event.key === 'Home') this.resetViewport();
    else return;
    event.preventDefault();
  }
  private mapPointerDown(event: PointerEvent) {
    if ((event.target as Element).closest('[data-interactive]')) return;
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    if (this.activePointers.size === 1) {
      this.drag = {
        x: event.clientX,
        y: event.clientY,
        px: this.panX,
        py: this.panY,
        moved: false,
      };
    } else if (this.activePointers.size === 2) {
      const [a, b] = [...this.activePointers.values()];
      const rect = (event.currentTarget as Element).getBoundingClientRect();
      this.pinch = {
        firstDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        anchor: mapViewBoxPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, rect),
        viewport: { zoom: this.zoom, panX: this.panX, panY: this.panY },
      };
      this.drag = null;
    }
  }
  private mapPointerMove(event: PointerEvent) {
    if (!this.activePointers.has(event.pointerId)) return;
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const rect = (event.currentTarget as Element).getBoundingClientRect();
    if (this.pinch && this.activePointers.size === 2) {
      const [a, b] = [...this.activePointers.values()];
      const center = mapViewBoxPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, rect);
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const result = pinchMapAt(
        this.pinch.viewport,
        this.pinch.anchor,
        center,
        distance / this.pinch.firstDistance,
      );
      this.zoom = result.zoom;
      this.panX = result.panX;
      this.panY = result.panY;
    } else if (this.drag && this.activePointers.size === 1) {
      const unitsPerPixel = Math.max(760 / rect.width, 570 / rect.height);
      this.panX = this.drag.px + (event.clientX - this.drag.x) * unitsPerPixel;
      this.panY = this.drag.py + (event.clientY - this.drag.y) * unitsPerPixel;
      this.drag.moved = true;
    }
  }
  private mapPointerEnd(event: PointerEvent) {
    this.activePointers.delete(event.pointerId);
    this.pinch = null;
    const next = this.activePointers.values().next().value as MapPoint | undefined;
    this.drag = next ? { x: next.x, y: next.y, px: this.panX, py: this.panY, moved: false } : null;
  }
  private centerOn(coords: [number, number], zoom = 3) {
    const p = this.position(coords);
    this.zoom = zoom;
    this.panX = 380 - p[0] * zoom;
    this.panY = 285 - p[1] * zoom;
  }
  protected updated(changed: Map<string, unknown>) {
    if (changed.has('region')) {
      if (this.region === 'all') {
        this.resetViewport();
      } else {
        const s = this.stations.get(this.region);
        if (s) this.centerOn([s.longitude, s.latitude], this.region === 'HKI' ? 4.8 : 2.4);
      }
    }
  }
  render() {
    if (this.geography && this.geoReady !== this.geography) {
      this.geoReady = this.geography;
      this.paths = this.geography.features.map((raw: any) => {
        const f = structuredClone(raw);
        if (geoArea(f) > 2 * Math.PI) {
          if (f.geometry.type === 'MultiPolygon')
            f.geometry.coordinates.forEach((p: any) => p.forEach((r: any) => r.reverse()));
          else f.geometry.coordinates.forEach((r: any) => r.reverse());
        }
        return { name: f.properties.name, d: geoPath(this.projection)(f) ?? '' };
      });
    }
    const selectedTrain = this.network.find((t) => key(t) === this.selected);
    const trainsByKey = new Map(this.trains.map((t) => [key(t), t]));
    // Keep a selected service visible even when a separate list filter excludes it.
    if (selectedTrain) trainsByKey.set(key(selectedTrain), selectedTrain);
    const segments = this.cachedSegments;
    if (this.cachedNetwork !== this.network || this.cachedStationMap !== this.stations) {
      segments.clear();
      this.cachedNetwork = this.network;
      this.cachedStationMap = this.stations;
      for (const t of this.network) {
        const seq = stationSequence(t);
        for (let i = 1; i < seq.length; i++) {
          const a = this.stations.get(seq[i - 1]),
            b = this.stations.get(seq[i]);
          if (!a || !b || a.countryCode !== 'FI' || b.countryCode !== 'FI') continue;
          const pair = [seq[i - 1], seq[i]].sort().join('-');
          if (!segments.has(pair))
            segments.set(pair, [
              this.position([a.longitude, a.latitude]) as [number, number],
              this.position([b.longitude, b.latitude]) as [number, number],
            ]);
        }
      }
    }
    const highlight = selectedTrain
      ? stationSequence(selectedTrain)
          .map((c) => this.stations.get(c))
          .filter((s): s is Station => !!s)
          .map((s) => this.position([s.longitude, s.latitude]).join(','))
          .join(' ')
      : '';
    const major = [
      'HKI',
      'TKU',
      'TPE',
      'LH',
      'KV',
      'LR',
      'JNS',
      'KUO',
      'JY',
      'SK',
      'VS',
      'KOK',
      'YV',
      'OL',
      'KAJ',
      'KEM',
      'ROI',
      'KLI',
      'KJÄ',
      'MI',
      'PRI',
      'RI',
    ];
    const eligible = this.locations.filter(
      (l) =>
        trainsByKey.has(key(l)) &&
        Date.parse(l.timestamp) >= this.now - 10 * 60_000 &&
        Date.parse(l.timestamp) <= this.now + 60_000,
    );
    const selectedLocation = eligible.find((l) => key(l) === this.selected);
    const selectedAge = selectedLocation
      ? gpsObservationAge(selectedLocation.timestamp, this.now)
      : null;
    const selectedOutsideFilter =
      !!selectedLocation && !this.trains.some((train) => key(train) === this.selected);
    const cells = new Map<string, Location[]>();
    for (const l of eligible) {
      if (key(l) === this.selected) continue;
      const [x, y] = this.position(l.location.coordinates);
      const cell = `${Math.floor((x * this.zoom) / 16)},${Math.floor((y * this.zoom) / 16)}`;
      const group = cells.get(cell) ?? [];
      group.push(l);
      cells.set(cell, group);
    }
    const clusters = [...cells.values()].filter((g) => g.length > 1);
    const clusterKeys = new Set(clusters.flat().map(key));
    const hovered = this.hover ? trainsByKey.get(this.hover) : null;
    return html`<section class="panel map-panel" aria-label="Junien sijainnit kartalla">
      <div class="panel-heading">
        <h2>${icon('map', 18)} Junaliikenne kartalla</h2>
        <span class="map-caption"
          >Suomi <span class="subtle-divider">/</span> ${eligible.length} tuoretta
          GPS-havaintoa</span
        >
      </div>
      <div class="map-canvas">
        <svg
          class="rail-map"
          viewBox="0 0 760 570"
          role="group"
          tabindex="0"
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - Home"
          aria-label="Suomen kartta. Nuolinäppäimillä siirretään, plus- ja miinusnäppäimillä lähennetään ja loitonnetaan. Home näyttää koko Suomen. Junat voi valita myös junaluettelosta."
          @keydown=${(event: KeyboardEvent) => this.handleMapKeys(event)}
          @wheel=${(e: WheelEvent) => {
            if (e.ctrlKey) {
              e.preventDefault();
              const bounds = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              this.adjust(
                e.deltaY < 0 ? 1.12 : 1 / 1.12,
                mapViewBoxPoint({ x: e.clientX, y: e.clientY }, bounds),
              );
            }
          }}
          @pointerdown=${(e: PointerEvent) => this.mapPointerDown(e)}
          @pointermove=${(e: PointerEvent) => this.mapPointerMove(e)}
          @pointerup=${(e: PointerEvent) => this.mapPointerEnd(e)}
          @pointercancel=${(e: PointerEvent) => this.mapPointerEnd(e)}
        >
          <defs>
            <pattern id="map-grid" width="38" height="38" patternUnits="userSpaceOnUse">
              <path
                d="M38 0H0V38"
                fill="none"
                stroke="#243248"
                stroke-opacity=".18"
                stroke-width=".6"
              />
            </pattern>
            <filter id="selected-glow"><feGaussianBlur stdDeviation="3" /></filter>
          </defs>
          <rect width="760" height="570" fill="url(#map-grid)" />
          <g transform=${`translate(${this.panX} ${this.panY}) scale(${this.zoom})`}>
            ${this.paths.map((p) => svg`<path d=${p.d} class=${p.name === 'Finland' ? 'land finland' : 'land'} vector-effect="non-scaling-stroke"/>`)}
            ${[...segments.values()].map(([a, b]) => svg`<line x1=${a[0]} y1=${a[1]} x2=${b[0]} y2=${b[1]} class="network-line" vector-effect="non-scaling-stroke"/>`)}
            ${highlight ? svg`<polyline points=${highlight} fill="none" stroke="#6de2b7" stroke-width="6" opacity=".14" vector-effect="non-scaling-stroke"/><polyline points=${highlight} class="selected-route" vector-effect="non-scaling-stroke"/>` : nothing}
            <text x="235" y="345" class="country-label" transform=${`rotate(-20 235 345)`}>
              RUOTSI
            </text>
            <text x="630" y="350" class="country-label">VENÄJÄ</text>
            <text x="365" y="275" class="country-label finland-label">SUOMI</text>
            <text x="275" y="410" class="sea-label" transform="rotate(-38 275 410)">
              Pohjanlahti
            </text>
            ${
              this.showStations
                ? major.map((c) => {
                    const s = this.stations.get(c);
                    if (!s) return nothing;
                    const [x, y] = this.position([s.longitude, s.latitude]);
                    return svg`<g class="map-station" data-interactive="true" role="button" tabindex="0" aria-label=${`Valitse liikennepaikka ${s.stationName}`} @click=${() => this.emit('station-select', c)} @keydown=${(
                      event: KeyboardEvent,
                    ) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        this.emit('station-select', c);
                      }
                    }}><circle class="hmi-hit-target" cx=${x} cy=${y} r=${16 / this.zoom}/><circle cx=${x} cy=${y} r=${2.7 / Math.sqrt(this.zoom)} class="station-dot"/><text x=${x + 7 / Math.sqrt(this.zoom)} y=${y + 4 / Math.sqrt(this.zoom)} font-size=${12 / Math.sqrt(this.zoom)}>${s.stationName.replace(' asema', '')}</text><title>${s.stationName}</title></g>`;
                  })
                : nothing
            }
            ${clusters.map((group) => {
              const points = group.map((l) => this.position(l.location.coordinates));
              const x = points.reduce((a, p) => a + p[0], 0) / points.length,
                y = points.reduce((a, p) => a + p[1], 0) / points.length;
              const zoomIntoCluster = () =>
                this.centerOn(
                  this.projection.invert!([x, y]) as [number, number],
                  Math.min(8, this.zoom * 2),
                );
              return svg`<g class="map-cluster" data-interactive="true" role="button" tabindex="0" aria-label=${`Näytä alueen ${group.length} junaa`} @click=${zoomIntoCluster} @keydown=${(
                event: KeyboardEvent,
              ) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  zoomIntoCluster();
                }
              }}><circle class="hmi-hit-target" cx=${x} cy=${y} r=${18 / this.zoom}/><circle class="hmi-visible-marker" cx=${x} cy=${y} r=${11 / Math.sqrt(this.zoom)} fill="#223e55" stroke="#77acd0" stroke-width=${1 / Math.sqrt(this.zoom)}/><text x=${x} y=${y + 3.5 / Math.sqrt(this.zoom)} text-anchor="middle" fill="#c9e5f6" font-size=${10 / Math.sqrt(this.zoom)}>${group.length}</text><title>${group.length} junaa. Lähennä aluetta valitsemalla.</title></g>`;
            })}
            ${eligible
              .filter((l) => !clusterKeys.has(key(l)))
              .map((l) => {
                const t = trainsByKey.get(key(l))!;
                const [x, y] = this.position(l.location.coordinates);
                const isSelected = this.selected === key(l);
                const late = (delay(t, this.now) ?? 0) > 5;
                const r = (isSelected ? 7 : 4.3) / Math.sqrt(this.zoom);
                const age = gpsObservationAge(l.timestamp, this.now);
                const markerColor = isSelected
                  ? '#96f5cf'
                  : late
                    ? '#eab36c'
                    : t.trainCategory === 'Cargo'
                      ? '#ac9de7'
                      : ['Commuter', 'Long-distance'].includes(t.trainCategory)
                        ? '#68a8eb'
                        : '#9aaabc';
                return svg`<g class="map-train ${isSelected ? 'active' : ''}" data-interactive="true" role="button" tabindex="0" aria-label=${`Valitse ${label(t)}; GPS ${time(l.timestamp)}`} @click=${() => this.emit('train-select', key(l))} @keydown=${(
                  event: KeyboardEvent,
                ) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this.emit('train-select', key(l));
                  }
                }} @pointerenter=${() => (this.hover = key(l))} @pointerleave=${() => (this.hover = '')}>
                  <circle class="hmi-hit-target" cx=${x} cy=${y} r=${16 / this.zoom}/>
                  ${isSelected ? svg`<circle cx=${x} cy=${y} r=${r * 2.2} fill="#6de2b7" opacity=".12"/>` : nothing}
                  <circle class="hmi-visible-marker" cx=${x} cy=${y} r=${r} fill=${markerColor} stroke="#102132" stroke-width=${1.5 / Math.sqrt(this.zoom)}/>
                  ${isSelected ? svg`<g transform=${`translate(${x + 12 / Math.sqrt(this.zoom)} ${y - 22 / Math.sqrt(this.zoom)}) scale(${1 / Math.sqrt(this.zoom)})`}><rect x="-3" y="-13" width="69" height="25" rx="5" fill="#87edc4"/><text x="31" y="4" text-anchor="middle" class="selected-train-label">${label(t)}</text></g>` : nothing}
                  <title>${label(t)} · ${Math.round(l.speed)} km/h · GPS ${time(l.timestamp)}${age === null ? '' : ` · havainto ${age} min vanha`}</title>
                </g>`;
              })}
          </g>
        </svg>
        <div class="map-top-overlay">
          <span class="map-label">${icon('layers', 14)} REITTIYHTEYDET</span
          ><span class="muted tiny">Yhteydet aikataulutiedoista</span>
          <span class="hmi-map-help"
            >Nuolet: siirrä · +/−: zoomaa · Home: palauta · Ctrl + rulla: zoomaa osoittimeen</span
          >
          ${
            selectedLocation && selectedTrain
              ? html`<span class="hmi-map-selected-observation">
                  <strong>${label(selectedTrain)}</strong>
                  <span
                    >GPS
                    ${time(selectedLocation.timestamp)}${selectedAge === null ? '' : ` · ${selectedAge} min sitten`}</span
                  >
                </span>`
              : nothing
          }
          ${selectedOutsideFilter ? html`<span class="hmi-map-filter-note">Valittu juna näkyy kartalla myös hakurajauksen ulkopuolella.</span>` : nothing}
        </div>
        <div class="map-controls">
          <button
            class="icon-button"
            aria-label="Lähennä karttaa"
            title="Lähennä"
            @click=${() => this.adjust(1.3)}
          >
            ${icon('plus')}</button
          ><button
            class="icon-button"
            aria-label="Loitonna karttaa"
            title="Loitonna"
            @click=${() => this.adjust(1 / 1.3)}
          >
            ${icon('minus')}</button
          ><span></span
          ><button
            class="icon-button"
            aria-label="Näytä koko Suomi"
            title="Näytä koko Suomi"
            @click=${() => this.resetViewport()}
          >
            ${icon('target')}
          </button>
          ${
            selectedLocation && selectedTrain
              ? html`<button
                  class="icon-button"
                  aria-label=${`Kohdista kartta junan ${label(selectedTrain)} viimeisimpään GPS-havaintoon`}
                  title="Kohdista valittuun junaan (GPS)"
                  @click=${() => this.centerOn(selectedLocation.location.coordinates, Math.max(3, this.zoom))}
                >
                  ${icon('pin')}
                </button>`
              : nothing
          }
        </div>
        ${
          hovered
            ? html`<div class="map-tooltip">
                <strong>${label(hovered)}</strong
                ><span
                  >${endpoints(hovered)
                    .map((c) => this.stations.get(c)?.stationName ?? c)
                    .join(' – ')}</span
                >
                ${(() => {
                  const observation = eligible.find((item) => key(item) === this.hover);
                  if (!observation) return nothing;
                  const age = gpsObservationAge(observation.timestamp, this.now);
                  return html`<span class="hmi-observation-source"
                    >GPS ${time(observation.timestamp)}${age === null ? '' : ` · ${age} min sitten`}
                    · ${Math.round(observation.speed)} km/h</span
                  >`;
                })()}
              </div>`
            : nothing
        }
        <div class="map-legend">
          <span><i class="legend-dot blue"></i>Henkilöliikenne</span
          ><span><i class="legend-dot purple"></i>Tavaraliikenne</span
          ><span><i class="legend-dot gray"></i>Muu liikenne</span
          ><span><i class="legend-dot amber"></i>Yli 5 min myöhässä</span>
        </div>
        <span class="map-credit">Pohjakartta: Natural Earth · Sijainnit: Digitraffic</span>
      </div>
    </section>`;
  }
}
customElements.define('raide-map', RailMap);
export class TrainDetail extends LightElement {
  @property({ attribute: false }) composition: Composition | undefined;
  @property() compositionStatus = 'idle';
  @property() mode = 'live';
  @state() private tab = 'timetable';
  protected updated(changed: Map<string, unknown>) {
    if (changed.has('train') && this.tab === 'composition')
      this.emit('composition-request', this.train ? key(this.train) : '');
  }

  @property({ attribute: false }) train: Train | undefined;
  @property({ attribute: false }) stationMap = new Map<string, Station>();
  @property({ attribute: false }) location: Location | undefined;
  @property({ type: Number }) now = Date.now();
  @property({ attribute: false }) notices: Notice[] = [];
  render() {
    const t = this.train;
    if (!t)
      return html`<section class="panel detail-panel">
        <div class="empty-state">
          ${icon('train', 30)}<strong>Valitse juna</strong>
          <p>Valitse juna kartalta tai luettelosta.</p>
        </div>
      </section>`;
    const [a, b] = endpoints(t);
    const stop = nextStop(t, this.now);
    const rows = t.timeTableRows.filter(
      (r, i) => r.commercialStop && (r.type === 'ARRIVAL' || i === 0),
    );
    const loc = this.location;
    const fresh =
      loc &&
      Date.parse(loc.timestamp) >= this.now - 10 * 60_000 &&
      Date.parse(loc.timestamp) <= this.now + 60_000;
    const notice = this.notices.find(
      (n) =>
        n.trainNumber === t.trainNumber &&
        (!n.trainDepartureDate || n.trainDepartureDate === t.departureDate),
    );
    return html`<section class="panel detail-panel" aria-label=${`${label(t)} tiedot`}>
      <div class="detail-header">
        <div>
          <span class="eyebrow">VALITTU JUNA</span>
          <h2>
            ${label(t)}
            <raide-delay-badge
              .value=${delay(t, this.now)}
              .cancelled=${t.cancelled}
              .unknownDelay=${t.timeTableRows.some((r) => !r.actualTime && r.unknownDelay)}
            ></raide-delay-badge>
          </h2>
          <p>
            ${this.stationMap.get(a)?.stationName ?? a}<span class="route-dash">—</span
            >${this.stationMap.get(b)?.stationName ?? b}
          </p>
        </div>
        <button
          class="icon-button"
          title="Avaa junan aikataulu"
          aria-label="Avaa junan aikataulu"
          @click=${() => this.emit('open-timetable', key(t))}
        >
          ${icon('chart')}
        </button>
      </div>
      ${
        this.tab === 'timetable'
          ? html`<div class="detail-metrics">
                <div>
                  <span>Nopeus</span
                  ><strong>${fresh ? Math.round(loc!.speed) : '—'} <small>km/h</small></strong>
                </div>
                <div>
                  <span>Seuraava pysähdys</span
                  ><strong class="stop-name"
                    >${stop ? (this.stationMap.get(stop.stationShortCode)?.stationName ?? stop.stationShortCode) : '—'}</strong
                  >
                </div>
                <div>
                  <span>Ennuste</span><strong>${stop ? time(stop.liveEstimateTime) : '—'}</strong>
                </div>
              </div>
              ${notice ? html`<div class="inline-notice">${icon('info', 16)}<span>Junaan liittyvä tiedote</span><button @click=${() => this.emit('open-notice', notice.id)}>Näytä</button></div>` : nothing}`
          : nothing
      }
      <div class="detail-tabs" role="group" aria-label="Junan tietonäkymä">
        <button
          class=${this.tab === 'timetable' ? 'active' : ''}
          @click=${() => (this.tab = 'timetable')}
        >
          Aikataulu</button
        ><button
          class=${this.tab === 'composition' ? 'active' : ''}
          @click=${() => {
            this.tab = 'composition';
            this.emit('composition-request', key(t));
          }}
        >
          Kokoonpano
        </button>
      </div>
      ${
        this.tab === 'composition'
          ? html`<raide-composition
              .data=${this.composition}
              .stations=${this.stationMap}
              .status=${this.compositionStatus}
              .mode=${this.mode}
            ></raide-composition>`
          : html`<div
              class="stop-list scroll-area"
              tabindex="0"
              role="region"
              aria-label="Junan pysähdykset"
            >
              <table>
                <thead>
                  <tr>
                    <th>Liikennepaikka</th>
                    <th>Aikataulu</th>
                    <th>Ennuste / toteuma</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(
                    (r) =>
                      html`<tr class=${r.actualTime ? 'passed' : stop === r ? 'next' : ''}>
                        <td>
                          <span class="stop-marker"></span
                          >${this.stationMap.get(r.stationShortCode)?.stationName ?? r.stationShortCode}
                        </td>
                        <td>${time(r.scheduledTime)}</td>
                        <td
                          class=${r.cancelled ? 'text-amber' : r.actualTime ? 'muted' : 'text-mint'}
                        >
                          ${r.cancelled ? 'Peruttu' : r.actualTime ? html`${time(r.actualTime)} ${icon('check', 12)}` : time(r.liveEstimateTime)}
                        </td>
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>`
      }
      <div class="detail-footer">
        ${icon('pin', 12)}
        ${fresh ? `Sijainti päivitetty klo ${time(loc!.timestamp)}` : 'Ajantasaista sijaintitietoa ei ole saatavilla'}
      </div>
    </section>`;
  }
}
customElements.define('raide-train-detail', TrainDetail);
