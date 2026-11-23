import { describe, expect, it } from 'vitest';
import {
  bestCorridorForTrain,
  journeyStops,
  summarizeCorridors,
  trainsOnCorridor,
  upcomingCorridorPoints,
  schematicApproaches,
} from './network-analytics';
import type { Location, TimeRow, Train } from './domain';
import { corridors } from './corridors';

const row = (
  stationShortCode: string,
  scheduledTime: string,
  type: TimeRow['type'] = 'ARRIVAL',
  overrides: Partial<TimeRow> = {},
): TimeRow => ({
  stationShortCode,
  type,
  scheduledTime,
  commercialStop: true,
  cancelled: false,
  ...overrides,
});

function train(
  trainNumber: number,
  timeTableRows: TimeRow[],
  overrides: Partial<Train> = {},
): Train {
  return {
    trainNumber,
    departureDate: '2026-11-22',
    trainType: 'IC',
    trainCategory: 'Long-distance',
    cancelled: false,
    runningCurrently: true,
    timeTableRows,
    ...overrides,
  };
}

const start = Date.parse('2026-11-22T12:00:00Z');
const service = train(23, [
  row('HKI', '2026-11-22T10:00:00Z', 'DEPARTURE', { actualTime: '2026-11-22T10:02:00Z' }),
  row('TPE', '2026-11-22T12:20:00Z', 'ARRIVAL', { liveEstimateTime: '2026-11-22T12:32:00Z' }),
  row('TPE', '2026-11-22T12:26:00Z', 'DEPARTURE', { liveEstimateTime: '2026-11-22T12:38:00Z' }),
  row('OL', '2026-11-22T15:30:00Z'),
]);

