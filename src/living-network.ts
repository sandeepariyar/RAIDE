import { LitElement, html, nothing, svg } from 'lit';
import { property, state } from 'lit/decorators.js';
import { corridors } from './corridors';
import { bestCorridorForTrain, schematicApproaches, trainsOnCorridor } from './network-analytics';
import { buildTrainProgress } from './train-progress-model';
import { buildLivingNetwork } from './living-network-model';
import { icon } from './icons';
import { key, label, time, type Location, type Station, type Train } from './domain';
import './living-network.css';

type Lens = 'all' | 'forecast' | 'selected';
type Position = { x: number; y: number };

const corridorNames = Object.entries(corridors);
const WINDOW_OPTIONS = [30, 60, 120] as const;

function keyboardActivate(event: KeyboardEvent, action: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
}

function routePath(from: Position, to: Position) {
  if (Math.abs(from.y - to.y) < 2) return `M ${from.x} ${from.y} H ${to.x}`;
  const direction = to.x >= from.x ? 1 : -1;
  const width = Math.abs(to.x - from.x);
  const shoulder = Math.min(43, Math.max(15, width / 3));
  return `M ${from.x} ${from.y} H ${from.x + direction * shoulder} L ${to.x - direction * shoulder} ${to.y} H ${to.x}`;
}

/** Draw a detached bracket ABOVE the corridor, never across its track-like
 * backbone: intermediate physical routing is unverified timetable information. */
function unresolvedPath(from: Position, to: Position) {
  const sign = to.x >= from.x ? 1 : -1;
  const shoulder = Math.min(42, Math.abs(to.x - from.x) / 5) * sign;
  const laneY = Math.min(from.y, to.y) - 150;
  return `M ${from.x} ${from.y - 14} L ${from.x + shoulder} ${laneY} H ${to.x - shoulder} L ${to.x} ${to.y - 14}`;
}

/**
 * Elävä reittiverkko is a timetable-derived representation of station links.
 * Edges are NOT physical track sections, route setting, occupancy or signals.
 * Train badges are drawn at their NEXT published timetable point, not GPS position.
 */
