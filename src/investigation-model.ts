import { key, type Notice, type Recording, type TimeRow, type Train } from './domain';

export type ObservationKind = 'actual' | 'forecast' | 'cancelled' | 'track';

export interface Observation {
  id: string;
  observedAt: string;
  trainKey: string;
  kind: ObservationKind;
  stationCode?: string;
  title: string;
  description: string;
}

const clock = (value: string) =>
  new Intl.DateTimeFormat('fi-FI', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Helsinki',
  }).format(new Date(value));

export function rowDeviation(row: TimeRow): number | null {
  if (row.cancelled || row.unknownDelay) return null;
  const observed = row.actualTime ?? row.liveEstimateTime;
  if (!observed) return null;
  const difference = Date.parse(observed) - Date.parse(row.scheduledTime);
  return Number.isFinite(difference) ? Math.round(difference / 60000) : null;
}

/** A snapshot difference is evidence of a change BETWEEN observations, not its exact occurrence time. */
export function compareSnapshots(
  previous: Train[],
  current: Train[],
  observedAt: string,
): Observation[] {
  const oldTrains = new Map(previous.map((t) => [key(t), t]));
  const events: Observation[] = [];
  const add = (
    t: Train,
    kind: ObservationKind,
    title: string,
    description: string,
    index = -1,
    stationCode?: string,
  ) => {
    events.push({
      id: `${observedAt}/${key(t)}/${index}/${kind}`,
      observedAt,
      trainKey: key(t),
      kind,
      title,
      description,
      stationCode,
    });
  };

  for (const train of current) {
    const old = oldTrains.get(key(train));
    if (!old) continue; // First observation does not establish a change.
    if (train.cancelled !== old.cancelled)
      add(
        train,
        'cancelled',
        train.cancelled ? 'Juna merkitty perutuksi' : 'Junan peruutusmerkintä poistui',
        'Junan peruutustila muuttui lähdeaineistossa.',
      );

    // Include row type and its ordinal to avoid merging repeated visits to the same station.
    const indexes = (rows: TimeRow[]) => {
      const occurrences = new Map<string, number>();
      return new Map(
        rows.map((r) => {
          const stem = `${r.stationShortCode}/${r.type}`;
          const ordinal = occurrences.get(stem) ?? 0;
          occurrences.set(stem, ordinal + 1);
          return [`${stem}/${ordinal}`, r] as const;
        }),
      );
    };
    const priorRows = indexes(old.timeTableRows);
    const currentRows = indexes(train.timeTableRows);
    let i = 0;
    for (const [rowKey, row] of currentRows) {
      const before = priorRows.get(rowKey);
      if (!before) continue;
      const action = row.type === 'ARRIVAL' ? 'saapuminen' : 'lähtö';
      const station = row.stationShortCode;
      if (row.actualTime && row.actualTime !== before.actualTime) {
        add(
          train,
          'actual',
          `Toteutunut ${action}`,
          `${station}: toteuma ${clock(row.actualTime)} (aikataulu ${clock(row.scheduledTime)}).`,
          i,
          station,
        );
      } else if (
        !row.actualTime &&
        (row.liveEstimateTime !== before.liveEstimateTime ||
          row.unknownDelay !== before.unknownDelay)
      ) {
        const oldValue = before.unknownDelay
          ? 'myöhästyminen ei tiedossa'
          : before.liveEstimateTime
            ? clock(before.liveEstimateTime)
            : 'ei ennustetta';
        const newValue = row.unknownDelay
          ? 'myöhästyminen ei tiedossa'
          : row.liveEstimateTime
            ? clock(row.liveEstimateTime)
            : 'ei ennustetta';
        add(
          train,
          'forecast',
          `Ennuste muuttui: ${action}`,
          `${station}: ${oldValue} → ${newValue}.`,
          i,
          station,
        );
      }
      if (row.cancelled !== before.cancelled)
        add(
          train,
          'cancelled',
          row.cancelled ? 'Pysähdys merkitty perutuksi' : 'Pysähdyksen peruutusmerkintä poistui',
          `${station}: ${action}.`,
          i,
          station,
        );
      if ((row.commercialTrack ?? '') !== (before.commercialTrack ?? ''))
        add(
          train,
          'track',
          'Raidenumerotieto muuttui',
          `${station}: ${before.commercialTrack || 'ei tietoa'} → ${row.commercialTrack || 'ei tietoa'}.`,
          i,
          station,
        );
      i++;
    }
  }
  return events;
}

export function recordingObservations(recording: Recording): Observation[] {
  const events: Observation[] = [];
  for (let i = 1; i < recording.frames.length; i++) {
    events.push(
      ...compareSnapshots(
        recording.frames[i - 1].trains,
        recording.frames[i].trains,
        recording.frames[i].capturedAt,
      ),
    );
  }
  return events.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
}

export function matchingNotices(train: Train, notices: Notice[], now: number) {
  const stations = new Set(train.timeTableRows.map((r) => r.stationShortCode));
  return notices.filter((n) => {
    if (Date.parse(n.startValidity) > now || Date.parse(n.endValidity) < now) return false;
    if (typeof n.trainNumber === 'number')
      return (
        n.trainNumber === train.trainNumber &&
        (!n.trainDepartureDate || n.trainDepartureDate === train.departureDate)
      );
    return Boolean(n.stations?.some((s) => stations.has(s)));
  });
}
