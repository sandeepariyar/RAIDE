import type { Observation, ObservationKind } from './investigation-model';

export type RadarKind = ObservationKind | 'all';
export type RadarWindow = 5 | 15 | 60;

export interface RadarSummary {
  items: Observation[];
  total: number;
  forecast: number;
  actual: number;
  cancelled: number;
  track: number;
  trains: number;
  latest: number | null;
}

export interface RadarBucket {
  start: number;
  end: number;
  count: number;
  forecast: number;
  actual: number;
  cancelled: number;
  track: number;
}

/** The final displayed bin includes the observation exactly on its right edge. */
export function eventsForRadarBucket(
  items: readonly Observation[],
  bucket: RadarBucket,
  finalBucket: boolean,
): Observation[] {
  return items.filter((event) => {
    const when = Date.parse(event.observedAt);
    return when >= bucket.start && (when < bucket.end || (finalBucket && when === bucket.end));
  });
}

/**
 * Counts differences *observed between snapshots*. `observedAt` is the moment
 * RAIDE took a later sample, never a claim about when the underlying event occurred.
 */
export function summarizeChanges(
  observations: readonly Observation[],
  now: number,
  minutes: RadarWindow,
  trainKey = '',
  kind: RadarKind = 'all',
): RadarSummary {
  const from = now - minutes * 60_000;
  const unique = new Set<string>();
  const items = observations
    .filter((observation) => {
      const timestamp = Date.parse(observation.observedAt);
      if (!Number.isFinite(timestamp) || timestamp < from || timestamp > now) return false;
      if (trainKey && observation.trainKey !== trainKey) return false;
      if (kind !== 'all' && observation.kind !== kind) return false;
      if (unique.has(observation.id)) return false;
      unique.add(observation.id);
      return true;
    })
    .sort(
      (a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || a.id.localeCompare(b.id),
    );
  return {
    items,
    total: items.length,
    forecast: items.filter((item) => item.kind === 'forecast').length,
    actual: items.filter((item) => item.kind === 'actual').length,
    cancelled: items.filter((item) => item.kind === 'cancelled').length,
    track: items.filter((item) => item.kind === 'track').length,
    trains: new Set(items.map((item) => item.trainKey)).size,
    latest: items.length ? Date.parse(items[0].observedAt) : null,
  };
}

/** Stable time buckets and no extrapolated activity beyond the observed snapshot. */
export function radarBuckets(
  items: readonly Observation[],
  now: number,
  minutes: RadarWindow,
  count = 12,
): RadarBucket[] {
  const width = (minutes * 60_000) / count;
  // Cover the full rolling window even when its endpoints are between
  // clock-aligned boundaries. This may require one additional partial bin.
  const start = Math.floor((now - minutes * 60_000) / width) * width;
  const end = Math.ceil(now / width) * width;
  const slots = Math.max(1, Math.round((end - start) / width));
  const buckets: RadarBucket[] = Array.from({ length: slots }, (_, i) => ({
    start: start + i * width,
    end: start + (i + 1) * width,
    count: 0,
    forecast: 0,
    actual: 0,
    cancelled: 0,
    track: 0,
  }));
  for (const item of items) {
    const timestamp = Date.parse(item.observedAt);
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > now) continue;
    const index = Math.min(slots - 1, Math.floor((timestamp - start) / width));
    const bucket = buckets[index];
    if (!bucket) continue;
    bucket.count++;
    bucket[item.kind]++;
  }
  return buckets;
}

/** Single filter contract for the pulse chart and drill-down feed. */
export function radarViewData(
  observations: readonly Observation[],
  now: number,
  minutes: RadarWindow,
  trainKey = '',
  kind: RadarKind = 'all',
) {
  const base = summarizeChanges(observations, now, minutes, trainKey);
  const narrowed =
    kind === 'all' ? base : summarizeChanges(observations, now, minutes, trainKey, kind);
  return { base, narrowed, buckets: radarBuckets(narrowed.items, now, minutes) };
}

/** Avoid treating all changes as equally severe or implying confirmed incidents. */
export function observationDescription(kind: ObservationKind): string {
  switch (kind) {
    case 'forecast':
      return 'Ennuste muuttui';
    case 'actual':
      return 'Toteumatiedon muutos';
    case 'cancelled':
      return 'Peruutusmerkintä muuttui';
    case 'track':
      return 'Raidenumerotieto muuttui';
  }
}
