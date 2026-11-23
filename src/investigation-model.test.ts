import { describe, expect, it } from 'vitest';
import {
  compareSnapshots,
  matchingNotices,
  recordingObservations,
  rowDeviation,
} from './investigation-model';
import type { Notice, Recording, TimeRow, Train } from './domain';

const observedAt = '2026-11-22T12:05:00Z';
const stationRow = (changes: Partial<TimeRow> = {}): TimeRow => ({
  stationShortCode: 'OL',
  type: 'ARRIVAL',
  commercialStop: true,
  scheduledTime: '2026-11-22T12:30:00Z',
  cancelled: false,
  ...changes,
});
const service = (changes: Partial<Train> = {}): Train => ({
  trainNumber: 21,
  departureDate: '2026-11-22',
  trainType: 'IC',
  trainCategory: 'Long-distance',
  cancelled: false,
  runningCurrently: true,
  timeTableRows: [stationRow()],
  ...changes,
});

describe('Aineistomuutosten jäljitettävyys', () => {
  it('ei keksi tapahtumia ensimmäisestä havainnosta', () =>
    expect(compareSnapshots([], [service()], observedAt)).toEqual([]));

  it('havainto kohdistuu sekä junanumeroon että lähtöpäivään', () => {
    const before = service();
    const after = service({
      timeTableRows: [stationRow({ liveEstimateTime: '2026-11-22T12:39:00Z' })],
    });
    const events = compareSnapshots([before], [after], observedAt);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      trainKey: '2026-11-22/21',
      kind: 'forecast',
      stationCode: 'OL',
      observedAt,
    });
    expect(events[0].description).toContain('14.39');
  });

  it('ei yhdistä eri lähtöpäivien samannumeroisia junia', () => {
    const previous = service({ departureDate: '2026-11-21' });
    expect(compareSnapshots([previous], [service()], observedAt)).toEqual([]);
  });

  it('kirjaa toteuman, peruutuksen ja raidetiedon muutoksen erikseen', () => {
    const changed = service({
      cancelled: true,
      timeTableRows: [
        stationRow({ actualTime: '2026-11-22T12:31:00Z', commercialTrack: '3', cancelled: true }),
      ],
    });
    const kinds = compareSnapshots([service()], [changed], observedAt).map((e) => e.kind);
    expect(kinds).toEqual(['cancelled', 'actual', 'cancelled', 'track']);
  });

  it('ei kirjaa muuttumatonta havaintoa uudeksi tapahtumaksi', () => {
    const t = service({
      timeTableRows: [stationRow({ liveEstimateTime: '2026-11-22T12:33:00Z' })],
    });
    expect(compareSnapshots([t], [structuredClone(t)], observedAt)).toEqual([]);
  });

  it('poikkeama erottaa ennusteen puuttumisen ja etuajassa kulkemisen', () => {
    expect(rowDeviation(stationRow())).toBeNull();
    expect(rowDeviation(stationRow({ actualTime: '2026-11-22T12:27:00Z' }))).toBe(-3);
    expect(rowDeviation(stationRow({ liveEstimateTime: '2026-11-22T12:38:00Z' }))).toBe(8);
    expect(
      rowDeviation(stationRow({ liveEstimateTime: '2026-11-22T12:38:00Z', unknownDelay: true })),
    ).toBeNull();
  });

  it('toiston historia sisältää vain peräkkäisistä näytteistä johdettuja muutoksia', () => {
    const later = '2026-11-22T12:10:00Z';
    const recording: Recording = {
      source: 'Test',
      license: 'CC BY 4.0',
      frames: [
        { capturedAt: '2026-11-22T12:00:00Z', trains: [service()], locations: [] },
        {
          capturedAt: observedAt,
          trains: [
            service({ timeTableRows: [stationRow({ liveEstimateTime: '2026-11-22T12:33:00Z' })] }),
          ],
          locations: [],
        },
        {
          capturedAt: later,
          trains: [
            service({ timeTableRows: [stationRow({ liveEstimateTime: '2026-11-22T12:35:00Z' })] }),
          ],
          locations: [],
        },
      ],
    };
    expect(recordingObservations(recording).map((e) => e.observedAt)).toEqual([later, observedAt]);
  });
});

describe('Liittyvien tiedotteiden rajaus', () => {
  const notice = (changes: Partial<Notice> = {}): Notice => ({
    id: '1',
    creationDateTime: observedAt,
    startValidity: '2026-11-22T11:00:00Z',
    endValidity: '2026-11-22T15:00:00Z',
    ...changes,
  });
  it('hyväksyy oikean junan ja saman liikennepaikan tiedotteen', () => {
    const ns = [notice({ trainNumber: 21 }), notice({ id: '2', stations: ['OL'] })];
    expect(matchingNotices(service(), ns, Date.parse(observedAt))).toHaveLength(2);
  });
  it('ei väitä eri junan tiedotetta valitun junan tiedotteeksi', () => {
    expect(
      matchingNotices(
        service(),
        [notice({ trainNumber: 22, stations: ['OL'] })],
        Date.parse(observedAt),
      ),
    ).toEqual([]);
  });
  it('kunnioittaa lähtöpäivää ja voimassaoloa', () => {
    expect(
      matchingNotices(
        service(),
        [
          notice({ trainNumber: 21, trainDepartureDate: '2026-11-21' }),
          notice({ id: '2', trainNumber: 21, startValidity: '2026-11-23T12:00:00Z' }),
        ],
        Date.parse(observedAt),
      ),
    ).toEqual([]);
  });
});
