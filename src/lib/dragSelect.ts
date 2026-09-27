// Pure math behind hold-and-drag multi-select (see useDragSelect in
// src/components/useDragSelect.ts). Kept free of React Native so
// `npm run check:dragselect` can run it under plain Node.

export interface ItemRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Which item is under (px, py)? Falls back to the NEAREST item when the point
 * sits in a gap between items, or past either end of the list -- so dragging
 * off the last verse keeps it (and everything before it) selected instead of
 * dropping the range. Returns -1 only when nothing has been measured yet.
 */
export function hitTestIndex(rects: (ItemRect | undefined)[], px: number, py: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (!r) continue;
    const dx = Math.max(r.x - px, 0, px - (r.x + r.width));
    const dy = Math.max(r.y - py, 0, py - (r.y + r.height));
    const dist = dx * dx + dy * dy;
    if (dist === 0) return i;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/**
 * The selection while a drag is in progress. Everything between the verse
 * the drag started on (`anchor`) and the one under the finger (`current`),
 * in display order, is added ('select') or removed ('deselect'). Anything
 * outside that range keeps whatever state it had when the drag began -- so
 * sliding back toward the anchor un-does the verses you slid past, the same
 * way iPhone Photos behaves.
 */
export function applyDragRange(
  initial: number[],
  ids: number[],
  anchor: number,
  current: number,
  mode: 'select' | 'deselect'
): number[] {
  const lo = Math.max(0, Math.min(anchor, current));
  const hi = Math.min(ids.length - 1, Math.max(anchor, current));
  const next = new Set(initial);
  for (let i = lo; i <= hi; i++) {
    if (mode === 'select') next.add(ids[i]);
    else next.delete(ids[i]);
  }
  return [...next].sort((a, b) => a - b);
}

/**
 * Auto-scroll speed (px per frame) for a finger at window position `y`,
 * given the visible scroll area [top, bottom]. Zero in the middle; ramps up
 * linearly inside the `zone` nearest either edge, and holds at `max` once the
 * finger is at or past the edge. Negative scrolls up.
 */
export function autoScrollSpeed(y: number, top: number, bottom: number, zone = 72, max = 18): number {
  if (bottom - top < zone * 2) zone = (bottom - top) / 3;
  if (y < top + zone) return -max * Math.min(1, (top + zone - y) / zone);
  if (y > bottom - zone) return max * Math.min(1, (y - (bottom - zone)) / zone);
  return 0;
}
