import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  date,
  delay,
  endpoints,
  key,
  localDate,
  nextStop,
  time,
  type Location,
  type TimeRow,
  type Train,
} from './domain';
import { corridors } from './corridors';
import {
  bestCorridorForTrain,
  journeyStops,
  schematicApproaches,
  trainsOnCorridor,
  upcomingCorridorPoints,
} from './network-analytics';
import { makeHeatmap } from './timetable-analytics';
import { buildTrainProgress } from './train-progress-model';
import { compareSnapshots, rowDeviation } from './investigation-model';
import { radarBuckets, summarizeChanges } from './change-radar-model';
import { RailService } from './service';

const utc = (clock: string) => `2026-11-22T${clock}:00Z`;
const epoch = (clock: string) => Date.parse(utc(clock));
const row = (
  stationShortCode: string,
  scheduled: string,
  type: TimeRow['type'] = 'ARRIVAL',
  extra: Partial<TimeRow> = {},
): TimeRow => ({
  stationShortCode,
  scheduledTime: scheduled,
  type,
  commercialStop: true,
  cancelled: false,
  ...extra,
});
const train = (number: number, timeTableRows: TimeRow[], departureDate = '2026-11-22'): Train => ({
  trainNumber: number,
  departureDate,
  trainType: 'IC',
  trainCategory: 'Long-distance',
  runningCurrently: true,
  cancelled: false,
  timeTableRows,
});
const gps = (trainNumber: number, timestamp: string, departureDate = '2026-11-22'): Location => ({
  trainNumber,
  departureDate,
  timestamp,
  speed: 92,
  location: { type: 'Point', coordinates: [25.47, 65.01] },
});
const sample = train(25, [
  row('HKI', utc('10:00'), 'DEPARTURE', { actualTime: utc('10:02') }),
  row('TPE', utc('11:30'), 'ARRIVAL', { actualTime: utc('11:41') }),
  row('TPE', utc('11:35'), 'DEPARTURE', { actualTime: utc('11:48') }),
  row('OL', utc('14:00'), 'ARRIVAL', { liveEstimateTime: utc('14:13') }),
  row('ROI', utc('16:00'), 'ARRIVAL'),
]);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Release gate: train identity, time and route truth', () => {
  it('does not merge same-number trains with different departure dates', () => {
    expect(key(sample)).not.toBe(key(train(25, sample.timeTableRows, '2026-11-21')));
  });

  it('follows Finland local service date across UTC midnight and DST seasons', () => {
    expect(localDate(new Date('2026-11-21T22:30:00Z'))).toBe('2026-11-22');
    expect(localDate(new Date('2026-06-30T21:30:00Z'))).toBe('2026-07-01');
    expect(time('2026-11-22T12:30:00Z')).toBe('14.30');
    expect(date('2026-11-22T22:30:00Z')).toContain('23.11.2026');
  });

  it('keeps origin, destination and next commercial point distinct', () => {
    expect(endpoints(sample)).toEqual(['HKI', 'ROI']);
    expect(nextStop(sample, epoch('12:00'))?.stationShortCode).toBe('OL');
    expect(delay(sample, epoch('12:00'))).toBe(13);
  });

  it('never turns an unknown future delay into the historical last-confirmed delay', () => {
    const unknown = train(2, [
      row('HKI', utc('10:00'), 'DEPARTURE', { actualTime: utc('10:19') }),
      row('TPE', utc('12:15'), 'ARRIVAL', { unknownDelay: true }),
    ]);
    expect(delay(unknown, epoch('12:00'))).toBeNull();
    expect(
      upcomingCorridorPoints([unknown], ['HKI', 'TPE'], epoch('12:00')).get('TPE')?.[0].late,
    ).toBeNull();
  });

  it('actual time takes precedence over estimated time, while unknown and cancelled are not zero', () => {
    const known = row('OL', utc('12:00'), 'ARRIVAL', {
      liveEstimateTime: utc('12:07'),
      actualTime: utc('12:11'),
    });
    expect(rowDeviation(known)).toBe(11);
    expect(rowDeviation({ ...known, unknownDelay: true })).toBeNull();
    expect(rowDeviation({ ...known, cancelled: true })).toBeNull();
    expect(rowDeviation(row('OL', utc('12:00')))).toBeNull();
  });

  it('does not confuse two trunk stations with membership of a branch line', () => {
    const northbound = train(3, [
      row('HKI', utc('10:00'), 'DEPARTURE'),
      row('PSL', utc('10:07')),
      row('TPE', utc('11:00')),
      row('OL', utc('14:00')),
    ]);
    expect(
      trainsOnCorridor([northbound], corridors.turku.stations, corridors.turku.qualifiers),
    ).toEqual([]);
    expect(
      trainsOnCorridor([northbound], corridors.west.stations, corridors.west.qualifiers),
    ).toEqual([northbound]);
    expect(bestCorridorForTrain(northbound)?.id).toBe('west');
  });

  it('marks a departed station completed and preserves forecast-only future station as upcoming', () => {
    const stops = journeyStops(sample);
    expect(stops.map((stop) => stop.code)).toEqual(['HKI', 'TPE', 'OL', 'ROI']);
    expect(stops[1]).toMatchObject({ source: 'actual', deviation: 11, stage: 'completed' });
    expect(stops[2]).toMatchObject({ source: 'estimate', deviation: 13, stage: 'upcoming' });
    expect(stops[3]).toMatchObject({ source: 'schedule', deviation: null, stage: 'upcoming' });
  });
});

