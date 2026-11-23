import { LitElement, html, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import './style.css';
import './operations.css';
import './motion.css';
import './components';
import './traffic-views';
import './timetable';
import './investigation';
import './change-radar';
import './train-progress';
import './living-network';
import './command-shell.css';
import { icon } from './icons';
import { corridors } from './corridors';
import type { Composition } from './composition';
import { RailService } from './service';
import { compareSnapshots, recordingObservations, type Observation } from './investigation-model';
import {
  key,
  label,
  time,
  date,
  delay,
  endpoints,
  noticeText,
  matchesQuery,
  visibleTrains,
  matchesCategory,
  createTrainMatcher,
  type Train,
  type Station,
  type Location,
  type Notice,
  type Recording,
  type Category,
} from './domain';
type Page =
  | 'overview'
  | 'network'
  | 'radar'
  | 'journey'
  | 'investigation'
  | 'timetable'
  | 'notices'
  | 'components';
const nav: [Page, string, string][] = [
  ['overview', 'Tilannekuva', 'map'],
  ['network', 'Elävä reittiverkko', 'network'],
  ['radar', 'Muutostutka', 'target'],
  ['journey', 'Junan eteneminen', 'train'],
  ['investigation', 'Tilanneanalyysi', 'filter'],
  ['timetable', 'Aikataulut', 'chart'],
  ['notices', 'Tiedotteet', 'alert'],
  ['components', 'Komponenttikirjasto', 'layers'],
];
const expandedPages = new Set<Page>([
  'overview',
  'network',
  'radar',
  'journey',
  'investigation',
  'timetable',
]);
interface Stats {
  active: number;
  running: number;
  known: number;
  onTime: number;
  delayed: number;
  over5: number;
}
class RaideApp extends LitElement {
  createRenderRoot() {
    return this;
  }
  @state() private page: Page = 'overview';
  @state() private stations: Station[] = [];
  @state() private geography: any;
  @state() private trains: Train[] = [];
  @state() private locations: Location[] = [];
  @state() private notices: Notice[] = [];
  @state() private liveObservations: Observation[] = [];
  private recordedObservations: Observation[] = [];
  private lastLiveTrains: Train[] | undefined;
  @state() private recording: Recording | undefined;
  @state() private selected = '';
  @state() private query = '';
  @state() private category: Category = 'all';
  @state() private sort: 'delay' | 'number' | 'next' = 'delay';
  @state() private region = 'all';
  @state() private onlyDelayed = false;
  @state() private mode: 'live' | 'recorded' = 'recorded';
  @state() private status = 'loading';
  @state() private updatedAt = '';
  @state() private now = Date.now();
  @state() private error = '';
  @state() private bootError = '';
  @state() private noticeError = false;
  @state() private gpsError = false;
  @state() private recentTrainsAvailable = true;
  @state() private dailyTrainsAvailable = true;
  @state() private focusMode = false;
  @state() private browserFullscreen = false;
  @state() private searchOpen = false;
  @state() private networkFocusStationCode = '';
  @state() private networkFocusRequest = 0;
  @state() private gpsUpdatedAt = '';
  @state() private filtered: Train[] = [];
  @state() private stats: Stats = {
    active: 0,
    running: 0,
    known: 0,
    onTime: 0,
    delayed: 0,
    over5: 0,
  };
  @state() private composition: Composition | undefined;
  @state() private compositionStatus = 'idle';
  private compositionCache = new Map<string, Composition | null>();
  private compositionRequest = 0;
  @state() private playing = false;
  @state() private replayPosition = 0;
  @state() private replaySpeed = 5;
  @state() private showStations = true;
  @state() private timetableFocusSelected = false;
  @state() private infoOpen = false;
  @state() private focusedNotice = '';
  @state() private doc = 'overview';
  @state() private demoDelay = 8;
  @state() private demoCancelled = false;
  @state() private demoMode = 'live';
  @state() private toast = '';
  @state() private refreshing = false;
  private service = new RailService();
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private requestId = 0;
  private liveGeneration = 0;
  private intervals: ReturnType<typeof setInterval>[] = [];
  private lastLivePoll = 0;
  private replayIndex = -1;
  private map = new Map<string, Station>();
  private lastTick = performance.now();
  private queryTimer: ReturnType<typeof setTimeout> | undefined;
  private sentTrains: Train[] | undefined;
  private sentLocations: Location[] | undefined;
  private sentStations: Station[] | undefined;
  connectedCallback() {
    super.connectedCallback();
    this.worker.onmessage = (e) => {
      if (e.data.id !== this.requestId) return;
      this.filtered = e.data.trains;
      this.stats = e.data.stats;
      // Filtering the visible list must not silently change the globally followed train.
      // applyFrame()/refresh() handle a selected service that genuinely leaves the dataset.
      if (!this.selected && this.filtered[0]) this.selected = key(this.filtered[0]);
    };
    this.addEventListener('train-select', ((e: CustomEvent) =>
      this.selectTrain(e.detail)) as EventListener);
    this.addEventListener(
      'sort-change',
      ((e: CustomEvent) => (this.sort = e.detail)) as EventListener,
    );
    this.addEventListener('station-select', ((e: CustomEvent) => {
      this.region = e.detail;
      this.query = this.map.get(e.detail)?.stationName ?? e.detail;
      this.notify(`Liikennepaikka: ${this.query}`);
    }) as EventListener);
    this.addEventListener('composition-request', () => this.loadComposition());
    this.addEventListener('open-timetable', () => {
      // The investigation's selected service must remain visible when opening its chart.
      this.query = '';
      this.category = 'all';
      this.onlyDelayed = false;
      this.timetableFocusSelected = true;
      this.page = 'timetable';
    });
    this.addEventListener('open-investigation', () => {
      this.page = 'investigation';
    });
    this.addEventListener('open-journey', () => {
      this.page = 'journey';
    });
    this.addEventListener('open-notice', ((e: CustomEvent) => {
      this.page = 'notices';
      this.focusedNotice = e.detail;
      this.query = '';
    }) as EventListener);
    this.initialize();
    this.intervals.push(setInterval(() => this.tick(), 250));
    this.intervals.push(setInterval(() => this.poll(), 15000));
    window.addEventListener('keydown', this.shortcut);
    document.addEventListener('pointerdown', this.dismissSearch);
    document.addEventListener('fullscreenchange', this.syncFullscreen);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.intervals.forEach(clearInterval);
    this.worker.terminate();
    this.service.dispose();
    window.removeEventListener('keydown', this.shortcut);
    document.removeEventListener('pointerdown', this.dismissSearch);
    document.removeEventListener('fullscreenchange', this.syncFullscreen);
  }
  private infoTrigger: HTMLElement | null = null;
  private dismissSearch = (event: PointerEvent) => {
    const target = event.target;
    if (
      this.searchOpen &&
      target instanceof Node &&
      !this.querySelector('.search-box')?.contains(target)
    )
      this.searchOpen = false;
  };
  private openInfo() {
    this.infoTrigger = document.activeElement as HTMLElement;
    this.infoOpen = true;
  }
  private shortcut = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.querySelector<HTMLInputElement>('#global-search')?.focus();
      if (this.page === 'network') this.searchOpen = true;
    }
    if (e.key === 'Escape') {
      if (this.infoOpen) {
        this.closeInfo();
      } else if (this.searchOpen) {
        this.searchOpen = false;
        this.querySelector<HTMLInputElement>('#global-search')?.focus();
      } else if (this.focusMode) {
        void this.exitFocusMode();
      } else {
        this.focusedNotice = '';
      }
    }
  };
  private syncFullscreen = () => {
    const active = document.fullscreenElement === this.querySelector('.app-shell');
    // Escape is handled natively by the browser when true fullscreen is active.
    if (this.browserFullscreen && !active) {
      this.focusMode = false;
      this.updateComplete.then(() =>
        this.querySelector<HTMLButtonElement>('[data-testid="focus-toggle"]')?.focus(),
      );
    }
    this.browserFullscreen = active;
  };
  private async exitFocusMode() {
    this.focusMode = false;
    if (document.fullscreenElement === this.querySelector('.app-shell')) {
      try {
        await document.exitFullscreen();
      } catch {
        // CSS expanded mode is already closed even when browser fullscreen fails.
      }
    }
    this.updateComplete.then(() =>
      this.querySelector<HTMLButtonElement>('[data-testid="focus-toggle"]')?.focus(),
    );
  }
  private async toggleFocusMode() {
    if (this.focusMode) {
      await this.exitFocusMode();
      return;
    }
    this.searchOpen = false;
    this.focusMode = true;
    // Called synchronously from the button gesture; if the browser refuses the
    // Fullscreen API, RAIDE keeps an intentional full-width focus workspace.
    const shell = this.querySelector<HTMLElement>('.app-shell');
    if (shell?.requestFullscreen) {
      try {
        await shell.requestFullscreen();
      } catch {
        this.notify('Laajennettu työtila käytössä. Selaimen koko näyttö ei ole käytettävissä.');
      }
    }
  }
  private networkSearchResults() {
    const query = this.query.trim().toLocaleLowerCase('fi');
    if (!query || this.page !== 'network') return { stationMatches: [] as Station[], trainMatches: [] as Train[] };
    const diagramStations = new Set(Object.values(corridors).flatMap((corridor) => corridor.stations));
    const stationMatches = this.stations
      .filter(
        (station) =>
          diagramStations.has(station.stationShortCode) &&
          `${station.stationShortCode} ${station.stationName}`
            .toLocaleLowerCase('fi')
            .includes(query),
      )
      .slice(0, 5);
    const matches = createTrainMatcher(this.query, this.map);
    const trainMatches = this.trains.filter(matches).slice(0, 7);
    return { stationMatches, trainMatches };
  }
  private chooseNetworkSearchTrain(train: Train) {
    this.selectTrain(key(train));
    this.networkFocusStationCode = '';
    this.query = label(train);
    this.searchOpen = false;
    this.querySelector<HTMLInputElement>('#global-search')?.blur();
  }
  private chooseNetworkSearchStation(station: Station) {
    this.networkFocusStationCode = station.stationShortCode;
    this.networkFocusRequest++;
    this.query = station.stationName;
    this.searchOpen = false;
    this.querySelector<HTMLInputElement>('#global-search')?.blur();
    this.notify(`Reittiverkon liikennepaikka: ${station.stationName}`);
  }
  private onNetworkSearchKeydown(event: KeyboardEvent) {
    if (this.page !== 'network') return;
    if (event.key === 'ArrowDown' && this.searchOpen) {
      event.preventDefault();
      this.querySelector<HTMLButtonElement>('.network-search-result')?.focus();
    } else if (event.key === 'Enter' && this.query.trim()) {
      const { stationMatches, trainMatches } = this.networkSearchResults();
      const exactStation = stationMatches.find(
        (station) =>
          station.stationShortCode.toLocaleLowerCase('fi') === this.query.trim().toLocaleLowerCase('fi') ||
          station.stationName.toLocaleLowerCase('fi') === this.query.trim().toLocaleLowerCase('fi'),
      );
      if (exactStation) this.chooseNetworkSearchStation(exactStation);
      else if (trainMatches[0]) this.chooseNetworkSearchTrain(trainMatches[0]);
      else if (stationMatches[0]) this.chooseNetworkSearchStation(stationMatches[0]);
    }
  }
  private async initialize() {
    try {
      this.bootError = '';
      const d = await this.service.bootstrap();
      this.stations = d.stations.filter((s) => s.countryCode === 'FI');
      this.map = new Map(this.stations.map((s) => [s.stationShortCode, s]));
      this.geography = d.geography;
      this.recording = d.recording;
      this.recordedObservations = recordingObservations(d.recording);
      this.notices = d.notices;
      if (!d.recording.frames.length) throw Error('Tallenne puuttuu.');
      this.applyFrame(d.recording.frames.length - 1);
      this.mode = 'recorded';
      this.updatedAt = d.recording.frames.at(-1)!.capturedAt;
      this.status = 'ready';
      await this.refresh(true);
    } catch (e) {
      this.status = 'error';
      this.bootError =
        'Aineiston lataaminen epäonnistui. Tarkista verkkoyhteys ja yritä uudelleen.';
    }
  }
  private async refresh(switchLive = false) {
    if (this.refreshing) return;
    const generation = ++this.liveGeneration;
    this.refreshing = true;
    try {
      const d = await this.service.live();
      if (generation !== this.liveGeneration) return;
      if (this.lastLiveTrains) {
        this.liveObservations = [
          ...compareSnapshots(this.lastLiveTrains, d.trains, d.updatedAt).reverse(),
          ...this.liveObservations,
        ].slice(0, 1500);
      }
      this.lastLiveTrains = d.trains;
      this.trains = d.trains;
      this.locations = d.locations;
      if (!d.partial) this.notices = d.notices;
      this.noticeError = d.partial;
      this.gpsError = !d.locationsAvailable;
      this.recentTrainsAvailable = d.recentTrainsAvailable;
      this.dailyTrainsAvailable = d.dailyTrainsAvailable;
      this.gpsUpdatedAt = d.locationsAvailable ? d.updatedAt : '';
      this.updatedAt = d.updatedAt;
      this.now = Date.now();
      this.mode = 'live';
      this.playing = false;
      this.status = 'ready';
      this.error = '';
      this.lastLivePoll = Date.now();
      if (!this.trains.some((t) => key(t) === this.selected)) this.chooseDefault();
      this.process();
    } catch (e) {
      if (generation !== this.liveGeneration) return;
      this.status = 'error';
      this.error =
        this.mode === 'recorded'
          ? 'Reaaliaikaisia tietoja ei voitu hakea. Näytössä on selvästi merkitty tallenne.'
          : 'Tietojen päivitys epäonnistui. Viimeksi vastaanotetut tiedot ovat edelleen näkyvissä.';
      if (switchLive && this.mode === 'recorded')
        this.notify('Reaaliaikainen yhteys ei ole käytettävissä.');
    } finally {
      this.refreshing = false;
    }
  }
  private async poll() {
    if (this.mode !== 'live' || this.refreshing || document.hidden) return;
    if (Date.now() - this.lastLivePoll > 60000) {
      await this.refresh();
      return;
    }
    try {
      const generation = this.liveGeneration;
      const locations = await this.service.locations();
      if (this.mode === 'live' && generation === this.liveGeneration) {
        this.locations = locations;
        // A GPS-only response must never reset the timetable freshness clock.
        this.gpsUpdatedAt = new Date().toISOString();
        this.gpsError = false;
        this.process();
      }
    } catch {
      this.gpsError = true;
      // Timetable data remains valid even if the supplementary position feed fails.
    }
  }
  private tick() {
    const p = performance.now(),
      delta = p - this.lastTick;
    this.lastTick = p;
    if (this.mode === 'live') {
      if (Math.floor(this.now / 1000) !== Math.floor(Date.now() / 1000)) this.now = Date.now();
    } else if (this.playing && this.recording) {
      const first = Date.parse(this.recording.frames[0].capturedAt),
        last = Date.parse(this.recording.frames.at(-1)!.capturedAt);
      this.replayPosition = Math.min(
        (last - first) / 1000,
        this.replayPosition + (delta / 1000) * this.replaySpeed,
      );
      const target = first + this.replayPosition * 1000;
      let index = 0;
      for (let i = 0; i < this.recording.frames.length; i++) {
        if (Date.parse(this.recording.frames[i].capturedAt) <= target) index = i;
      }
      if (index !== this.replayIndex) this.applyFrame(index, false);
      this.now = target;
      if (target >= last) this.playing = false;
    }
  }
  private applyFrame(index: number, seek = true) {
    if (!this.recording) return;
    const f = this.recording.frames[index];
    if (!f) return;
    this.replayIndex = index;
    this.trains = f.trains;
    this.locations = f.locations;
    this.updatedAt = f.capturedAt;
    this.now = Date.parse(f.capturedAt);
    if (seek)
      this.replayPosition = (this.now - Date.parse(this.recording.frames[0].capturedAt)) / 1000;
    if (!this.trains.some((t) => key(t) === this.selected)) this.chooseDefault();
    this.process();
  }
  private chooseDefault() {
    const t =
      this.trains.find(
        (t) =>
          t.runningCurrently &&
          ['IC', 'S'].includes(t.trainType) &&
          this.locations.some((l) => key(l) === key(t)),
      ) ??
      this.trains.find((t) => t.runningCurrently) ??
      this.trains[0];
    this.selected = t ? key(t) : '';
  }
  private async loadComposition() {
    const t = this.trains.find((t) => key(t) === this.selected);
    if (!t) return;
    const k = key(t),
      generation = ++this.compositionRequest;
    this.composition = undefined;
    this.compositionStatus = 'loading';
    if (this.compositionCache.has(k)) {
      this.composition = this.compositionCache.get(k) ?? undefined;
      this.compositionStatus = 'ready';
      return;
    }
    try {
      const c = await this.service.json<Composition>(
        `compositions/${t.departureDate}/${t.trainNumber}`,
      );
      if (generation !== this.compositionRequest) return;
      this.composition = c;
      this.compositionCache.set(k, c);
      this.compositionStatus = 'ready';
    } catch (e) {
      if (generation === this.compositionRequest) {
        if (e instanceof Error && e.message.includes('(404)')) {
          this.compositionCache.set(k, null);
          this.compositionStatus = 'ready';
        } else this.compositionStatus = 'error';
      }
    }
  }
  private selectTrain(k: string) {
    this.selected = k;
    const t = this.trains.find((t) => key(t) === k);
    if (t) this.notify(`${label(t)} valittu`);
  }
  private process() {
    this.worker.postMessage({
      id: ++this.requestId,
      ...(this.sentTrains !== this.trains ? { trains: this.trains } : {}),
      ...(this.sentLocations !== this.locations ? { locations: this.locations } : {}),
      ...(this.sentStations !== this.stations ? { stations: this.stations } : {}),
      now: this.now,
      query: this.query,
      category: this.category,
      sort: this.sort,
      onlyDelayed: this.onlyDelayed,
      scope: this.page === 'timetable' ? 'day' : 'active',
    });
    this.sentTrains = this.trains;
    this.sentLocations = this.locations;
    this.sentStations = this.stations;
  }
  protected updated(changed: Map<string, unknown>) {
    if (changed.has('infoOpen') && this.infoOpen)
      this.querySelector<HTMLElement>('.modal-close')?.focus();
    if (['query', 'category', 'sort', 'onlyDelayed', 'page'].some((k) => changed.has(k)))
      this.process();
    if (changed.has('page') && !expandedPages.has(this.page) && this.focusMode)
      void this.exitFocusMode();
  }
  private setMode(mode: 'live' | 'recorded') {
    if (mode === 'live') {
      this.refresh(true);
      return;
    }
    ++this.liveGeneration;
    this.mode = 'recorded';
    this.status = 'ready';
    this.error = '';
    this.gpsError = false;
    this.playing = false;
    this.applyFrame(0);
  }
  private seek(value: number) {
    this.replayPosition = value;
    const first = Date.parse(this.recording!.frames[0].capturedAt),
      target = first + value * 1000;
    let i = 0;
    for (let n = 0; n < this.recording!.frames.length; n++) {
      if (Date.parse(this.recording!.frames[n].capturedAt) <= target) i = n;
    }
    this.applyFrame(i, false);
    this.now = target;
  }
  private notify(text: string) {
    this.toast = text;
    setTimeout(() => {
      if (this.toast === text) this.toast = '';
    }, 3000);
  }
  private navigate(p: Page) {
    if (p === 'timetable') this.timetableFocusSelected = false;
    this.page = p;
    this.focusedNotice = '';
    this.searchOpen = false;
    if (p === 'components') this.query = '';
  }
  private exportData() {
    const data = {
      lahde: 'Fintraffic / Digitraffic, CC BY 4.0',
      tila: this.mode === 'live' ? 'Reaaliaikainen' : 'Tallenne',
      paivitetty: this.updatedAt,
      junat: this.filtered.map((t) => ({
        juna: label(t),
        lahtopaiva: t.departureDate,
        reitti: endpoints(t)
          .map((c) => this.map.get(c)?.stationName ?? c)
          .join(' – '),
        myohastyminenMin: delay(t, this.now),
        liikenteessa: t.runningCurrently,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `raide-${new Date(this.now).toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.notify('Junatiedot viety JSON-tiedostoon.');
  }
  private replay() {
    const frames = this.recording?.frames ?? [];
    const duration =
      frames.length > 1
        ? (Date.parse(frames.at(-1)!.capturedAt) - Date.parse(frames[0].capturedAt)) / 1000
        : 0;
    return html`<div class="replay-strip ${this.mode === 'recorded' ? 'is-recorded' : ''}">
      <div class="mode-switch" role="group" aria-label="Tietolähteen tila">
        <button class=${this.mode === 'live' ? 'active' : ''} @click=${() => this.setMode('live')}>
          ${icon('wifi', 15)} Reaaliaikainen</button
        ><button
          class=${this.mode === 'recorded' ? 'active' : ''}
          @click=${() => this.setMode('recorded')}
        >
          ${icon('clock', 15)} Tallenne
        </button>
      </div>
      ${
        this.mode === 'recorded'
          ? html`<div class="replay-controls">
              <button
                class="icon-button"
                aria-label="Palaa tallenteen alkuun"
                @click=${() => {
                  this.playing = false;
                  this.seek(0);
                }}
              >
                ${icon('back', 15)}</button
              ><button
                class="replay-play"
                aria-label=${this.playing ? 'Keskeytä toisto' : 'Toista tallenne'}
                @click=${() => {
                  if (this.replayPosition >= duration) this.seek(0);
                  this.playing = !this.playing;
                }}
              >
                ${icon(this.playing ? 'pause' : 'play', 15)}</button
              ><span class="replay-time">${time(this.now)}</span
              ><input
                type="range"
                min="0"
                .max=${String(duration)}
                step="1"
                .value=${String(this.replayPosition)}
                aria-label="Tallenteen toistokohta"
                aria-valuetext=${`${time(this.now)}, ${date(this.now)}`}
                @input=${(e: Event) => {
                  this.playing = false;
                  this.seek(Number((e.target as HTMLInputElement).value));
                }}
              /><select
                aria-label="Toistonopeus"
                .value=${String(this.replaySpeed)}
                @change=${(e: Event) => (this.replaySpeed = Number((e.target as HTMLSelectElement).value))}
              >
                <option value="1">1×</option>
                <option value="5">5×</option>
                <option value="20">20×</option></select
              ><span class="muted tiny"
                >${date(frames[0]?.capturedAt ?? this.now)} · ${frames.length} havaintoa</span
              >
            </div>`
          : html`<div class="live-source">
              ${icon('refresh', 13)} Sijainnit päivittyvät 15 sekunnin välein
              <span class="subtle-divider">·</span>
              ${this.refreshing ? 'Päivitetään…' : `Aikataulut haettu ${time(this.updatedAt)} · ${this.gpsUpdatedAt && !this.gpsError ? `GPS haettu ${time(this.gpsUpdatedAt)}` : 'GPS ei käytettävissä'}`}
            </div>`
      }<button class="text-button source-button" @click=${() => this.openInfo()}>
        ${icon('info', 14)} Tietoa aineistosta
      </button>
    </div>`;
  }
  private filters() {
    return html`<div class="filter-row">
      <div class="segmented" role="group" aria-label="Liikennelaji">
        ${(
          [
            ['all', 'Kaikki junat'],
            ['long', 'Kaukoliikenne'],
            ['commuter', 'Lähiliikenne'],
            ['cargo', 'Tavaraliikenne'],
          ] as [Category, string][]
        ).map(
          ([v, n]) =>
            html`<button
              aria-pressed=${this.category === v}
              class=${this.category === v ? 'active' : ''}
              @click=${() => (this.category = v)}
            >
              ${n}
            </button>`,
        )}
      </div>
      <div class="filter-actions">
        <label class="checkbox-label"
          ><input
            type="checkbox"
            .checked=${this.onlyDelayed}
            @change=${(e: Event) => (this.onlyDelayed = (e.target as HTMLInputElement).checked)}
          />Vain myöhässä</label
        ><button
          class="icon-button outlined"
          aria-label="Vie suodatetut junatiedot JSON-tiedostona"
          title="Vie junatiedot"
          @click=${() => this.exportData()}
        >
          ${icon('download', 17)}
        </button>
      </div>
    </div>`;
  }
  /** Apply the same user filters to charts in both tabs; do not hide future scheduled trains. */
  private chartTrains(): Train[] {
    const matcher = createTrainMatcher(this.query, this.map);
    return this.trains.filter(
      (train) =>
        matchesCategory(train, this.category) &&
        matcher(train) &&
        (!this.onlyDelayed || (delay(train, this.now) ?? 0) > 0),
    );
  }
  private overview() {
    const onTime = this.stats.known
      ? Math.round((this.stats.onTime / this.stats.known) * 100)
      : null;
    const validNotices = this.currentNotices();
    return html`<div class="metrics">
        <div class="metric">
          <span>${icon('train', 17)} Seurannassa</span
          ><strong>${this.stats.active}<small>junaa</small></strong>
          <p>${this.stats.running} junaa liikenteessä</p>
        </div>
        <div class="metric">
          <span>${icon('check', 17)} Aikataulussa</span
          ><strong class="text-mint"
            >${onTime ?? '—'}<small>${onTime === null ? '' : '%'}</small></strong
          >
          <p>${this.stats.onTime} / ${this.stats.known} junaa, joilla aikaero tiedossa</p>
          <div class="metric-progress"><i style=${`width:${onTime ?? 0}%`}></i></div>
        </div>
        <div class="metric">
          <span>${icon('clock', 17)} Myöhässä</span
          ><strong class="text-amber">${this.stats.delayed}<small>junaa</small></strong>
          <p>${this.stats.over5} junaa yli 5 minuuttia myöhässä</p>
        </div>
        <button class="metric metric-action" @click=${() => (this.page = 'notices')}>
          <span>${icon('alert', 17)} Voimassa olevat tiedotteet</span
          ><strong>${validNotices.length}<small>tiedotetta</small></strong>
          <p>Avaa matkustajainformaation tiedotteet ${icon('chevron', 12)}</p>
        </button>
      </div>
      <nav class="ops-quick-actions" aria-label="Keskeiset työkalut">
        <button class="ops-quick-action" @click=${() => this.navigate('journey')}>
          <span class="ops-quick-symbol">${icon('train', 21)}</span>
          <span
            ><strong>Seuraa valittua junaa</strong
            ><small
              >${this.trains.find((t) => key(t) === this.selected) ? label(this.trains.find((t) => key(t) === this.selected)!) : 'Valitse juna'}
              · Reitti, GPS ja seuraava asema</small
            ></span
          >
          ${icon('chevron', 17)}
        </button>
        <button class="ops-quick-action" @click=${() => this.navigate('radar')}>
          <span class="ops-quick-symbol accent">${icon('target', 21)}</span>
          <span
            ><strong>Mitä on muuttunut?</strong
            ><small>Muutostutka · Havaintohistoria ja poikkeamat</small></span
          >
          ${icon('chevron', 17)}
        </button>
        <button class="ops-quick-action" @click=${() => this.navigate('timetable')}>
          <span class="ops-quick-symbol blue">${icon('chart', 21)}</span>
          <span
            ><strong>Tutki aikataulua</strong
            ><small>Kuusi vuorovaikutteista esitystapaa</small></span
          >
          ${icon('chevron', 17)}
        </button>
      </nav>
      ${this.filters()}
      <div class="workspace-grid">
        <raide-traffic-views
          .trains=${this.chartTrains()}
          .network=${this.trains}
          .locations=${this.locations}
          .stations=${this.map}
          .geography=${this.geography}
          .selected=${this.selected}
          .now=${this.now}
          .region=${this.region}
          .showStations=${this.showStations}
        ></raide-traffic-views>
        <div class="right-stack">
          <raide-train-table
            .trains=${this.filtered}
            .stations=${this.map}
            .locations=${this.locations}
            .selected=${this.selected}
            .sort=${this.sort}
            .now=${this.now}
          ></raide-train-table
          >${this.detail()}
        </div>
      </div>
      <raide-timetable
        .trains=${this.chartTrains()}
        .stations=${this.map}
        .selected=${this.selected}
        .now=${this.now}
      ></raide-timetable>`;
  }
  private detail() {
    return html`<raide-train-detail
      .train=${this.trains.find((t) => key(t) === this.selected)}
      .stationMap=${this.map}
      .location=${this.locations.find((l) => key(l) === this.selected)}
      .now=${this.now}
      .notices=${this.currentNotices()}
      .composition=${this.composition}
      .compositionStatus=${this.compositionStatus}
      .mode=${this.mode}
    ></raide-train-detail>`;
  }
  private currentNotices() {
    return this.notices.filter(
      (n) => Date.parse(n.startValidity) <= this.now && Date.parse(n.endValidity) >= this.now,
    );
  }
  private renderTimetable() {
    return html`${this.filters()}<raide-timetable
        .trains=${this.chartTrains()}
        .stations=${this.map}
        .selected=${this.selected}
        .now=${this.now}
        .expanded=${true}
        .focusSelected=${this.timetableFocusSelected}
      ></raide-timetable>
      <div class="timetable-lower">
        <raide-train-table
          .trains=${this.filtered}
          .stations=${this.map}
          .locations=${this.locations}
          .selected=${this.selected}
          .sort=${this.sort}
          .now=${this.now}
        ></raide-train-table
        >${this.detail()}
      </div>`;
  }
  private renderInvestigation() {
    const observations =
      this.mode === 'recorded'
        ? this.recordedObservations.filter((o) => Date.parse(o.observedAt) <= this.now)
        : this.liveObservations;
    return html`<raide-investigation
      .trains=${this.trains}
      .locations=${this.locations}
      .stations=${this.map}
      .notices=${this.notices}
      .observations=${observations}
      .selected=${this.selected}
      .now=${this.now}
      .updatedAt=${this.updatedAt}
      .mode=${this.mode}
    ></raide-investigation>`;
  }
  private observationsForMode() {
    return this.mode === 'recorded'
      ? this.recordedObservations.filter(
          (observation) => Date.parse(observation.observedAt) <= this.now,
        )
      : this.liveObservations;
  }
  private renderNetwork() {
    const first = this.recording?.frames[0]?.capturedAt;
    const last = this.recording?.frames.at(-1)?.capturedAt;
    const replayStart = first ? Date.parse(first) : 0;
    const replayEnd = last ? Date.parse(last) : 0;
    return html`<raide-living-network
      .trains=${this.trains}
      .locations=${this.locations}
      .stations=${this.map}
      .selected=${this.selected}
      .searchQuery=${this.query}
      .focusStationCode=${this.networkFocusStationCode}
      .focusRequest=${this.networkFocusRequest}
      .mode=${this.mode}
      .now=${this.now}
      .updatedAt=${this.updatedAt}
      .dailyTrainsAvailable=${this.dailyTrainsAvailable}
      .loadStatus=${this.status}
      .replayStart=${replayStart}
      .replayEnd=${replayEnd}
      @network-time-seek=${(e: CustomEvent<number>) => {
        if (this.mode === 'recorded' && Number.isFinite(e.detail) && replayStart) {
          this.seek(Math.max(0, (e.detail - replayStart) / 1000));
        }
      }}
    ></raide-living-network>`;
  }
  private renderRadar() {
    const selectedTrain = this.trains.find((train) => key(train) === this.selected);
    return html`<div class="ops-workspace">
      <div class="ops-workspace-heading">
        <div>
          <span class="eyebrow">MUUTOSTUTKA / HAVAINTOPERUSTEINEN SEURANTA</span>
          <h2>Havaitse muutos. Löydä siihen liittyvä juna.</h2>
          <p>
            Vertaa vastaanotettuja havaintoja. Muutoksen tarkka tapahtumahetki ei ole tiedossa,
            ellei lähde sitä kerro.
          </p>
        </div>
        <button class="button secondary" @click=${() => this.navigate('investigation')}>
          Avaa tilanneanalyysi ${icon('chevron', 14)}
        </button>
      </div>
      <div class="ops-radar-layout">
        <raide-change-radar
          .observations=${this.observationsForMode()}
          .trains=${this.trains}
          .stations=${this.map}
          .selected=${this.selected}
          .mode=${this.mode}
          .now=${this.now}
          .expanded=${true}
        ></raide-change-radar>
        <aside class="ops-radar-context" aria-label="Valitun junan tarkennus">
          <span class="eyebrow">VALITTU PALVELU</span>
          <h3>${selectedTrain ? label(selectedTrain) : 'Valitse tapahtumasta juna'}</h3>
          <p>Valinta seuraa samaa junaa kartalla, matkakuvassa ja graafisessa aikataulussa.</p>
          ${selectedTrain ? html`<raide-train-progress .train=${selectedTrain} .locations=${this.locations} .stations=${this.map} .now=${this.now} .mode=${this.mode}></raide-train-progress>` : nothing}
          <button
            class="ops-context-cta"
            ?disabled=${!selectedTrain}
            @click=${() => this.navigate('journey')}
          >
            Avaa junan koko eteneminen ${icon('chevron', 15)}
          </button>
        </aside>
      </div>
    </div>`;
  }
  private renderJourney() {
    const selectedTrain = this.trains.find((train) => key(train) === this.selected);
    return html`<div class="ops-workspace">
      <div class="ops-workspace-heading">
        <div>
          <span class="eyebrow">JUNAN ETENEMINEN / YKSI PALVELU</span>
          <h2>Alkupaikasta viimeisimpään havaintoon ja määränpäähän.</h2>
          <p>
            Vaihda reitti- ja sijaintiesityksen välillä. GPS-havainto erotetaan aina aikataulun
            ennusteesta.
          </p>
        </div>
        <button class="button secondary" @click=${() => this.navigate('timetable')}>
          Avaa graafinen aikataulu ${icon('chevron', 14)}
        </button>
      </div>
      <div class="ops-journey-layout">
        <div class="ops-journey-primary">
          <raide-train-progress
            .train=${selectedTrain}
            .locations=${this.locations}
            .stations=${this.map}
            .now=${this.now}
            .mode=${this.mode}
          ></raide-train-progress>
        </div>
        <div class="ops-journey-list">
          <div class="ops-list-heading">
            <strong>Valitse seurattava juna</strong><span>${this.filtered.length} näkyvissä</span>
          </div>
          <raide-train-table
            .trains=${this.filtered}
            .stations=${this.map}
            .locations=${this.locations}
            .selected=${this.selected}
            .sort=${this.sort}
            .now=${this.now}
          ></raide-train-table>
        </div>
      </div>
      <div class="ops-journey-secondary">
        <div class="ops-secondary-heading">
          <span class="eyebrow">SAMA JUNA, TOINEN MITTAKAAVA</span>
          <h3>Graafinen aikataulu</h3>
        </div>
        <raide-timetable
          .trains=${this.chartTrains()}
          .stations=${this.map}
          .selected=${this.selected}
          .now=${this.now}
          .focusSelected=${true}
        ></raide-timetable>
      </div>
    </div>`;
  }
  private renderNotices() {
    const notices = this.currentNotices().filter(
      (n) =>
        !this.query ||
        `${noticeText(n)} ${(n.stations ?? []).map((c) => this.map.get(c)?.stationName ?? c).join(' ')} ${n.trainNumber ?? ''}`
          .toLocaleLowerCase('fi')
          .includes(this.query.toLocaleLowerCase('fi')),
    );
    return html`<div class="notices-layout">
      <section>
        <div class="section-intro">
          <h2>Matkustajainformaation tiedotteet <span class="count">${notices.length}</span></h2>
          <p>Voimassa olevat suomenkieliset tiedotteet Digitraffic-palvelusta.</p>
        </div>
        ${this.noticeError ? html`<div class="warning-banner">Tiedotteiden päivitys epäonnistui. Yritä päivittää tiedot uudelleen.</div>` : nothing}${
          !notices.length
            ? html`<div class="panel empty-state">
                ${icon('check', 32)}
                <h3>Voimassa olevia tiedotteita ei löytynyt</h3>
                <p>
                  ${this.query ? 'Muuta hakua.' : 'Aineistossa ei ole tähän ajankohtaan liittyviä tiedotteita.'}
                </p>
              </div>`
            : notices.map(
                (n) =>
                  html`<article
                    class="notice-card ${this.focusedNotice === n.id ? 'focused' : ''}"
                    id=${n.id}
                  >
                    <div class="notice-icon">${icon('info', 21)}</div>
                    <div>
                      <div class="notice-meta">
                        <span>MATKUSTAJATIEDOTE</span
                        ><time>${date(n.creationDateTime)} klo ${time(n.creationDateTime)}</time>
                      </div>
                      <h3>
                        ${
                          n.trainNumber
                            ? `Juna ${n.trainNumber}`
                            : (n.stations ?? [])
                                .slice(0, 2)
                                .map((c) => this.map.get(c)?.stationName ?? c)
                                .join(' – ') || 'Junaliikenne'
                        }
                      </h3>
                      <p>${noticeText(n)}</p>
                      <div class="station-chips">
                        ${(n.stations ?? []).map(
                          (c) =>
                            html`<button
                              @click=${() => {
                                this.page = 'overview';
                                this.query = this.map.get(c)?.stationName ?? c;
                                this.region = c;
                              }}
                            >
                              ${this.map.get(c)?.stationName ?? c}
                            </button>`,
                        )}
                      </div>
                      <details>
                        <summary>Tiedotteen tiedot</summary>
                        <dl>
                          <dt>Voimassa</dt>
                          <dd>
                            ${date(n.startValidity)} ${time(n.startValidity)} –
                            ${date(n.endValidity)} ${time(n.endValidity)}
                          </dd>
                          <dt>Tunniste</dt>
                          <dd>${n.id}</dd>
                          <dt>Lähde</dt>
                          <dd>Fintraffic / Digitraffic</dd>
                        </dl>
                      </details>
                    </div>
                  </article>`,
              )
        }
      </section>
      <aside class="panel notice-aside">
        <span class="eyebrow">AINEISTON TULKINTA</span>
        <h3>Tiedote kertoo tilanteesta.</h3>
        <p>Matkustajainformaation tiedote voi koskea yhtä junaa tai useita liikennepaikkoja.</p>
        <p>
          Tiedotteet näytetään lähteen alkuperäisessä suomenkielisessä muodossa. Tallennetilassa
          voimassaolo tarkistetaan tallenteen ajankohdan perusteella.
        </p>
        <a href="https://www.digitraffic.fi/rautatieliikenne/" target="_blank" rel="noopener"
          >Digitrafficin dokumentaatio ${icon('external', 14)}</a
        >
      </aside>
    </div>`;
  }
  private renderDocs() {
    const sample = this.trains.find((t) => t.runningCurrently) ?? this.trains[0];
    const docNav = [
      ['overview', 'Yleiskuva'],
      ['tokens', 'Visuaalinen perusta'],
      ['delay', 'Myöhästymistunniste'],
      ['status', 'Tietolähteen tila'],
      ['table', 'Junaluettelo'],
      ['accessibility', 'Saavutettavuus'],
      ['engineering', 'Tekninen toteutus'],
      ['terms', 'Sanasto ja lähteet'],
    ];
    return html`<div class="docs-layout">
      <aside class="docs-nav">
        <span class="eyebrow">KOMPONENTTIKIRJASTO</span
        >${docNav.map(([id, name]) => html`<button class=${this.doc === id ? 'active' : ''} @click=${() => (this.doc = id)}>${name}</button>`)}
      </aside>
      <article class="docs-content">
        ${
          this.doc === 'overview'
            ? html`<span class="eyebrow text-mint">RAIDE / DESIGN SYSTEM</span>
                <h2>Yhteinen perusta.<br />Toimivat käyttöliittymät.</h2>
                <p class="lead">
                  Samat Web Components -komponentit toimivat sekä tilannekuvassa että tämän
                  kirjaston esimerkeissä. Esimerkit ovat vuorovaikutteisia.
                </p>
                <div class="docs-tiles">
                  <button @click=${() => (this.doc = 'delay')}>
                    ${icon('clock', 25)}
                    <h3>Myöhästymistunniste</h3>
                    <p>Aikaero, puuttuva ennuste ja peruminen.</p></button
                  ><button @click=${() => (this.doc = 'table')}>
                    ${icon('train', 25)}
                    <h3>Junaluettelo</h3>
                    <p>Yhteinen valinta ja järjestäminen.</p></button
                  ><button @click=${() => (this.doc = 'tokens')}>
                    ${icon('layers', 25)}
                    <h3>Visuaalinen perusta</h3>
                    <p>Värit, typografia ja mitoitus.</p></button
                  ><button @click=${() => (this.doc = 'accessibility')}>
                    ${icon('check', 25)}
                    <h3>Saavutettavuus</h3>
                    <p>Näppäimistö ja tiedon ymmärrettävyys.</p>
                  </button>
                </div>`
            : this.doc === 'delay'
              ? html`<span class="eyebrow">KOMPONENTTI</span>
                  <h2>Myöhästymistunniste</h2>
                  <p>
                    Ilmaisee aikataulun mukaisen ajan ja ennusteen tai toteutuneen ajan erotuksen.
                    Väri täydentää tekstiä.
                  </p>
                  <div class="component-stage">
                    <raide-delay-badge
                      .value=${this.demoDelay}
                      .cancelled=${this.demoCancelled}
                    ></raide-delay-badge>
                  </div>
                  <div class="component-controls">
                    <label
                      >Aikaero (min)<input
                        type="number"
                        min="-60"
                        max="180"
                        .value=${String(this.demoDelay)}
                        @input=${(e: Event) => (this.demoDelay = Number((e.target as HTMLInputElement).value))} /></label
                    ><label class="checkbox-label"
                      ><input
                        type="checkbox"
                        .checked=${this.demoCancelled}
                        @change=${(e: Event) => (this.demoCancelled = (e.target as HTMLInputElement).checked)}
                      />Peruttu</label
                    >
                  </div>
                  <div class="badge-examples">
                    <raide-delay-badge .value=${0}></raide-delay-badge
                    ><raide-delay-badge .value=${3}></raide-delay-badge
                    ><raide-delay-badge .value=${12}></raide-delay-badge
                    ><raide-delay-badge .value=${null}></raide-delay-badge
                    ><raide-delay-badge .cancelled=${true}></raide-delay-badge>
                  </div>
                  <h3>Ominaisuudet</h3>
                  <table class="docs-table">
                    <thead>
                      <tr>
                        <th>Nimi</th>
                        <th>Tyyppi</th>
                        <th>Merkitys</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td><code>value</code></td>
                        <td>number | null</td>
                        <td>Aikaero minuutteina; null tarkoittaa puuttuvaa ennustetta.</td>
                      </tr>
                      <tr>
                        <td><code>cancelled</code></td>
                        <td>boolean</td>
                        <td>Peruminen ohittaa aikaeron esityksen.</td>
                      </tr>
                    </tbody>
                  </table>
                  <pre><code>&lt;raide-delay-badge .value=&#36;{8}&gt;
&lt;/raide-delay-badge&gt;</code></pre>`
              : this.doc === 'status'
                ? html`<h2>Tietolähteen tila</h2>
                    <p>
                      Erottelee reaaliaikaisen aineiston, tallenteen ja yhteyshäiriön. Tilaa ei
                      ilmaista pelkällä värillä.
                    </p>
                    <div class="component-stage">
                      <raide-data-status .mode=${this.demoMode} status="ready"></raide-data-status>
                    </div>
                    <label
                      >Esimerkin tila
                      <select
                        .value=${this.demoMode}
                        @change=${(e: Event) => (this.demoMode = (e.target as HTMLSelectElement).value)}
                      >
                        <option value="live">Reaaliaikainen</option>
                        <option value="recorded">Tallenne</option>
                      </select></label
                    >
                    <div class="badge-examples">
                      <raide-data-status mode="live" status="ready"></raide-data-status
                      ><raide-data-status mode="recorded" status="ready"></raide-data-status
                      ><raide-data-status mode="live" status="error"></raide-data-status>
                    </div>
                    <h3>Ominaisuudet</h3>
                    <p>
                      <code>mode</code>: live | recorded · <code>status</code>: loading | ready |
                      error
                    </p>`
                : this.doc === 'tokens'
                  ? html`<h2>Visuaalinen perusta</h2>
                      <p>
                        Semanttiset värit, yhteinen mitoitus ja selkeä typografia pitävät
                        tietotiheän käyttöliittymän johdonmukaisena.
                      </p>
                      <div class="swatches">
                        ${[
                          ['Pohja', '#0b111a'],
                          ['Pinta', '#111b28'],
                          ['Korostus', '#87edc4'],
                          ['Junaliikenne', '#68a8eb'],
                          ['Myöhästyminen', '#eab36c'],
                          ['Tavaraliikenne', '#ac9de7'],
                          ['Teksti', '#e8eef5'],
                          ['Toissijainen teksti', '#94a4b8'],
                        ].map(
                          ([n, c]) =>
                            html`<div>
                              <i style=${`background:${c}`}></i><strong>${n}</strong
                              ><code>${c}</code>
                            </div>`,
                        )}
                      </div>
                      <h3>Typografia</h3>
                      <p class="type-sample">Junaliikenteen tilannekuva</p>
                      <p>
                        Järjestelmäkirjasin: Segoe UI, Inter tai vastaava. Taulukoiden kellonajoissa
                        käytetään tasalevyisiä numeroita.
                      </p>
                      <h3>Mitoitus</h3>
                      <div class="spacing-demo">
                        ${[4, 8, 12, 16, 24, 32].map((n) => html`<div><i style=${`width:${n * 3}px`}></i><span>${n} px</span></div>`)}
                      </div>`
                  : this.doc === 'table'
                    ? html`<h2>Junaluettelo</h2>
                        <p>
                          Semanttinen taulukko sisältää jokaiselle junalle nimettynä painikkeena
                          toteutetun valinnan. Esimerkin valinta päivittyy myös varsinaiseen
                          tilannekuvaan.
                        </p>
                        <raide-train-table
                          .trains=${this.filtered.slice(0, 8)}
                          .stations=${this.map}
                          .locations=${this.locations}
                          .selected=${this.selected}
                          .sort=${this.sort}
                          .now=${this.now}
                        ></raide-train-table>
                        <h3>Tapahtumat</h3>
                        <table class="docs-table">
                          <tbody>
                            <tr>
                              <td><code>train-select</code></td>
                              <td>Valitun junan lähtöpäivä ja junanumero.</td>
                            </tr>
                            <tr>
                              <td><code>sort-change</code></td>
                              <td>Valittu järjestämisperuste.</td>
                            </tr>
                          </tbody>
                        </table>
                        <p>
                          Tapahtumat välittyvät ylöspäin komponenttirajojen yli. Tiedon haku on
                          erotettu esityskomponentista.
                        </p>`
                    : this.doc === 'accessibility'
                      ? html`<h2>Saavutettavuus</h2>
                          <p>
                            Saavutettavuus kuuluu komponenttien toimintaan ja tiedon esitystapaan.
                          </p>
                          <ul class="docs-list">
                            <li>Kaikilla painikkeilla ja syötekentillä on kuvaava nimi.</li>
                            <li>
                              Näppäimistökohdistus on näkyvä. Taulukon junan voi valita Enter- tai
                              välilyöntinäppäimellä.
                            </li>
                            <li>
                              Kartan junat voi valita myös junaluettelosta ilman kartan käyttöä.
                            </li>
                            <li>Myöhästyminen ja yhteystila ilmaistaan tekstinä värin lisäksi.</li>
                            <li>
                              Tilaviestit välitetään ruudunlukijalle. Jatkuvat aikapäivitykset eivät
                              keskeytä lukemista.
                            </li>
                            <li>
                              Liikkeen vähentämistä koskevaa järjestelmäasetusta kunnioitetaan.
                            </li>
                          </ul>
                          <h3>Näppäinkomennot</h3>
                          <table class="docs-table">
                            <tbody>
                              <tr>
                                <td><kbd>Ctrl</kbd> + <kbd>K</kbd></td>
                                <td>Siirrä kohdistus hakuun.</td>
                              </tr>
                              <tr>
                                <td><kbd>Esc</kbd></td>
                                <td>Sulje aineiston tiedot.</td>
                              </tr>
                              <tr>
                                <td><kbd>Tab</kbd></td>
                                <td>Siirry seuraavaan toimintoon.</td>
                              </tr>
                            </tbody>
                          </table>
                          <p>
                            Ohjeistus:
                            <a
                              href="https://www.saavutettavuusvaatimukset.fi/fi/kattavan-valvonnan-tarkastusohjeet/verkkosivuston-kattavan-valvonnan-tarkastusohje"
                              target="_blank"
                              rel="noopener"
                              >Traficomin saavutettavuusohjeet</a
                            >. Tämä sivu kuvaa toteutusta; se ei ole sertifiointi.
                          </p>`
                      : this.doc === 'engineering'
                        ? html`<h2>Tekninen toteutus</h2>
                            <p>
                              Lit ja TypeScript muodostavat komponenttikerroksen. Selaimen Web
                              Worker käsittelee junien suodatuksen, järjestämisen ja
                              yhteenvetoluvut.
                            </p>
                            <div class="engineering-flow">
                              <span>Digitraffic</span><span>Tietopalvelu</span
                              ><span>Tietomalli / Web Worker</span><span>Web Components</span>
                            </div>
                            <h3>Aineiston käsittely</h3>
                            <ul class="docs-list">
                              <li>Junan yksilöi lähtöpäivän ja junanumeron yhdistelmä.</li>
                              <li>UTC-aikaleimat esitetään Europe/Helsinki-aikavyöhykkeellä.</li>
                              <li>Aikataulu, ennuste ja toteuma säilytetään erillisinä.</li>
                              <li>
                                Tietopyynnöillä on aikakatkaisu. Vanhentuneen pyynnön tulos ei
                                korvaa uudempaa tilaa.
                              </li>
                              <li>
                                Sijainnit päivitetään 15 sekunnin ja aikataulut noin minuutin
                                välein. Päivitys keskeytetään välilehden ollessa piilossa.
                              </li>
                              <li>
                                Tallenne toistaa todellisia havaintoja aikaleimojen mukaisessa
                                järjestyksessä.
                              </li>
                              <li>
                                Kartalla näytetään enintään kymmenen minuuttia vanhat sijainnit.
                              </li>
                            </ul>
                            <h3>Lähdekoodi ja testaus</h3>
                            <p>
                              <a href=${`${(import.meta as any).env?.BASE_URL || '/'}komponentit/index.html`} target="_blank" rel="noopener"
                                >Avaa Storybook-kehittäjänäkymä ${icon('external', 14)}</a
                              >
                            </p>
                            <p>
                              Komponentit, tietopalvelu, tietomalli ja testit on erotettu omiin
                              moduuleihinsa. Testit tarkistavat muun muassa junan yksilöinnin,
                              aikaeron ja puuttuvan tiedon käsittelyn.
                            </p>`
                        : html`<h2>Sanasto ja lähteet</h2>
                            <p>
                              Termi valitaan käsitteen ja käyttötarkoituksen perusteella. Alla
                              erotetaan lähteessä käytetyt termit sovelluksen omista
                              käyttöliittymänimistä.
                            </p>
                            <table class="docs-table">
                              <thead>
                                <tr>
                                  <th>Termi</th>
                                  <th>Käyttö tässä sovelluksessa</th>
                                  <th>Lähde</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td>Graafinen aikataulu</td>
                                  <td>Aika–etäisyyskaavio junien kulusta.</td>
                                  <td>Fintraffic / Digitraffic</td>
                                </tr>
                                <tr>
                                  <td>Raiteistokaavio</td>
                                  <td>
                                    Raiteiston rakennetta kuvaava kaavio. Sovelluksen kartta ei ole
                                    raiteistokaavio.
                                  </td>
                                  <td>Fintraffic, RUMA-ohje</td>
                                </tr>
                                <tr>
                                  <td>Ennuste</td>
                                  <td>Rajapinnan liveEstimateTime.</td>
                                  <td>Digitraffic</td>
                                </tr>
                                <tr>
                                  <td>Toteuma</td>
                                  <td>Rajapinnan actualTime; havaittu saapumis- tai lähtöaika.</td>
                                  <td>Digitraffic</td>
                                </tr>
                                <tr>
                                  <td>Suunniteltu raide</td>
                                  <td>commercialTrack; voi poiketa käytetystä raiteesta.</td>
                                  <td>Digitraffic</td>
                                </tr>
                                <tr>
                                  <td>Näppäimistökohdistus</td>
                                  <td>Näppäimistöllä valittuna oleva käyttöliittymän kohde.</td>
                                  <td>Traficom</td>
                                </tr>
                                <tr>
                                  <td>Reittiyhteydet</td>
                                  <td>
                                    Sovelluksen oma nimitys aikatauluista johdetuille yhteyksille.
                                    Ei tarkkaa ratageometriaa.
                                  </td>
                                  <td>Sovelluksen määritelmä</td>
                                </tr>
                                <tr>
                                  <td>Myöhästymistunniste</td>
                                  <td>Sovelluksen oman komponentin nimi.</td>
                                  <td>Sovelluksen määritelmä</td>
                                </tr>
                              </tbody>
                            </table>
                            <div class="source-links">
                              <a
                                href="https://www.digitraffic.fi/rautatieliikenne/"
                                target="_blank"
                                rel="noopener"
                                >Digitraffic: rautatieliikenne ${icon('external', 14)}</a
                              ><a
                                href="https://www.fintraffic.fi/fi/raide/raideliikenteenpalvelut/tietojarjestelmat/ruma/faq-usein-kysyttya"
                                target="_blank"
                                rel="noopener"
                                >Fintraffic: RUMA-ohje ${icon('external', 14)}</a
                              ><a
                                href="https://www.digitraffic.fi/sovellukset/julia.html"
                                target="_blank"
                                rel="noopener"
                                >Digitraffic: graafinen aikataulu ${icon('external', 14)}</a
                              >
                            </div>`
        }
      </article>
    </div>`;
  }
  private info() {
    return html`<div
      class="modal-backdrop"
      @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget) this.closeInfo();
      }}
    >
      <section
        class="info-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="info-title"
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Tab') {
            const els = this.querySelectorAll<HTMLElement>(
              '.info-modal button,.info-modal a,.info-modal input',
            );
            const first = els[0],
              last = els[els.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <button
          class="icon-button modal-close"
          autofocus
          aria-label="Sulje aineiston tiedot"
          @click=${() => this.closeInfo()}
        >
          ${icon('close')}</button
        ><span class="eyebrow text-mint">RAIDE</span>
        <h2 id="info-title">Tietoa aineistosta</h2>
        <p>
          Itsenäinen portfolio- ja käyttöliittymäprototyyppi. Sovellus ei ole Fintrafficin palvelu
          eikä liikenteenohjausjärjestelmä.
        </p>
        <dl>
          <dt>Junaliikenteen tiedot</dt>
          <dd>
            Fintraffic / Digitraffic ·
            <a
              href="https://creativecommons.org/licenses/by/4.0/deed.fi"
              target="_blank"
              rel="noopener"
              >CC BY 4.0</a
            >
          </dd>
          <dt>Pohjakartta</dt>
          <dd>Natural Earth · public domain</dd>
          <dt>Aikavyöhyke</dt>
          <dd>Europe/Helsinki</dd>
          <dt>Tallenne</dt>
          <dd>
            ${this.recording?.frames.length ?? 0} todellista havaintoa ·
            ${this.recording?.frames[0] ? date(this.recording.frames[0].capturedAt) : '—'}
          </dd>
        </dl>
        <p>
          Kartan yhteydet on johdettu aikataulujen liikennepaikoista. Ne eivät kuvaa tarkkaa
          ratageometriaa, raideosuuksien varaustilaa tai opastimien tilaa.
        </p>
        <p>
          Aikataulussa-osuus lasketaan seurattavista junista, joiden aikaero on tiedossa. Luku on
          tämän näkymän yhteenveto, ei Fintrafficin virallinen täsmällisyysmittari.
        </p>
        <label class="checkbox-label"
          ><input
            type="checkbox"
            .checked=${this.showStations}
            @change=${(e: Event) => (this.showStations = (e.target as HTMLInputElement).checked)}
          />Näytä liikennepaikkojen nimet kartalla</label
        ><a href="https://www.digitraffic.fi/rautatieliikenne/" target="_blank" rel="noopener"
          >Avaa rajapinnan dokumentaatio ${icon('external', 14)}</a
        >
      </section>
    </div>`;
  }
  private closeInfo() {
    this.infoOpen = false;
    this.updateComplete.then(() => this.infoTrigger?.focus());
  }
  render() {
    const title = {
      overview: 'Junaliikenteen tilannekuva',
      network: 'Elävä reittiverkko',
      radar: 'Muutostutka',
      journey: 'Junan eteneminen',
      investigation: 'Tilanneanalyysi',
      timetable: 'Junien aikataulut',
      notices: 'Liikenteen tiedotteet',
      components: 'Komponenttikirjasto',
    }[this.page];
    const networkSearch = this.networkSearchResults();
    const showNetworkResults =
      this.page === 'network' && this.searchOpen && this.query.trim().length > 0;
    const sourceAge = this.updatedAt ? Date.now() - Date.parse(this.updatedAt) : Infinity;
    const sourceState =
      this.mode === 'recorded'
        ? 'recorded'
        : this.status === 'error' || sourceAge > 90_000
          ? 'stale'
          : this.dailyTrainsAvailable
            ? 'live'
            : 'limited';
    const sourceLabel = {
      live: 'AJANTASAINEN',
      recorded: 'TALLENNE',
      stale: 'PÄIVITYSHÄIRIÖ',
      limited: 'RAJATTU AINEISTO',
    }[sourceState];
    return html`<a class="skip-link" href="#main">Siirry sisältöön</a>
      <div class=${`app-shell ${this.focusMode ? 'is-focus-mode' : ''}`} data-focus-mode=${this.focusMode} data-fullscreen=${this.browserFullscreen}>
        <aside class="side-rail">
          <a
            href="#"
            class="rail-brand"
            aria-label="RAIDE, etusivu"
            @click=${(e: Event) => {
              e.preventDefault();
              this.navigate('overview');
            }}
            ><svg width="31" height="33" viewBox="0 0 40 44" fill="none">
              <path
                d="M14 5 5 39M26 5l9 34M11 16h18M8 29h24"
                stroke="currentColor"
                stroke-width="3.5"
              /></svg
          ></a>
          <nav aria-label="Päänavigaatio">
            ${nav.map(([p, n, i]) => html`<button class=${this.page === p ? 'active' : ''} aria-label=${p === 'components' ? 'Kirjasto – Komponenttikirjasto' : p === 'overview' ? 'Tilanne – Tilannekuva' : n} title=${n} aria-current=${this.page === p ? 'page' : nothing} @click=${() => this.navigate(p)}>${icon(i, 22)}<span>${p === 'overview' ? 'Tilanne' : p === 'network' ? 'Verkko' : p === 'radar' ? 'Muutokset' : p === 'journey' ? 'Eteneminen' : p === 'investigation' ? 'Analyysi' : p === 'timetable' ? 'Aikataulut' : p === 'notices' ? 'Tiedotteet' : 'Kirjasto'}</span>${p === 'notices' && this.currentNotices().length ? html`<i class="nav-indicator"></i>` : nothing}</button>`)}
          </nav>
          <button
            class="rail-info"
            title="Tietoa sovelluksesta"
            aria-label="Tietoa sovelluksesta"
            @click=${() => this.openInfo()}
          >
            ${icon('info', 21)}</button
          ><span class="rail-version">1.7</span>
        </aside>
        <div class="main-shell">
          <header class="topbar">
            <div class="wordmark">RAIDE<span>JUNALIIKENNE</span></div>
            <div class="search-box" data-search-open=${showNetworkResults}>
              ${icon('search', 17)}<input
                id="global-search"
                type="search"
                placeholder=${this.page === 'notices' ? 'Hae tiedotteista…' : 'Hae junaa tai liikennepaikkaa…'}
                aria-label=${this.page === 'notices' ? 'Hae tiedotteista' : 'Hae junaa tai liikennepaikkaa'}
                aria-controls=${this.page === 'network' ? 'network-search-results' : nothing}
                aria-expanded=${this.page === 'network' ? String(showNetworkResults) : nothing}
                .value=${this.query}
                @focus=${() => {
                  if (this.page === 'network') this.searchOpen = true;
                }}
                @keydown=${(e: KeyboardEvent) => this.onNetworkSearchKeydown(e)}
                @input=${(e: Event) => {
                  const v = (e.target as HTMLInputElement).value;
                  clearTimeout(this.queryTimer);
                  if (this.page === 'network') {
                    this.searchOpen = true;
                    this.query = v;
                  } else {
                    this.queryTimer = setTimeout(() => (this.query = v), 150);
                  }
                }}
              /><kbd>Ctrl K</kbd>
              ${showNetworkResults
                ? html`<div id="network-search-results" class="network-search-results" role="region" aria-label="Haun tulokset">
                    ${networkSearch.stationMatches.length
                      ? html`<div class="search-section-title">Liikennepaikat</div>
                          ${networkSearch.stationMatches.map(
                            (station) => html`<button class="network-search-result" @click=${() => this.chooseNetworkSearchStation(station)}>
                              <span class="search-result-symbol">${icon('pin', 15)}</span>
                              <span><strong>${station.stationName}</strong><small>${station.stationShortCode} · Avaa reittiverkossa</small></span>
                            </button>`,
                          )}`
                      : nothing}
                    ${networkSearch.trainMatches.length
                      ? html`<div class="search-section-title">Junat</div>
                          ${networkSearch.trainMatches.map(
                            (train) => html`<button class="network-search-result" @click=${() => this.chooseNetworkSearchTrain(train)}>
                              <span class="search-result-symbol">${icon('train', 15)}</span>
                              <span><strong>${label(train)}</strong><small>${this.map.get(endpoints(train)[0])?.stationName ?? endpoints(train)[0]} – ${this.map.get(endpoints(train)[1])?.stationName ?? endpoints(train)[1]}</small></span>
                            </button>`,
                          )}`
                      : nothing}
                    ${!networkSearch.trainMatches.length && !networkSearch.stationMatches.length
                      ? html`<p class="search-empty">Ei tuloksia ladatusta aineistosta. Tarkista hakusana tai valitse toinen aikajakso.</p>`
                      : nothing}
                  </div>`
                : nothing}
            </div>
            <div class=${`source-pill ${sourceState}`} role="status" aria-label=${`${sourceLabel}. ${this.updatedAt ? `Viimeisin vastaanotto ${time(this.updatedAt)}` : 'Aineiston vastaanottoaika puuttuu'}`}>
              <i aria-hidden="true"></i><span><strong>${sourceLabel}</strong><time>${this.updatedAt ? time(this.updatedAt) : '–'}</time></span>
            </div>
            <div class="topbar-status">
              <raide-data-status
                .mode=${this.mode}
                .status=${this.status}
                .lastUpdated=${this.updatedAt}
              ></raide-data-status
              ><time class="header-clock">${time(this.now)}<span>SUOMEN AIKA</span></time>
            </div>
          </header>
          <main id="main" tabindex="-1">
            <div class="page-heading">
              <div>
                <div class="breadcrumb">
                  RAIDE <span>/</span> ${nav.find((n) => n[0] === this.page)?.[1]}
                </div>
                <h1>${title}</h1>
                <p>
                  ${
                    this.page === 'components'
                      ? 'Suunnittelusta toimiviksi, saavutettaviksi käyttöliittymäkomponenteiksi.'
                      : this.page === 'network'
                        ? 'Aikatauluista johdettu, päivittyvä reittiverkko. Havaintotila, ennusteet ja junavalinta yhdellä kaaviolla.'
                        : this.page === 'radar'
                          ? 'Mitä tapahtui edellisen havainnon jälkeen? Muutokset, aikaleimat ja junakohtainen näyttö samassa työtilassa.'
                          : this.page === 'journey'
                            ? 'Junan alkupaikka, viimeisin GPS-havainto, seuraava pysähdys ja määränpää yhdessä näkymässä.'
                            : this.page === 'investigation'
                              ? 'Tutki havaittuja viiveitä, vertaile ennusteita ja seuraa tietomuutosten historiaa.'
                              : 'Aikataulut, junien sijainnit ja matkustajainformaatio yhdessä näkymässä.'
                  }
                </p>
              </div>
              <div class="heading-actions">
                ${expandedPages.has(this.page)
                  ? html`<button
                      class="button focus-toggle"
                      data-testid="focus-toggle"
                      aria-pressed=${this.focusMode}
                      aria-label=${this.focusMode ? 'Sulje koko näytön työtila' : 'Avaa koko näytön työtila'}
                      @click=${() => this.toggleFocusMode()}
                    >${icon(this.focusMode ? 'minimize' : 'maximize', 16)}
                      <span>${this.focusMode ? 'Palauta näkymä' : 'Koko näyttö'}</span></button>`
                  : nothing}
                ${
                  this.page === 'overview'
                    ? html`<select
                        aria-label="Kartan alue"
                        .value=${this.region}
                        @change=${(e: Event) => {
                          this.region = (e.target as HTMLSelectElement).value;
                          this.query =
                            this.region === 'all'
                              ? ''
                              : (this.map.get(this.region)?.stationName ?? '');
                        }}
                      >
                        <option value="all">Koko Suomi</option>
                        <option value="HKI">Helsinki</option>
                        <option value="TPE">Tampere</option>
                        <option value="OL">Oulu</option>
                        <option value="TKU">Turku</option>
                        <option value="KUO">Kuopio</option>
                        <option value="ROI">Rovaniemi</option>
                      </select>`
                    : nothing
                }<button
                  class="button secondary refresh-button"
                  ?disabled=${this.refreshing}
                  @click=${() => this.refresh(true)}
                >
                  ${icon('refresh', 16)}<span
                    >${this.refreshing ? 'Päivitetään' : this.mode === 'recorded' ? 'Hae tuoreet tiedot' : 'Päivitä'}</span
                  >
                </button>
              </div>
            </div>
            ${this.replay()}${this.error ? html`<div class="warning-banner" role="status">${icon('alert', 16)}<span>${this.error}</span><button @click=${() => this.refresh(true)}>Yritä uudelleen</button></div>` : nothing}${
              this.mode === 'live' && !this.recentTrainsAvailable
                ? html`<div class="warning-banner" role="status">
                    ${icon('alert', 16)}<span
                      >Viime aikoina kulkeneiden junien lisäaineistoa ei saatu. Päivän aikataulut
                      ovat käytettävissä, mutta osa edellisen lähtöpäivän junista voi puuttua ilman
                      tuoretta GPS-havaintoa.</span
                    >
                  </div>`
                : nothing
            }${
              this.mode === 'live' && !this.dailyTrainsAvailable
                ? html`<div class="warning-banner degraded-source" role="status">
                    ${icon('alert', 16)}<span
                      ><strong>Rajoitettu aikatauluaineisto.</strong> Päivän koko aikatauluaineistoa ei saatu.
                      Näkymä käyttää viime aikoina aktiivisten junien tietoja; osa junista voi
                      puuttua. Aikataulujen kattavuutta ei ole vahvistettu.</span
                    ><button @click=${() => this.refresh(true)}>Yritä uudelleen</button>
                  </div>`
                : nothing
            }${
              this.mode === 'live' && this.gpsError
                ? html`<div class="warning-banner" role="status">
                    ${icon('alert', 16)}<span
                      >GPS-sijainteja ei juuri nyt saada. Reaaliaikaiset aikataulut, ennusteet ja
                      toteumat ovat edelleen käytössä; kartalla ei esitetä puuttuvia
                      sijainteja.</span
                    ><button @click=${() => this.refresh(true)}>Yritä uudelleen</button>
                  </div>`
                : nothing
            }${
              this.mode === 'live' &&
              !this.error &&
              this.updatedAt &&
              Date.now() - Date.parse(this.updatedAt) > 90000
                ? html`<div class="warning-banner" role="status">
                    ${icon('alert', 16)}<span
                      >Viimeisestä onnistuneesta tietojen vastaanotosta on yli 90 sekuntia. Tarkista
                      yhteys; tiedot voivat olla vanhentuneita.</span
                    ><button @click=${() => this.refresh(true)}>Päivitä</button>
                  </div>`
                : nothing
            }${
              this.bootError
                ? html`<div class="panel empty-state">
                    <h2>Aineistoa ei voitu ladata</h2>
                    <p>${this.bootError}</p>
                    <button class="button primary" @click=${() => this.initialize()}>
                      Yritä uudelleen
                    </button>
                  </div>`
                : !this.recording
                  ? html`<div class="loading-panel">
                      <div class="loading-track"></div>
                      <h2>Haetaan junaliikenteen tietoja</h2>
                      <p>Liikennepaikat, aikataulut ja sijainnit</p>
                    </div>`
                  : this.page === 'overview'
                    ? this.overview()
                    : this.page === 'network'
                      ? this.renderNetwork()
                      : this.page === 'radar'
                        ? this.renderRadar()
                        : this.page === 'journey'
                          ? this.renderJourney()
                          : this.page === 'investigation'
                            ? this.renderInvestigation()
                            : this.page === 'timetable'
                              ? this.renderTimetable()
                              : this.page === 'notices'
                                ? this.renderNotices()
                                : this.renderDocs()
            }
            <footer class="app-footer">
              <span
                >Fintraffic / Digitraffic ·
                <a
                  href="https://creativecommons.org/licenses/by/4.0/deed.fi"
                  target="_blank"
                  rel="noopener"
                  >CC BY 4.0</a
                ><span class="footer-separator">·</span>Itsenäinen portfolio-prototyyppi</span
              ><span class="footer-owner">© 2026 <strong>SANDEEP PARIYAR</strong><span class="footer-separator">·</span>KAIKKI OIKEUDET PIDÄTETÄÄN</span>
            </footer>
          </main>
        </div>
      </div>
      ${this.infoOpen ? this.info() : nothing}
      <div class="sr-only" role="status" aria-live="polite">${this.toast}</div>
      ${this.toast ? html`<div class="toast" aria-hidden="true">${icon('check', 16)}${this.toast}</div>` : nothing}`;
  }
}
customElements.define('raide-app', RaideApp);
if ((import.meta as any).env.DEV && new URLSearchParams(location.search).has('audit'))
  import('./dev-audit');
