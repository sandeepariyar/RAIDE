import { key, type Train, type TimeRow } from './domain';
import { rowDeviation } from './investigation-model';

export interface ChartCell {
  station: string;
  start: number;
  trains: Train[];
  count: number;
  delayed: number;
  known: number;
  delayMinutes: number;
  actual: number;
  estimated: number;
  scheduled: number;
}

export type HeatMetric = 'delayed' | 'average' | 'trains';

export function observedTime(row: TimeRow): number {
  return Date.parse(row.actualTime ?? row.liveEstimateTime ?? row.scheduledTime);
}

/** Choose the same representative event for the cell totals and the details panel. */
export function heatRow(
  train: Train,
  station: string,
  start: number,
  end: number,
): TimeRow | undefined {
  return train.timeTableRows
    .filter(
      (row) =>
        !row.cancelled &&
        row.stationShortCode === station &&
        observedTime(row) >= start &&
        observedTime(row) < end,
    )
    .sort((a, b) => {
      const knownDifference = Number(rowDeviation(b) !== null) - Number(rowDeviation(a) !== null);
      return knownDifference || Number(b.type === 'ARRIVAL') - Number(a.type === 'ARRIVAL');
    })[0];
}

/** A journey crossing the window must remain visible even when both endpoints lie outside it. */
export function corridorTrains(
  trains: Train[],
  stationCodes: string[],
  from: number,
  to: number,
): Train[] {
  const allowed = new Set(stationCodes);
  return trains.filter((train) => {
    const rows = train.timeTableRows.filter((r) => allowed.has(r.stationShortCode));
    if (new Set(rows.map((r) => r.stationShortCode)).size < 2) return false;
    const times = rows.map(observedTime).filter(Number.isFinite);
    return Boolean(times.length) && Math.min(...times) <= to && Math.max(...times) >= from;
  });
}

export function prioritizedTrains(trains: Train[], selected: string, now: number): Train[] {
  return [...trains].sort((a, b) => {
    const selectedOrder = Number(key(b) === selected) - Number(key(a) === selected);
    if (selectedOrder) return selectedOrder;
    const closest = (train: Train) =>
      Math.min(
        ...train.timeTableRows.map((r) => Math.abs(observedTime(r) - now)).filter(Number.isFinite),
        Number.MAX_SAFE_INTEGER,
      );
    return closest(a) - closest(b) || a.trainNumber - b.trainNumber;
  });
}

/** A missing deviation is unknown, not an infinitely early train. */
export function trainLaneDeviation(
  train: Train,
  allowed: Set<string>,
  midpoint: number,
): number | null {
  const candidate = train.timeTableRows
    .filter((row) => allowed.has(row.stationShortCode) && rowDeviation(row) !== null)
    .sort((a, b) => Math.abs(observedTime(a) - midpoint) - Math.abs(observedTime(b) - midpoint))[0];
  const deviation = candidate ? rowDeviation(candidate) : null;
  return deviation !== null && Number.isFinite(deviation) ? deviation : null;
}

export function trainLaneDelayLabel(deviation: number | null): string {
  return deviation === null || !Number.isFinite(deviation)
    ? 'Ei viivetietoa'
    : `${deviation > 0 ? '+' : ''}${deviation} min`;
}

