/** Degrees between neighbouring cells, along a parallel and between them. */
const STEP = 1.5;

/**
 * The cells the hero globe is drawn from, as [longitude, latitude], in the
 * order the land mask stores them. Rings get fewer cells toward the poles so
 * every cell covers about the same ground. Antarctica and the far north are
 * left out: the globe never tilts far enough to show them.
 *
 * Shared by the generator (scripts/globe-land.ts) and the globe, so the two
 * can never disagree about which bit is which cell.
 */
export function* globeGrid(): Generator<[number, number]> {
  for (let lat = -58; lat <= 78; lat += STEP) {
    const ring = Math.max(1, Math.round((360 / STEP) * Math.cos((lat * Math.PI) / 180)));
    for (let i = 0; i < ring; i++) yield [-180 + (i * 360) / ring, lat];
  }
}
