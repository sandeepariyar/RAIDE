import { describe, it, expect, vi, afterEach } from 'vitest';
import { RailService } from './service';
import { localDate } from './domain';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('Tietopalvelun virhetilanteet', () => {
  it('hylkää HTTP-virheen eikä tulkitse sitä tyhjäksi onnistuneeksi vastaukseksi', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })));
    await expect(new RailService().json('metadata/stations')).rejects.toThrow('503');
  });
  it('keskeyttää tietopyynnön aikakatkaisussa', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u, options) =>
          new Promise((_resolve, reject) =>
            options.signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            ),
          ),
      ),
    );
    const request = new RailService().json('metadata/stations');
    const assertion = expect(request).rejects.toHaveProperty('name', 'AbortError');
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });
  it('säilyttää juna- ja sijaintitiedot tiedotepalvelun virheestä huolimatta', async () => {
    const d = localDate(new Date());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('passenger-information')
          ? new Response('', { status: 503 })
          : new Response(
              JSON.stringify(
                url.includes('train-locations')
                  ? [
                      {
                        trainNumber: 21,
                        departureDate: d,
                        timestamp: new Date().toISOString(),
                        speed: 80,
                        location: { type: 'Point', coordinates: [25, 65] },
                      },
                    ]
                  : [{ trainNumber: 21, departureDate: d }],
              ),
              { status: 200 },
            ),
      ),
    );
    const result = await new RailService().live();
    expect(result.partial).toBe(true);
    expect(result.noticesAvailable).toBe(false);
    expect(result.locationsAvailable).toBe(true);
    expect(result.trains).toHaveLength(1);
    expect(result.locations).toHaveLength(1);
  });
  it('näyttää aidot ajantasaiset aikataulut, vaikka GPS-rajapinta on poissa käytöstä', async () => {
    const today = localDate(new Date());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('train-locations')
          ? new Response('', { status: 503 })
          : new Response(
              JSON.stringify(
                url.includes('trains/') ? [{ trainNumber: 87, departureDate: today }] : [],
              ),
              { status: 200 },
            ),
      ),
    );
    const result = await new RailService().live();
    expect(result.trains).toMatchObject([{ trainNumber: 87, departureDate: today }]);
    expect(result.locations).toEqual([]);
    expect(result.locationsAvailable).toBe(false);
    expect(result.noticesAvailable).toBe(true);
    expect(result.partial).toBe(false);
    expect(result.dailyTrainsAvailable).toBe(true);
  });

  it('pitää rajatun reaaliaikaisen aikatauluotoksen käytettävissä päivän palvelukatkossa', async () => {
    const today = localDate(new Date());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('trains/')) return new Response('', { status: 503 });
        if (url.includes('live-trains'))
          return new Response(
            JSON.stringify([
              {
                trainNumber: 93,
                departureDate: today,
                trainType: 'IC',
                timeTableRows: [
                  {
                    stationShortCode: 'HKI',
                    type: 'DEPARTURE',
                    scheduledTime: new Date().toISOString(),
                  },
                ],
              },
              { trainNumber: 1, departureDate: today }, // invalid fallback item must be skipped
            ]),
            { status: 200 },
          );
        return new Response('[]', { status: 200 });
      }),
    );
    const result = await new RailService().live();
    expect(result.dailyTrainsAvailable).toBe(false);
    expect(result.recentTrainsAvailable).toBe(true);
    expect(result.trains).toMatchObject([{ trainNumber: 93, departureDate: today }]);
    expect(result.trains).toHaveLength(1);
    expect(result.partial).toBe(false); // notices are independently available
  });
  it('hylkää live-tilan, jos kumpikaan aikataulupalvelu ei toimita käyttökelpoisia junia', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('trains/')
          ? new Response('', { status: 503 })
          : new Response('[]', { status: 200 }),
      ),
    );
    await expect(new RailService().live()).rejects.toThrow('Junien aikataulutietoja');
  });
  it('hylkää virheellisen aikatauluvastauksen eikä muuta sitä tyhjäksi listaksi', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) => new Response(url.includes('trains/') ? '{}' : '[]', { status: 200 }),
      ),
    );
    await expect(new RailService().live()).rejects.toThrow('Junien aikataulutietoja');
  });

  it('säilyttää edellisen lähtöpäivän hiljattain aktiiviset junat myös ilman GPS-havaintoa', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T22:15:00Z')); // 00.15 Suomen aikaa 23.11.
    const today = '2026-11-23';
    const previous = '2026-11-22';
    const dayTrain = {
      trainNumber: 21,
      departureDate: today,
      trainType: 'IC',
      timeTableRows: [{ stationShortCode: 'HKI', scheduledTime: '2026-11-23T04:00:00Z' }],
    };
    const overnight = {
      trainNumber: 93,
      departureDate: previous,
      trainType: 'IC',
      timeTableRows: [{ stationShortCode: 'OL', scheduledTime: '2026-11-22T23:10:00Z' }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('live-trains'))
          return new Response(JSON.stringify([overnight, { ...dayTrain, trainType: 'T' }]), {
            status: 200,
          });
        if (url.endsWith('trains/' + today))
          return new Response(JSON.stringify([dayTrain]), { status: 200 });
        if (url.includes('train-locations')) return new Response('', { status: 503 });
        return new Response('[]', { status: 200 });
      }),
    );
    const result = await new RailService().live();
    expect(result.locationsAvailable).toBe(false);
    expect(result.recentTrainsAvailable).toBe(true);
    expect(result.trains).toHaveLength(2);
    expect(result.trains.find((t) => t.departureDate === previous)).toMatchObject(overnight);
    // Day timetable stays authoritative rather than an arbitrary duplicate from /live-trains.
    expect(result.trains.find((t) => t.departureDate === today)?.trainType).toBe('IC');
  });

  it('kestää live-trains-palvelun vian ja säilyttää GPS:n osoittaman eilisen junan varahaun', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T22:15:00Z'));
    const previous = '2026-11-22';
    const overnight = {
      trainNumber: 93,
      departureDate: previous,
      trainType: 'IC',
      timeTableRows: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('live-trains')) return new Response('', { status: 503 });
        if (url.endsWith('trains/' + previous))
          return new Response(JSON.stringify([overnight]), { status: 200 });
        if (url.includes('train-locations'))
          return new Response(
            JSON.stringify([
              {
                trainNumber: 93,
                departureDate: previous,
                timestamp: new Date().toISOString(),
                speed: 52,
                location: { type: 'Point', coordinates: [25, 65] },
              },
            ]),
            { status: 200 },
          );
        return new Response('[]', { status: 200 });
      }),
    );
    const result = await new RailService().live();
    expect(result.recentTrainsAvailable).toBe(false);
    expect(result.locationsAvailable).toBe(true);
    expect(result.trains).toEqual([overnight]);
    expect(result.partial).toBe(false);
  });
});