export function makeHeatmap(
  trains: Train[],
  stationCodes: string[],
  from: number,
  to: number,
  minutes = 15,
): ChartCell[] {
  const allowed = new Set(stationCodes);
  const bucketMs = minutes * 60000;
  // Stable wall-clock boundaries: 12:00, 12:15, 12:30, 12:45, never 12:07:34.
  const alignedFrom = Math.floor(from / bucketMs) * bucketMs;
  const steps = Math.max(1, Math.ceil((to - alignedFrom) / bucketMs));
  const byCell = new Map<string, Map<string, Train>>();
  for (const train of trains) {
    if (train.cancelled) continue;
    for (const row of train.timeTableRows) {
      if (!allowed.has(row.stationShortCode) || row.cancelled) continue;
      const timestamp = observedTime(row);
      if (!Number.isFinite(timestamp) || timestamp < alignedFrom || timestamp >= to) continue;
      const slot = Math.floor((timestamp - alignedFrom) / bucketMs);
      const id = `${row.stationShortCode}|${slot}`;
      if (!byCell.has(id)) byCell.set(id, new Map());
      const entries = byCell.get(id)!;
      const trainKey = key(train);
      entries.set(trainKey, train);
    }
  }
  return stationCodes.flatMap((station) =>
    Array.from({ length: steps }, (_, i) => {
      const start = alignedFrom + i * bucketMs;
      const matches = [...(byCell.get(`${station}|${i}`)?.values() ?? [])].map((train) => ({
        train,
        row: heatRow(train, station, start, start + bucketMs)!,
      }));
      const late = matches.filter(({ row }) => (rowDeviation(row) ?? 0) > 0);
      return {
        station,
        start,
        trains: matches.map((m) => m.train),
        count: matches.length,
        delayed: late.length,
        known: matches.filter((m) => rowDeviation(m.row) !== null).length,
        delayMinutes: late.reduce((total, m) => total + (rowDeviation(m.row) ?? 0), 0),
        actual: matches.filter((m) => !!m.row.actualTime).length,
        estimated: matches.filter((m) => !m.row.actualTime && !!m.row.liveEstimateTime).length,
        scheduled: matches.filter((m) => !m.row.actualTime && !m.row.liveEstimateTime).length,
      };
    }),
  );
}

export function heatValue(cell: ChartCell, metric: HeatMetric): number {
  if (metric === 'trains') return cell.count;
  if (metric === 'delayed') return cell.delayed;
  return cell.delayed ? cell.delayMinutes / cell.delayed : 0;
}

export interface FlowBucket {
  start: number;
  arrivals: number;
  departures: number;
}

/** These are timetable events, not confirmed track occupancy or capacity. */
export function makeFlow(
  trains: Train[],
  stations: string[],
  from: number,
  to: number,
  minutes: number,
): FlowBucket[] {
  const accepted = new Set(stations);
  const size = minutes * 60000;
  const alignedFrom = Math.floor(from / size) * size;
  const count = Math.max(1, Math.ceil((to - alignedFrom) / size));
  const buckets: FlowBucket[] = Array.from({ length: count }, (_, i) => ({
    start: alignedFrom + i * size,
    arrivals: 0,
    departures: 0,
  }));
  for (const train of trains)
    for (const row of train.timeTableRows) {
      if (!row.commercialStop || !accepted.has(row.stationShortCode) || row.cancelled) continue;
      const ts = observedTime(row);
      if (!Number.isFinite(ts) || ts < alignedFrom || ts >= to) continue;
      const bucket = buckets[Math.floor((ts - alignedFrom) / size)];
      if (row.type === 'ARRIVAL') bucket.arrivals++;
      else bucket.departures++;
    }
  return buckets;
}

export function trainSpan(
  train: Train,
  allowed: Set<string>,
): {
  scheduledStart: number;
  scheduledEnd: number;
  observedStart: number;
  observedEnd: number;
} | null {
  const rows = train.timeTableRows.filter((r) => allowed.has(r.stationShortCode));
  if (new Set(rows.map((r) => r.stationShortCode)).size < 2) return null;
  const scheduled = rows.map((r) => Date.parse(r.scheduledTime)).filter(Number.isFinite);
  const observed = rows.map(observedTime).filter(Number.isFinite);
  if (!scheduled.length || !observed.length) return null;
  return {
    scheduledStart: Math.min(...scheduled),
    scheduledEnd: Math.max(...scheduled),
    observedStart: Math.min(...observed),
    observedEnd: Math.max(...observed),
  };
}
