import { describe, expect, it } from 'vitest';
import { buildTrainProgress } from './train-progress-model';
import type { Location, TimeRow, Train } from './domain';

const row = (
  stationShortCode: string,
  type: TimeRow['type'],
  scheduledTime: string,
  options: Partial<TimeRow> = {},
): TimeRow => ({
  stationShortCode,
  type,
  scheduledTime,
  cancelled: false,
  commercialStop: true,
  ...options,
});
const train = (timeTableRows: TimeRow[]): Train => ({
  trainNumber: 25,
  departureDate: '2026-11-22',
  trainType: 'IC',
  trainCategory: 'Long-distance',
  runningCurrently: true,
  cancelled: false,
  timeTableRows,
});
const position = (timestamp: string, overrides: Partial<Location> = {}): Location => ({
  trainNumber: 25,
  departureDate: '2026-11-22',
  timestamp,
  speed: 118,
  location: { type: 'Point', coordinates: [25.11, 65.03] },
  ...overrides,
});
const now = Date.parse('2026-11-22T12:00:00Z');

describe('Junan eteneminen – tiedon laatu ja aineiston yhdistäminen', () => {
  it('erottaa toteutuneet liikennepaikat, seuraavan ennusteen ja määränpään', () => {
    const t = train([
      row('HKI', 'DEPARTURE', '2026-11-22T09:00:00Z', { actualTime: '2026-11-22T09:01:00Z' }),
      row('TPE', 'ARRIVAL', '2026-11-22T11:00:00Z', { actualTime: '2026-11-22T11:04:00Z' }),
      row('TPE', 'DEPARTURE', '2026-11-22T11:10:00Z', { actualTime: '2026-11-22T11:15:00Z' }),
      row('OL', 'ARRIVAL', '2026-11-22T14:30:00Z', { liveEstimateTime: '2026-11-22T14:42:00Z' }),
    ]);
    const model = buildTrainProgress(t, [position('2026-11-22T11:57:00Z')], now);
    expect(model).toMatchObject({
      origin: 'HKI',
      destination: 'OL',
      completed: 2,
      total: 3,
      gpsStatus: 'fresh',
      gpsAgeMinutes: 3,
    });
    expect(model.lastConfirmed?.code).toBe('TPE');
    expect(model.next?.code).toBe('OL');
    expect(model.next?.deviation).toBe(12);
    expect(model.stops.map((s) => s.code)).toEqual(['HKI', 'TPE', 'OL']);
  });

  it('ei palaa junan jo ohittamaan asemaan, vaikka aiempi toteumaleima puuttuu', () => {
    const t = train([
      row('HKI', 'DEPARTURE', '2026-11-22T09:00:00Z'),
      row('TPE', 'ARRIVAL', '2026-11-22T11:50:00Z', { actualTime: '2026-11-22T11:55:00Z' }),
      row('TPE', 'DEPARTURE', '2026-11-22T11:58:00Z', { actualTime: '2026-11-22T12:01:00Z' }),
      row('OL', 'ARRIVAL', '2026-11-22T15:00:00Z'),
    ]);
    const progress = buildTrainProgress(t, [], Date.parse('2026-11-22T12:30:00Z'));
    expect(progress.lastConfirmed?.code).toBe('TPE');
    expect(progress.next?.code).toBe('OL');
    expect(progress.current).toBeUndefined();
  });

  it('ei jää aiemmalle asemalle, jos myöhemmästä asemasta on jo saapumishavainto', () => {
    const t = train([
      row('HKI', 'DEPARTURE', '2026-11-22T09:00:00Z', { actualTime: '2026-11-22T09:01:00Z' }),
      row('RI', 'ARRIVAL', '2026-11-22T10:00:00Z', { actualTime: '2026-11-22T10:01:00Z' }),
      row('RI', 'DEPARTURE', '2026-11-22T10:05:00Z'), // missing, not proof the train remains
      row('TPE', 'ARRIVAL', '2026-11-22T11:00:00Z', { actualTime: '2026-11-22T11:02:00Z' }),
      row('TPE', 'DEPARTURE', '2026-11-22T11:10:00Z'),
      row('OL', 'ARRIVAL', '2026-11-22T14:30:00Z'),
    ]);
    const progress = buildTrainProgress(t, [], now);
    expect(progress.lastConfirmed?.code).toBe('TPE');
    expect(progress.current?.code).toBe('TPE');
    expect(progress.next?.code).toBe('OL');
  });

  it('hyväksyy vuorokauden ja lähtöpäivän ylittävän aikataulun ilman väärää järjestystä', () => {
    const model = buildTrainProgress(
      train([
        row('OL', 'DEPARTURE', '2026-11-22T23:49:00Z', { actualTime: '2026-11-22T23:50:00Z' }),
        row('ROI', 'ARRIVAL', '2026-11-23T01:24:00Z', { liveEstimateTime: '2026-11-23T01:34:00Z' }),
        row('KJÄ', 'ARRIVAL', '2026-11-23T04:25:00Z'),
      ]),
      [],
      Date.parse('2026-11-23T00:10:00Z'),
    );
    expect(model).toMatchObject({
      origin: 'OL',
      destination: 'KJÄ',
      completed: 1,
      gpsStatus: 'absent',
    });
    expect(model.next?.code).toBe('ROI');
    expect(model.next?.observed).toBe(Date.parse('2026-11-23T01:34:00Z'));
  });

  it('ei esitä 11 minuuttia vanhaa GPS-havaintoa tämänhetkisenä sijaintina', () => {
    const t = train([
      row('HKI', 'DEPARTURE', '2026-11-22T11:00:00Z'),
      row('RI', 'ARRIVAL', '2026-11-22T12:30:00Z'),
    ]);
    expect(buildTrainProgress(t, [position('2026-11-22T11:49:00Z')], now)).toMatchObject({
      gpsStatus: 'stale',
      gpsAgeMinutes: 11,
    });
    expect(buildTrainProgress(t, [], now).gpsStatus).toBe('absent');
  });

  it('sivuuttaa toisen junan ja epäkelvot GPS-koordinaatit', () => {
    const t = train([row('HKI', 'DEPARTURE', '2026-11-22T11:00:00Z')]);
    const invalid = position('2026-11-22T11:59:00Z', {
      location: { type: 'Point', coordinates: [500, 300] },
    });
    const other = position('2026-11-22T11:58:00Z', { trainNumber: 26 });
    expect(buildTrainProgress(t, [invalid, other], now).gpsStatus).toBe('absent');
  });

  it('ei laske peruttua väliasemaa toteumaksi eikä valitse sitä seuraavaksi', () => {
    const t = train([
      row('HKI', 'DEPARTURE', '2026-11-22T10:00:00Z', { actualTime: '2026-11-22T10:00:00Z' }),
      row('RI', 'ARRIVAL', '2026-11-22T11:00:00Z', { cancelled: true }),
      row('TPE', 'ARRIVAL', '2026-11-22T13:00:00Z'),
    ]);
    const model = buildTrainProgress(t, [], now);
    expect(model).toMatchObject({ completed: 1, total: 2 });
    expect(model.stops.find((s) => s.code === 'RI')?.cancelled).toBe(true);
    expect(model.next?.code).toBe('TPE');
  });

  it('erottaa asemalle saapuneen mutta vielä lähtemättömän junan seuraavasta asemasta', () => {
    const t = train([
      row('HKI', 'DEPARTURE', '2026-11-22T10:00:00Z', { actualTime: '2026-11-22T10:00:00Z' }),
      row('RI', 'ARRIVAL', '2026-11-22T11:45:00Z', { actualTime: '2026-11-22T11:48:00Z' }),
      row('RI', 'DEPARTURE', '2026-11-22T12:10:00Z'),
      row('TPE', 'ARRIVAL', '2026-11-22T14:05:00Z'),
    ]);
    const model = buildTrainProgress(t, [], now);
    expect(model.current?.code).toBe('RI');
    expect(model.current?.stage).toBe('at-station');
    expect(model.next?.code).toBe('TPE');
    expect(model.lastConfirmed?.code).toBe('RI');
    expect(model.completed).toBe(1);
  });

  it('jättää tuntemattoman aikaeron tuntemattomaksi ennusteesta huolimatta', () => {
    const t = train([
      row('HKI', 'DEPARTURE', '2026-11-22T11:00:00Z', { actualTime: '2026-11-22T11:01:00Z' }),
      row('RI', 'ARRIVAL', '2026-11-22T12:30:00Z', {
        liveEstimateTime: '2026-11-22T12:35:00Z',
        unknownDelay: true,
      }),
    ]);
    const next = buildTrainProgress(t, [], now).next;
    expect(next?.source).toBe('estimate');
    expect(next?.deviation).toBeNull();
  });
});
