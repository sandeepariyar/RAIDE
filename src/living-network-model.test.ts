import { describe, expect, it } from 'vitest';
import type { Location, Station, TimeRow, Train } from './domain';
import { buildLivingNetwork } from './living-network-model';

const now = Date.parse('2026-11-22T12:00:00Z');
const at = (hour: number, minute: number) =>
  new Date(Date.parse('2026-11-22T00:00:00Z') + (hour * 60 + minute) * 60_000).toISOString();

const row = (
  stationShortCode: string,
  type: TimeRow['type'],
  scheduledTime: string,
  extras: Partial<TimeRow> = {},
): TimeRow => ({
  stationShortCode,
  type,
  commercialStop: true,
  scheduledTime,
  cancelled: false,
  ...extras,
});

const train = (
  trainNumber: number,
  timeTableRows: TimeRow[],
  extras: Partial<Train> = {},
): Train => ({
  trainNumber,
  departureDate: '2026-11-22',
  trainType: 'IC',
  trainCategory: 'Long-distance',
  runningCurrently: true,
  cancelled: false,
  timeTableRows,
  ...extras,
});

const stations = new Map<string, Station>(
  ['HKI', 'PSL', 'TKL', 'RI', 'BRN', 'OUT'].map((code, index) => [
    code,
    {
      stationShortCode: code,
      stationName: `Station ${code}`,
      latitude: 60 + index,
      longitude: 25 + index,
      passengerTraffic: true,
      countryCode: 'FI',
      type: 'STATION',
    },
  ]),
);

const base = {
  stations,
  corridorCodes: ['HKI', 'PSL', 'TKL'],
  now,
  from: Date.parse(at(11, 0)),
  to: Date.parse(at(13, 0)),
};

