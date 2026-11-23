export interface Station {
  stationShortCode: string;
  stationName: string;
  latitude: number;
  longitude: number;
  passengerTraffic: boolean;
  countryCode: string;
  type: string;
}
export interface TimeRow {
  stationShortCode: string;
  type: 'ARRIVAL' | 'DEPARTURE';
  commercialStop: boolean;
  scheduledTime: string;
  liveEstimateTime?: string;
  actualTime?: string;
  differenceInMinutes?: number;
  cancelled: boolean;
  commercialTrack?: string;
  unknownDelay?: boolean;
  causes?: unknown[];
}
export interface Train {
  trainNumber: number;
  departureDate: string;
  trainType: string;
  trainCategory: string;
  commuterLineID?: string;
  runningCurrently: boolean;
  cancelled: boolean;
  timeTableRows: TimeRow[];
}
export interface Location {
  trainNumber: number;
  departureDate: string;
  timestamp: string;
  speed: number;
  location: { type: 'Point'; coordinates: [number, number] };
}
export interface Notice {
  id: string;
  creationDateTime: string;
  startValidity: string;
  endValidity: string;
  trainNumber?: number;
  trainDepartureDate?: string;
  stations?: string[];
  video?: { text?: { fi?: string } };
  audio?: { text?: { fi?: string } };
}
export interface Frame {
  capturedAt: string;
  trains: Train[];
  locations: Location[];
}
export interface Recording {
  source: string;
  license: string;
  frames: Frame[];
}
export type Category = 'all' | 'long' | 'commuter' | 'cargo';
export const key = (t: { trainNumber: number; departureDate: string }) =>
  `${t.departureDate}/${t.trainNumber}`;
export const time = (value: string | number | Date | undefined) =>
  value
    ? new Intl.DateTimeFormat('fi-FI', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Helsinki',
      }).format(new Date(value))
    : '—';
export const date = (value: string | number | Date) =>
  new Intl.DateTimeFormat('fi-FI', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'Europe/Helsinki',
  }).format(new Date(value));
export const localDate = (value: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Helsinki',
  }).format(value);
export const label = (t: Train) =>
  t.commuterLineID ? `${t.commuterLineID} ${t.trainNumber}` : `${t.trainType} ${t.trainNumber}`;
export function endpoints(t: Train) {
  const stops = t.timeTableRows.filter((r) => r.commercialStop);
  const rows = stops.length ? stops : t.timeTableRows;
  return [rows[0]?.stationShortCode ?? '', rows.at(-1)?.stationShortCode ?? ''];
}
export function delay(t: Train, now: number): number | null {
  const future = t.timeTableRows.find(
    (r) =>
      !r.actualTime &&
      !r.cancelled &&
      new Date(r.liveEstimateTime ?? r.scheduledTime).getTime() >= now - 60_000,
  );
  if (future?.unknownDelay) return null;
  if (future?.liveEstimateTime)
    return Math.round(
      (Date.parse(future.liveEstimateTime) - Date.parse(future.scheduledTime)) / 60000,
    );
  const past = t.timeTableRows
    .filter((r) => r.actualTime && Date.parse(r.actualTime) <= now + 60_000)
    .at(-1);
  if (past)
    return Math.round((Date.parse(past.actualTime!) - Date.parse(past.scheduledTime)) / 60000);
  return null;
}
export function nextStop(t: Train, now: number) {
  return t.timeTableRows.find(
    (r) =>
      r.type === 'ARRIVAL' &&
      r.commercialStop &&
      !r.cancelled &&
      !r.actualTime &&
      Date.parse(r.liveEstimateTime ?? r.scheduledTime) >= now - 60_000,
  );
}
export function matchesCategory(t: Train, category: Category) {
  return (
    category === 'all' ||
    (category === 'commuter' && t.trainCategory === 'Commuter') ||
    (category === 'long' && ['Long-distance', 'NightTrain'].includes(t.trainCategory)) ||
    (category === 'cargo' && t.trainCategory === 'Cargo')
  );
}
export function createTrainMatcher(q: string, stations: Map<string, Station>) {
  const query = q.toLocaleLowerCase('fi').trim();
  if (!query) return (_t: Train) => true;
  if (/^\d+$/.test(query)) return (t: Train) => t.trainNumber === Number(query);
  const exactStations = new Set(
    [...stations.values()]
      .filter(
        (s) =>
          s.stationShortCode.toLowerCase() === query ||
          s.stationName.toLocaleLowerCase('fi') === query ||
          s.stationName.toLocaleLowerCase('fi').replace(/ asema$/, '') === query,
      )
      .map((s) => s.stationShortCode),
  );
  if (exactStations.size)
    return (t: Train) => t.timeTableRows.some((r) => exactStations.has(r.stationShortCode));
  if (/^[a-zäöå]+\s*\d+$/i.test(query)) {
    const compact = query.replace(/\s+/g, '');
    return (t: Train) => label(t).toLowerCase().replace(/\s+/g, '') === compact;
  }
  return (t: Train) =>
    `${label(t)} ${t.timeTableRows.map((r) => `${r.stationShortCode} ${stations.get(r.stationShortCode)?.stationName ?? ''}`).join(' ')}`
      .toLocaleLowerCase('fi')
      .includes(query);
}
export function matchesQuery(t: Train, q: string, stations: Map<string, Station>) {
  return createTrainMatcher(q, stations)(t);
}

export const noticeText = (n: Notice) =>
  n.video?.text?.fi ?? n.audio?.text?.fi ?? 'Suomenkielistä tiedotetta ei ole saatavilla.';
export function visibleTrains(trains: Train[], locations: Location[], now: number) {
  const located = new Set(
    locations
      .filter(
        (l) =>
          Date.parse(l.timestamp) >= now - 10 * 60_000 && Date.parse(l.timestamp) <= now + 60_000,
      )
      .map(key),
  );
  return trains.filter((t) => {
    if (t.runningCurrently || located.has(key(t))) return true;
    const rows = t.timeTableRows;
    const first = rows[0],
      last = rows.at(-1);
    return (
      first &&
      last &&
      Date.parse(first.scheduledTime) < now + 90 * 60_000 &&
      Date.parse(last.liveEstimateTime ?? last.scheduledTime) > now
    );
  });
}
export function sortTrains(trains: Train[], sort: 'delay' | 'number' | 'next', now: number) {
  return [...trains].sort((a, b) =>
    sort === 'number'
      ? a.trainNumber - b.trainNumber
      : sort === 'next'
        ? Date.parse(
            nextStop(a, now)?.liveEstimateTime ?? nextStop(a, now)?.scheduledTime ?? '9999-01-01',
          ) -
          Date.parse(
            nextStop(b, now)?.liveEstimateTime ?? nextStop(b, now)?.scheduledTime ?? '9999-01-01',
          )
        : (delay(b, now) ?? -999) - (delay(a, now) ?? -999),
  );
}
export function stationSequence(t: Train) {
  return t.timeTableRows
    .filter((r, i, a) => i === 0 || a[i - 1].stationShortCode !== r.stationShortCode)
    .map((r) => r.stationShortCode);
}
export function pendingRows(t: Train) {
  return t.timeTableRows.filter(
    (r) =>
      (r.commercialStop && r.type === 'ARRIVAL') || (r.commercialStop && r === t.timeTableRows[0]),
  );
}
