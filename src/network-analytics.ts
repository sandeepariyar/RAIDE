import { corridors } from './corridors';
import { delay, key, stationSequence, type Location, type TimeRow, type Train } from './domain';

export interface CorridorSummary {
  id: string;
  name: string;
  stations: string[];
  trains: Train[];
  delayed: number;
  serious: number;
  cancelled: number;
  freshLocations: number;
}

// A train belongs to a corridor when its published route includes at least
// two of its timetable locations. This is route overlap, NOT track occupancy.
export function trainsOnCorridor(trains: Train[], codes: string[], qualifiers: string[] = []) {
  const allowed = new Set(codes);
  const signature = new Set(qualifiers);
  return trains.filter((train) => {
    const matches = new Set(stationSequence(train).filter((code) => allowed.has(code)));
    // Shared trunk points alone (e.g. Helsinki + Pasila) do not prove
    // membership of a branch such as Helsinki–Turku.
    return (
      matches.size >= 2 && (!signature.size || [...matches].some((code) => signature.has(code)))
    );
  });
}

/** Favor the corridor that actually covers most of the selected service's published route. */
export function bestCorridorForTrain(train: Train) {
  const route = new Set(stationSequence(train));
  return Object.entries(corridors)
    .filter(
      ([, corridor]) => trainsOnCorridor([train], corridor.stations, corridor.qualifiers).length,
    )
    .map(([id, corridor]) => ({
      id,
      corridor,
      score:
        corridor.stations.filter((station) => route.has(station)).length +
        corridor.qualifiers.filter((station) => route.has(station)).length,
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0];
}

export function summarizeCorridors(trains: Train[], locations: Location[], now: number) {
  const located = new Set(
    locations
      .filter((location) => {
        const at = Date.parse(location.timestamp);
        return at >= now - 10 * 60_000 && at <= now + 60_000;
      })
      .map(key),
  );
  return Object.entries(corridors).map(([id, corridor]): CorridorSummary => {
    const members = trainsOnCorridor(trains, corridor.stations, corridor.qualifiers);
    return {
      id,
      name: corridor.name,
      stations: corridor.stations,
      trains: members,
      delayed: members.filter((t) => !t.cancelled && (delay(t, now) ?? 0) > 5).length,
      serious: members.filter((t) => !t.cancelled && (delay(t, now) ?? 0) > 15).length,
      cancelled: members.filter((t) => t.cancelled).length,
      freshLocations: members.filter((t) => located.has(key(t))).length,
    };
  });
}

export interface Approach {
  train: Train;
  row: TimeRow;
  expected: number;
  late: number | null;
}

function publishedExpectedTime(row: TimeRow): number {
  // An explicitly unknown delay cannot be treated as a reliable ETA. Keep
  // the published schedule as the timestamp and expose the uncertainty.
  return Date.parse(
    !row.unknownDelay && row.liveEstimateTime ? row.liveEstimateTime : row.scheduledTime,
  );
}

// One upcoming timetable point per train. No GPS is extrapolated and no
// claim is made about the exact track segment occupied by the train.
export function upcomingCorridorPoints(
  trains: Train[],
  codes: string[],
  now: number,
  qualifiers: string[] = [],
) {
  const allowed = new Set(codes);
  const result = new Map<string, Approach[]>(codes.map((code) => [code, []]));
  for (const train of trainsOnCorridor(trains, codes, qualifiers)) {
    if (train.cancelled) continue;
    const lastConfirmedIndex = train.timeTableRows.reduce((last, row, index) => {
      const at = row.actualTime ? Date.parse(row.actualTime) : NaN;
      return Number.isFinite(at) && at <= now + 60_000 ? index : last;
    }, -1);
    const row = train.timeTableRows.find((candidate, index) => {
      // Skip missing earlier events after the train is confirmed farther along
      // its published route. Such gaps must not appear as upcoming stations.
      if (index <= lastConfirmedIndex) return false;
      if (!allowed.has(candidate.stationShortCode) || candidate.cancelled || candidate.actualTime)
        return false;
      return publishedExpectedTime(candidate) >= now - 60_000;
    });
    if (!row) continue;
    const expected = publishedExpectedTime(row);
    // A previous station's observed delay is not a forecast for this upcoming point.
    const late =
      row.unknownDelay || !row.liveEstimateTime
        ? null
        : Math.round((Date.parse(row.liveEstimateTime) - Date.parse(row.scheduledTime)) / 60_000);
    result.get(row.stationShortCode)!.push({ train, row, expected, late });
  }
  for (const approaches of result.values()) approaches.sort((a, b) => a.expected - b.expected);
  return result;
}

export interface SchematicApproach extends Approach {
  stationIndex: number;
  direction: 'forward' | 'reverse';
  source: 'estimate' | 'schedule';
}

/** Published next timetable points, NOT physical position, route setting or track occupation. */
export function schematicApproaches(
  trains: Train[],
  codes: string[],
  now: number,
  qualifiers: string[] = [],
): SchematicApproach[] {
  const upcoming = upcomingCorridorPoints(trains, codes, now, qualifiers);
  const indices = new Map(codes.map((code, index) => [code, index]));
  const result: SchematicApproach[] = [];
  for (const [code, points] of upcoming) {
    for (const point of points) {
      const route = stationSequence(point.train)
        .map((stop) => indices.get(stop))
        .filter((index): index is number => index !== undefined);
      const direction = route.length > 1 && route[0] > route.at(-1)! ? 'reverse' : 'forward';
      result.push({
        ...point,
        stationIndex: indices.get(code)!,
        direction,
        source: point.row.liveEstimateTime && !point.row.unknownDelay ? 'estimate' : 'schedule',
      });
    }
  }
  return result.sort(
    (a, b) => a.expected - b.expected || a.train.trainNumber - b.train.trainNumber,
  );
}

export interface JourneyStop {
  code: string;
  arrival?: TimeRow;
  departure?: TimeRow;
  commercial: boolean;
  cancelled: boolean;
  scheduled: number;
  observed: number;
  source: 'actual' | 'estimate' | 'schedule';
  deviation: number | null;
  stage: 'completed' | 'at-station' | 'upcoming';
}

export function journeyStops(train: Train): JourneyStop[] {
  const groups: TimeRow[][] = [];
  for (const row of train.timeTableRows) {
    const group = groups.at(-1);
    if (group && group[0].stationShortCode === row.stationShortCode) group.push(row);
    else groups.push([row]);
  }
  return groups.map((rows) => {
    const arrival = rows.find((row) => row.type === 'ARRIVAL');
    const departure = rows.find((row) => row.type === 'DEPARTURE');
    const representative = arrival ?? departure ?? rows[0];
    const scheduled = Date.parse(representative.scheduledTime);
    const observed = Date.parse(
      representative.actualTime ?? representative.liveEstimateTime ?? representative.scheduledTime,
    );
    const source = representative.actualTime
      ? 'actual'
      : representative.liveEstimateTime
        ? 'estimate'
        : 'schedule';
    const completed = departure ? !!departure.actualTime : !!arrival?.actualTime;
    const atStation = !!arrival?.actualTime && !!departure && !departure.actualTime;
    return {
      code: rows[0].stationShortCode,
      arrival,
      departure,
      commercial: rows.some((row) => row.commercialStop),
      cancelled: train.cancelled || rows.every((row) => row.cancelled),
      scheduled,
      observed,
      source,
      deviation:
        representative.unknownDelay || source === 'schedule'
          ? null
          : Math.round((observed - scheduled) / 60_000),
      stage: completed ? 'completed' : atStation ? 'at-station' : 'upcoming',
    } satisfies JourneyStop;
  });
}
