import { LitElement, html, svg, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { date, label, time, type Location, type Station, type Train } from './domain';
import { icon } from './icons';
import { buildTrainProgress, type TrainProgressModel } from './train-progress-model';
import type { JourneyStop } from './network-analytics';
import './train-progress.css';

type ProgressMode = 'route' | 'location';

interface GeoPoint {
  code: string;
  name: string;
  x: number;
  y: number;
  stage: JourneyStop['stage'];
  cancelled: boolean;
}

export class TrainProgressView extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) train: Train | undefined;
  @property({ attribute: false }) locations: Location[] = [];
  @property({ attribute: false }) stations = new Map<string, Station>();
  @property({ type: Number }) now = Date.now();
  @property() mode: 'live' | 'recorded' = 'live';
  @state() private view: ProgressMode = 'route';
  @state() private selectedCode = '';
  @state() private showAllStops = false;

  private station(code: string) {
    return this.stations.get(code)?.stationName.replace(/ asema$/, '') ?? code;
  }

  private eventLabel(stop: JourneyStop) {
    if (stop.cancelled) return 'Peruttu';
    if (stop.stage === 'at-station') return 'Saapuminen vahvistettu';
    if (stop.stage === 'completed') return 'Toteutunut';
    return stop.source === 'estimate' ? 'Ennuste' : 'Aikataulu';
  }

  private eventTime(stop: JourneyStop) {
    const actual = stop.arrival?.actualTime ?? stop.departure?.actualTime;
    const estimate = stop.arrival?.liveEstimateTime ?? stop.departure?.liveEstimateTime;
    const scheduled = stop.arrival?.scheduledTime ?? stop.departure?.scheduledTime;
    return stop.source === 'actual'
      ? (actual ?? scheduled)
      : stop.source === 'estimate'
        ? (estimate ?? scheduled)
        : scheduled;
  }

  private plot(progress: TrainProgressModel) {
    const raw = progress.stops
      .map((stop) => {
        const station = this.stations.get(stop.code);
        return station && Number.isFinite(station.latitude) && Number.isFinite(station.longitude)
          ? {
              code: stop.code,
              name: this.station(stop.code),
              lat: station.latitude,
              lon: station.longitude,
              stage: stop.stage,
              cancelled: stop.cancelled,
            }
          : null;
      })
      .filter((point): point is NonNullable<typeof point> => point !== null);
    if (raw.length < 2) return null;
    const gps = progress.gps;
    const coords = raw.map((point) => [point.lon, point.lat] as const);
    if (gps) coords.push(gps.location.coordinates);
    const west = Math.min(...coords.map((point) => point[0]));
    const east = Math.max(...coords.map((point) => point[0]));
    const south = Math.min(...coords.map((point) => point[1]));
    const north = Math.max(...coords.map((point) => point[1]));
    const spanX = Math.max(0.05, east - west);
    const spanY = Math.max(0.05, north - south);
    const x = (longitude: number) => 70 + ((longitude - west) / spanX) * 600;
    const y = (latitude: number) => 225 - ((latitude - south) / spanY) * 165;
    const points: GeoPoint[] = raw.map((point) => ({
      ...point,
      x: x(point.lon),
      y: y(point.lat),
    }));
    const gpsPoint = gps
      ? { x: x(gps.location.coordinates[0]), y: y(gps.location.coordinates[1]) }
      : null;
    return { points, gpsPoint };
  }

  private renderSelected(stop: JourneyStop) {
    const planned = stop.arrival?.scheduledTime ?? stop.departure?.scheduledTime;
    const actual = stop.arrival?.actualTime ?? stop.departure?.actualTime;
    const estimate = stop.arrival?.liveEstimateTime ?? stop.departure?.liveEstimateTime;
    return html`<div class="progress-stop-inspector" aria-live="polite">
      <div class="progress-inspector-location">
        <span class="progress-eyebrow">VALITTU AIKATAULUPISTE</span>
        <h4>${this.station(stop.code)}</h4>
        <span class="progress-source ${stop.source}">${this.eventLabel(stop)}</span>
      </div>
      <div class="progress-inspector-times">
        <span><small>Aikataulu</small><b>${time(planned)}</b></span
        ><span><small>Toteuma</small><b>${actual ? time(actual) : '—'}</b></span
        ><span><small>Ennuste</small><b>${!actual && estimate ? time(estimate) : '—'}</b></span
        ><span
          ><small>Aikaero</small
          ><b
            >${stop.deviation === null ? 'Ei tiedossa' : `${stop.deviation > 0 ? '+' : ''}${stop.deviation} min`}</b
          ></span
        >
      </div>
    </div>`;
  }

  private renderRoute(progress: TrainProgressModel) {
    const stops = progress.stops;
    const inspected =
      stops.find((stop) => stop.code === this.selectedCode) ??
      progress.current ??
      progress.next ??
      stops.at(-1);
    const shown = this.showAllStops
      ? stops
      : stops.length > 16
        ? [
            ...stops.slice(0, 5),
            ...stops.filter((stop) => stop === progress.next),
            ...stops.slice(-5),
          ].filter((stop, index, all) => all.indexOf(stop) === index)
        : stops;
    return html`<div class="progress-route-stage">
      <div class="progress-track-header">
        <strong>Junan aikataulureitti</strong
        ><span
          >${progress.completed}/${progress.total} vahvistettua kulkupistettä · ei
          GPS-etäisyysmitta</span
        >
      </div>
      <div
        class="progress-route-scroll"
        tabindex="0"
        role="region"
        aria-label="Junan asematapahtumat, vaakavieritys nuolinäppäimillä"
      >
        <div
          class="progress-stop-track"
          role="group"
          aria-label="Valitse liikennepaikka nähdäksesi aikataulu- ja toteumatiedot"
        >
          ${shown.map((stop, index) => {
            const current = inspected === stop;
            const phase = stop.cancelled ? 'cancelled' : stop.stage;
            return html`<button
              class="progress-track-stop ${phase} ${current ? 'is-selected' : ''}"
              aria-pressed=${current}
              aria-label=${`${this.station(stop.code)}, ${this.eventLabel(stop)}, ${time(this.eventTime(stop))}`}
              @click=${() => (this.selectedCode = stop.code)}
            >
              <span class="progress-stop-connector" aria-hidden="true"></span>
              <span class="progress-stop-node" aria-hidden="true"
                >${stop.stage === 'completed' && !stop.cancelled ? icon('check', 13) : stop.cancelled ? icon('close', 12) : icon('train', 12)}</span
              >
              <strong>${this.station(stop.code)}</strong>
              <time>${time(this.eventTime(stop))}</time>
              <small>${this.eventLabel(stop)}</small>
            </button>`;
          })}
        </div>
      </div>
      ${stops.length > 16 ? html`<button class="progress-toggle-all" @click=${() => (this.showAllStops = !this.showAllStops)}>${this.showAllStops ? 'Näytä tiivis reitti' : `Näytä kaikki ${stops.length} liikennepaikkaa`}</button>` : nothing}
      ${inspected ? this.renderSelected(inspected) : html`<div class="progress-empty-details">Julkaistuja liikennepaikkatapahtumia ei ole saatavilla.</div>`}
    </div>`;
  }

  private renderLocation(progress: TrainProgressModel) {
    const geometry = this.plot(progress);
    const gps = progress.gps;
    return html`<div class="progress-location-stage">
      <div class="progress-location-visual">
        <div class="progress-geo-heading">
          <strong>Julkaistu reitti ja GPS-havainto</strong
          ><small>Sijainti koordinaatteina · pohjoinen ylöspäin</small>
        </div>
        ${
          geometry
            ? html`<svg
                viewBox="0 0 740 275"
                role="img"
                aria-label=${`Asemien sijainnit maantieteellisin koordinaatein ja ${gps ? `junan viimeisin GPS-havainto ${time(gps.timestamp)}` : 'ei GPS-havaintoa'}. Yhteysviivat eivät ole ratageometriaa.`}
              >
                <defs>
                  <pattern
                    id="progress-geo-grid"
                    width="28"
                    height="28"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M28 0H0V28"
                      fill="none"
                      stroke="#34556b"
                      stroke-width=".8"
                      opacity=".45"
                    />
                  </pattern>
                </defs>
                <rect width="740" height="275" fill="url(#progress-geo-grid)" />
                <text
                  x="708"
                  y="29"
                  text-anchor="end"
                  fill="#7dafc3"
                  font-size="12"
                  font-family="IBM Plex Mono"
                >
                  N ↑
                </text>
                <polyline
                  points=${geometry.points.map((point) => `${point.x},${point.y}`).join(' ')}
                  fill="none"
                  stroke="#6695ab"
                  stroke-width="2.5"
                  stroke-dasharray="6 5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                ${geometry.points.map((point, index) => svg`<g><circle cx=${point.x} cy=${point.y} r=${point.cancelled ? 4 : point.stage === 'completed' ? 5.5 : 4.5} fill=${point.cancelled ? '#8b7385' : point.stage === 'completed' ? '#70d9bb' : '#a2b8c8'} stroke="#122d3d" stroke-width="2"/><title>${point.name}: ${point.cancelled ? 'peruttu' : point.stage === 'completed' ? 'toteutunut' : 'aikataulupiste'}</title>${index === 0 || index === geometry.points.length - 1 || index % Math.max(1, Math.ceil(geometry.points.length / 7)) === 0 ? svg`<text x=${point.x} y=${point.y - 12} text-anchor="middle" fill="#d2eaf0" font-size="11">${point.name.slice(0, 14)}</text>` : nothing}</g>`)}
                ${geometry.gpsPoint ? svg`<g><circle cx=${geometry.gpsPoint.x} cy=${geometry.gpsPoint.y} r="15" fill=${progress.gpsStatus === 'fresh' ? '#63e2bd' : '#dfa977'} opacity=".17"/><circle cx=${geometry.gpsPoint.x} cy=${geometry.gpsPoint.y} r="7" fill=${progress.gpsStatus === 'fresh' ? '#80f9cd' : '#dfa977'} stroke="#0d3d3f" stroke-width="3"/><title>${progress.gpsStatus === 'fresh' ? 'Tuore' : 'Vanhentunut'} GPS-havainto ${time(gps!.timestamp)}</title></g>` : nothing}
              </svg>`
            : html`<div class="progress-map-unavailable">
                Asemille ei ole riittävästi koordinaatteja tämän näkymän piirtämiseen.
              </div>`
        }
        <p class="progress-geo-caveat">
          Asemien väliset viivat yhdistävät sijaintipisteitä havainnollistavasti. Ne eivät ole
          todellinen ratageometria eivätkä ilmaise liikennöintilupaa tai raidevarausta.
        </p>
      </div>
      <div class="progress-gps-evidence ${progress.gpsStatus}">
        <span class="progress-eyebrow"
          >${progress.gpsStatus === 'fresh' ? 'TUORE GPS-HAVAINTO' : progress.gpsStatus === 'stale' ? 'VIIMEISIN GPS-HAVAINTO · VANHENTUNUT' : 'GPS-HAVAINTOA EI SAATAVILLA'}</span
        >
        ${
          gps
            ? html`<h4>
                  ${gps.location.coordinates[1].toFixed(4)}° N
                  <span>·</span> ${gps.location.coordinates[0].toFixed(4)}° E
                </h4>
                <p>
                  ${date(gps.timestamp)} klo ${time(gps.timestamp)} · ${progress.gpsAgeMinutes} min
                  vanha
                </p>
                <div class="progress-gps-speed">
                  <small>Nopeus havaintohetkellä</small
                  ><b
                    >${Number.isFinite(gps.speed) ? `${Math.round(gps.speed)} km/h` : 'Ei tietoa'}</b
                  >
                </div>`
            : html`<h4>Ei sijaintihavaintoa</h4>
                <p>Junan sijaintia ei voida vahvistaa. Aikataulutiedot ovat erillisiä.</p>`
        }
        <p class="progress-gps-clarification">
          ${progress.gpsStatus === 'fresh' ? 'Piste näyttää viimeisimmän vastaanotetun sijainnin, ei jatkuvasti ennustettua nykyhetken sijaintia.' : 'Vanhentunutta tai puuttuvaa GPS-tietoa ei käytetä nykyisen sijainnin arviointiin.'}
        </p>
      </div>
    </div>`;
  }

  render() {
    const train = this.train;
    if (!train)
      return html`<section class="train-progress-shell progress-no-train">
        <span class="progress-eyebrow">JUNAN ETENEMINEN</span>
        <h3>Valitse seurattava juna</h3>
        <p>
          Junan lähtö, toteutuneet pisteet, viimeisin GPS-havainto, seuraava piste ja määränpää
          tulevat samaan näkymään.
        </p>
      </section>`;
    const progress = buildTrainProgress(train, this.locations, this.now);
    const next = progress.next;
    return html`<section
      class="train-progress-shell"
      aria-label=${`${label(train)} eteneminen ja viimeisin GPS-sijainti`}
    >
      <div class="progress-hero">
        <header class="progress-hero-top">
          <div>
            <span class="progress-eyebrow"
              >JUNAN ETENEMINEN ·
              ${this.mode === 'live' ? 'REAALIAIKAINEN AINEISTO' : 'TALLENNETTU AINEISTO'}</span
            >
            <h3>
              ${label(train)}
              <small
                >${this.station(progress.origin)} — ${this.station(progress.destination)}</small
              >
            </h3>
          </div>
          <span class="progress-source-pill ${progress.cancelled ? 'cancelled' : 'active'}"
            >${progress.cancelled ? 'Juna peruttu' : 'Aikatauluseuranta'}</span
          >
        </header>
        <div class="progress-journey-grid">
          <div class="progress-journey-point origin">
            <span class="progress-point-label">Lähtö</span
            ><strong>${this.station(progress.origin)}</strong
            ><small>${progress.stops[0] ? time(this.eventTime(progress.stops[0])) : '—'}</small>
          </div>
          <div class="progress-journey-point observation">
            <span class="progress-point-label">Viimeisin sijaintitieto</span
            ><strong
              >${progress.gpsStatus === 'fresh' ? 'GPS-havainto' : progress.gpsStatus === 'stale' ? 'Vanhentunut GPS' : 'Ei GPS-tietoa'}</strong
            ><small
              >${progress.gps ? `Havaittu ${time(progress.gps.timestamp)} · ${progress.gpsAgeMinutes} min` : 'Sijainti tuntematon'}</small
            >
          </div>
          <div class="progress-journey-point next">
            <span class="progress-point-label">Seuraava aikataulupiste</span
            ><strong>${next ? this.station(next.code) : '—'}</strong
            ><small
              >${next ? `${this.eventLabel(next)} · ${time(this.eventTime(next))}` : 'Ei seuraavia pisteitä'}</small
            >
          </div>
          <div class="progress-journey-point destination">
            <span class="progress-point-label">Määränpää</span
            ><strong>${this.station(progress.destination)}</strong
            ><small
              >${progress.stops.at(-1) ? `Aikataulu ${time(progress.stops.at(-1)!.scheduled)}` : '—'}</small
            >
          </div>
        </div>
        <div class="progress-completion">
          <div class="progress-completion-meta">
            <span
              >Vahvistetut liikennepaikat
              <b>${progress.completed}/${progress.total}</b
              >${progress.current ? html`<span class="progress-confirmed-label"> · Saapuminen ${this.station(progress.current.code)} vahvistettu ${time(progress.current.observed)}; lähtöä ei vahvistettu</span>` : progress.lastConfirmed ? html`<span class="progress-confirmed-label"> · Viimeisin ${this.station(progress.lastConfirmed.code)} ${time(progress.lastConfirmed.observed)}</span>` : nothing}</span
            ><small>Vain toteutuneet asematapahtumat · ei GPS-pohjainen etäisyys</small>
          </div>
          <div
            class="progress-completion-meter"
            role="progressbar"
            aria-label="Vahvistettujen liikennepaikkojen osuus"
            aria-valuemin="0"
            aria-valuemax=${Math.max(progress.total, 1)}
            aria-valuenow=${progress.completed}
          >
            <i
              style=${`width:${progress.total ? (100 * progress.completed) / progress.total : 0}%`}
            ></i>
          </div>
        </div>
      </div>
      <div class="progress-body">
        <div class="progress-tabs" role="group" aria-label="Junan etenemisen esitystapa">
          <button
            class=${this.view === 'route' ? 'active' : ''}
            aria-pressed=${this.view === 'route'}
            @click=${() => (this.view = 'route')}
          >
            ${icon('train', 15)} Reitti ja tapahtumat</button
          ><button
            class=${this.view === 'location' ? 'active' : ''}
            aria-pressed=${this.view === 'location'}
            @click=${() => (this.view = 'location')}
          >
            ${icon('map', 15)} GPS ja sijainti
          </button>
        </div>
        ${this.view === 'route' ? this.renderRoute(progress) : this.renderLocation(progress)}
      </div>
      <p class="progress-footnote">
        Lähtö- ja määräpaikka sekä ennusteet perustuvat julkaistuun aikatauluun. Toteutuneet
        liikennepaikat ja GPS-havainnot ovat eri tietolähteitä; nykyistä raidesijaintia ei päätellä.
        Ajat Suomen aikaa.
      </p>
    </section>`;
  }
}

customElements.define('raide-train-progress', TrainProgressView);
