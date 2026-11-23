import { afterEach, describe, expect, it, vi } from 'vitest';
import { key, type TimeRow, type Train } from './domain';
import { RailService } from './service';
import { buildLivingNetwork } from './living-network-model';

const overnightDeparture = '2026-11-21';
const overnight: Train = {
  trainNumber: 951,
  departureDate: overnightDeparture,
  trainType: 'IC',
  trainCategory: 'Long-distance',
  runningCurrently: true,
  cancelled: false,
  timeTableRows: [
    {
      stationShortCode: 'HKI',
      type: 'DEPARTURE',
      commercialStop: true,
      cancelled: false,
      scheduledTime: '2026-11-21T21:40:00.000Z',
      actualTime: '2026-11-21T21:42:00.000Z',
    },
    {
      stationShortCode: 'TPE',
      type: 'ARRIVAL',
      commercialStop: true,
      cancelled: false,
      scheduledTime: '2026-11-22T00:25:00.000Z',
      liveEstimateTime: '2026-11-22T00:28:00.000Z',
    },
  ] satisfies TimeRow[],
};

const row = (
  stationShortCode: string,
  scheduledTime: string,
  type: TimeRow['type'],
  additional: Partial<TimeRow> = {},
): TimeRow => ({
  stationShortCode,
  scheduledTime,
  type,
  commercialStop: true,
  cancelled: false,
  ...additional,
});
const makeService = (
  trainNumber: number,
  events: TimeRow[],
  options: Partial<Train> = {},
): Train => ({
  trainNumber,
  departureDate: '2026-11-22',
  trainType: 'IC',
  trainCategory: 'Long-distance',
  runningCurrently: true,
  cancelled: false,
  timeTableRows: events,
  ...options,
});
const at = (clock: string) => `2026-11-22T${clock}:00.000Z`;
const epoch = (clock: string) => Date.parse(at(clock));
const noStations = new Map();

