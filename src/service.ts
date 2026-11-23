import {
  key,
  localDate,
  type Train,
  type Station,
  type Location,
  type Notice,
  type Recording,
} from './domain';
export function decodeRecording(raw: any): Recording {
  if (raw.format !== 'raide-delta-v1') return raw as Recording;
  const current = new Map<string, Train>(Object.entries(raw.trains));
  return {
    source: raw.source,
    license: raw.license,
    frames: raw.frames.map((f: any) => {
      for (const [k, running, cancelled, patches] of f.changes) {
        const old = current.get(k)!;
        const rows = [...old.timeTableRows];
        for (const [i, changes] of patches) {
          rows[i] = { ...rows[i], ...changes };
        }
        current.set(k, { ...old, runningCurrently: running, cancelled, timeTableRows: rows });
      }
      return {
        capturedAt: f.capturedAt,
        locations: f.locations,
        trains: f.active.map((k: string) => current.get(k)!).filter(Boolean),
      };
    }),
  };
}
export const API = 'https://rata.digitraffic.fi/api/v1/';
export interface LiveData {
  trains: Train[];
  locations: Location[];
  notices: Notice[];
  /** Time when the API requests completed, not the timestamp of each train observation. */
  updatedAt: string;
  /** Legacy notice-feed degradation flag. Missing GPS is tracked independently. */
  partial: boolean;
  locationsAvailable: boolean;
  noticesAvailable: boolean;
  /** Optional recently-active timetable feed; not a verified physical train position. */
  recentTrainsAvailable: boolean;
  /** False when only the limited recently-active timetable feed supplied trains. */
  dailyTrainsAvailable: boolean;
}
export class RailService {
  private controllers = new Set<AbortController>();
  private previousDay: { date: string; trains: Train[] } | undefined;
  async json<T>(path: string, local = false): Promise<T> {
    const c = new AbortController();
    this.controllers.add(c);
    const timer = setTimeout(() => c.abort(), 15000);
    try {
      // Vite replaces BASE_URL for GitHub Pages' /RAIDE/ subpath; root hosting remains '/'.
      const publicBase = (import.meta as any).env?.BASE_URL || '/';
      const requestUrl = local ? publicBase + path.replace(/^\//, '') : API + path;
      const r = await fetch(requestUrl, {
        signal: c.signal,
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) throw Error(`Tietopyyntö epäonnistui (${r.status})`);
      return await r.json();
    } finally {
      clearTimeout(timer);
      this.controllers.delete(c);
    }
  }
  async bootstrap() {
    const [stations, geography, recording, notices] = await Promise.all([
      this.json<Station[]>('/data/stations.json', true),
      this.json<any>('/data/nordic.json', true),
      this.json<any>('/data/recording.json', true),
      this.json<Notice[]>('/data/notices.json', true),
    ]);
    return { stations, geography, recording: decodeRecording(recording), notices };
  }
  async live(): Promise<LiveData> {
    const now = new Date();
    const [trains, recentTrains, locations, notices] = await Promise.allSettled([
      this.json<Train[]>('trains/' + localDate(now)),
      this.json<Train[]>('live-trains'),
      this.json<Location[]>('train-locations/latest/'),
      this.json<Notice[]>('passenger-information/active'),
    ]);
    const dailyTrainsAvailable = trains.status === 'fulfilled' && Array.isArray(trains.value);
    const recentTrainsAvailable =
      recentTrains.status === 'fulfilled' && Array.isArray(recentTrains.value);
    // /live-trains is narrower than the full daily timetable feed. It can keep
    // the workspace usable during a daily-endpoint outage, but only when it
    // contains structurally valid services. Never silently imply full coverage.
    const validRecentTrains: Train[] = recentTrainsAvailable
      ? recentTrains.value.filter(
          (train): train is Train =>
            !!train &&
            Number.isFinite(train.trainNumber) &&
            typeof train.departureDate === 'string' &&
            Array.isArray(train.timeTableRows) &&
            train.timeTableRows.some(
              (row) =>
                !!row &&
                typeof row.stationShortCode === 'string' &&
                typeof row.scheduledTime === 'string' &&
                Number.isFinite(Date.parse(row.scheduledTime)),
            ),
        )
      : [];
    if (!dailyTrainsAvailable && !validRecentTrains.length)
      throw Error('Junien aikataulutietoja ei saatu Digitraffic-palvelusta.');
    // GPS is supplementary to train timetables. Its failure must not hide usable
    // live timetables or silently fall back to a recording.
    const locationsAvailable = locations.status === 'fulfilled' && Array.isArray(locations.value);
    const observedLocations = locationsAvailable ? locations.value : [];
    const fresh = observedLocations.filter(
      (l) =>
        Date.parse(l.timestamp) >= now.getTime() - 10 * 60_000 &&
        Date.parse(l.timestamp) <= now.getTime() + 60_000,
    );
    const dates = [...new Set(fresh.map((l) => l.departureDate))].filter(
      (d) => d !== localDate(now),
    );
    let previous: Train[] = [];
    for (const date of dates) {
      try {
        if (this.previousDay?.date !== date)
          this.previousDay = { date, trains: await this.json<Train[]>('trains/' + date) };
        const located = new Set(fresh.map((l) => l.departureDate + '/' + l.trainNumber));
        previous.push(
          ...this.previousDay.trains.filter((t) =>
            located.has(t.departureDate + '/' + t.trainNumber),
          ),
        );
      } catch {
        /* Current-day data remains available. */
      }
    }
    const noticesAvailable = notices.status === 'fulfilled' && Array.isArray(notices.value);
    // /live-trains includes services with a recent timetable event, not necessarily
    // trains known to be physically moving. It fills overnight timetable gaps
    // independently of GPS, while daily data remains authoritative on duplicates.
    const merged = new Map<string, Train>();
    if (dailyTrainsAvailable) for (const train of trains.value) merged.set(key(train), train);
    for (const train of previous) if (!merged.has(key(train))) merged.set(key(train), train);
    for (const train of validRecentTrains)
      if (!merged.has(key(train))) merged.set(key(train), train);
    return {
      trains: [...merged.values()],
      locations: observedLocations,
      notices: noticesAvailable ? notices.value : [],
      updatedAt: new Date().toISOString(),
      partial: !noticesAvailable,
      locationsAvailable,
      noticesAvailable,
      recentTrainsAvailable,
      dailyTrainsAvailable,
    };
  }
  locations() {
    return this.json<Location[]>('train-locations/latest/');
  }
  async train(date: string, number: number) {
    return this.json<Train[]>(`trains/${date}/${number}`);
  }
  dispose() {
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
  }
}