describe('Release gate: last known position is not fabricated live position', () => {
  it('selects the latest fresh GPS of the exact train and exposes its age', () => {
    const now = epoch('12:00');
    const model = buildTrainProgress(
      sample,
      [
        gps(25, utc('11:52')),
        gps(25, utc('11:58')),
        gps(25, utc('11:59'), '2026-11-21'),
        gps(44, utc('11:59')),
      ],
      now,
    );
    expect(model.gps?.timestamp).toBe(utc('11:58'));
    expect(model.gpsStatus).toBe('fresh');
    expect(model.gpsAgeMinutes).toBe(2);
    expect(model.lastConfirmed?.code).toBe('TPE');
    expect(model.next?.code).toBe('OL');
    expect(model.completed).toBe(2);
  });

  it('reports old GPS as stale instead of extrapolating new coordinates', () => {
    const now = epoch('12:00');
    const old = gps(25, utc('11:40'));
    const model = buildTrainProgress(sample, [old], now);
    expect(model.gps).toBe(old);
    expect(model.gpsStatus).toBe('stale');
    expect(model.gpsAgeMinutes).toBe(20);
  });

  it('ignores implausible future timestamps and out-of-range coordinates', () => {
    const now = epoch('12:00');
    const future = gps(25, utc('12:03'));
    const impossible = {
      ...gps(25, utc('11:59')),
      location: { type: 'Point' as const, coordinates: [221, 200] as [number, number] },
    };
    const model = buildTrainProgress(sample, [future, impossible], now);
    expect(model.gpsStatus).toBe('absent');
    expect(model.gps).toBeUndefined();
  });

  it('does not count a cancelled stop as confirmed progress', () => {
    const cancelledService = train(8, [
      row('HKI', utc('10:00'), 'DEPARTURE', { actualTime: utc('10:00') }),
      row('TPE', utc('11:30'), 'ARRIVAL', { cancelled: true }),
      row('OL', utc('14:00')),
    ]);
    const model = buildTrainProgress(cancelledService, [], epoch('12:00'));
    expect(model.completed).toBe(1);
    expect(model.total).toBe(2);
    expect(model.next?.code).toBe('OL');
  });

  it('distinguishes being at a station from the next station in the direction of travel', () => {
    const atStation = train(9, [
      row('HKI', utc('10:00'), 'DEPARTURE', { actualTime: utc('10:00') }),
      row('TPE', utc('11:30'), 'ARRIVAL', { actualTime: utc('11:31') }),
      row('TPE', utc('11:35'), 'DEPARTURE'),
      row('OL', utc('14:00')),
    ]);
    expect(journeyStops(atStation)[1].stage).toBe('at-station');
    expect(buildTrainProgress(atStation, [], epoch('12:00')).next?.code).toBe('OL');
  });
});

