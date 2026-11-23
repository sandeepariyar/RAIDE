import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  key,
  delay,
  time,
  localDate,
  matchesQuery,
  matchesCategory,
  visibleTrains,
  sortTrains,
  type Train,
  type Station,
  type TimeRow,
} from './domain';
import { decodeRecording } from './service';
import { corridors } from './corridors';
const now = Date.parse('2026-11-22T12:00:00Z');
const row = (overrides: Partial<TimeRow> = {}): TimeRow => ({
  stationShortCode: 'OL',
  type: 'ARRIVAL',
  commercialStop: true,
  scheduledTime: '2026-11-22T12:10:00Z',
  cancelled: false,
  ...overrides,
});
const train = (overrides: Partial<Train> = {}): Train => ({
  trainNumber: 21,
  departureDate: '2026-11-22',
  trainType: 'IC',
  trainCategory: 'Long-distance',
  runningCurrently: true,
  cancelled: false,
  timeTableRows: [row()],
  ...overrides,
});
describe('Junan yksilöinti ja aikavyöhyke', () => {
  it('erottaa saman numeron eri lähtöpäivinä', () =>
    expect(key(train())).not.toBe(key(train({ departureDate: '2026-11-21' }))));
  it('esittää talviajan Suomen ajassa', () => expect(time('2026-11-22T12:00:00Z')).toBe('14.00'));
  it('esittää kesäajan Suomen ajassa', () => expect(time('2026-07-22T12:00:00Z')).toBe('15.00'));
  it('määrittää lähtöpäivän Suomen päivämäärän mukaan', () =>
    expect(localDate(new Date('2026-11-22T23:10:00Z'))).toBe('2026-11-23'));
});
describe('Aikaeron tulkinta', () => {
  it('laskee ennusteen aikaeron', () =>
    expect(
      delay(train({ timeTableRows: [row({ liveEstimateTime: '2026-11-22T12:18:00Z' })] }), now),
    ).toBe(8));
  it('ei muuta puuttuvaa ennustetta nollaksi', () => expect(delay(train(), now)).toBeNull());
  it('tuntematon myöhästyminen ohittaa numeerisen ennusteen', () =>
    expect(
      delay(
        train({
          timeTableRows: [row({ liveEstimateTime: '2026-11-22T12:18:00Z', unknownDelay: true })],
        }),
        now,
      ),
    ).toBeNull());
  it('käyttää havaittua aikaeroa, kun uutta ennustetta ei ole', () =>
    expect(
      delay(
        train({
          timeTableRows: [
            row({ scheduledTime: '2026-11-22T11:40:00Z', actualTime: '2026-11-22T11:43:00Z' }),
          ],
        }),
        now,
      ),
    ).toBe(3));
  it('säilyttää etuajassa saapumisen negatiivisena', () =>
    expect(
      delay(
        train({
          timeTableRows: [
            row({ scheduledTime: '2026-11-22T11:40:00Z', actualTime: '2026-11-22T11:38:00Z' }),
          ],
        }),
        now,
      ),
    ).toBe(-2));
  it('ei käytä tulevaa toteumaa menneessä toistotilanteessa', () =>
    expect(
      delay(train({ timeTableRows: [row({ actualTime: '2026-11-22T12:15:00Z' })] }), now),
    ).toBeNull());
});
describe('Seuranta ja suodatus', () => {
  it('ei lisää päättynyttä junaa vanhan GPS-sijainnin perusteella', () =>
    expect(
      visibleTrains(
        [
          train({
            runningCurrently: false,
            timeTableRows: [
              row({ scheduledTime: '2026-11-22T10:00:00Z', actualTime: '2026-11-22T10:00:00Z' }),
            ],
          }),
        ],
        [
          {
            trainNumber: 21,
            departureDate: '2026-11-22',
            timestamp: '2026-11-22T10:00:00Z',
            speed: 0,
            location: { type: 'Point', coordinates: [25, 65] },
          },
        ],
        now,
      ),
    ).toHaveLength(0));
  it('Oulu-haku ei sekoita Oulunkylää Ouluun', () => {
    const m = new Map([
      ['OL', { stationName: 'Oulu asema', stationShortCode: 'OL' } as Station],
      ['OLK', { stationName: 'Oulunkylä', stationShortCode: 'OLK' } as Station],
    ]);
    expect(
      matchesQuery(train({ timeTableRows: [row({ stationShortCode: 'OLK' })] }), 'Oulu', m),
    ).toBe(false);
    expect(matchesQuery(train(), 'Oulu', m)).toBe(true);
  });
  it('hakee junanumeron täsmällisesti', () => {
    expect(matchesQuery(train(), '21', new Map())).toBe(true);
    expect(matchesQuery(train({ trainNumber: 210 }), '21', new Map())).toBe(false);
  });
  it('hakee junatyypin ja numeron täsmällisesti', () => {
    expect(matchesQuery(train(), 'IC21', new Map())).toBe(true);
    expect(matchesQuery(train({ trainNumber: 210 }), 'IC 21', new Map())).toBe(false);
  });
  it('erottelee tavara- ja kaukoliikenteen', () => {
    expect(matchesCategory(train(), 'long')).toBe(true);
    expect(matchesCategory(train(), 'cargo')).toBe(false);
  });
  it('hakee liikennepaikan suomenkielisellä nimellä', () =>
    expect(
      matchesQuery(
        train(),
        'oulu',
        new Map([['OL', { stationName: 'Oulu asema', stationShortCode: 'OL' } as Station]]),
      ),
    ).toBe(true));
  it('järjestää myöhästymisen mukaan ilman alkuperäisen aineiston muutosta', () => {
    const a = train({
        trainNumber: 1,
        timeTableRows: [row({ liveEstimateTime: '2026-11-22T12:12:00Z' })],
      }),
      b = train({
        trainNumber: 2,
        timeTableRows: [row({ liveEstimateTime: '2026-11-22T12:20:00Z' })],
      });
    const original = [a, b];
    expect(sortTrains(original, 'delay', now).map((t) => t.trainNumber)).toEqual([2, 1]);
    expect(original[0]).toBe(a);
  });
});
describe('Todellinen tallenne ja liikennepaikat', () => {
  const packed = JSON.parse(readFileSync('public/data/recording.json', 'utf8'));
  const recording = decodeRecording(packed);
  const stations: Station[] = JSON.parse(readFileSync('public/data/stations.json', 'utf8'));
  const codes = new Set(stations.map((s) => s.stationShortCode));
  it('purkaa kaikki todelliset havaintokehykset', () => {
    expect(recording.frames).toHaveLength(15);
    expect(recording.frames.every((f) => f.trains.length > 50 && f.locations.length > 50)).toBe(
      true,
    );
  });
  it('säilyttää havaintojen aikajärjestyksen', () => {
    for (let i = 1; i < recording.frames.length; i++)
      expect(Date.parse(recording.frames[i].capturedAt)).toBeGreaterThan(
        Date.parse(recording.frames[i - 1].capturedAt),
      );
  });
  it('päivittää aitoja sijainteja toiston aikana', () => {
    const a = recording.frames[0].locations,
      b = recording.frames.at(-1)!.locations;
    expect(
      a.some((l) => {
        const other = b.find((x) => key(x) === key(l));
        return other && JSON.stringify(l.location) !== JSON.stringify(other.location);
      }),
    ).toBe(true);
  });
  it('ei muuta ensimmäistä kehystä myöhempien muutosten yhteydessä', () => {
    const first = recording.frames[0].trains;
    for (const t of first) {
      expect(t).toEqual(packed.trains[key(t)]);
    }
  });
  it('käyttää vain virallisesta metatiedosta löytyviä liikennepaikkatunnuksia', () => {
    for (const c of Object.values(corridors))
      for (const s of c.stations) expect(codes.has(s), `${c.name}: ${s}`).toBe(true);
  });
});