describe('Elävä rataverkkokaavio / published timetable graph', () => {
  it('groups arrival/departure at one station and distinguishes confirmed and forecast edges', () => {
    const service = train(25, [
      row('HKI', 'DEPARTURE', at(11, 10), { actualTime: at(11, 12) }),
      row('PSL', 'ARRIVAL', at(11, 20), { actualTime: at(11, 22) }),
      row('PSL', 'DEPARTURE', at(11, 23), { actualTime: at(11, 24) }),
      row('TKL', 'ARRIVAL', at(11, 45), { liveEstimateTime: at(11, 51) }),
    ]);
    const graph = buildLivingNetwork({ ...base, trains: [service] });
    expect(graph.edges.map((edge) => edge.id)).toEqual(['HKI|PSL', 'PSL|TKL']);
    expect(graph.edges[0]).toMatchObject({
      total: 1,
      counts: { confirmed: 1, forecast: 0, scheduled: 0, cancelled: 0 },
      forward: 1,
      reverse: 0,
    });
    expect(graph.edges[1]).toMatchObject({
      total: 1,
      counts: { confirmed: 0, forecast: 1, scheduled: 0, cancelled: 0 },
    });
    expect(graph.trainCount).toBe(1);
    expect(graph.nodes[0]).toMatchObject({
      code: 'HKI',
      name: 'Station HKI',
      isCorridor: true,
      corridorIndex: 0,
      lat: 60,
    });
    expect(graph.caveat).toContain('Ei rataverkon topologiaa');
  });

  it('does not make topology disappear when a live time window no longer includes a train', () => {
    const service = train(1, [
      row('HKI', 'DEPARTURE', at(9, 0)),
      row('PSL', 'ARRIVAL', at(9, 10)),
      row('PSL', 'DEPARTURE', at(9, 12)),
      row('TKL', 'ARRIVAL', at(9, 30)),
    ]);
    const graph = buildLivingNetwork({
      ...base,
      trains: [service],
      from: Date.parse(at(10, 0)),
      to: Date.parse(at(12, 0)),
      selectedTrainKey: '2026-11-22/1',
    });
    expect(graph.edges.map((edge) => edge.id)).toEqual(['HKI|PSL', 'PSL|TKL']);
    expect(graph.edges.map((edge) => edge.total)).toEqual([0, 0]);
    expect(graph.edges.every((edge) => edge.selected)).toBe(true);
    expect(graph.trainCount).toBe(0);
  });

  it('includes services that cross either time-window boundary without pretending they occupy a block', () => {
    const service = train(8, [
      row('HKI', 'DEPARTURE', at(10, 50)),
      row('PSL', 'ARRIVAL', at(11, 5)),
    ]);
    const graph = buildLivingNetwork({
      ...base,
      corridorCodes: ['HKI', 'PSL'],
      trains: [service],
      from: Date.parse(at(11, 0)),
      to: Date.parse(at(11, 2)),
    });
    expect(graph.edges[0]).toMatchObject({ total: 1, counts: { scheduled: 1 } });
    expect(graph.edges[0].earliestEventTime).toBe(Date.parse(at(10, 50)));
  });

  it('aggregates distinct train services in both directions against one canonical link', () => {
    const north = train(10, [
      row('HKI', 'DEPARTURE', at(11, 20)),
      row('PSL', 'ARRIVAL', at(11, 30)),
    ]);
    const south = train(11, [
      row('PSL', 'DEPARTURE', at(11, 25)),
      row('HKI', 'ARRIVAL', at(11, 35)),
    ]);
    const graph = buildLivingNetwork({
      ...base,
      corridorCodes: ['HKI', 'PSL'],
      trains: [north, south],
    });
    expect(graph.edges[0]).toMatchObject({
      from: 'HKI',
      to: 'PSL',
      total: 2,
      forward: 1,
      reverse: 1,
      counts: { scheduled: 2 },
    });
    expect(graph.edges[0].trainKeys).toEqual(['2026-11-22/10', '2026-11-22/11']);
  });

  it('never presents explicit unknown-delay forecasts as confirmed or a zero-delay estimate', () => {
    const unknown = train(91, [
      row('HKI', 'DEPARTURE', at(11, 20), { actualTime: at(11, 21) }),
      row('PSL', 'ARRIVAL', at(11, 30), {
        liveEstimateTime: at(11, 36),
        unknownDelay: true,
      }),
    ]);
    const cancelled = train(
      92,
      [row('HKI', 'DEPARTURE', at(11, 20)), row('PSL', 'ARRIVAL', at(11, 30))],
      { cancelled: true },
    );
    const graph = buildLivingNetwork({
      ...base,
      corridorCodes: ['HKI', 'PSL'],
      trains: [unknown, cancelled],
    });
    expect(graph.edges[0]).toMatchObject({
      total: 2,
      counts: { confirmed: 0, forecast: 0, scheduled: 1, cancelled: 1, unknown: 1 },
    });
  });

  it('shows one-hop published branches, never invented switches, and hides them on request', () => {
    const service = train(2, [
      row('HKI', 'DEPARTURE', at(11, 0)),
      row('PSL', 'ARRIVAL', at(11, 10)),
      row('PSL', 'DEPARTURE', at(11, 12)),
      row('BRN', 'ARRIVAL', at(11, 15)),
      row('BRN', 'DEPARTURE', at(11, 17)),
      row('TKL', 'ARRIVAL', at(11, 30)),
    ]);
    const graph = buildLivingNetwork({ ...base, trains: [service] });
    expect(graph.edges.filter((edge) => !edge.isCorridor).map((edge) => edge.id)).toEqual([
      'PSL|BRN',
      'TKL|BRN',
    ]);
    expect(graph.nodes.find((node) => node.code === 'BRN')).toMatchObject({
      isCorridor: false,
      corridorIndex: null,
    });
    expect(graph.edges.find((edge) => edge.id === 'PSL|TKL')?.total).toBe(1);
    const hidden = buildLivingNetwork({ ...base, trains: [service], showBranches: false });
    expect(hidden.edges).toHaveLength(2);
    expect(hidden.nodes).toHaveLength(3);
    const limited = buildLivingNetwork({ ...base, trains: [service], branchLimit: 1 });
    expect(limited.edges.filter((edge) => !edge.isCorridor).map((edge) => edge.id)).toEqual([
      'PSL|BRN',
    ]);
  });

  it('does not misclassify a shared Helsinki/Pasila trunk train as a Turku-bound service', () => {
    const wrongBranch = train(80, [
      row('HKI', 'DEPARTURE', at(11, 0)),
      row('PSL', 'ARRIVAL', at(11, 10)),
      row('PSL', 'DEPARTURE', at(11, 12)),
      row('TKL', 'ARRIVAL', at(11, 20)),
      row('RI', 'ARRIVAL', at(11, 40)),
    ]);
    const graph = buildLivingNetwork({
      ...base,
      corridorCodes: ['HKI', 'PSL', 'LPV', 'KKN', 'KR', 'SLO', 'KUT', 'TKU'],
      trains: [wrongBranch],
    });
    expect(graph.trainCount).toBe(0);
    expect(graph.edges.every((edge) => edge.total === 0)).toBe(true);
    expect(graph.nodes.some((node) => node.code === 'RI')).toBe(false);
  });

  it('reports raw last actual, upcoming forecast and stale GPS without guessing where the train is', () => {
    const service = train(32, [
      row('HKI', 'DEPARTURE', at(11, 0), { actualTime: at(11, 2) }),
      row('PSL', 'ARRIVAL', at(11, 10), { actualTime: at(11, 12) }),
      row('PSL', 'DEPARTURE', at(11, 15), { actualTime: at(11, 17) }),
      row('TKL', 'ARRIVAL', at(12, 20), { liveEstimateTime: at(12, 24) }),
    ]);
    const locations: Location[] = [
      {
        trainNumber: 32,
        departureDate: '2026-11-22',
        timestamp: at(11, 35),
        speed: 55,
        location: { type: 'Point', coordinates: [24.98, 60.12] },
      },
    ];
    const graph = buildLivingNetwork({
      ...base,
      trains: [service],
      locations,
      selectedTrainKey: '2026-11-22/32',
    });
    expect(graph.selectedContext).toMatchObject({
      trainKey: '2026-11-22/32',
      origin: 'HKI',
      destination: 'TKL',
      lastConfirmed: { stationCode: 'PSL', at: Date.parse(at(11, 17)), source: 'actual' },
      nextPublished: { stationCode: 'TKL', at: Date.parse(at(12, 24)), source: 'estimate' },
      gps: { coordinates: [24.98, 60.12], speed: 55, freshness: 'stale' },
    });
    expect(graph.selectedContext?.gps?.ageMs).toBe(25 * 60_000);
    const fresh = buildLivingNetwork({
      ...base,
      trains: [service],
      locations: [{ ...locations[0], timestamp: at(11, 58) }],
      selectedTrainKey: '2026-11-22/32',
    });
    expect(fresh.selectedContext?.gps?.freshness).toBe('fresh');
    const defended = buildLivingNetwork({
      ...base,
      trains: [service],
      locations: [
        { ...locations[0], timestamp: at(12, 7) }, // Clock-ahead feed event: not evidence yet.
        {
          ...locations[0],
          timestamp: at(11, 59),
          location: { type: 'Point', coordinates: [240, 200] },
        },
        { ...locations[0], timestamp: at(11, 58) },
      ],
      selectedTrainKey: '2026-11-22/32',
    });
    expect(defended.selectedContext?.gps?.timestamp).toBe(at(11, 58));
  });

  it('keys same-number trains on different operating dates as different services', () => {
    const timetable = [row('HKI', 'DEPARTURE', at(11, 20)), row('PSL', 'ARRIVAL', at(11, 30))];
    const graph = buildLivingNetwork({
      ...base,
      corridorCodes: ['HKI', 'PSL'],
      trains: [train(5, timetable), train(5, timetable, { departureDate: '2026-11-23' })],
    });
    expect(graph.edges[0].trainKeys).toEqual(['2026-11-22/5', '2026-11-23/5']);
    expect(graph.trainCount).toBe(2);
  });
});
