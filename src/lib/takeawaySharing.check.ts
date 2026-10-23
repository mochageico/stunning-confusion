// Regression assertions for sharing takeaways with a circle
// (src/lib/takeawaySharing.ts), run by `npm run check:takeawaysharing`.

import type { SharedTakeaway, Takeaway, TakeawayReply } from '../types';
import { makeTakeaway } from './takeaways';
import {
  authorShort,
  circleList,
  cleanReply,
  isShareable,
  nextSharedTo,
  REPLY_MAX,
  rememberedChoice,
  replyCountText,
  shareChanges,
  sharedChoiceFor,
  sharedCopy,
  sharedTakeawayId,
  visibleReplies,
} from './takeawaySharing';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`);
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const spot = { book: 'Matthew', chapter: 7, sectionStart: 1, sectionEnd: 5, label: 'Judge not' };
const T0 = '2026-10-20T10:00:00.000Z';
const T1 = '2026-10-21T10:00:00.000Z';

console.log('the switch');
{
  // The switch offered c1 and c2; c9 is a circle the list didn't show (not loaded yet, or left).
  check('switching on adds', same(nextSharedTo(undefined, ['c1'], ['c1', 'c2']), ['c1']));
  check('switching off removes', same(nextSharedTo(['c1', 'c2'], ['c2'], ['c1', 'c2']), ['c2']));
  check('a circle not offered is left alone', same(nextSharedTo(['c9', 'c1'], [], ['c1', 'c2']), ['c9']));
  check('nothing offered (circles not loaded) changes nothing', same(nextSharedTo(['c1', 'c2'], [], []), ['c1', 'c2']));
  check('a choice outside the offer is ignored', same(nextSharedTo([], ['cX'], ['c1']), []));
  check('no duplicates, fixed order', same(nextSharedTo(['c2'], ['c2', 'c1', 'c1'], ['c1', 'c2']), ['c1', 'c2']));
  check('opened takeaway starts on its circles still offered', same(sharedChoiceFor({ sharedTo: ['c1', 'c9'] }, ['c1', 'c2']), ['c1']));
  check('opened takeaway, never shared: off', same(sharedChoiceFor({}, ['c1']), []));
  check('remembered choice drops circles since left', same(rememberedChoice(['c2', 'c3'], ['c1', 'c2']), ['c2']));
  check('nothing remembered: off', same(rememberedChoice(null, ['c1']), []));
}

console.log('which writes a save needs');
{
  check('first share puts', same(shareChanges(undefined, ['c1'], true), { put: ['c1'], remove: [] }));
  check('an edit rewrites every shared circle', same(shareChanges(['c1', 'c2'], ['c1', 'c2'], true), { put: ['c1', 'c2'], remove: [] }));
  check('unsharing one removes it', same(shareChanges(['c1', 'c2'], ['c2'], true), { put: ['c2'], remove: ['c1'] }));
  check('unsharing all', same(shareChanges(['c1'], [], true), { put: [], remove: ['c1'] }));
  check('not shareable any more: out of every circle', same(shareChanges(['c1', 'c2'], ['c1', 'c2'], false), { put: [], remove: ['c1', 'c2'] }));
  check('deleting (after = none)', same(shareChanges(['c1'], undefined, false), { put: [], remove: ['c1'] }));
}

console.log('the private doc keeps sharedTo');
{
  const shared = makeTakeaway(spot, { text: 'Judge yourself first.', status: 'saved', sharedTo: ['c2', 'c1', 'c1'] }, null, T0);
  check('written and shared', same(shared.sharedTo, ['c1', 'c2']));
  check('shareable', isShareable(shared));
  const edited = makeTakeaway(spot, { text: 'Judge yourself first, then help.', status: 'saved' }, shared, T1);
  check('an edit without a switch keeps the circles', same(edited.sharedTo, ['c1', 'c2']));
  check('createdAt kept', edited.createdAt === T0 && edited.updatedAt === T1);
  const off = makeTakeaway(spot, { text: 'x', status: 'saved', sharedTo: [] }, shared, T1);
  check('switched off: no sharedTo field', !('sharedTo' in off));
  const later = makeTakeaway(spot, { text: '', status: 'later', sharedTo: ['c1'] }, null, T0);
  check('a Later stop is never shared', !('sharedTo' in later) && !isShareable(later));
  const draft = makeTakeaway(spot, { text: 'a draft', status: 'draft', sharedTo: ['c1'] }, null, T0);
  check('a Teach-It draft is never shared', !('sharedTo' in draft) && !isShareable(draft));
  const emptied = makeTakeaway(spot, { text: '   ', status: 'saved' }, shared, T1);
  check('emptied text drops sharedTo', !('sharedTo' in emptied));
}

console.log('the shared copy');
{
  const t: Takeaway = makeTakeaway(spot, { text: 'Judge yourself first.', note: '  Beam, then speck. ', status: 'saved', sharedTo: ['c1'] }, null, T0);
  const copy = sharedCopy(t, { uid: 'u1', name: 'Micah' }, 3);
  check('fields', copy.authorUid === 'u1' && copy.authorName === 'Micah' && copy.takeawayId === 'Matthew|7|1' && copy.bracketIndex === 3);
  check('passage and label', copy.book === 'Matthew' && copy.chapter === 7 && copy.sectionStart === 1 && copy.sectionEnd === 5 && copy.label === 'Judge not');
  check('note goes too, trimmed', copy.note === 'Beam, then speck.');
  check('dates are the author\'s', copy.createdAt === T0 && copy.updatedAt === T0);
  check('no sharedTo, status or circle on the copy', !('sharedTo' in copy) && !('status' in copy) && !('circleId' in copy) && !('id' in copy));
  const allowed = ['takeawayId', 'authorUid', 'authorName', 'book', 'chapter', 'sectionStart', 'sectionEnd', 'label', 'bracketIndex', 'text', 'note', 'createdAt', 'updatedAt'];
  check('only keys the rules allow', Object.keys(copy).every((k) => allowed.includes(k)), Object.keys(copy));
  const bare = sharedCopy({ ...t, label: '  ', note: undefined }, { uid: 'u1', name: '  ' }, -2);
  check('no label/note keys when empty', !('label' in bare) && !('note' in bare));
  check('blank name becomes Someone, bad index 0', bare.authorName === 'Someone' && bare.bracketIndex === 0);
  const long = sharedCopy({ ...t, text: 'x'.repeat(2500) }, { uid: 'u1', name: 'n'.repeat(150) }, 1);
  check('caps', long.text.length === 2000 && long.authorName.length === 100);
  check('id has the author first', sharedTakeawayId('u1', 'Matthew|7|1') === 'u1_Matthew|7|1');
}

console.log('the circle list');
{
  const item = (id: string, authorUid: string, createdAt: string, over: Partial<SharedTakeaway> = {}): SharedTakeaway => ({
    id, circleId: 'c1', takeawayId: 'Matthew|7|1', authorUid, authorName: authorUid, book: 'Matthew', chapter: 7,
    sectionStart: 1, sectionEnd: 5, bracketIndex: 0, text: 't', createdAt, updatedAt: createdAt, ...over,
  });
  // Two people with the same section: both stay, as their own items.
  const items = [
    item('a_Matthew|7|1', 'a', '2026-10-01'),
    item('b_Matthew|7|1', 'b', '2026-10-03'),
    item('c_Romans|8|1', 'c', '2026-10-02'),
    item('gone_x', 'gone', '2026-10-04'),
  ];
  const list = circleList(items, { blockedUids: new Set(), memberUids: ['a', 'b', 'c'] });
  check('newest first, same passage not grouped', same(list.map((t) => t.id), ['b_Matthew|7|1', 'c_Romans|8|1', 'a_Matthew|7|1']));
  check('someone who left or was removed is hidden', !list.some((t) => t.authorUid === 'gone'));
  const blocked = circleList(items, { blockedUids: new Set(['b']), memberUids: ['a', 'b', 'c'] });
  check('a blocked person is hidden', same(blocked.map((t) => t.authorUid), ['c', 'a']));
  const unknown = circleList(items, { blockedUids: new Set(), memberUids: null });
  check('members unknown: nobody hidden for that', unknown.length === 4);
  check('the input is not reordered', items[0].id === 'a_Matthew|7|1');
}

console.log('replies');
{
  const r = (id: string, fromUid: string, createdAt: string): TakeawayReply => ({ id, fromUid, fromName: fromUid, text: 'this was fire', createdAt });
  const replies = [r('r2', 'b', '2026-10-05T02'), r('r1', 'a', '2026-10-05T01'), r('r3', 'x', '2026-10-05T03')];
  const shown = visibleReplies(replies, new Set(['x']));
  check('oldest first, blocked left out', same(shown.map((x) => x.id), ['r1', 'r2']));
  check('count text', replyCountText(0) === 'No replies yet' && replyCountText(1) === '1 reply' && replyCountText(4) === '4 replies');
  check('reply trimmed', cleanReply('  this was fire  ') === 'this was fire');
  check('empty reply refused', cleanReply('   ') === null);
  check('too long refused', cleanReply('x'.repeat(REPLY_MAX + 1)) === null && cleanReply('x'.repeat(REPLY_MAX)) !== null);
  check('author short name', authorShort({ authorUid: 'u2', authorName: 'Sarah Miller' }, 'u1') === 'Sarah');
  check('my own is You', authorShort({ authorUid: 'u1', authorName: 'Micah' }, 'u1') === 'You');
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nall takeaway sharing checks passed');
