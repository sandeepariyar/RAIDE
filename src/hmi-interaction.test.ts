import { describe, expect, it } from 'vitest';
import {
  gpsObservationAge,
  mapViewBoxPoint,
  panMap,
  pinchMapAt,
  zoomMapAt,
} from './hmi-interaction';

describe('Control-room map viewport', () => {
  it('preserves the world point under the pointer when zooming', () => {
    const before = { zoom: 1.4, panX: 22, panY: -10 };
    const anchor = { x: 180, y: 275 };
    const worldX = (anchor.x - before.panX) / before.zoom;
    const worldY = (anchor.y - before.panY) / before.zoom;
    const after = zoomMapAt(before, 1.3, anchor);
    expect((anchor.x - after.panX) / after.zoom).toBeCloseTo(worldX, 10);
    expect((anchor.y - after.panY) / after.zoom).toBeCloseTo(worldY, 10);
  });

  it('clamps zoom and ignores nonsensical zoom factors', () => {
    const start = { zoom: 1, panX: 0, panY: 0 };
    expect(zoomMapAt(start, 100).zoom).toBe(8);
    expect(zoomMapAt(start, 0.01).zoom).toBe(0.7);
    expect(zoomMapAt(start, NaN)).toBe(start);
    expect(zoomMapAt(start, 0)).toBe(start);
  });

  it('converts letterboxed monitor coordinates to the SVG map correctly', () => {
    const wide = { left: 100, top: 50, width: 1520, height: 570 };
    expect(mapViewBoxPoint({ x: 860, y: 335 }, wide)).toEqual({ x: 380, y: 285 });
    const tall = { left: 10, top: 20, width: 760, height: 1000 };
    expect(mapViewBoxPoint({ x: 390, y: 520 }, tall)).toEqual({ x: 380, y: 285 });
  });

  it('supports precise keyboard panning with no zoom loss', () => {
    expect(panMap({ zoom: 3, panX: 10, panY: 20 }, -35, 80)).toEqual({
      zoom: 3,
      panX: -25,
      panY: 100,
    });
  });

  it('keeps the same world point under moving pinch fingers', () => {
    const initial = { zoom: 2, panX: -55, panY: 120 };
    const start = { x: 370, y: 240 };
    const current = { x: 390, y: 265 };
    const next = pinchMapAt(initial, start, current, 1.5);
    expect(next.zoom).toBe(3);
    expect((current.x - next.panX) / next.zoom).toBeCloseTo(
      (start.x - initial.panX) / initial.zoom,
    );
    expect((current.y - next.panY) / next.zoom).toBeCloseTo(
      (start.y - initial.panY) / initial.zoom,
    );
  });

  it('labels real observation age and rejects impossible future timestamps', () => {
    const now = Date.parse('2026-11-22T12:10:00Z');
    expect(gpsObservationAge('2026-11-22T12:04:50Z', now)).toBe(5);
    expect(gpsObservationAge('2026-11-22T12:12:01Z', now)).toBeNull();
    expect(gpsObservationAge('invalid', now)).toBeNull();
  });
});
