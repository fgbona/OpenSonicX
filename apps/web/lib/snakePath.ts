/** A tile's box, relative to the element the connector is drawn in (with whatever hangs under it), and the height its cable runs at. */
export interface TileBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly mid: number;
}

/** How far a row's return bend sits past its outermost tile. */
const BEND_OUT = 8;
const MAX_RADIUS = 12;

/** Tiles grouped into the rows they wrapped onto, in order (a tile whose top is below the row's cable starts a new row). */
export function snakeRows(tiles: readonly TileBox[]): TileBox[][] {
  const rows: TileBox[][] = [];
  for (const tile of tiles) {
    const row = rows.at(-1);
    if (row && tile.top < (row[0] as TileBox).mid) row.push(tile);
    else rows.push([tile]);
  }
  return rows;
}

/**
 * The SVG path of a wrapped chain's cable: through each row's tiles left to right, then from the
 * right end of a row a rounded bend down and back to the left start of the next one (a serpentine
 * return). It ends at the last tile's left edge (the add tile, an open socket). Empty for no tiles.
 */
export function snakePath(tiles: readonly TileBox[]): string {
  const rows = snakeRows(tiles);
  if (rows.length === 0) return '';
  const mid = (t: TileBox) => t.mid;
  const n = (v: number) => Math.round(v * 10) / 10;
  const right = Math.max(...tiles.map((t) => t.right)) + BEND_OUT;
  const left = Math.min(...tiles.map((t) => t.left)) - BEND_OUT;
  const firstRow = rows[0] as TileBox[];
  const parts = [`M${n((firstRow[0] as TileBox).left)} ${n(mid(firstRow[0] as TileBox))}`];
  rows.forEach((row, i) => {
    const y = mid(row[0] as TileBox);
    const next = rows[i + 1];
    if (!next) {
      // A row of one tile after a bend already reached it.
      if (row.length > 1 || i === 0) parts.push(`H${n((row.at(-1) as TileBox).left)}`);
      return;
    }
    const y1 = mid(next[0] as TileBox);
    // The return runs in the gap between the rows.
    const gap = (Math.max(...row.map((t) => t.bottom)) + Math.min(...next.map((t) => t.top))) / 2;
    const r = Math.max(0, Math.min(MAX_RADIUS, (gap - y) / 2, (y1 - gap) / 2));
    parts.push(
      `H${n(right - r)}`,
      `A${n(r)} ${n(r)} 0 0 1 ${n(right)} ${n(y + r)}`,
      `V${n(gap - r)}`,
      `A${n(r)} ${n(r)} 0 0 1 ${n(right - r)} ${n(gap)}`,
      `H${n(left + r)}`,
      `A${n(r)} ${n(r)} 0 0 0 ${n(left)} ${n(gap + r)}`,
      `V${n(y1 - r)}`,
      `A${n(r)} ${n(r)} 0 0 0 ${n(left + r)} ${n(y1)}`,
    );
  });
  return parts.join(' ');
}