describe('Release gate: snapshots describe observations, not imagined incident times', () => {
  it('does not invent events for the first snapshot or unrelated reused train number', () => {
    const previous = [sample];
    const renumbered = train(25, sample.timeTableRows, '2026-11-21');
    expect(compareSnapshots([], previous, utc('12:00'))).toEqual([]);
    expect(compareSnapshots(previous, [renumbered], utc('12:05'))).toEqual([]);
  });

  it('records forecast revisions with the later snapshot timestamp and before/after evidence', () => {
    const revised = train(
      25,
      sample.timeTableRows.map((r) =>
        r.stationShortCode === 'OL' ? { ...r, liveEstimateTime: utc('14:25') } : { ...r },
      ),
    );
    const observations = compareSnapshots([sample], [revised], utc('12:05'));
    const revision = observations.find((observation) => observation.kind === 'forecast');
    expect(revision?.observedAt).toBe(utc('12:05'));
    expect(revision?.description).toContain('→');
    expect(revision?.description).toContain('16.13');
    expect(revision?.description).toContain('16.25');
    const summary = summarizeChanges(observations, epoch('12:06'), 5);
    expect(summary).toMatchObject({ forecast: 1, trains: 1 });
  });

  it('does not silently merge a cancellation and forecast change into the same event', () => {
    const changed = train(
      25,
      sample.timeTableRows.map((r) =>
        r.stationShortCode === 'OL'
          ? { ...r, cancelled: true, liveEstimateTime: utc('14:20') }
          : { ...r },
      ),
    );
    const items = compareSnapshots([sample], [changed], utc('12:05'));
    expect(items.map((item) => item.kind)).toContain('cancelled');
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it('keeps the event count consistent when an observation lands exactly at a bucket boundary', () => {
    const now = epoch('12:00');
    const observation = {
      id: 'sample/forecast',
      observedAt: utc('12:00'),
      trainKey: key(sample),
      kind: 'forecast' as const,
      title: 'Ennuste muuttui',
      description: 'OL: ennuste muuttui.',
    };
    const summary = summarizeChanges([observation], now, 5);
    const chart = radarBuckets(summary.items, now, 5);
    expect(chart.reduce((count, bucket) => count + bucket.count, 0)).toBe(summary.total);
  });

  it('carries the same selected service identity across change, timetable, corridor, and GPS models', () => {
    const selected = key(sample);
    const evidence = {
      id: 'cross-view-forecast',
      observedAt: utc('12:00'),
      trainKey: selected,
      kind: 'forecast' as const,
      title: 'Ennuste päivittyi',
      description: 'OL: 14.13 → 14.25.',
    };
    const radarIdentity = summarizeChanges([evidence], epoch('12:05'), 15).items[0]?.trainKey;
    const timetableIdentity = makeHeatmap(
      [sample],
      ['TPE'],
      epoch('11:30'),
      epoch('11:45'),
    )[0].trains.map(key)[0];
    const schematicIdentity = schematicApproaches(
      [sample],
      ['HKI', 'TPE', 'OL', 'ROI'],
      epoch('12:00'),
    )[0]?.train;
    const progressIdentity = buildTrainProgress(
      sample,
      [gps(25, utc('11:59'))],
      epoch('12:00'),
    ).gps;
    expect([
      radarIdentity,
      timetableIdentity,
      schematicIdentity && key(schematicIdentity),
      progressIdentity && key(progressIdentity),
    ]).toEqual([selected, selected, selected, selected]);
  });
});

describe('Release gate: each public source fails independently', () => {
  it('retains live timetable values when GPS and notices separately return HTTP errors', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(utc('12:00')));
    const fetcher = vi.fn(async (url: string) =>
      url.includes('/trains/')
        ? new Response(JSON.stringify([sample]), { status: 200 })
        : new Response('', { status: 503 }),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await new RailService().live();
    expect(result.trains).toEqual([sample]);
    expect(result.locations).toEqual([]);
    expect(result.locationsAvailable).toBe(false);
    expect(result.noticesAvailable).toBe(false);
    expect(result.partial).toBe(true);
  });

  it('does not call a failed timetable HTTP request a valid empty live dataset', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(utc('12:00')));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    await expect(new RailService().live()).rejects.toThrow('aikataulutietoja');
  });
});

describe('Release gate: dense timetable model', () => {
  it('indexes 200 services and 5,000 timetable rows with consistent cell identities', () => {
    const stations = Array.from({ length: 25 }, (_, index) => `S${index + 1}`);
    const start = epoch('12:00');
    const dense = Array.from({ length: 200 }, (_, number) =>
      train(
        1000 + number,
        stations.map((station, index) =>
          row(station, new Date(start + index * 5 * 60_000).toISOString()),
        ),
      ),
    );
    const before = performance.now();
    const grid = makeHeatmap(dense, stations, start, start + 3 * 60 * 60_000);
    const elapsed = performance.now() - before;

    expect(dense.reduce((total, service) => total + service.timeTableRows.length, 0)).toBe(5000);
    expect(grid.reduce((total, cell) => total + cell.count, 0)).toBe(5000);
    expect(new Set(grid.flatMap((cell) => cell.trains.map(key))).size).toBe(200);
    // Model-level guard only; this is not a browser paint or interaction measurement.
    expect(elapsed).toBeLessThan(1500);
  });
});
