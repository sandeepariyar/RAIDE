import { corridors } from './corridors';
import { key, type Location, type Station, type TimeRow, type Train } from './domain';
import { trainsOnCorridor } from './network-analytics';

/**
 * A schematic of *published timetable connections*. Neither an edge nor its
 * service count represents track occupation, signal state, a route permission,
 * a switch, or the precise location of a train.
 */
export interface LivingNetworkOptions {
  trains: Train[];
  stations: Map<string, Station>;
  corridorCodes: string[];
  qualifierCodes?: string[];
  now: number;
  from?: number;
  to?: number;
  selectedTrainKey?: string;
  showBranches?: boolean;
  branchLimit?: number;
  locations?: Location[];
}

export interface LivingNetworkNode {
  code: string;
  name: string;
  isCorridor: boolean;
  corridorIndex: number | null;
  lat?: number;
  lon?: number;
}

export type LivingNetworkServiceClass = 'confirmed' | 'forecast' | 'scheduled' | 'cancelled';

export interface LivingNetworkEdge {
  id: string;
  from: string;
  to: string;
  /** True for adjacent display checkpoints, not a verified physical rail section. */
  isCorridor: boolean;
  /** A selected train visits both endpoints but intermediate display checkpoints
   * have no published visit: an unresolved itinerary span, NOT a track path. */
  isGap: boolean;
  counts: {
    confirmed: number;
    forecast: number;
    scheduled: number;
    cancelled: number;
    /** Explicit unknownDelay marks; overlaps the four exclusive categories. */
    unknown: number;
  };
  /** Distinct timetable services intersecting the selected time window. */
  total: number;
  trainKeys: string[];
  /** Selected service has a published visit to this link, even outside window. */
  selected: boolean;
  earliestEventTime: number | null;
  /** Published timetable direction relative to the edge's from/to orientation. */
  forward: number;
  reverse: number;
}

export interface LivingNetworkStationEvidence {
  stationCode: string;
  at: number;
  source: 'actual' | 'estimate' | 'schedule';
  unknownDelay?: boolean;
}

export interface LivingNetworkSelectedContext {
  trainKey: string;
  origin: string | null;
  destination: string | null;
  /** Last received actual timetable event; does not locate train between stations. */
  lastConfirmed: LivingNetworkStationEvidence | null;
  /** Next received forecast or timetable event; not a driving instruction. */
  nextPublished: LivingNetworkStationEvidence | null;
  /** Raw Digitraffic observation; no snapping or interpolation onto track edges. */
  gps: {
    timestamp: string;
    coordinates: [number, number];
    speed: number;
    ageMs: number;
    freshness: 'fresh' | 'stale';
  } | null;
}

export interface LivingNetworkGraph {
  nodes: LivingNetworkNode[];
  edges: LivingNetworkEdge[];
  selectedContext: LivingNetworkSelectedContext | null;
  trainCount: number;
  from: number;
  to: number;
  caveat: string;
}

interface StationVisit {
  code: string;
  arrival?: TimeRow;
  departure?: TimeRow;
  rows: TimeRow[];
}

interface PairEvidence {
  trainKey: string;
  source: StationVisit;
  destination: StationVisit;
  intervalStart: number;
  intervalEnd: number;
  classification: LivingNetworkServiceClass;
  unknown: boolean;
  direction: 'forward' | 'reverse';
}

interface CandidateEdge {
  from: string;
  to: string;
  isCorridor: boolean;
  isGap: boolean;
  evidence: PairEvidence[];
  selected: boolean;
}

const CAVEAT =
  'Julkaistuihin aikatauluriveihin perustuva kaaviollinen yhteys ja palvelumäärä. Ei rataverkon topologiaa, raideosuuden varaustietoa, turvalaitetietoa tai junan tarkkaa sijaintia.';

function stationVisits(rows: TimeRow[]): StationVisit[] {
  const visits: StationVisit[] = [];
  for (const row of rows) {
    if (!row.stationShortCode) continue;
    const previous = visits.at(-1);
    if (previous?.code === row.stationShortCode) {
      previous.rows.push(row);
      if (row.type === 'ARRIVAL') previous.arrival ??= row;
      else previous.departure ??= row;
    } else {
      visits.push({
        code: row.stationShortCode,
        rows: [row],
        arrival: row.type === 'ARRIVAL' ? row : undefined,
        departure: row.type === 'DEPARTURE' ? row : undefined,
      });
    }
  }
  return visits;
}