export class LivingNetwork extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) trains: Train[] = [];
  @property({ attribute: false }) locations: Location[] = [];
  @property({ attribute: false }) stations = new Map<string, Station>();
  @property() selected = '';
  @property() mode: 'live' | 'recorded' = 'recorded';
  @property({ type: Number }) now = Date.now();
  @property() updatedAt = '';
  @property({ type: Boolean }) dailyTrainsAvailable = true;
  @property() loadStatus = 'ready';
  @property({ type: Number }) replayStart = 0;
  @property({ type: Number }) replayEnd = 0;
  @property() searchQuery = '';
  @property() focusStationCode = '';
  @property({ type: Number }) focusRequest = 0;

  @state() private corridorId = 'west';
  @state() private windowMinutes: 30 | 60 | 120 = 60;
  @state() private lens: Lens = 'all';
  @state() private showBranches = true;
  @state() private zoom = 1;
  @state() private followSelected = true;
  @state() private focusedEdge = '';
  @state() private focusedStation = '';
  @state() private focusedMarker = '';
  @state() private showAllAtStation = false;
  @state() private showAllOnEdge = false;

  private histogramCache:
    | {
        trains: Train[];
        corridor: string;
        minutes: number;
        minute: number;
        buckets: { start: number; count: number }[];
      }
    | undefined;

  connectedCallback() {
    super.connectedCallback();
    try {
      const value = JSON.parse(localStorage.getItem('raide-network-view-v2') ?? 'null');
      if (!value || typeof value !== 'object') return;
      if (typeof value.corridor === 'string' && value.corridor in corridors)
        this.corridorId = value.corridor;
      if (WINDOW_OPTIONS.includes(value.minutes)) this.windowMinutes = value.minutes;
      if (['all', 'forecast', 'selected'].includes(value.lens)) this.lens = value.lens;
      if (typeof value.branches === 'boolean') this.showBranches = value.branches;
      if (Number.isFinite(value.zoom) && value.zoom >= 0.1 && value.zoom <= 1.6)
        this.zoom = value.zoom;
      if (typeof value.follow === 'boolean') this.followSelected = value.follow;
    } catch {
      // An unavailable storage API or an old preference cannot break the view.
    }
  }

  private cached:
    | {
        trains: Train[];
        stations: Map<string, Station>;
        nowBucket: number;
        corridor: string;
        window: number;
        branches: boolean;
        selected: string;
        graph: ReturnType<typeof buildLivingNetwork>;
      }
    | undefined;

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('selected') && this.selected) {
      this.focusedStation = '';
      this.focusedEdge = '';
      this.showAllOnEdge = false;
      const train = this.trains.find((item) => key(item) === this.selected);
      const best = train && bestCorridorForTrain(train);
      if (this.followSelected && best && best.id !== this.corridorId) {
        this.corridorId = best.id;
        this.focusedEdge = '';
        this.focusedStation = '';
      }
    }
    if ((changed.has('focusStationCode') || changed.has('focusRequest')) && this.focusStationCode) {
      if (!corridors[this.corridorId].stations.includes(this.focusStationCode)) {
        const suitable = Object.entries(corridors).find(([, corridor]) =>
          corridor.stations.includes(this.focusStationCode),
        );
        if (suitable) this.corridorId = suitable[0];
      }
      this.focusStation(this.focusStationCode);
    }
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has('focusStationCode') || changed.has('focusRequest')) {
      this.centerStation(this.focusStationCode);
    } else if (
      this.followSelected &&
      (changed.has('selected') || changed.has('corridorId') || changed.has('followSelected'))
    ) {
      this.centerSelected();
    }
    if (
      ['corridorId', 'windowMinutes', 'lens', 'showBranches', 'zoom', 'followSelected'].some((k) =>
        changed.has(k),
      )
    ) {
      try {
        localStorage.setItem(
          'raide-network-view-v2',
          JSON.stringify({
            corridor: this.corridorId,
            minutes: this.windowMinutes,
            lens: this.lens,
            branches: this.showBranches,
            zoom: this.zoom,
            follow: this.followSelected,
          }),
        );
      } catch {
        // Session-only interaction remains functional.
      }
    }
  }

  private centerStation(code: string) {
    const stage = this.querySelector<HTMLElement>('.living-network-stage');
    if (!stage || !code) return;
    const index = corridors[this.corridorId].stations.indexOf(code);
    if (index < 0) return;
    const x = (128 + index * 177) * this.zoom;
    stage.scrollLeft = Math.max(0, x - stage.clientWidth / 2);
  }

  private centerSelected() {
    const train = this.trains.find((item) => key(item) === this.selected);
    const progress = train ? buildTrainProgress(train, this.locations, this.now) : undefined;
    if (!progress) return;
    const codes = corridors[this.corridorId].stations;
    const target = [
      progress.next?.code,
      progress.current?.code,
      progress.lastConfirmed?.code,
      progress.origin,
      progress.destination,
    ].find((candidate) => candidate && codes.includes(candidate));
    if (target) this.centerStation(target);
  }

  private fitToStage() {
    const stage = this.querySelector<HTMLElement>('.living-network-stage');
    const width = Math.max(1050, corridors[this.corridorId].stations.length * 177 + 180);
    if (!stage?.clientWidth) return;
    // On a phone this may intentionally become a low-detail overview; normal
    // labels remain accessible at a larger zoom, and the overview says so.
    this.zoom = Math.max(
      0.1,
      Math.min(1.6, Math.floor(((stage.clientWidth - 26) / width) * 100) / 100),
    );
    stage.scrollLeft = 0;
  }

  private timelineBuckets(codes: Set<string>) {
    const minute = Math.floor(this.now / 60_000);
    const cached = this.histogramCache;
    if (
      cached &&
      cached.trains === this.trains &&
      cached.corridor === this.corridorId &&
      cached.minutes === this.windowMinutes &&
      cached.minute === minute
    )
      return cached.buckets;
    const start = minute * 60_000;
    const windowMs = this.windowMinutes * 60_000;
    const size = windowMs / 12;
    const keys = Array.from({ length: 12 }, () => new Set<string>());
    for (const train of this.trains) {
      if (train.cancelled) continue;
      const id = key(train);
      for (const row of train.timeTableRows) {
        if (!codes.has(row.stationShortCode) || row.cancelled) continue;
        const at = Date.parse(
          row.actualTime ??
            (row.unknownDelay ? undefined : row.liveEstimateTime) ??
            row.scheduledTime,
        );
        if (!Number.isFinite(at) || at < start || at >= start + windowMs) continue;
        keys[Math.floor((at - start) / size)].add(id);
      }
    }
    const buckets = keys.map((set, i) => ({ start: start + i * size, count: set.size }));
    this.histogramCache = {
      trains: this.trains,
      corridor: this.corridorId,
      minutes: this.windowMinutes,
      minute,
      buckets,
    };
    return buckets;
  }

  private cycleStation(event: KeyboardEvent, code: string, codes: string[]) {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) {
      keyboardActivate(event, () => this.focusStation(code));
      return;
    }
    event.preventDefault();
    const current = Math.max(0, codes.indexOf(code));
    const next = codes[(current + step + codes.length) % codes.length];
    this.focusStation(next);
    this.centerStation(next);
    this.updateComplete.then(() =>
      this.querySelector<SVGGElement>(`[data-station="${next}"]`)?.focus(),
    );
  }

  private cycleEdge(event: KeyboardEvent, edgeId: string, ids: string[]) {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) {
      keyboardActivate(event, () => {
        this.focusedEdge = edgeId;
        this.focusedStation = '';
      });
      return;
    }
    event.preventDefault();
    const next = ids[(Math.max(0, ids.indexOf(edgeId)) + step + ids.length) % ids.length];
    this.focusedEdge = next;
    this.focusedStation = '';
    this.updateComplete.then(() =>
      this.querySelector<SVGGElement>(`[data-edge="${next}"]`)?.focus(),
    );
  }

  private cycleMarker(event: KeyboardEvent, trainKey: string, ids: string[]) {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) {
      keyboardActivate(event, () => this.selectService(trainKey));
      return;
    }
    event.preventDefault();
    const next = ids[(Math.max(0, ids.indexOf(trainKey)) + step + ids.length) % ids.length];
    this.focusedMarker = next;
    this.updateComplete.then(() =>
      this.querySelector<SVGGElement>(`[data-service="${next}"]`)?.focus(),
    );
  }

  private graph() {
    const nowBucket = Math.floor(this.now / 15000);
    const cached = this.cached;
    if (
      cached &&
      cached.trains === this.trains &&
      cached.stations === this.stations &&
      cached.nowBucket === nowBucket &&
      cached.corridor === this.corridorId &&
      cached.window === this.windowMinutes &&
      cached.branches === this.showBranches &&
      cached.selected === this.selected
    )
      return cached.graph;
    const graph = buildLivingNetwork({
      trains: this.trains,
      stations: this.stations,
      corridorCodes: corridors[this.corridorId].stations,
      now: this.now,
      from: this.now - 15 * 60000,
      to: this.now + this.windowMinutes * 60000,
      selectedTrainKey: this.selected,
      showBranches: this.showBranches,
      branchLimit: 18,
    });
    this.cached = {
      trains: this.trains,
      stations: this.stations,
      nowBucket,
      corridor: this.corridorId,
      window: this.windowMinutes,
      branches: this.showBranches,
      selected: this.selected,
      graph,
    };
    return graph;
  }

  private selectService(trainKey: string) {
    this.dispatchEvent(
      new CustomEvent('train-select', { detail: trainKey, bubbles: true, composed: true }),
    );
    this.focusedStation = '';
    this.focusedEdge = '';
    this.lens = 'selected';
  }

  private focusStation(code: string) {
    this.focusedStation = code;
    this.focusedEdge = '';
    this.showAllAtStation = false;
  }

  private changeCorridor(value: string) {
    if (!(value in corridors)) return;
    // A deliberate corridor choice must not be undone by the previously selected train.
    this.followSelected = false;
    this.corridorId = value;
    this.focusedEdge = '';
    this.focusedStation = '';
    this.lens = 'all';
  }

  private followSelectedTrain() {
    const train = this.trains.find((item) => key(item) === this.selected);
    if (!train) return;
    const best = bestCorridorForTrain(train);
    if (best && best.id !== this.corridorId) this.changeCorridor(best.id);
    // updated() centers the selected service after the corridor has rendered.
    this.followSelected = true;
  }

  private seek(timestamp: number) {
    if (this.mode !== 'recorded' || !Number.isFinite(timestamp)) return;
    const target = Math.max(this.replayStart, Math.min(this.replayEnd, timestamp));
    this.dispatchEvent(
      new CustomEvent('network-time-seek', { detail: target, bubbles: true, composed: true }),
    );
  }

  render() {
    const corridor = corridors[this.corridorId];
    const graph = this.graph();
    const selectedTrain = this.trains.find((train) => key(train) === this.selected);
    const selectedOnCorridor = selectedTrain
      ? trainsOnCorridor([selectedTrain], corridor.stations, corridor.qualifiers).length > 0
      : false;
    const selectedCorridor =
      selectedTrain && !selectedOnCorridor ? bestCorridorForTrain(selectedTrain) : undefined;
    const progress = selectedTrain
      ? buildTrainProgress(selectedTrain, this.locations, this.now)
      : undefined;
    const corridorCodes = corridor.stations;
    const corridorSet = new Set(corridorCodes);
    const normalizedSearch = this.searchQuery.trim().toLocaleLowerCase('fi-FI');
    const matchesSearch = (value: string) =>
      Boolean(normalizedSearch && value.toLocaleLowerCase('fi-FI').includes(normalizedSearch));
    const yMain = 320;
    const width = Math.max(1050, corridorCodes.length * 177 + 180);
    const height = 660;
    const positions = new Map<string, Position>();
    corridorCodes.forEach((code, index) => positions.set(code, { x: 128 + index * 177, y: yMain }));

    const branchNodes = graph.nodes
      .filter((node) => !corridorSet.has(node.code))
      .slice(0, this.showBranches ? 18 : 0);
    const branchSlots = new Map<string, number>();
    for (const node of branchNodes) {
      const attachment = graph.edges.find(
        (edge) =>
          (edge.from === node.code && corridorSet.has(edge.to)) ||
          (edge.to === node.code && corridorSet.has(edge.from)),
      );
      if (!attachment) continue;
      const parentCode = attachment.from === node.code ? attachment.to : attachment.from;
      const parent = positions.get(parentCode);
      if (!parent) continue;
      const slot = branchSlots.get(parentCode) ?? 0;
      branchSlots.set(parentCode, slot + 1);
      const above = slot % 2 === 0;
      const tier = Math.floor(slot / 2);
      positions.set(node.code, {
        x: parent.x + (tier % 2 === 0 ? 53 : -53),
        y: above ? 112 + tier * 47 : 518 - tier * 47,
      });
    }

    const visibleEdges = graph.edges
      .filter((edge) => positions.has(edge.from) && positions.has(edge.to))
      .filter((edge) =>
        this.lens === 'selected'
          ? edge.selected
          : this.lens === 'forecast'
            ? edge.counts.forecast > 0
            : true,
      )
      .sort((a, b) => Number(a.selected) - Number(b.selected))
      .slice(0, 140);
    // The backdrop is a timetable-evidence layer, never a claim of physical rail topology.
    const evidencedLinks = new Set(
      graph.edges
        .filter((edge) => !edge.isGap && edge.total > 0)
        .map((edge) => [edge.from, edge.to].sort().join('|')),
    );
    const edgeFocus = graph.edges.find((edge) => edge.id === this.focusedEdge);
    const focusedStation = this.focusedStation;
    const focusOrder = graph.nodes
      .filter((node) => positions.has(node.code))
      .map((node) => node.code);
    const focusEdges = visibleEdges.map((edge) => edge.id);

    // Published upcoming points, never train coordinates or current track occupation.
    const stationApproaches = schematicApproaches(
      this.trains,
      corridorCodes,
      this.now,
      corridor.qualifiers,
    );
    const focusedApproaches = stationApproaches.filter(
      (entry) => entry.row.stationShortCode === focusedStation,
    );
    const uniqueUpcoming = new Set<string>();
    const shownApproaches = stationApproaches
      .filter((entry) => entry.expected <= this.now + this.windowMinutes * 60000)
      .sort(
        (a, b) =>
          Number(key(b.train) === this.selected) - Number(key(a.train) === this.selected) ||
          a.expected - b.expected,
      )
      .filter((entry) => {
        const id = key(entry.train);
        if (uniqueUpcoming.has(id)) return false;
        uniqueUpcoming.add(id);
        return true;
      });
    const markerSlots = new Map<string, number>();
    const markerOverflow = new Map<string, { code: string; direction: string; count: number }>();
    const markers = shownApproaches.flatMap((entry) => {
      const pos = positions.get(entry.row.stationShortCode)!;
      const reverse = entry.direction === 'reverse';
      const slotKey = `${entry.row.stationShortCode}/${entry.direction}`;
      const slot = markerSlots.get(slotKey) ?? 0;
      markerSlots.set(slotKey, slot + 1);
      if (slot >= 2) {
        const excess = markerOverflow.get(slotKey) ?? {
          code: entry.row.stationShortCode,
          direction: entry.direction,
          count: 0,
        };
        excess.count++;
        markerOverflow.set(slotKey, excess);
        return [];
      }
      return [{ ...entry, x: pos.x - 45, y: reverse ? 382 + slot * 48 : 224 - slot * 48 }];
    });
    const markerFocusOrder = markers.map((entry) => key(entry.train));
    const dataAge = Date.now() - Date.parse(this.updatedAt);
    const liveStale =
      this.mode === 'live' &&
      (this.loadStatus !== 'ready' || !Number.isFinite(dataAge) || dataAge > 90_000);
    const sourceState =
      this.mode === 'recorded'
        ? 'recorded'
        : liveStale
          ? 'stale'
          : this.dailyTrainsAvailable
            ? 'live'
            : 'limited';
    const stamp =
      sourceState === 'recorded'
        ? 'TALLENTEEN AIKAHETKI'
        : sourceState === 'stale'
          ? 'VIIMEISIN VASTAANOTETTU AINEISTO · PÄIVITYSHÄIRIÖ'
          : sourceState === 'limited'
            ? 'RAJATTU REAALIAIKAINEN AINEISTO'
            : 'REAALIAIKAINEN AINEISTO';
    const selectedServiceName = selectedTrain
      ? `${label(selectedTrain)}${selectedOnCorridor ? '' : ' · toisella rataosalla'}`
      : 'Ei junavalintaa';
    const gpsAge = progress?.gpsAgeMinutes;

    const buckets = this.timelineBuckets(corridorSet);
    const maxBucket = Math.max(1, ...buckets.map((bucket) => bucket.count));

    return html`<section class="living-network" aria-label="Elävä reittiverkko">
      <div class="living-network-head">
        <div>
          <span class="eyebrow">RAIDE / REITTIVERKON HAVAINTONÄKYMÄ</span>
          <h2>Elävä reittiverkko</h2>
          <p>
            Rautatieyhteydet ja junien tulevat aikataulupisteet näkyvät muuttuvana kaaviona.
            Pysähdystiedot eivät kerro raiteen varaustilaa.
          </p>
        </div>
        <span class="status" data-role="status" data-source=${sourceState}
          >${icon(this.mode === 'live' ? 'wifi' : 'clock', 16)} ${stamp} · ${time(this.now)}</span
        >
      </div>

      <div class="living-network-controls">
        <label
          >Rataosakokonaisuus
          <select
            aria-label="Valitse reittiverkon rataosa"
            .value=${this.corridorId}
            @change=${(e: Event) => this.changeCorridor((e.target as HTMLSelectElement).value)}
          >
            ${corridorNames.map(([id, value]) => html`<option value=${id}>${value.name}</option>`)}
          </select></label
        >
        <div role="group" aria-label="Verkon tietotaso" class="living-network-lenses">
          ${(
            [
              ['all', 'Yhteydet'],
              ['forecast', 'Ennusteet'],
              ['selected', 'Valittu juna'],
            ] as const
          ).map(
            ([id, text]) =>
              html`<button
                aria-pressed=${this.lens === id}
                class=${this.lens === id ? 'active' : ''}
                ?disabled=${id === 'selected' && !selectedOnCorridor}
                @click=${() => (this.lens = id)}
              >
                ${text}
              </button>`,
          )}
        </div>
        <label
          >Aikajakso
          <select
            aria-label="Valitse reittiverkon aikaikkuna"
            .value=${String(this.windowMinutes)}
            @change=${(e: Event) => (this.windowMinutes = Number((e.target as HTMLSelectElement).value) as 30 | 60 | 120)}
          >
            ${WINDOW_OPTIONS.map((value) => html`<option value=${value}>${value} min</option>`)}
          </select></label
        >
        <label class="living-network-branches"
          ><input
            type="checkbox"
            .checked=${this.showBranches}
            @change=${(e: Event) => (this.showBranches = (e.target as HTMLInputElement).checked)}
          />
          Liityntäyhteydet</label
        >
        <div role="group" aria-label="Kaavion mittakaava" class="living-network-zoom">
          <button
            class="fit-button"
            aria-label="Sovita reittiverkko näkymään"
            title="Sovita reittiverkko näkymään"
            @click=${() => this.fitToStage()}
          >
            ${icon('layers', 16)} Sovita verkko
          </button>
          <button
            aria-pressed=${this.followSelected}
            ?disabled=${!selectedTrain}
            title="Keskitä ja seuraa valittua junaa"
            @click=${() => {
              if (this.followSelected) this.followSelected = false;
              else this.followSelectedTrain();
            }}
          >
            ${icon('target', 16)} Seuraa valittua
          </button>
          <button
            aria-label="Loitonna kaaviota"
            ?disabled=${this.zoom <= 0.11}
            @click=${() => (this.zoom = Math.max(0.1, Math.round((this.zoom - 0.15) * 100) / 100))}
          >
            ${icon('minus', 16)}
          </button>
          <button
            aria-label="Palauta kaavion koko"
            title="Palauta 100 %"
            @click=${() => (this.zoom = 1)}
          >
            ${Math.round(this.zoom * 100)} %
          </button>
          <button
            aria-label="Lähennä kaaviota"
            ?disabled=${this.zoom >= 1.55}
            @click=${() => (this.zoom = Math.min(1.6, Math.round((this.zoom + 0.15) * 100) / 100))}
          >
            ${icon('plus', 16)}
          </button>
        </div>
      </div>

      <div
        class="living-network-stage"
        role="region"
        tabindex="0"
        data-overview=${this.zoom < 0.38 ? 'true' : 'false'}
        aria-label="Vieritettävä reittiverkon kaavio. Valitse asema nuolinäppäimillä. Junamerkit eivät tarkoita GPS-sijainteja."
      >
        ${this.zoom < 0.38 ? html`<div class="living-network-overview-note">Yleiskuva · lähennä nähdäksesi asemat ja junat</div>` : nothing}
        ${
          graph.nodes.length
            ? svg`<svg class="living-network-svg" width=${Math.round(width * this.zoom)} height=${Math.round(height * this.zoom)} style=${`width:${Math.round(width * this.zoom)}px;height:${Math.round(height * this.zoom)}px`} viewBox=${`0 0 ${width} ${height}`} role="group" aria-label="Aikatauluyhteyksistä johdettu reittikaavio, ${corridor.name}">
          <defs>
            <pattern id="living-dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".55" fill="#5b8796" opacity=".31" /></pattern>
          </defs>
          <rect width=${width} height=${height} fill="url(#living-dots)" />
          <text x="55" y="45" class="minor">AIKATAULUIHIN PERUSTUVA REITTIKUVA · EI OPASTIN- TAI RAIDEVARAUSTIETOA</text>
          ${corridorCodes.slice(0, -1).map((fromCode, index) => {
            const toCode = corridorCodes[index + 1];
            if (!evidencedLinks.has([fromCode, toCode].sort().join('|'))) return nothing;
            const a = positions.get(fromCode)!;
            const b = positions.get(toCode)!;
            return svg`<path d=${routePath(a, b)} fill="none" stroke="#416073" stroke-width="10" opacity=".28" stroke-linecap="round" />
              <path d=${routePath(a, b)} fill="none" stroke="#68869a" stroke-width="2" stroke-dasharray="6 9" opacity=".55" />`;
          })}
          ${visibleEdges.map((edge) => {
            const a = positions.get(edge.from)!;
            const b = positions.get(edge.to)!;
            const d = edge.isGap ? unresolvedPath(a, b) : routePath(a, b);
            const isChosen = edge.id === this.focusedEdge;
            const cancelled = edge.counts.cancelled > 0;
            const forecast = !cancelled && edge.counts.forecast > 0;
            const unknown = edge.counts.unknown > 0;
            const confirmed = !cancelled && !forecast && edge.counts.confirmed > 0;
            const state = edge.selected
              ? 'selected'
              : cancelled
                ? 'cancelled'
                : forecast
                  ? 'forecast'
                  : confirmed
                    ? 'confirmed'
                    : edge.total
                      ? 'evidence'
                      : 'unknown';
            const labelText = `${this.stations.get(edge.from)?.stationName ?? edge.from} – ${this.stations.get(edge.to)?.stationName ?? edge.to}, ${edge.total} aikatauluyhteyttä, suuntaan ${edge.forward}, vastasuuntaan ${edge.reverse}${edge.isGap ? '. Valitun junan havaintopisteiden välinen ratkaisematon jakso, ei ratayhteyden vahvistusta' : ''}${cancelled ? '. Sisältää peruutuksia' : ''}${unknown ? '. Osassa viive tuntematon' : ''}`;
            return svg`<g class=${`living-network-edge ${edge.selected ? 'is-selected' : ''} ${edge.isGap ? 'is-gap' : ''} ${cancelled ? 'is-cancelled' : ''} ${forecast ? 'is-forecast' : ''} ${unknown ? 'has-unknown' : ''} ${confirmed ? 'is-confirmed' : ''} ${isChosen ? 'is-focused' : ''}`} data-state=${state} data-edge=${edge.id} tabindex=${edge.id === (this.focusedEdge || focusEdges[0]) ? '0' : '-1'} role="button" aria-label=${labelText} @click=${() => {
              this.focusedEdge = edge.id;
              this.focusedStation = '';
              this.showAllOnEdge = false;
            }} @keydown=${(event: KeyboardEvent) => this.cycleEdge(event, edge.id, focusEdges)}>
              <path d=${d} fill="none" style="stroke:transparent;stroke-width:24px;pointer-events:stroke" />
              <path d=${d} class="living-network-ink" />
              ${edge.isGap ? svg`<text x=${(a.x + b.x) / 2} y=${Math.min(a.y, b.y) - 162} text-anchor="middle" class="gap-label">TARKKA REITTI TUNTEMATON</text>` : edge.total ? svg`<text x=${(a.x + b.x) / 2} y=${(a.y + b.y) / 2 - 12} text-anchor="middle" class="edge-flow">${edge.forward ? `→ ${edge.forward}` : ''}${edge.forward && edge.reverse ? '   ·   ' : ''}${edge.reverse ? `← ${edge.reverse}` : ''}${cancelled ? '  ⨯' : ''}${unknown ? '  ?' : ''}</text>` : nothing}
              <title>${labelText}</title>
            </g>`;
          })}
          ${graph.nodes
            .filter((node) => positions.has(node.code))
            .map((node) => {
              const pos = positions.get(node.code)!;
              const selected =
                node.code === this.focusedStation || node.code === progress?.next?.code;
              const core = corridorSet.has(node.code);
              const searched = matchesSearch(node.name) || matchesSearch(node.code);
              return svg`<g class=${`living-network-node ${selected ? 'is-selected' : ''} ${searched ? 'is-search' : ''}`} tabindex=${node.code === (this.focusedStation || focusOrder[0]) ? '0' : '-1'} role="button" data-station=${node.code} aria-label=${`Tarkastele liikennepaikkaa ${node.name}. Nuolinäppäimet siirtävät asemaa.`} @click=${() => {
                this.focusStation(node.code);
                this.centerStation(node.code);
              }} @keydown=${(event: KeyboardEvent) => this.cycleStation(event, node.code, focusOrder)}>
              <rect class="living-network-hit-target" x=${pos.x - 22} y=${pos.y - 22} width="44" height="44" rx="10" />
              <rect x=${pos.x - (core ? 7 : 5)} y=${pos.y - (core ? 7 : 5)} width=${core ? 14 : 10} height=${core ? 14 : 10} rx="2" transform=${`rotate(45 ${pos.x} ${pos.y})`} />
              <text x=${pos.x} y=${pos.y - (core ? 28 : 21)} text-anchor="middle">${node.name.length > 19 ? `${node.name.slice(0, 17)}…` : node.name}</text>
              <text x=${pos.x} y=${pos.y + (core ? 28 : 20)} text-anchor="middle" class="minor">${node.code}</text>
              <title>${node.name}</title>
            </g>`;
            })}
          ${markers.map((entry) => {
            const selected = key(entry.train) === this.selected;
            const textLabel = label(entry.train);
            const searched =
              matchesSearch(textLabel) || matchesSearch(String(entry.train.trainNumber));
            return svg`<g class=${`living-network-service ${selected ? 'is-selected' : ''} ${searched ? 'is-search' : ''}`} data-state=${selected ? 'selected' : entry.source === 'estimate' ? 'changed' : 'published'} data-service=${key(entry.train)} tabindex=${key(entry.train) === (this.focusedMarker || (markerFocusOrder.includes(this.selected) ? this.selected : markerFocusOrder[0])) ? '0' : '-1'} role="button" aria-label=${`${textLabel}, seuraava aikataulupiste ${entry.row.stationShortCode}, ${time(entry.expected)}, ${entry.source === 'estimate' ? 'ennuste' : 'aikataulu'}. Nuolinäppäimet vaihtavat junaa.`} @click=${() => this.selectService(key(entry.train))} @keydown=${(event: KeyboardEvent) => this.cycleMarker(event, key(entry.train), markerFocusOrder)}>
              <rect x=${entry.x} y=${entry.y} width="90" height="30" rx="6" />
              <text x=${entry.x + 45} y=${entry.y + 20} text-anchor="middle">${textLabel}</text>
              <text x=${entry.x + 45} y=${entry.y - 7} text-anchor="middle" class="source-label">${time(entry.expected)} · ${entry.source === 'estimate' ? 'ENNUSTE' : 'AIKATAULU'}</text>
              <title>${textLabel}: seuraava aikataulupiste ${entry.row.stationShortCode} ${time(entry.expected)}</title>
            </g>`;
          })}
          ${[...markerOverflow.values()].map(({ code, direction, count }) => {
            const pos = positions.get(code)!;
            const x = pos.x - 32;
            const y = direction === 'reverse' ? 478 : 132;
            return svg`<g class="living-network-service living-network-service-cluster" tabindex="0" role="button" aria-label=${`${count} muuta junaa, ${this.stations.get(code)?.stationName ?? code}; avaa liikennepaikan tiedot`} @click=${() => {
              this.focusStation(code);
            }} @keydown=${(event: KeyboardEvent) =>
              keyboardActivate(event, () => {
                this.focusStation(code);
              })}>
              <rect x=${x} y=${y} width="64" height="28" rx="6"/><text x=${x + 32} y=${y + 19} text-anchor="middle">+${count}</text>
            </g>`;
          })}
          <text x="60" y="615" class="minor">YHTEYDET: JULKAISTUT AIKATAULUPISTEET · EIVÄT TODELLISIA VAIHTEITA TAI VARATTUJA RAITEITA</text>
        </svg>`
            : html`<div class="living-network-empty">
                <strong>Reittiaineisto puuttuu</strong>
                <p>Valitun rataosan aikataulupisteitä ei löydy ladatusta aineistosta.</p>
              </div>`
        }
      </div>

      <aside class="living-network-inspector" aria-label="Reittiverkon tarkennus">
        <span class="eyebrow">VALITUN KOHTEEN TARKASTELU</span>
        ${
          selectedTrain && !selectedOnCorridor && !edgeFocus && !focusedStation
            ? html`<div class="living-network-corridor-notice" role="status">
                <strong>${label(selectedTrain)} ei kuulu tähän rataosaan.</strong>
                <span
                  >Valittu juna säilyy muissa näkymissä. Verkon juna- ja yhteysluvut koskevat vain
                  nykyistä rataosaa.</span
                >
                ${
                  selectedCorridor && selectedCorridor.id !== this.corridorId
                    ? html`<button @click=${() => this.followSelectedTrain()}>
                        Näytä rataosalla ${selectedCorridor.corridor.name}
                      </button>`
                    : nothing
                }
              </div>`
            : nothing
        }
        <h3>
          ${edgeFocus ? `${this.stations.get(edgeFocus.from)?.stationName ?? edgeFocus.from} – ${this.stations.get(edgeFocus.to)?.stationName ?? edgeFocus.to}` : focusedStation ? (this.stations.get(focusedStation)?.stationName ?? focusedStation) : selectedServiceName}
        </h3>
        ${
          edgeFocus
            ? html`<p>
                  ${edgeFocus.isGap ? 'Valitun junan julkaistujen tarkastelupisteiden välissä on esittämättä jääviä liikennepaikkoja. Katkoviiva ei todista kuljettua fyysistä raidetta.' : 'Aikataulujen julkaistu yhteys. Lukumäärät eivät ilmaise raideosuuden varausta.'}
                </p>
                <dl>
                  <dt>Yhteyden junia</dt>
                  <dd>${edgeFocus.total}</dd>
                  <dt>Kohti rataosan loppua</dt>
                  <dd>${edgeFocus.forward}</dd>
                  <dt>Vastasuuntaan</dt>
                  <dd>${edgeFocus.reverse}</dd>
                  <dt>Vahvistettu molemmista päistä</dt>
                  <dd>${edgeFocus.counts.confirmed}</dd>
                  <dt>Ennusteita</dt>
                  <dd>${edgeFocus.counts.forecast}</dd>
                  <dt>Vain aikataulu</dt>
                  <dd>${edgeFocus.counts.scheduled}</dd>
                  <dt>Peruttuja</dt>
                  <dd>${edgeFocus.counts.cancelled}</dd>
                  <dt>Tuntematon viive*</dt>
                  <dd>${edgeFocus.counts.unknown}</dd>
                </dl>
                <p>* Tuntematon viive on lisämääre ja sisältyy myös yllä olevaan luokkaan.</p>
                ${edgeFocus.trainKeys
                  .slice(0, this.showAllOnEdge ? edgeFocus.trainKeys.length : 5)
                  .map((trainKey) => {
                    const train = this.trains.find((item) => key(item) === trainKey);
                    return html`<button
                      class="living-network-inspector-train"
                      @click=${() => this.selectService(trainKey)}
                    >
                      ${train ? label(train) : trainKey}
                    </button>`;
                  })}
                ${edgeFocus.trainKeys.length > 5 ? html`<button @click=${() => (this.showAllOnEdge = !this.showAllOnEdge)}>${this.showAllOnEdge ? 'Näytä vähemmän' : `Näytä kaikki ${edgeFocus.trainKeys.length} junaa`}</button>` : nothing}`
            : focusedStation
              ? html`<p>
                    Liikennepaikka näkyy julkaistun aikataulun reittipisteenä. Valitse juna
                    avattavaksi.
                  </p>
                  <dl>
                    <dt>Liikennepaikkatunnus</dt>
                    <dd>${focusedStation}</dd>
                    <dt>Seuraavia aikataulupisteitä</dt>
                    <dd>
                      ${stationApproaches.filter((entry) => entry.row.stationShortCode === focusedStation).length}
                    </dd>
                  </dl>
                  ${focusedApproaches
                    .slice(0, this.showAllAtStation ? focusedApproaches.length : 6)
                    .map(
                      (entry) =>
                        html`<button
                          class="living-network-inspector-train"
                          @click=${() => this.selectService(key(entry.train))}
                        >
                          ${label(entry.train)} · ${time(entry.expected)}
                        </button>`,
                    )}
                  ${
                    !this.showAllAtStation && focusedApproaches.length > 6
                      ? html`<button @click=${() => (this.showAllAtStation = true)}>
                          Näytä kaikki ${focusedApproaches.length} junaa
                        </button>`
                      : nothing
                  }`
              : selectedTrain && progress
                ? html`<p>
                      Valittua junaa seurataan kaikissa RAIDE-näkymissä. Reittiverkko ei sijoita
                      junaa fyysiselle raiteelle.
                    </p>
                    <dl>
                      <dt>Lähtöpaikka</dt>
                      <dd>${this.stations.get(progress.origin)?.stationName ?? progress.origin}</dd>
                      <dt>Määränpää</dt>
                      <dd>
                        ${this.stations.get(progress.destination)?.stationName ?? progress.destination}
                      </dd>
                      <dt>Vahvistettu asema</dt>
                      <dd>
                        ${progress.lastConfirmed ? (this.stations.get(progress.lastConfirmed.code)?.stationName ?? progress.lastConfirmed.code) : 'Ei vahvistettua'}
                      </dd>
                      <dt>Seuraava aikataulupiste</dt>
                      <dd>
                        ${progress.next ? (this.stations.get(progress.next.code)?.stationName ?? progress.next.code) : 'Ei tiedossa'}
                      </dd>
                      <dt>GPS-havainto</dt>
                      <dd>
                        ${progress.gps ? `${progress.gpsStatus === 'stale' ? 'Vanhentunut' : 'Tuore'} · ${time(progress.gps.timestamp)} · ${gpsAge} min sitten` : 'Ei saatavilla'}
                      </dd>
                    </dl>
                    <button
                      @click=${() => this.dispatchEvent(new CustomEvent('open-journey', { bubbles: true, composed: true }))}
                    >
                      Avaa junan eteneminen
                    </button>`
                : html`<p>
                    Valitse reittipiste tai junan aikataulutunnus. Aikatauluhavaintoja päivitetään
                    lähdejärjestelmän mukaan.
                  </p>`
        }
        <div class="living-network-summary">
          <div><strong>${graph.trainCount}</strong><span>Junaa valitussa aikaikkunassa</span></div>
          <div>
            <strong>${graph.edges.filter((edge) => !edge.isGap).length}</strong
            ><span>Kaavion aikatauluyhteyttä</span>
          </div>
        </div>
        <p class="living-network-caveat">${graph.caveat}</p>
      </aside>

      <div class="living-network-timeline">
        <div class="living-network-timeline-title">
          <label
            >${this.mode === 'recorded' ? 'TOISTA JA TARKASTELE' : 'LÄHIAJAN AIKATAULUTAPAHTUMAT'}</label
          ><time>${time(this.now)}</time>
        </div>
        ${
          this.mode === 'recorded' && this.replayEnd > this.replayStart
            ? html`<button
                  @click=${() => this.seek(this.replayStart)}
                  aria-label="Siirry tallenteen alkuun"
                >
                  Alkuun
                </button>
                <input
                  type="range"
                  min=${this.replayStart}
                  max=${this.replayEnd}
                  step="1000"
                  aria-label="Reittiverkon tallenteen aika"
                  .value=${String(Math.min(this.replayEnd, Math.max(this.replayStart, this.now)))}
                  @input=${(e: Event) => this.seek(Number((e.target as HTMLInputElement).value))}
                />
                <button
                  @click=${() => this.seek(this.replayEnd)}
                  aria-label="Siirry tallenteen loppuun"
                >
                  Loppuun
                </button>`
            : html`<div
                class="living-network-spark"
                role="img"
                aria-label="Seuraavien ${this.windowMinutes} minuutin aikataulupisteiden junamäärät"
              >
                ${buckets.map((bucket) => html`<div style=${`height:${Math.max(6, Math.round((bucket.count / maxBucket) * 45))}px`} title=${`${time(bucket.start)}: ${bucket.count} junaa`}></div>`)}
              </div>`
        }
        <output aria-label=${this.mode === 'recorded' ? 'Tallenteen loppu' : 'Aikaikkunan loppu'}
          >${this.mode === 'recorded' && this.replayEnd > this.replayStart ? time(this.replayEnd) : time(this.now + this.windowMinutes * 60000)}</output
        >
      </div>

      <div class="living-network-legend">
        <span class="legend-item"><i class="legend-swatch"></i> Julkaistu yhteys</span>
        <span class="legend-item"><i class="legend-swatch selected"></i> Valittu junareitti</span>
        <span class="legend-item"><i class="legend-swatch gap"></i> Tuntematon yhteysväli</span>
        <span class="legend-item"
          ><i class="legend-swatch confirmed"></i> Molemmat päät toteutuneet</span
        >
        <span class="legend-item"><i class="legend-swatch forecast"></i> Ennuste</span>
        <span class="legend-item"><i class="legend-swatch cancelled"></i> Peruutus</span>
        <span class="legend-item"><i class="legend-swatch unknown"></i> Tuntematon viive</span>
        <span class="disclaimer"
          >Kaavio on aikataulujen reittihavainnollistus, ei turvalaitteen tilakuva.
          ${this.mode === 'recorded' ? 'Tallenne' : 'Viimeisin päivitys'}:
          ${time(this.updatedAt || this.now)}.</span
        >
      </div>
    </section>`;
  }
}

customElements.define('raide-living-network', LivingNetwork);
