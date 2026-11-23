import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { corridors } from './corridors';
import { key } from './domain';
import { buildLivingNetwork } from './living-network-model';
import { decodeRecording } from './service';

/** Release regression with the actual checked-in replay, not a fabricated timetable. */
describe('Elävä reittiverkko – tallenteen oikeat kaukojunat', () => {
  const raw = JSON.parse(
    readFileSync(new URL('../public/data/recording.json', import.meta.url), 'utf8'),
  );
  const replay = decodeRecording(raw);

  for (const number of [63, 65, 67, 68, 70]) {
    it(`retains the explicitly unknown intermediate route of IC ${number}`, () => {
      const frame = replay.frames.find((candidate) =>
        candidate.trains.some((train) => train.trainNumber === number && train.trainType === 'IC'),
      );
      expect(frame, `IC ${number} should exist in the bundled recording`).toBeDefined();
      const service = frame!.trains.find(
        (train) => train.trainNumber === number && train.trainType === 'IC',
      )!;
      const now = Date.parse(frame!.capturedAt);
      const graph = buildLivingNetwork({
        trains: frame!.trains,
        stations: new Map(),
        corridorCodes: corridors.west.stations,
        qualifierCodes: corridors.west.qualifiers,
        now,
        from: now - 15 * 60_000,
        to: now + 60 * 60_000,
        selectedTrainKey: key(service),
        showBranches: true,
      });
      expect(
        graph.edges.some((edge) => edge.isGap && edge.selected && edge.id.startsWith('gap:')),
        `IC ${number} needs a visible unresolved link without invented rail occupancy`,
      ).toBe(true);
      expect(graph.edges.every((edge) => !('occupied' in edge))).toBe(true);
    });
  }
});
