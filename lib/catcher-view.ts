/**
 * The imported TrackMan PlateLocSide, HorzBreak and RelSide retain the source
 * signs: positive is the pitcher's right (the catcher's left).
 * Convert only at the presentation boundary; never rewrite stored measurements.
 * Bearing / sprayAngle already use catcher view and must NOT use this conversion.
 */
export function catcherX(sourceX: number) {
  return sourceX === 0 ? 0 : -sourceX;
}

/** Mirror columns while preserving rows and source cell identities. */
export function catcherGridIndex(sourceIndex: number, columns: number) {
  return Math.floor(sourceIndex / columns) * columns + columns - 1 - sourceIndex % columns;
}

export function catcherGridOrder<T>(cells: T[], columns: number): T[] {
  return cells.map((_, index) => cells[catcherGridIndex(index, columns)]);
}

/** Turn the camera 180 degrees around the vertical axis (not a 2D mirror). */
export function catcherSpinVector(point: { x: number; y: number; z: number }) {
  return { x: catcherX(point.x), y: point.y, z: catcherX(point.z) };
}

export function catcherSpinAxis(sourceAxis: number) {
  return (360 - sourceAxis % 360) % 360;
}