describe('rataosakohtaiset visualisoinnit', () => {
  it('uses Tervola rather than Teuva in the Oulu–Rovaniemi corridor', () => {
    expect(corridors.north.stations).toEqual(['OL', 'KEM', 'TRV', 'ROI', 'MIS', 'KJÄ']);
    expect(corridors.north.stations).not.toContain('TUV');

    const viaTervola = train(26, [
      row('OL', '2026-11-22T10:00:00Z', 'DEPARTURE'),
      row('TRV', '2026-11-22T11:10:00Z'),
      row('ROI', '2026-11-22T12:00:00Z'),
    ]);
    expect(
      trainsOnCorridor([viaTervola], corridors.north.stations, corridors.north.qualifiers),
    ).toEqual([viaTervola]);
    expect(bestCorridorForTrain(viaTervola)?.id).toBe('north');
  });
  it('includes a train once when its published route covers at least two unique stations', () => {
    expect(trainsOnCorridor([service], ['HKI', 'TPE', 'OL'])).toEqual([service]);
    expect(trainsOnCorridor([service], ['HKI', 'PSL'])).toEqual([]);
  });

  it('does not count repeated ARRIVAL + DEPARTURE at a single station as corridor overlap', () => {
    const single = train(4, [
      row('TPE', '2026-11-22T12:10:00Z'),
      row('TPE', '2026-11-22T12:15:00Z', 'DEPARTURE'),
    ]);
    expect(trainsOnCorridor([single], ['TPE', 'RI'])).toEqual([]);
  });
  it('ei sijoita pohjoiseen ajavaa junaa Turun haaraan Helsingin ja Pasilan perusteella', () => {
    const northbound = train(25, [
      row('HKI', '2026-11-22T10:00:00Z', 'DEPARTURE'),
      row('PSL', '2026-11-22T10:05:00Z'),
      row('TPE', '2026-11-22T11:20:00Z'),
      row('OL', '2026-11-22T14:00:00Z'),
    ]);
    expect(
      trainsOnCorridor([northbound], corridors.turku.stations, corridors.turku.qualifiers),
    ).toEqual([]);
    expect(
      trainsOnCorridor([northbound], corridors.west.stations, corridors.west.qualifiers),
    ).toEqual([northbound]);
    expect(bestCorridorForTrain(northbound)?.id).toBe('west');
  });

  it('groups only the next uncompleted timetable point of each service', () => {
    const groups = upcomingCorridorPoints([service], ['HKI', 'TPE', 'OL'], start);
    expect(groups.get('HKI')).toEqual([]);
    expect(groups.get('TPE')).toHaveLength(1);
    expect(groups.get('TPE')![0]).toMatchObject({ train: service, late: 12 });
    expect(groups.get('TPE')![0].expected).toBe(Date.parse('2026-11-22T12:32:00Z'));
    expect(groups.get('OL')).toEqual([]);
  });

  it('does not return an earlier missing station after a later real arrival', () => {
    const outOfOrder = train(63, [
      row('HKI', '2026-11-22T10:00:00Z', 'DEPARTURE'),
      row('TPE', '2026-11-22T11:40:00Z', 'ARRIVAL', { actualTime: '2026-11-22T11:43:00Z' }),
      row('OL', '2026-11-22T15:30:00Z', 'ARRIVAL'),
    ]);
    const points = upcomingCorridorPoints([outOfOrder], ['HKI', 'TPE', 'OL'], start);
    expect(points.get('HKI')).toEqual([]);
    expect(points.get('OL')?.map((p) => p.train.trainNumber)).toEqual([63]);
  });

  it('does not promote an ETA with unknown delay to a reliable forecast', () => {
    const unknownEta = train(64, [
      row('HKI', '2026-11-22T10:00:00Z', 'DEPARTURE', { actualTime: '2026-11-22T10:01:00Z' }),
      row('TPE', '2026-11-22T12:20:00Z', 'ARRIVAL', {
        unknownDelay: true,
        liveEstimateTime: '2026-11-22T12:55:00Z',
      }),
    ]);
    const point = upcomingCorridorPoints([unknownEta], ['HKI', 'TPE'], start).get('TPE')![0];
    expect(point.expected).toBe(Date.parse('2026-11-22T12:20:00Z'));
    expect(point.late).toBeNull();
    expect(schematicApproaches([unknownEta], ['HKI', 'TPE'], start)[0].source).toBe('schedule');
  });

  it('retains unknown delay as unknown rather than claiming on-time', () => {
    const unknown = train(24, [
      row('HKI', '2026-11-22T10:00:00Z'),
      row('TPE', '2026-11-22T12:10:00Z', 'ARRIVAL', { unknownDelay: true }),
    ]);
    expect(upcomingCorridorPoints([unknown], ['HKI', 'TPE'], start).get('TPE')![0].late).toBeNull();
  });
  it('ei väitä aiempaa havaittua myöhästymistä seuraavan aseman ennusteeksi', () => {
    const unforecasted = train(26, [
      row('HKI', '2026-11-22T10:00:00Z', 'DEPARTURE', { actualTime: '2026-11-22T10:14:00Z' }),
      row('TPE', '2026-11-22T12:20:00Z'),
    ]);
    const point = upcomingCorridorPoints([unforecasted], ['HKI', 'TPE'], start).get('TPE')![0];
    expect(point.late).toBeNull();
    expect(schematicApproaches([unforecasted], ['HKI', 'TPE'], start)[0]).toMatchObject({
      stationIndex: 1,
      direction: 'forward',
      source: 'schedule',
      late: null,
    });
  });
  it('erottaa vastakkaisen kulkusuunnan kaavion esityskaistaksi', () => {
    const reverse = train(27, [
      row('OL', '2026-11-22T11:45:00Z', 'DEPARTURE', { actualTime: '2026-11-22T11:46:00Z' }),
      row('TPE', '2026-11-22T12:30:00Z'),
      row('HKI', '2026-11-22T15:00:00Z'),
    ]);
    expect(schematicApproaches([reverse], ['HKI', 'TPE', 'OL'], start)[0]).toMatchObject({
      stationIndex: 1,
      direction: 'reverse',
    });
  });

  it('excludes cancelled rows and cancelled services from the next-point schematic', () => {
    const partlyCancelled = train(25, [
      row('HKI', '2026-11-22T10:00:00Z', 'DEPARTURE', { actualTime: '2026-11-22T10:00:00Z' }),
      row('TPE', '2026-11-22T12:10:00Z', 'ARRIVAL', { cancelled: true }),
      row('OL', '2026-11-22T15:30:00Z'),
    ]);
    expect(
      upcomingCorridorPoints([partlyCancelled], ['HKI', 'TPE', 'OL'], start).get('OL'),
    ).toHaveLength(1);
    expect(
      upcomingCorridorPoints([{ ...service, cancelled: true }], ['HKI', 'TPE'], start).get('TPE'),
    ).toEqual([]);
  });

  it('counts GPS only if the observation is fresh and attached to a corridor train', () => {
    const gps: Location = {
      trainNumber: 23,
      departureDate: '2026-11-22',
      timestamp: '2026-11-22T11:55:00Z',
      speed: 110,
      location: { type: 'Point', coordinates: [24.5, 61.3] },
    };
    const west = summarizeCorridors([service], [gps], start).find((c) => c.id === 'west')!;
    expect(west.trains).toHaveLength(1);
    expect(west.delayed).toBe(1);
    expect(west.freshLocations).toBe(1);
    expect(
      summarizeCorridors([service], [{ ...gps, timestamp: '2026-11-22T11:40:00Z' }], start).find(
        (c) => c.id === 'west',
      )!.freshLocations,
    ).toBe(0);
  });

  it('deduplicates arrival and departure for a single journey stop', () => {
    const result = journeyStops(service);
    expect(result.map((s) => s.code)).toEqual(['HKI', 'TPE', 'OL']);
    expect(result[0].stage).toBe('completed');
    expect(result[1].source).toBe('estimate');
    expect(result[1].deviation).toBe(12);
    expect(result[1].stage).toBe('upcoming');
    expect(result[2].deviation).toBeNull();
  });

  it('shows a train as at-station when arrival is actual but departure is not', () => {
    const stops = journeyStops(
      train(42, [
        row('HKI', '2026-11-22T10:00:00Z', 'ARRIVAL', { actualTime: '2026-11-22T10:03:00Z' }),
        row('HKI', '2026-11-22T10:10:00Z', 'DEPARTURE'),
        row('TPE', '2026-11-22T12:20:00Z'),
      ]),
    );
    expect(stops[0].stage).toBe('at-station');
    expect(stops[0].deviation).toBe(3);
  });

  it('keeps passing points available to the UI without silently treating them as commercial stops', () => {
    const stops = journeyStops(
      train(44, [
        row('HKI', '2026-11-22T10:00:00Z', 'DEPARTURE'),
        row('PSL', '2026-11-22T10:05:00Z', 'ARRIVAL', { commercialStop: false }),
        row('TPE', '2026-11-22T12:20:00Z'),
      ]),
    );
    expect(stops).toHaveLength(3);
    expect(stops[1].commercial).toBe(false);
  });

  it('does not invent an estimate when only a scheduled time is known', () => {
    const stops = journeyStops(service);
    expect(stops[2].source).toBe('schedule');
    expect(stops[2].deviation).toBeNull();
  });
});
