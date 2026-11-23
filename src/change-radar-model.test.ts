import { describe, expect, it } from 'vitest';
import type { Observation } from './investigation-model';
import {
  eventsForRadarBucket,
  observationDescription,
  radarBuckets,
  radarViewData,
  summarizeChanges,
} from './change-radar-model';

const now = Date.parse('2026-11-22T12:15:00Z');
const observation = (
  id: string,
  minute: number,
  kind: Observation['kind'],
  trainKey = '2026-11-22/25',
): Observation => ({
  id,
  observedAt: new Date(now - minute * 60_000).toISOString(),
  trainKey,
  kind,
  stationCode: 'TPE',
  title: 'Tarkistettu muutos',
  description: 'TPE: 12.00 → 12.07',
});

describe('Muutostutkan havaintomalli', () => {
  it('laskee vain otosajan sisällä havaitut muutokset, ei vanhoja eikä tulevia', () => {
    const events = [
      observation('latest', 0, 'forecast'),
      observation('within', 5, 'cancelled'),
      observation('outside', 5.01, 'actual'),
      observation('future', -1, 'actual'),
    ];
    const result = summarizeChanges(events, now, 5);
    expect(result.items.map((item) => item.id)).toEqual(['latest', 'within']);
    expect(result).toMatchObject({ total: 2, forecast: 1, cancelled: 1, actual: 0 });
  });

  it('erottaa tapahtumat ja junat, poistaa päällekkäiset tunnisteet ja järjestää ajan mukaan', () => {
    const events = [
      observation('a', 12, 'forecast'),
      observation('b', 1, 'actual', '2026-11-22/31'),
      observation('a', 12, 'forecast'),
      observation('c', 4, 'track'),
    ];
    const result = summarizeChanges(events, now, 15);
    expect(result).toMatchObject({ total: 3, trains: 2, forecast: 1, actual: 1, track: 1 });
    expect(result.items.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(result.latest).toBe(now - 60_000);
  });

  it('tukee valittua junaa ja havaintolajin rajausvalintaa ilman keksittyjä tapahtumia', () => {
    const events = [
      observation('a', 2, 'forecast'),
      observation('b', 1, 'actual', '2026-11-22/31'),
      observation('c', 1, 'cancelled'),
    ];
    expect(summarizeChanges(events, now, 15, '2026-11-22/25', 'forecast').items).toHaveLength(1);
    expect(summarizeChanges(events, now, 15, '2026-11-22/99').total).toBe(0);
  });

  it('synkronoi pulssin pylväät ja tapahtumasyötteen saman havaintolajirajauksen alle', () => {
    const events = [observation('forecast', 1, 'forecast'), observation('actual', 1, 'actual')];
    const view = radarViewData(events, now, 15, '', 'forecast');
    expect(view.base.total).toBe(2);
    expect(view.narrowed.total).toBe(1);
    expect(view.narrowed.items.map((item) => item.kind)).toEqual(['forecast']);
    expect(view.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(1);
    expect(view.buckets.reduce((sum, bucket) => sum + bucket.actual, 0)).toBe(0);
  });

  it('ei pidä puuttuvaa havaintohistoriaa todisteena häiriöttömyydestä', () => {
    expect(summarizeChanges([], now, 60)).toMatchObject({ total: 0, trains: 0, latest: null });
  });

  it('ryhmittelee vain olemassa olevat otokset vakaisiin aikaruutuihin', () => {
    const events = [
      observation('a', 1, 'forecast'),
      observation('b', 1, 'cancelled'),
      observation('c', 4, 'actual'),
    ];
    const buckets = radarBuckets(events, now, 5);
    expect(buckets.length).toBeGreaterThanOrEqual(12);
    expect(buckets.length).toBeLessThanOrEqual(13);
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3);
    expect(
      buckets
        .flatMap((bucket) => [bucket.forecast, bucket.actual, bucket.cancelled])
        .reduce((sum, n) => sum + n, 0),
    ).toBe(3);
    expect(buckets.map((bucket) => bucket.start)).toEqual(
      [...buckets.map((b) => b.start)].sort((a, b) => a - b),
    );
  });

  it('säilyttää viimeisen tasarajan havainnon eikä kadota alkupään osittaista aikaruutua', () => {
    const alignedNow = Date.parse('2026-11-22T12:15:00Z');
    const offNow = alignedNow + 8000;
    const exact = observation('exact', 0, 'forecast');
    const early: Observation = {
      ...observation('early', 0, 'forecast'),
      observedAt: new Date(offNow - 5 * 60000).toISOString(),
    };
    const exactSummary = summarizeChanges([exact], alignedNow, 5);
    const exactBuckets = radarBuckets(exactSummary.items, alignedNow, 5);
    expect(exactBuckets.reduce((a, b) => a + b.count, 0)).toBe(1);
    expect(
      eventsForRadarBucket(exactSummary.items, exactBuckets.at(-1)!, true).map((e) => e.id),
    ).toEqual(['exact']);
    const offSummary = summarizeChanges([early, exact], offNow, 5);
    expect(radarBuckets(offSummary.items, offNow, 5).reduce((a, b) => a + b.count, 0)).toBe(
      offSummary.total,
    );
  });

  it('kuvaa tapahtuman tyypin havainnoksi eikä vahvistetuksi häiriöksi', () => {
    expect(observationDescription('forecast')).toBe('Ennuste muuttui');
    expect(observationDescription('actual')).toBe('Toteumatiedon muutos');
    expect(observationDescription('cancelled')).toContain('Peruutusmerkintä');
    expect(observationDescription('track')).toContain('Raidenumerotieto');
  });
});
