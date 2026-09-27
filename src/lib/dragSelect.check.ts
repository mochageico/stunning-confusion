// Assertions for hold-and-drag multi-select, run by `npm run check:dragselect`.

import { applyDragRange, autoScrollSpeed, hitTestIndex, ItemRect } from './dragSelect';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// A list: 5 rows, 40 tall, 10 apart.
const rows: ItemRect[] = [0, 1, 2, 3, 4].map((i) => ({ x: 0, y: i * 50, width: 300, height: 40 }));
// A 3-column grid: 6 boxes, 100x60, 10 apart.
const grid: ItemRect[] = [0, 1, 2, 3, 4, 5].map((i) => ({ x: (i % 3) * 110, y: Math.floor(i / 3) * 70, width: 100, height: 60 }));

console.log('hitTestIndex');
check('point inside a row', hitTestIndex(rows, 10, 60) === 1);
check('gap between rows snaps to nearest', hitTestIndex(rows, 10, 44) === 0 && hitTestIndex(rows, 10, 47) === 1);
check('above the list = first', hitTestIndex(rows, 10, -200) === 0);
check('below the list = last', hitTestIndex(rows, 10, 9999) === 4);
check('grid: second row, third column', hitTestIndex(grid, 250, 100) === 5);
check('grid: gap between columns', hitTestIndex(grid, 103, 20) === 0);
check('unmeasured items are skipped', hitTestIndex([undefined, rows[1]], 0, 0) === 1);
check('nothing measured = -1', hitTestIndex([undefined, undefined], 0, 0) === -1);

console.log('applyDragRange');
const ids = [1, 2, 3, 4, 5, 6];
check('drag down selects the range', same(applyDragRange([], ids, 1, 3, 'select'), [2, 3, 4]));
check('drag up selects the range', same(applyDragRange([], ids, 4, 2, 'select'), [3, 4, 5]));
check('press without moving selects just that verse', same(applyDragRange([], ids, 2, 2, 'select'), [3]));
check('keeps earlier selections outside the range', same(applyDragRange([6], ids, 0, 1, 'select'), [1, 2, 6]));
check('sliding back restores what was there before', same(applyDragRange([3], ids, 0, 0, 'select'), [1, 3]));
check('deselect mode clears the range only', same(applyDragRange([1, 2, 3, 4, 5, 6], ids, 1, 3, 'deselect'), [1, 5, 6]));
check('selection stays in numeric order', same(applyDragRange([10], [8, 9, 10, 11], 0, 1, 'select'), [8, 9, 10]));

console.log('autoScrollSpeed');
check('middle of screen: no scroll', autoScrollSpeed(400, 0, 800) === 0);
check('near top: scrolls up', autoScrollSpeed(20, 0, 800) < 0);
check('near bottom: scrolls down', autoScrollSpeed(780, 0, 800) > 0);
check('deeper into the edge = faster', autoScrollSpeed(790, 0, 800) > autoScrollSpeed(740, 0, 800));
check('past the edge holds at max', autoScrollSpeed(2000, 0, 800) === 18 && autoScrollSpeed(-50, 0, 800) === -18);
check('tiny viewport still has a still middle', autoScrollSpeed(75, 0, 150) === 0);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall drag-select checks passed');