function graph(trains: Train[], options: Record<string, unknown> = {}) {
  return buildLivingNetwork({
    trains,
    stations: noStations,
    corridorCodes: ['HKI', 'PSL', 'LPV', 'KKN'],
    qualifierCodes: ['KKN'],
    now: epoch('12:00'),
    from: epoch('11:30'),
    to: epoch('13:00'),
    ...options,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Living rail schematic: overnight and source-truth release gates', () => {
  it('keeps a yesterday-departed service visible after Finnish midnight even without GPS', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T00:00:00Z'));
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: string) => {
        const url = String(request);
        calls.push(url);
        const payload =
          url.includes('/live-trains') || url.includes('trains/2026-11-21') ? [overnight] : [];
        return new Response(JSON.stringify(payload), { status: 200 });
      }),
    );

    const live = await new RailService().live();
    expect(live.locations).toEqual([]);
    expect(live.trains.map(key)).toContain(key(overnight));
    expect(new Set(live.trains.map(key)).size).toBe(live.trains.length);
    // A midnight boundary must not require GPS availability to fetch this service.
    expect(calls.some((url) => url.includes('/train-locations'))).toBe(true);
  });

  it('does not place Helsinki–Pasila-only northbound train onto the Turku branch', () => {
    const north = makeService(1, [
      row('HKI', at('11:55'), 'DEPARTURE'),
      row('PSL', at('12:05'), 'ARRIVAL'),
      row('TPE', at('12:45'), 'ARRIVAL'),
    ]);
    const ownBranch = makeService(2, [
      row('HKI', at('11:55'), 'DEPARTURE'),
      row('PSL', at('12:05'), 'ARRIVAL'),
      row('PSL', at('12:07'), 'DEPARTURE'),
      row('LPV', at('12:15'), 'ARRIVAL'),
      row('LPV', at('12:16'), 'DEPARTURE'),
      row('KKN', at('12:30'), 'ARRIVAL'),
    ]);
    const network = graph([north, ownBranch]);
    expect(network.trainCount).toBe(1);
    expect(network.edges.find((edge) => edge.id === 'HKI|PSL')?.trainKeys).toEqual([
      key(ownBranch),
    ]);
  });

  it('deduplicates ARRIVAL and DEPARTURE at one station into one service per edge', () => {
    const service = makeService(3, [
      row('HKI', at('11:45'), 'DEPARTURE', { actualTime: at('11:46') }),
      row('PSL', at('11:56'), 'ARRIVAL', { actualTime: at('11:58') }),
      row('PSL', at('11:59'), 'DEPARTURE', { actualTime: at('12:00') }),
      row('LPV', at('12:12'), 'ARRIVAL', { liveEstimateTime: at('12:14') }),
      row('LPV', at('12:14'), 'DEPARTURE'),
      row('KKN', at('12:28'), 'ARRIVAL'),
    ]);
    const network = graph([service]);
    expect(network.trainCount).toBe(1);
    expect(network.edges.find((edge) => edge.id === 'HKI|PSL')).toMatchObject({
      total: 1,
      counts: { confirmed: 1 },
    });
    expect(network.edges.find((edge) => edge.id === 'PSL|LPV')).toMatchObject({
      total: 1,
      counts: { forecast: 1 },
    });
    expect(network.edges.find((edge) => edge.id === 'LPV|KKN')).toMatchObject({
      total: 1,
      counts: { scheduled: 1 },
    });
  });

  it('keeps unknown delay and cancellation distinct from known on-time or confirmed', () => {
    const cancelled = makeService(4, [
      row('HKI', at('11:50'), 'DEPARTURE'),
      row('PSL', at('12:05'), 'ARRIVAL', { cancelled: true }),
      row('KKN', at('12:40'), 'ARRIVAL'),
    ]);
    const unknown = makeService(5, [
      row('HKI', at('11:50'), 'DEPARTURE'),
      row('PSL', at('12:05'), 'ARRIVAL', { unknownDelay: true }),
      row('KKN', at('12:40'), 'ARRIVAL'),
    ]);
    const network = graph([cancelled, unknown], { qualifierCodes: [], showBranches: false });
    expect(network.edges.find((edge) => edge.id === 'HKI|PSL')).toMatchObject({
      total: 2,
      counts: { cancelled: 1, scheduled: 1, unknown: 1 },
    });
  });

  it('preserves service identity and direction without inventing present track position', () => {
    const towardKKN = makeService(10, [
      row('HKI', at('11:55'), 'DEPARTURE', { actualTime: at('11:56') }),
      row('PSL', at('12:04'), 'ARRIVAL', { liveEstimateTime: at('12:06') }),
      row('KKN', at('12:35'), 'ARRIVAL'),
    ]);
    const towardHKI = makeService(
      10,
      [
        row('KKN', at('11:40'), 'DEPARTURE'),
        row('LPV', at('11:55'), 'ARRIVAL'),
        row('LPV', at('11:58'), 'DEPARTURE'),
        row('PSL', at('12:10'), 'ARRIVAL'),
        row('HKI', at('12:20'), 'ARRIVAL'),
      ],
      { departureDate: '2026-11-21' },
    );
    const network = graph([towardKKN, towardHKI], {
      selectedTrainKey: key(towardKKN),
      qualifierCodes: [],
    });
    expect(network.selectedContext?.trainKey).toBe(key(towardKKN));
    expect(network.selectedContext).toMatchObject({
      origin: 'HKI',
      destination: 'KKN',
      lastConfirmed: { stationCode: 'HKI', source: 'actual' },
      nextPublished: { stationCode: 'PSL', source: 'estimate' },
      gps: null,
    });
    const section = network.edges.find((edge) => edge.id === 'HKI|PSL');
    expect(section?.trainKeys).toEqual([key(towardHKI), key(towardKKN)].sort());
    expect(section).toMatchObject({ total: 2, forward: 1, reverse: 1 });
  });

  it('uses only exact service GPS identity and rejects impossible or future position evidence', () => {
    const service = makeService(11, [
      row('HKI', at('11:55'), 'DEPARTURE'),
      row('PSL', at('12:10'), 'ARRIVAL'),
      row('KKN', at('12:45'), 'ARRIVAL'),
    ]);
    const baseline = {
      trainNumber: 11,
      departureDate: '2026-11-22',
      timestamp: at('11:59'),
      speed: 80,
      location: { type: 'Point' as const, coordinates: [24.95, 60.17] as [number, number] },
    };
    const model = graph([service], {
      selectedTrainKey: key(service),
      locations: [
        { ...baseline, timestamp: at('12:07') },
        {
          ...baseline,
          timestamp: at('11:58'),
          location: { type: 'Point', coordinates: [200, 300] },
        },
        { ...baseline, departureDate: '2026-11-21', timestamp: at('12:00') },
        baseline,
      ],
    });
    expect(model.selectedContext?.gps).toMatchObject({
      timestamp: at('11:59'),
      coordinates: [24.95, 60.17],
      freshness: 'fresh',
    });
  });

  it('keeps a 20-minute-old GPS as a dated stale observation, not moving edge occupancy', () => {
    const service = makeService(15, [
      row('HKI', at('11:50'), 'DEPARTURE'),
      row('PSL', at('12:10'), 'ARRIVAL'),
      row('KKN', at('12:45'), 'ARRIVAL'),
    ]);
    const network = graph([service], {
      selectedTrainKey: key(service),
      locations: [
        {
          trainNumber: 15,
          departureDate: '2026-11-22',
          timestamp: at('11:40'),
          speed: 71,
          location: { type: 'Point', coordinates: [24.95, 60.17] },
        },
      ],
    });
    expect(network.selectedContext?.gps).toMatchObject({
      timestamp: at('11:40'),
      freshness: 'stale',
      ageMs: 20 * 60_000,
    });
    expect(network.caveat).toMatch(/Ei rataverkon topologiaa/i);
    expect(network.edges.every((edge) => !('occupied' in edge))).toBe(true);
  });

  it('counts eligible skipped-checkpoint services without painting fictitious intervening links', () => {
    const nonstop = makeService(16, [
      row('HKI', at('11:40'), 'DEPARTURE'),
      row('KKN', at('12:40'), 'ARRIVAL'),
    ]);
    const network = graph([nonstop], { qualifierCodes: ['KKN'], showBranches: false });
    expect(network.trainCount).toBe(1);
    expect(network.edges.filter((edge) => edge.total > 0)).toEqual([]);
  });

  it('preserves a selected express journey as an explicitly unresolved bracket, not occupied track', () => {
    const express = makeService(63, [
      row('HKI', at('11:40'), 'DEPARTURE'),
      row('KKN', at('12:40'), 'ARRIVAL'),
    ]);
    const network = graph([express], {
      qualifierCodes: ['KKN'],
      selectedTrainKey: key(express),
      showBranches: false,
    });
    const gap = network.edges.find((edge) => edge.id === 'gap:HKI|KKN');
    expect(gap).toMatchObject({
      from: 'HKI',
      to: 'KKN',
      isGap: true,
      isCorridor: false,
      selected: true,
      total: 1,
      counts: { scheduled: 1 },
    });
    expect(network.edges.find((edge) => edge.id === 'HKI|PSL')?.total).toBe(0);
    expect(network.edges.find((edge) => edge.id === 'PSL|LPV')?.total).toBe(0);
    expect(network.edges.every((edge) => !('occupied' in edge))).toBe(true);
  });

  it('never sends selected next-published context backwards before a confirmed station', () => {
    const service = makeService(66, [
      row('HKI', at('09:00'), 'DEPARTURE'),
      row('PSL', at('12:00'), 'ARRIVAL', { actualTime: at('12:01') }),
      row('KKN', at('12:45'), 'ARRIVAL'),
    ]);
    const network = graph([service], { selectedTrainKey: key(service), qualifierCodes: [] });
    expect(network.selectedContext?.lastConfirmed?.stationCode).toBe('PSL');
    expect(network.selectedContext?.nextPublished?.stationCode).toBe('KKN');
  });

  it('includes a service interval intersecting a time-window boundary, not just endpoint events', () => {
    const longTrip = makeService(17, [
      row('HKI', at('10:00'), 'DEPARTURE', { actualTime: at('10:03') }),
      row('PSL', at('13:30'), 'ARRIVAL', { liveEstimateTime: at('13:32') }),
      row('KKN', at('14:30'), 'ARRIVAL'),
    ]);
    const network = graph([longTrip], { qualifierCodes: [] });
    expect(network.edges.find((edge) => edge.id === 'HKI|PSL')?.total).toBe(1);
  });

  it('keeps topology stable as a time window moves over the same services', () => {
    const branch = makeService(12, [
      row('HKI', at('11:55'), 'DEPARTURE'),
      row('PSL', at('12:05'), 'ARRIVAL'),
      row('PSL', at('12:07'), 'DEPARTURE'),
      row('KKN', at('12:35'), 'ARRIVAL'),
      row('KKN', at('12:40'), 'DEPARTURE'),
      row('BRANCH', at('12:51'), 'ARRIVAL'),
    ]);
    const early = graph([branch], { showBranches: true, branchLimit: 4 });
    const late = graph([branch], {
      from: epoch('14:00'),
      to: epoch('16:00'),
      showBranches: true,
      branchLimit: 4,
    });
    expect(early.edges.map((edge) => edge.id)).toEqual(late.edges.map((edge) => edge.id));
    expect(early.edges.some((edge) => !edge.isCorridor && edge.to === 'BRANCH')).toBe(true);
    expect(late.trainCount).toBe(0);
  });
});