function departureRow(visit: StationVisit): TimeRow {
  return visit.departure ?? visit.arrival ?? visit.rows[0];
}

function arrivalRow(visit: StationVisit): TimeRow {
  return visit.arrival ?? visit.departure ?? visit.rows[0];
}

function dateOf(value?: string): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
}

function eventTime(row: TimeRow, now: number): number {
  const actual = dateOf(row.actualTime);
  if (Number.isFinite(actual) && actual <= now + 60_000) return actual;
  const estimate = dateOf(row.unknownDelay ? undefined : row.liveEstimateTime);
  return Number.isFinite(estimate) ? estimate : dateOf(row.scheduledTime);
}

function validActual(row: TimeRow, now: number): boolean {
  const actual = dateOf(row.actualTime);
  return Number.isFinite(actual) && actual <= now + 60_000;
}

function pairEvidence(
  train: Train,
  source: StationVisit,
  destination: StationVisit,
  from: string,
  to: string,
  now: number,
): PairEvidence | null {
  const first = departureRow(source);
  const second = arrivalRow(destination);
  const atFirst = eventTime(first, now);
  const atSecond = eventTime(second, now);
  if (!Number.isFinite(atFirst) || !Number.isFinite(atSecond)) return null;
  const unknown = !!first.unknownDelay || !!second.unknownDelay;
  const classification: LivingNetworkServiceClass =
    train.cancelled || first.cancelled || second.cancelled
      ? 'cancelled'
      : validActual(first, now) && validActual(second, now)
        ? 'confirmed'
        : !unknown &&
            ((!validActual(first, now) && Number.isFinite(dateOf(first.liveEstimateTime))) ||
              (!validActual(second, now) && Number.isFinite(dateOf(second.liveEstimateTime))))
          ? 'forecast'
          : 'scheduled';
  return {
    trainKey: key(train),
    source,
    destination,
    intervalStart: Math.min(atFirst, atSecond),
    intervalEnd: Math.max(atFirst, atSecond),
    classification,
    unknown,
    direction: source.code === from && destination.code === to ? 'forward' : 'reverse',
  };
}

function buildSelectedContext(
  train: Train | undefined,
  locations: Location[] | undefined,
  now: number,
): LivingNetworkSelectedContext | null {
  if (!train) return null;
  const visits = stationVisits(train.timeTableRows);
  let lastConfirmed: LivingNetworkStationEvidence | null = null;
  let nextPublished: LivingNetworkStationEvidence | null = null;
  let lastConfirmedIndex = -1;
  for (let visitIndex = 0; visitIndex < visits.length; visitIndex++) {
    const visit = visits[visitIndex];
    for (const row of visit.rows) {
      const actual = dateOf(row.actualTime);
      if (validActual(row, now) && (!lastConfirmed || actual > lastConfirmed.at)) {
        lastConfirmed = { stationCode: visit.code, at: actual, source: 'actual' };
        lastConfirmedIndex = visitIndex;
      }
    }
  }
  // An earlier station without a reported event must never be labelled as the
  // next station after a later station has already been confirmed.
  for (let visitIndex = lastConfirmedIndex + 1; visitIndex < visits.length; visitIndex++) {
    const visit = visits[visitIndex];
    for (const row of visit.rows) {
      if (validActual(row, now) || train.cancelled || row.cancelled) continue;
      const time = eventTime(row, now);
      if (!Number.isFinite(time) || time < now - 60_000) continue;
      const evidence: LivingNetworkStationEvidence = {
        stationCode: visit.code,
        at: time,
        source: row.liveEstimateTime && !row.unknownDelay ? 'estimate' : 'schedule',
        ...(row.unknownDelay ? { unknownDelay: true } : {}),
      };
      if (!nextPublished || evidence.at < nextPublished.at) nextPublished = evidence;
    }
  }
  const mostRecentGps = locations
    ?.filter((location) => key(location) === key(train))
    .filter((location) => {
      const observedAt = dateOf(location.timestamp);
      const coordinates = location.location?.coordinates;
      return (
        Number.isFinite(observedAt) &&
        observedAt <= now + 60_000 &&
        Array.isArray(coordinates) &&
        coordinates.length === 2 &&
        Number.isFinite(coordinates[0]) &&
        Number.isFinite(coordinates[1]) &&
        coordinates[0] >= -180 &&
        coordinates[0] <= 180 &&
        coordinates[1] >= -90 &&
        coordinates[1] <= 90
      );
    })
    .sort((a, b) => dateOf(b.timestamp) - dateOf(a.timestamp))[0];
  const ageMs = mostRecentGps ? now - dateOf(mostRecentGps.timestamp) : Infinity;
  const gps = mostRecentGps
    ? {
        timestamp: mostRecentGps.timestamp,
        coordinates: mostRecentGps.location.coordinates,
        speed: mostRecentGps.speed,
        ageMs,
        freshness: (ageMs >= -60_000 && ageMs <= 10 * 60_000 ? 'fresh' : 'stale') as
          'fresh' | 'stale',
      }
    : null;
  return {
    trainKey: key(train),
    origin: visits[0]?.code ?? null,
    destination: visits.at(-1)?.code ?? null,
    lastConfirmed,
    nextPublished,
    gps,
  };
}

