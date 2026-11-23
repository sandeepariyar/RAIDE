import {
  visibleTrains,
  sortTrains,
  matchesCategory,
  createTrainMatcher,
  delay,
  type Train,
  type Location,
  type Station,
  type Category,
} from './domain';
let trains: Train[] = [],
  locations: Location[] = [],
  stationMap = new Map<string, Station>();
self.onmessage = (
  event: MessageEvent<{
    id: number;
    trains?: Train[];
    locations?: Location[];
    stations?: Station[];
    now: number;
    category: Category;
    query: string;
    sort: 'delay' | 'number' | 'next';
    onlyDelayed: boolean;
    scope: 'active' | 'day';
  }>,
) => {
  const d = event.data;
  if (d.trains) trains = d.trains;
  if (d.locations) locations = d.locations;
  if (d.stations) stationMap = new Map(d.stations.map((s) => [s.stationShortCode, s]));
  const active = visibleTrains(trains, locations, d.now);
  const matcher = createTrainMatcher(d.query, stationMap);
  const filtered = (d.scope === 'day' ? trains : active).filter(
    (t) =>
      matchesCategory(t, d.category) &&
      matcher(t) &&
      (!d.onlyDelayed || (delay(t, d.now) ?? 0) > 0),
  );
  const known = active.filter((t) => delay(t, d.now) !== null && !t.cancelled);
  self.postMessage({
    id: d.id,
    trains: sortTrains(filtered, d.sort, d.now),
    stats: {
      active: active.length,
      running: active.filter((t) => t.runningCurrently).length,
      known: known.length,
      onTime: known.filter((t) => (delay(t, d.now) ?? 1) <= 0).length,
      delayed: known.filter((t) => (delay(t, d.now) ?? 0) > 0).length,
      over5: known.filter((t) => (delay(t, d.now) ?? 0) > 5).length,
    },
  });
};
