import { endpoints, key, type Location, type Train } from './domain';
import { journeyStops, type JourneyStop } from './network-analytics';

export interface TrainProgressModel {
  origin: string;
  destination: string;
  stops: JourneyStop[];
  completed: number;
  total: number;
  lastConfirmed: JourneyStop | undefined;
  /** Arrival was observed but departure from the station is not yet confirmed. */
  current: JourneyStop | undefined;
  /** First unconfirmed stop after the last confirmed route point. Its timestamp
   * may be overdue and does not establish the train's physical position. */
  next: JourneyStop | undefined;
  gps: Location | undefined;
  gpsStatus: 'fresh' | 'stale' | 'absent';
  gpsAgeMinutes: number | null;
  cancelled: boolean;
}

/**
 * Reconciles timetable events and location observations without conflating them.
 * Stop progress is inferred from confirmed station events. GPS is only a dated
 * coordinate observation; it is never projected onto a track or interpolated.
 */
export function buildTrainProgress(
  train: Train,
  locations: Location[],
  now: number,
  commercialOnly = true,
): TrainProgressModel {
  const fullRoute = journeyStops(train);
  const stops = commercialOnly ? fullRoute.filter((stop) => stop.commercial) : fullRoute;
  const counted = stops.filter((stop) => !stop.cancelled);
  const confirmed = counted.filter(
    (stop) => stop.stage === 'completed' || stop.stage === 'at-station',
  );
  // An upstream actual event may be missing even after a later station has
  // reported an arrival. Progress must never jump backwards to that gap.
  const lastConfirmedIndex = counted.reduce(
    (latest, stop, index) =>
      stop.stage === 'completed' || stop.stage === 'at-station' ? index : latest,
    -1,
  );
  const lastConfirmed = lastConfirmedIndex >= 0 ? counted[lastConfirmedIndex] : undefined;
  const latestGps = locations
    .filter((location) => {
      const ts = Date.parse(location.timestamp);
      const [lon, lat] = location.location?.coordinates ?? [NaN, NaN];
      return (
        key(location) === key(train) &&
        Number.isFinite(ts) &&
        ts <= now + 60_000 &&
        Number.isFinite(lon) &&
        Number.isFinite(lat) &&
        lon >= -180 &&
        lon <= 180 &&
        lat >= -90 &&
        lat <= 90
      );
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  const ageMs = latestGps ? Math.max(0, now - Date.parse(latestGps.timestamp)) : null;
  const gpsStatus = latestGps ? (ageMs! <= 10 * 60_000 ? 'fresh' : 'stale') : 'absent';
  const [origin, destination] = endpoints(train);
  return {
    origin,
    destination,
    stops,
    completed: confirmed.filter((stop) => stop.stage === 'completed').length,
    total: counted.length,
    lastConfirmed,
    // A station with an unreported departure is not still "current" after a
    // later station has confirmed the train's arrival.
    current: lastConfirmed?.stage === 'at-station' ? lastConfirmed : undefined,
    next: counted.slice(lastConfirmedIndex + 1).find((stop) => stop.stage === 'upcoming'),
    gps: latestGps,
    gpsStatus,
    gpsAgeMinutes: ageMs === null ? null : Math.floor(ageMs / 60_000),
    cancelled: train.cancelled,
  };
}
