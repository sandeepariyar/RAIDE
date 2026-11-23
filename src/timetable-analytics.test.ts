import { describe, expect, it } from 'vitest';
import type { TimeRow, Train } from './domain';
import {
  corridorTrains,
  heatRow,
  heatValue,
  makeFlow,
  makeHeatmap,
  prioritizedTrains,
  trainLaneDeviation,
  trainLaneDelayLabel,
  trainSpan,
} from './timetable-analytics';

const baseTime = '2026-11-22T12:';
const row = (
  stationShortCode: string,
  type: 'ARRIVAL' | 'DEPARTURE',
  minute: string,
  changes: Partial<TimeRow> = {},
): TimeRow => ({
  stationShortCode,
  type,
  scheduledTime: `${baseTime}${minute}:00Z`,
  commercialStop: true,
  cancelled: false,
  ...changes,
});
const train = (number: number, rows: TimeRow[], departureDate = '2026-11-22'): Train => ({
  trainNumber: number,
  departureDate,
  trainType: 'IC',
  trainCategory: 'Long-distance',
  runningCurrently: true,
  cancelled: false,
  timeTableRows: rows,
});
const start = Date.parse(`${baseTime}00:00Z`);
const end = Date.parse(`${baseTime}45:00Z`);

describe('Graafisen aikataulun aineiston rajaus', () => {
  it('näyttää junan, jonka reitti kulkee aikaikkunan läpi vaikka päätepisteet ovat ulkopuolella', () => {
    const passing = train(1, [
      row('HKI', 'DEPARTURE', '00', { scheduledTime: '2026-11-22T11:00:00Z' }),
      row('RI', 'ARRIVAL', '00', { scheduledTime: '2026-11-22T14:00:00Z' }),
    ]);
    expect(corridorTrains([passing], ['HKI', 'RI'], start, end)).toHaveLength(1);
  });
  it('ei esitä vain yhdessä valitun rataosan liikennepaikassa käyviä junia rataosaviivoina', () => {
    expect(
      corridorTrains(
        [train(1, [row('HKI', 'ARRIVAL', '10'), row('OL', 'ARRIVAL', '25')])],
        ['HKI', 'RI'],
        start,
        end,
      ),
    ).toHaveLength(0);
  });
  it('nostaa käyttäjän valitseman junan aina ensin', () => {
    const a = train(1, [row('HKI', 'DEPARTURE', '10'), row('RI', 'ARRIVAL', '30')]);
    const b = train(2, [row('HKI', 'DEPARTURE', '10'), row('RI', 'ARRIVAL', '30')]);
    expect(prioritizedTrains([a, b], '2026-11-22/2', start)[0].trainNumber).toBe(2);
  });
});

