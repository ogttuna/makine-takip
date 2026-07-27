export type DropPoint = {
  x: number;
  y: number;
};

export type DropBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export function singleDroppedPath(paths: string[]): string | null {
  return paths.length === 1 && paths[0].trim() ? paths[0] : null;
}

export function physicalPointIsInsideBounds(
  position: DropPoint,
  scaleFactor: number,
  bounds: DropBounds,
): boolean {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const x = position.x / scale;
  const y = position.y / scale;

  return (
    x >= bounds.left &&
    x <= bounds.right &&
    y >= bounds.top &&
    y <= bounds.bottom
  );
}