/**
 * Creates a stable corridor schematic from published station visits. Corridor
 * links aggregate two consecutive *displayed* corridor checkpoints (there may
 * be other published timetable points in between). Branch links are strictly
 * consecutive stations in the original timetable. No geographic route is
 * inferred between either pair.
 */
export function buildLivingNetwork(options: LivingNetworkOptions): LivingNetworkGraph {
  const { trains, stations, now } = options;
  const codes = [...new Set(options.corridorCodes.filter(Boolean))];
  const from = Number.isFinite(options.from) ? options.from! : now - 30 * 60_000;
  const to = Number.isFinite(options.to) ? options.to! : now + 90 * 60_000;
  const rangeStart = Math.min(from, to);
  const rangeEnd = Math.max(from, to);
  const corridorIndex = new Map(codes.map((code, index) => [code, index]));
  const corridorSet = new Set(codes);
  const knownCorridor = Object.values(corridors).find(
    (corridor) => corridor.stations.join('|') === codes.join('|'),
  );
  const qualifierCodes = options.qualifierCodes ?? knownCorridor?.qualifiers ?? [];
  const eligible = trainsOnCorridor(trains, codes, qualifierCodes);
  const selected = options.selectedTrainKey ?? '';
  const candidateEdges = new Map<string, CandidateEdge>();
  const edgeId = (fromCode: string, toCode: string) => `${fromCode}|${toCode}`;
  const addEdge = (fromCode: string, toCode: string, isCorridor: boolean, isGap = false) => {
    const id = isGap ? `gap:${edgeId(fromCode, toCode)}` : edgeId(fromCode, toCode);
    let edge = candidateEdges.get(id);
    if (!edge) {
      edge = { from: fromCode, to: toCode, isCorridor, isGap, evidence: [], selected: false };
      candidateEdges.set(id, edge);
    }
    return edge;
  };
  for (let i = 0; i < codes.length - 1; i++) addEdge(codes[i], codes[i + 1], true);

  // Rank candidate one-hop branches independently of current filter window, so
  // the topology doesn't jump whenever a live clock tick crosses an event.
  const branches = new Map<string, { from: string; to: string; count: Set<string> }>();
  for (const train of eligible) {
    const visits = stationVisits(train.timeTableRows);
    for (let i = 0; i < visits.length - 1; i++) {
      const a = visits[i].code;
      const b = visits[i + 1].code;
      if (a === b || corridorSet.has(a) === corridorSet.has(b)) continue;
      const fromCode = corridorSet.has(a) ? a : b;
      const toCode = corridorSet.has(a) ? b : a;
      const id = edgeId(fromCode, toCode);
      if (!branches.has(id)) branches.set(id, { from: fromCode, to: toCode, count: new Set() });
      branches.get(id)!.count.add(key(train));
    }
  }
  const shownBranches =
    options.showBranches === false
      ? []
      : [...branches.values()]
          .sort(
            (a, b) =>
              b.count.size - a.count.size ||
              (corridorIndex.get(a.from) ?? Infinity) - (corridorIndex.get(b.from) ?? Infinity) ||
              a.to.localeCompare(b.to),
          )
          .slice(0, Math.max(0, Math.min(60, Math.floor(options.branchLimit ?? 14))));
  for (const branch of shownBranches) addEdge(branch.from, branch.to, false);

  for (const train of eligible) {
    const visits = stationVisits(train.timeTableRows);
    const displayed = visits.filter((visit) => corridorSet.has(visit.code));
    const tkey = key(train);
    for (let i = 0; i < displayed.length - 1; i++) {
      const a = displayed[i];
      const b = displayed[i + 1];
      if (a.code === b.code) continue;
      const ia = corridorIndex.get(a.code)!;
      const ib = corridorIndex.get(b.code)!;
      // A service may skip intermediate display checkpoints. Do not spread its
      // evidence across fictitious links; selected services get a clearly
      // differentiated unresolved span so their journey never vanishes.
      const skipped = Math.abs(ia - ib) !== 1;
      if (skipped && tkey !== selected) continue;
      const fromCode = codes[Math.min(ia, ib)];
      const toCode = codes[Math.max(ia, ib)];
      const edge = addEdge(fromCode, toCode, !skipped, skipped);
      if (tkey === selected) edge.selected = true;
      const evidence = pairEvidence(train, a, b, fromCode, toCode, now);
      if (evidence) edge.evidence.push(evidence);
    }
    if (options.showBranches === false) continue;
    for (let i = 0; i < visits.length - 1; i++) {
      const a = visits[i];
      const b = visits[i + 1];
      if (corridorSet.has(a.code) === corridorSet.has(b.code)) continue;
      const fromCode = corridorSet.has(a.code) ? a.code : b.code;
      const toCode = corridorSet.has(a.code) ? b.code : a.code;
      const edge = candidateEdges.get(edgeId(fromCode, toCode));
      if (!edge) continue; // Branch didn't survive deterministic limit.
      if (tkey === selected) edge.selected = true;
      const evidence = pairEvidence(train, a, b, fromCode, toCode, now);
      if (evidence) edge.evidence.push(evidence);
    }
  }

  const edges: LivingNetworkEdge[] = [...candidateEdges].map(([id, candidate]) => {
    const active = candidate.evidence.filter(
      (entry) => entry.intervalStart <= rangeEnd && entry.intervalEnd >= rangeStart,
    );
    const perTrain = new Map<string, PairEvidence>();
    const rank = { scheduled: 0, forecast: 1, confirmed: 2, cancelled: 3 };
    for (const entry of active) {
      const previous = perTrain.get(entry.trainKey);
      if (!previous || rank[entry.classification] > rank[previous.classification]) {
        perTrain.set(entry.trainKey, entry);
      }
    }
    const selectedEvidence = [...perTrain.values()];
    const counts = { confirmed: 0, forecast: 0, scheduled: 0, cancelled: 0, unknown: 0 };
    let forward = 0;
    let reverse = 0;
    let earliestEventTime: number | null = null;
    for (const entry of selectedEvidence) {
      counts[entry.classification]++;
      if (entry.unknown) counts.unknown++;
      if (entry.direction === 'forward') forward++;
      else reverse++;
      earliestEventTime =
        earliestEventTime === null
          ? entry.intervalStart
          : Math.min(earliestEventTime, entry.intervalStart);
    }
    return {
      id,
      from: candidate.from,
      to: candidate.to,
      isCorridor: candidate.isCorridor,
      isGap: candidate.isGap,
      counts,
      total: selectedEvidence.length,
      trainKeys: [...perTrain.keys()].sort(),
      selected: candidate.selected,
      earliestEventTime,
      forward,
      reverse,
    };
  });

  const nodeCodes = new Set(codes);
  for (const branch of shownBranches) nodeCodes.add(branch.to);
  const nodes: LivingNetworkNode[] = [...nodeCodes].map((code) => {
    const station = stations.get(code);
    const index = corridorIndex.get(code);
    return {
      code,
      name: station?.stationName ?? code,
      isCorridor: index !== undefined,
      corridorIndex: index ?? null,
      ...(Number.isFinite(station?.latitude) ? { lat: station!.latitude } : {}),
      ...(Number.isFinite(station?.longitude) ? { lon: station!.longitude } : {}),
    };
  });
  // Count eligible timetable services whose published time range intersects
  // the window, even if they skip intermediate schematic checkpoints. Edge
  // counts deliberately remain a narrower metric of represented connections.
  const servicesInWindow = eligible.filter((train) => {
    const eventTimes = train.timeTableRows
      .map((row) => eventTime(row, now))
      .filter(Number.isFinite);
    return (
      eventTimes.length &&
      Math.min(...eventTimes) <= rangeEnd &&
      Math.max(...eventTimes) >= rangeStart
    );
  });
  const selectedTrain = selected ? trains.find((train) => key(train) === selected) : undefined;
  return {
    nodes,
    edges,
    selectedContext: buildSelectedContext(selectedTrain, options.locations, now),
    trainCount: servicesInWindow.length,
    from: rangeStart,
    to: rangeEnd,
    caveat: CAVEAT,
  };
}