describe('Viivekartan laskenta', () => {
  it('laskee yhden junan kerran samassa liikennepaikka/aikaruutu-parissa', () => {
    const sameStop = train(21, [
      row('TPE', 'ARRIVAL', '02', { liveEstimateTime: `${baseTime}07:00Z` }),
      row('TPE', 'DEPARTURE', '05', { liveEstimateTime: `${baseTime}10:00Z` }),
    ]);
    const cell = makeHeatmap([sameStop], ['TPE'], start, end)[0];
    expect(cell.count).toBe(1);
    expect(cell.delayed).toBe(1);
    expect(cell.delayMinutes).toBe(5);
  });
  it('säilyttää saman junan eri lähtöpäivillä erillisinä', () => {
    const rows = [row('TPE', 'ARRIVAL', '05')];
    expect(
      makeHeatmap([train(21, rows), train(21, rows, '2026-11-21')], ['TPE'], start, end)[0].count,
    ).toBe(2);
  });
  it('ei muuta tuntematonta viivettä nollaksi keskiarvossa', () => {
    const delayed = train(1, [
      row('TPE', 'ARRIVAL', '05', { liveEstimateTime: `${baseTime}10:00Z` }),
    ]);
    const unknown = train(2, [
      row('TPE', 'ARRIVAL', '05', { unknownDelay: true, liveEstimateTime: `${baseTime}07:00Z` }),
    ]);
    const cell = makeHeatmap([delayed, unknown], ['TPE'], start, end)[0];
    expect(cell.count).toBe(2);
    expect(cell.known).toBe(1);
    expect(heatValue(cell, 'average')).toBe(5);
  });
  it('jättää puuttuvan aikatiedon vailla laskettavaa viivettä mutta säilyttää junamäärän', () => {
    const cell = makeHeatmap([train(1, [row('TPE', 'ARRIVAL', '05')])], ['TPE'], start, end)[0];
    expect(cell.count).toBe(1);
    expect(cell.known).toBe(0);
    expect(heatValue(cell, 'delayed')).toBe(0);
  });
  it('pitää neljännestunnit seinäkellon ajassa silloinkin kun nyt sisältää sekunteja', () => {
    const cells = makeHeatmap(
      [train(3, [row('TPE', 'ARRIVAL', '14')])],
      ['TPE'],
      start + 7 * 60000 + 39000,
      start + 31 * 60000,
    );
    expect(cells.map((c) => c.start)).toEqual([start, start + 15 * 60000, start + 30 * 60000]);
    expect(cells[0].count).toBe(1);
  });
  it('erottaa oikeasti aikataulussa olleen junan puuttuvasta viivetiedosta', () => {
    const scheduledOnly = train(4, [row('TPE', 'ARRIVAL', '05')]);
    const onTime = train(5, [row('TPE', 'ARRIVAL', '05', { actualTime: `${baseTime}05:00Z` })]);
    const cell = makeHeatmap([scheduledOnly, onTime], ['TPE'], start, end)[0];
    expect(cell).toMatchObject({
      count: 2,
      known: 1,
      delayed: 0,
      actual: 1,
      scheduled: 1,
      estimated: 0,
    });
    expect(heatRow(scheduledOnly, 'TPE', start, start + 900000)?.actualTime).toBeUndefined();
  });
  it('ei merkitse peruttua junaa viiveruudun junamäärään', () => {
    const cancelled = train(6, [row('TPE', 'ARRIVAL', '05')]);
    cancelled.cancelled = true;
    expect(makeHeatmap([cancelled], ['TPE'], start, end)[0].count).toBe(0);
    expect(
      makeHeatmap(
        [train(7, [row('TPE', 'ARRIVAL', '05', { cancelled: true })])],
        ['TPE'],
        start,
        end,
      )[0].count,
    ).toBe(0);
  });
  it('näyttää saman edustavan asematapahtuman yhteenvedossa ja junan tarkastelussa', () => {
    const single = train(8, [
      row('TPE', 'ARRIVAL', '03', { unknownDelay: true }),
      row('TPE', 'DEPARTURE', '05', { actualTime: `${baseTime}08:00Z` }),
    ]);
    const cell = makeHeatmap([single], ['TPE'], start, end)[0];
    expect(cell).toMatchObject({ known: 1, delayed: 1, delayMinutes: 3 });
    expect(heatRow(single, 'TPE', start, start + 900000)?.type).toBe('DEPARTURE');
  });
});

describe('Liikennevirta ja aikajanat', () => {
  it('ei koskaan tulosta aikataulujunalle ääretöntä minuuttipoikkeamaa', () => {
    const scheduled = train(81, [row('HKI', 'DEPARTURE', '03'), row('RI', 'ARRIVAL', '22')]);
    const deviation = trainLaneDeviation(scheduled, new Set(['HKI', 'RI']), start);
    expect(deviation).toBeNull();
    expect(trainLaneDelayLabel(deviation)).toBe('Ei viivetietoa');
    expect(trainLaneDelayLabel(12)).toBe('+12 min');
    expect(trainLaneDelayLabel(-2)).toBe('-2 min');
  });
  it('erottelee saapumisen ja lähdön sekä sivuuttaa perutun pysähdystapahtuman', () => {
    const service = train(1, [
      row('HKI', 'ARRIVAL', '03'),
      row('HKI', 'DEPARTURE', '08'),
      row('HKI', 'ARRIVAL', '12', { cancelled: true }),
    ]);
    const buckets = makeFlow([service], ['HKI'], start, end, 15);
    expect(buckets[0]).toMatchObject({ arrivals: 1, departures: 1 });
  });
  it('osaa tarkastella yhtä liikennepaikkaa myös muiden pysähdysten ollessa mukana', () => {
    const service = train(1, [row('HKI', 'ARRIVAL', '03'), row('RI', 'DEPARTURE', '08')]);
    const result = makeFlow([service], ['RI'], start, end, 15);
    expect(result[0]).toMatchObject({ arrivals: 0, departures: 1 });
  });
  it('erottaa suunnitellun ja havaitun aikajakson', () => {
    const service = train(1, [
      row('HKI', 'DEPARTURE', '00', { actualTime: `${baseTime}03:00Z` }),
      row('RI', 'ARRIVAL', '40', { liveEstimateTime: `${baseTime}44:00Z` }),
    ]);
    const result = trainSpan(service, new Set(['HKI', 'RI']));
    expect(result).toMatchObject({
      scheduledStart: start,
      observedStart: start + 180000,
      observedEnd: Date.parse(`${baseTime}44:00Z`),
    });
  });
});
