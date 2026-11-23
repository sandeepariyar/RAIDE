/** Pure viewport math for the railway map's mouse, touch and keyboard interactions. */
export interface MapViewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface MapPoint {
  x: number;
  y: number;
}

export const MAP_VIEWBOX = { width: 760, height: 570 } as const;
export const MAP_CENTER = { x: MAP_VIEWBOX.width / 2, y: MAP_VIEWBOX.height / 2 } as const;

const clamp = (value: number, lower: number, upper: number) =>
  Math.min(upper, Math.max(lower, value));

export function zoomMapAt(
  viewport: MapViewport,
  factor: number,
  anchor: MapPoint = MAP_CENTER,
): MapViewport {
  if (!Number.isFinite(factor) || factor <= 0) return viewport;
  const zoom = clamp(viewport.zoom * factor, 0.7, 8);
  const ratio = zoom / viewport.zoom;
  return {
    zoom,
    panX: anchor.x - (anchor.x - viewport.panX) * ratio,
    panY: anchor.y - (anchor.y - viewport.panY) * ratio,
  };
}

export function panMap(viewport: MapViewport, dx: number, dy: number): MapViewport {
  return { ...viewport, panX: viewport.panX + dx, panY: viewport.panY + dy };
}

/** Preserve the touched world point while two fingers zoom and translate together. */
export function pinchMapAt(
  initial: MapViewport,
  startAnchor: MapPoint,
  currentAnchor: MapPoint,
  scale: number,
): MapViewport {
  if (!Number.isFinite(scale) || scale <= 0) return initial;
  const zoom = clamp(initial.zoom * scale, 0.7, 8);
  return {
    zoom,
    panX: currentAnchor.x - ((startAnchor.x - initial.panX) / initial.zoom) * zoom,
    panY: currentAnchor.y - ((startAnchor.y - initial.panY) / initial.zoom) * zoom,
  };
}

/**
 * Convert a viewport CSS-pixel coordinate into the SVG 760×570 viewBox.
 * Accounts for preserveAspectRatio="xMidYMid meet" letterboxing at different monitor ratios.
 */
export function mapViewBoxPoint(
  client: MapPoint,
  bounds: { left: number; top: number; width: number; height: number },
): MapPoint {
  if (bounds.width <= 0 || bounds.height <= 0) return MAP_CENTER;
  const scale = Math.min(bounds.width / MAP_VIEWBOX.width, bounds.height / MAP_VIEWBOX.height);
  const insetX = (bounds.width - MAP_VIEWBOX.width * scale) / 2;
  const insetY = (bounds.height - MAP_VIEWBOX.height * scale) / 2;
  return {
    x: clamp((client.x - bounds.left - insetX) / scale, 0, MAP_VIEWBOX.width),
    y: clamp((client.y - bounds.top - insetY) / scale, 0, MAP_VIEWBOX.height),
  };
}

/** A source timestamp is an observation, never a claim about continuous current position. */
export function gpsObservationAge(timestamp: string, now: number): number | null {
  const observedAt = Date.parse(timestamp);
  if (!Number.isFinite(observedAt) || observedAt > now + 60_000) return null;
  return Math.max(0, Math.round((now - observedAt) / 60_000));
}
