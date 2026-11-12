import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Footprints, Headphones, Minus, Plus } from 'lucide-react-native';

import type { MapLayout, QueueItem, SkyState, StarRef, VerseLink, VerseState } from '../../types';
import type { VersePageRef } from '../../state/useAppState';
import { AppButton, AppText, useScaledSpace } from '../design';
import { ScreenHeader } from '../blocks';
import { OneTimeTip } from '../OneTimeTip';
import { starKey, starLit } from '../../lib/constellations';
import { CONSTELLATIONS } from '../../content/constellations';
import { layout, LayoutResult, Pt, starLabel, StarMove, viewBounds } from '../../lib/mapLayout';
import { MapCamera, MapCanvas } from './MapCanvas';
import { EchoGhosts, MapDrawing, TITLE_SIZE } from './MapDrawing';
import { CardActions, EchoCard, heldPage, LineCard, StarCard } from './MapCards';
import ConnectSheet from './ConnectSheet';
import AddStarSheet from './AddStarSheet';
import { GuideSheet } from './ConstellationSheets';
import { versesForStars } from './addStars';
import WalkConstellation, { WalkDeps } from './WalkConstellation';
import { echoViews, foundEchoes, hitTest, lineLabels as lineLabelsFor, skyView, starLooks } from './mapModel';
import { BACKDROP_STARS, SKY, useSkyPalette } from './skyPalette';
import { FoundStarPopup, HiddenStarPopup, type SkyPlayProps } from './SkyPopups';

// ============================================================================
// MY SKY -- the map, reworked (CONSTELLATION_SKY_PLAN.md, stage 3)
// ----------------------------------------------------------------------------
// The user's own canvas: always a night sky, even in light mode. It holds only
// the constellations they added (sky.added) plus their own links. Every star
// of those is laid out (lib/mapLayout.ts) so nothing moves when a hidden one
// is found, but a star not found yet is drawn as a soft glow, with no name and
// no line to it (the mystery: lib/constellations.ts revealedStars).
//
// Tap a constellation (a star, a line, or its name) and the camera glides in
// to it over ~0.8 s while the others fade; Back glides out. Inside one: the
// NEXT marker, the "Learn X to uncover what's joined to it" hint, and Listen /
// Walk it. A hidden glow opens a centered popup; a found star the user doesn't
// hold opens the small star popup; a held star keeps its card (stage, echoes,
// Connect). Pinch and pan work at any time; the CONSTELLATION_PLAN.md camera,
// walk, echoes, connect and line labels are all unchanged.
// ============================================================================

const MOVE_MS = 700;
const GHOST_FADE_MS = 260;
const FOCUS_MS = 800;
/** How visible the other constellations stay while one is zoomed into. */
const FADED = 0.1;

type Selection =
  | { kind: 'star'; key: string }
  | { kind: 'hidden'; key: string }
  | { kind: 'found'; key: string }
  | { kind: 'line'; from: string; to: string; lineKind: 'curated' | 'user'; id: string }
  | { kind: 'echo'; key: string; index: number }
  | null;

/** 0 → 1 over `ms`, eased, restarting whenever `token` changes to a new non-null value. */
function useTween(token: unknown, ms: number): number {
  const [t, setT] = useState(1);
  useEffect(() => {
    if (token === null || token === undefined) return;
    let raf = 0;
    const start = Date.now();
    const step = () => {
      const k = Math.min(1, (Date.now() - start) / ms);
      setT(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    setT(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [token, ms]);
  return t;
}

/**
 * 0 → 1 over `ms`, ease-in-out, in `steps` jumps: the drawing is repainted on
 * each jump, and repainting every star every frame is what made the map stutter.
 */
function useSteppedTween(token: unknown, ms: number, steps: number): number {
  const [t, setT] = useState(1);
  useEffect(() => {
    if (token === null || token === undefined) return;
    let raf = 0;
    const start = Date.now();
    const step = () => {
      const k = Math.min(1, (Date.now() - start) / ms);
      const eased = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      setT(Math.round(eased * steps) / steps);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    setT(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [token, ms, steps]);
  return t;
}

/** Positions to draw: the layout's, with the stars that just moved part-way along. */
function useMovedPositions(result: LayoutResult, animate: boolean) {
  // Only a result that actually moved something starts a glide; the re-run
  // after its positions are saved (no moves) must not cut it short.
  const [moves, setMoves] = useState<StarMove[] | null>(null);
  useEffect(() => {
    if (animate && result.moves.length > 0) setMoves(result.moves);
  }, [result, animate]);
  const t = useTween(moves, MOVE_MS);
  return useMemo(() => {
    if (!moves || t >= 1) return { positions: result.positions, appear: {} as Record<string, number> };
    const positions: Record<string, Pt> = { ...result.positions };
    const appear: Record<string, number> = {};
    for (const m of moves) {
      if (!positions[m.key]) continue;
      positions[m.key] = [m.from[0] + (m.to[0] - m.from[0]) * t, m.from[1] + (m.to[1] - m.from[1]) * t];
      if (m.appearing) appear[m.key] = t;
    }
    return { positions, appear };
  }, [moves, t, result]);
}

/** A round button for the night sky (the app's themed buttons would be pale in light mode). */
function NightButton({ label, onPress, children, wide }: { label: string; onPress: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="items-center justify-center active:opacity-60"
      // layout-ok: round icon button, no text
      style={{ width: wide ? undefined : 40, height: 40, borderRadius: 20, backgroundColor: SKY.bgSoft, borderWidth: 1, borderColor: SKY.edge }}
    >
      {children}
    </Pressable>
  );
}

/** Listen / Walk it, in the night sky's colors. */
function SkyAction({ label, Icon, primary, onPress }: { label: string; Icon: typeof Headphones; primary?: boolean; onPress: () => void }) {
  const space = useScaledSpace();
  const ink = primary ? SKY.bg : SKY.ink;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-1 flex-row items-center justify-center active:opacity-70"
      style={{
        minHeight: 48,
        borderRadius: 14,
        gap: space(8),
        paddingHorizontal: space(12),
        backgroundColor: primary ? SKY.ink : 'transparent',
        borderWidth: 1.5,
        borderColor: primary ? SKY.ink : SKY.edge,
      }}
    >
      <Icon size={18} color={ink} />
      <AppText variant="label" className="font-sans font-semibold" style={{ color: ink }}>
        {label}
      </AppText>
    </Pressable>
  );
}

export default function ConstellationMap({
  queue,
  sky,
  skyReady,
  verseLinks,
  mapLayout,
  saveMapLayout,
  translationId,
  onOpenVerse,
  addVersesToQueue,
  addVerseLink,
  relabelVerseLink,
  deleteVerseLink,
  onJoined,
  onAdded,
  walk,
  focusId,
  onLeave,
  onBrowse,
  onRemoveFromSky,
  onListen,
  play,
}: {
  queue: QueueItem[];
  /** What's in My sky and which stars were found (useSky). */
  sky: SkyState;
  /** False until the sky doc has loaded: nothing is shown as empty before then. */
  skyReady: boolean;
  verseLinks: Record<string, VerseLink>;
  mapLayout: MapLayout | null;
  saveMapLayout: (layout: MapLayout) => void;
  /** For fetching an echo's text the user doesn't hold. */
  translationId: string;
  onOpenVerse: (page: VersePageRef) => void;
  /** The existing add path (waiting, started by My Schedule's pace). */
  addVersesToQueue: (verses: VerseState[], translationId: string) => void;
  addVerseLink: (a: StarRef, b: StarRef, extra?: { label?: string; curated?: string; solo?: boolean }) => Promise<VerseLink>;
  relabelVerseLink: (id: string, label: string) => Promise<void>;
  deleteVerseLink: (id: string) => Promise<void>;
  onJoined?: () => void;
  /** A star was put on the sky on its own. */
  onAdded?: () => void;
  /** What Walk the constellation needs to credit a review. */
  walk: WalkDeps;
  /** Open zoomed into this constellation (a group id), read once when the sky opens. */
  focusId?: string | null;
  /** Back from the whole sky (the browse page). */
  onLeave: () => void;
  /** The empty sky's "Find constellations". */
  onBrowse: () => void;
  onRemoveFromSky: (constellationId: string) => void;
  /** Listen to these verses (the ones held, in the constellation's order). */
  onListen: (items: QueueItem[]) => void;
  /** What the star popup's play button needs. */
  play: SkyPlayProps;
}) {
  const space = useScaledSpace();
  const palette = useSkyPalette();
  const paper = SKY.bg;

  const [guideFor, setGuideFor] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<StarRef | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // The star just added: once the layout has placed it, look at it.
  const focusStar = useRef<string | null>(null);
  // The group being walked (Walk the constellation), drawn over the whole map view.
  const [walkGroup, setWalkGroup] = useState<string | null>(null);

  const addStars = async (refs: StarRef[]) => {
    const verses = await versesForStars(refs, translationId);
    addVersesToQueue(verses, translationId);
  };
  const actions: CardActions = {
    onOpenVerse,
    onAddVerses: (ref) => void addStars([ref]),
    onConnect: (ref) => setConnectFrom(ref),
  };

  // ---- Layout: once per change, never per frame. Only the sky's constellations go in. ----
  const addedKey = sky.added.join('|');
  const shownConstellations = useMemo(
    () => sky.added.map((id) => CONSTELLATIONS.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addedKey]
  );
  const links = useMemo(() => Object.values(verseLinks), [verseLinks]);
  const { result, animate } = useMemo(
    () => ({
      result: layout({ constellations: shownConstellations, links }, mapLayout),
      // The very first layout just appears; after that, changes glide.
      animate: !!mapLayout,
    }),
    [links, mapLayout, shownConstellations]
  );
  useEffect(() => {
    if (result.changed) saveMapLayout(result.layout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  const { positions, appear } = useMovedPositions(result, animate);

  // ---- The mystery: which stars show, which are glows ----
  const view = useMemo(() => skyView(sky.added, sky.found, queue, result), [sky, queue, result]);
  const looks = useMemo(() => starLooks(result, queue, view.next), [result, queue, view]);
  const found = useMemo(() => foundEchoes(result, queue), [result, queue]);
  const lineLabels = useMemo(() => lineLabelsFor(result, links), [result, links]);
  const starsByKey = useMemo(() => new Map(result.stars.map((s) => [s.key, s])), [result]);
  const empty = skyReady && result.stars.length === 0;

  // ---- Selection ----
  const [selection, setSelection] = useState<Selection>(null);
  const selectedStar = selection?.kind === 'star' || selection?.kind === 'echo' ? selection.key : null;
  // A star that left the sky (a constellation removed, a link deleted) can't stay selected.
  useEffect(() => {
    if (selection && 'key' in selection && !starsByKey.has(selection.key)) setSelection(null);
    else if (selection?.kind === 'line' && !(starsByKey.has(selection.from) && starsByKey.has(selection.to))) setSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, starsByKey]);
  // Echoes only from stars that are found, and none that point at a star still hidden.
  const echoes = useMemo(
    () => (selectedStar ? echoViews(result, selectedStar, found).filter((e) => !(e.thereKey && view.hidden.has(e.thereKey))) : []),
    [result, selectedStar, found, view]
  );
  const ghostT = useTween(selectedStar, GHOST_FADE_MS);
  const ghosts = useMemo(() => echoes.map((e, i) => ({ p: e.ghost, i })).filter((g): g is { p: Pt; i: number } => !!g.p), [echoes]);

  // ---- Camera and zoom ----
  const camera = useRef<MapCamera>(null);
  const windowHeight = useWindowDimensions().height;
  const [showLabels, setShowLabels] = useState(true);
  /** The constellation zoomed into (a group id), or null for the whole sky. */
  const [focus, setFocus] = useState<string | null>(null);
  const [sized, setSized] = useState(false);
  // layout-ok: measured height, not a style
  const [mapHeight, setMapHeight] = useState(0);
  const cardHeight = useRef(0);
  const framedOnce = useRef(false);
  // Room kept clear at the bottom: the tapped card, or the Listen / Walk row while zoomed in.
  const insets = (f: string | null = focus) => ({ top: 8, bottom: selection ? cardHeight.current + 12 : f ? 120 : 8 });

  // The fade: each group's visibility moves from where it was to where the new focus wants it.
  const [fadeToken, setFadeToken] = useState<object | null>(null);
  const fadeFrom = useRef<Record<string, number>>({});
  const fadeTo = useRef<Record<string, number>>({});
  const fadeT = useSteppedTween(fadeToken, FOCUS_MS, 10);
  const groupOpacity = useMemo(() => {
    const out: Record<string, number> = {};
    for (const g of result.groups) {
      const to = fadeTo.current[g.id] ?? 1;
      const from = fadeFrom.current[g.id] ?? to;
      out[g.id] = from + (to - from) * fadeT;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, fadeT, fadeToken]);
  const titleOpacity = focus === null ? fadeT : 1 - fadeT;

  const setFocusTo = (next: string | null, instant = false) => {
    const target: Record<string, number> = {};
    for (const g of result.groups) target[g.id] = next === null || g.id === next ? 1 : FADED;
    fadeFrom.current = Object.fromEntries(result.groups.map((g) => [g.id, instant ? target[g.id] : groupOpacity[g.id] ?? 1]));
    fadeTo.current = target;
    setFocus(next);
    setSelection(null);
    setFadeToken(instant ? null : {});
  };
  const zoomInto = (id: string) => {
    if (id === focus) return;
    setFocusTo(id);
    camera.current?.frame(viewBounds(result, id), insets(id), false, true);
  };
  const zoomOut = () => {
    setFocusTo(null);
    camera.current?.frame(viewBounds(result), insets(null), false, true);
  };

  // Open on the whole sky (or zoomed into the constellation we were sent to).
  useEffect(() => {
    if (!sized || !skyReady || framedOnce.current) return;
    framedOnce.current = true;
    const start = focusId && result.groups.some((g) => g.id === focusId) ? focusId : null;
    setFocusTo(start, true);
    camera.current?.frame(viewBounds(result, start ?? undefined), insets(start), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sized, skyReady, result]);

  // The zoomed-into constellation left the sky (removed): back out to the whole sky.
  useEffect(() => {
    if (focus && !result.groups.some((g) => g.id === focus)) {
      setFocusTo(null, true);
      camera.current?.frame(viewBounds(result), insets(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // A constellation added while the sky is open: look at all of it again.
  const addedBefore = useRef(addedKey);
  useEffect(() => {
    if (addedBefore.current === addedKey) return;
    addedBefore.current = addedKey;
    if (focus === null) camera.current?.frame(viewBounds(result), insets(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addedKey, result]);

  // ---- A star on its own ----
  const addSoloStar = (ref: StarRef) => {
    // Verses outside My Verses join it through the usual add path; ones already there are left alone.
    const have = (v: number) => queue.some((q) => q.book === ref.book && q.chapter === ref.chapter && q.verseNumber === v);
    let missing = false;
    for (let v = ref.start; v <= ref.end; v++) if (!have(v)) missing = true;
    if (missing) void addStars([ref]);
    void addVerseLink(ref, ref, { solo: true });
    focusStar.current = starKey(ref);
    setAddOpen(false);
    onAdded?.();
  };
  useEffect(() => {
    const key = focusStar.current;
    if (!key || !starsByKey.has(key)) return;
    focusStar.current = null;
    const group = result.groups.find((g) => g.keys.includes(key));
    if (group) zoomInto(group.id);
    setSelection({ kind: 'star', key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // ---- Taps ----
  /** The constellation name under a map point, on the whole sky. */
  const titleAt = (p: Pt): string | null => {
    for (const g of result.groups) {
      const w = titleOf(g.id).length * TITLE_SIZE * 0.6;
      const b = g.bounds;
      const cx = b.x + b.w / 2;
      if (Math.abs(p[0] - cx) <= w / 2 && p[1] >= b.y - TITLE_SIZE - 6 && p[1] <= b.y + 8) return g.id;
    }
    return null;
  };
  const onTap = useCallback(
    (x: number, y: number, zoom: number) => {
      if (focus === null) {
        const t = titleAt([x, y]);
        if (t) {
          zoomInto(t);
          return;
        }
      }
      const hit = hitTest([x, y], zoom, result, positions, selectedStar ? ghosts.map((g) => g.p) : [], view.hidden);
      const groupOfKey = (k: string) => starsByKey.get(k)?.group;
      if (hit.kind === 'ghost' && selectedStar) setSelection({ kind: 'echo', key: selectedStar, index: ghosts[hit.index].i });
      else if (hit.kind === 'star') {
        const g = groupOfKey(hit.key);
        // The first tap on a constellation zooms into it; the next ones open its stars.
        if (g && g !== focus) zoomInto(g);
        else if (view.hidden.has(hit.key)) setSelection({ kind: 'hidden', key: hit.key });
        else setSelection({ kind: looks[hit.key]?.lit ? 'star' : 'found', key: hit.key });
      } else if (hit.kind === 'line') {
        const g = groupOfKey(hit.from);
        if (g && g !== focus) zoomInto(g);
        else setSelection({ kind: 'line', from: hit.from, to: hit.to, lineKind: hit.lineKind, id: hit.id });
      } else setSelection(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, positions, ghosts, selectedStar, focus, view, looks, starsByKey, groupOpacity]
  );

  // ---- Names, header, bottom row ----
  const titleOf = (groupId: string) => CONSTELLATIONS.find((c) => c.id === groupId)?.title ?? 'Your links';
  const titles = useMemo(
    () => result.groups.map((g) => ({ id: g.id, text: titleOf(g.id), x: g.bounds.x + g.bounds.w / 2, y: g.bounds.y - 4 })),
    [result]
  );
  const focusInfo = focus ? view.info[focus] : undefined;
  const focusGroup = focus ? result.groups.find((g) => g.id === focus) : undefined;
  // A group can be walked once two of its stars are in My Verses.
  const walkable = (groupId: string) => {
    const g = result.groups.find((x) => x.id === groupId);
    return !!g && g.keys.filter((k) => starsByKey.get(k) && starLit(starsByKey.get(k)!.ref, queue)).length >= 2;
  };
  /** The held verses of a group's found stars, in the group's order. */
  const listenItems = (groupId: string): QueueItem[] => {
    const g = result.groups.find((x) => x.id === groupId);
    const out: QueueItem[] = [];
    for (const k of g?.keys ?? []) {
      const s = starsByKey.get(k);
      if (!s || view.hidden.has(k)) continue;
      const page = heldPage(s.ref, queue);
      if (!page) continue;
      for (const v of page.verses) {
        const item = queue.find((q) => q.book === s.ref.book && q.chapter === s.ref.chapter && q.verseNumber === v && (q.translationId || 'BSB') === page.translationId);
        if (item && !out.includes(item)) out.push(item);
      }
    }
    return out;
  };
  const totalFound = Object.values(view.info).reduce((n, i) => n + i.found, 0);
  const constellationCount = Object.keys(view.info).length;
  const header = focus
    ? {
        title: focusInfo ? focusInfo.constellation.title : 'Your links',
        subtitle: focusInfo
          ? focusInfo.complete
            ? `All ${focusInfo.total} found`
            : `${focusInfo.found} found · ${focusInfo.total - focusInfo.found} still hidden`
          : `${focusGroup?.keys.length ?? 0} ${focusGroup?.keys.length === 1 ? 'star' : 'stars'}`,
        backLabel: 'My sky',
        onBack: zoomOut,
      }
    : {
        title: 'My sky',
        subtitle: empty
          ? undefined
          : constellationCount > 0
            ? `${constellationCount} ${constellationCount === 1 ? 'constellation' : 'constellations'} · ${totalFound} ${totalFound === 1 ? 'star' : 'stars'} found`
            : undefined,
        backLabel: 'Constellations',
        onBack: onLeave,
      };
  // "Learn John 10:11 to uncover what's joined to it."
  const nextStar = focusInfo?.next[0] ? focusInfo.constellation.stars.find((s) => s.id === focusInfo.next[0]) : undefined;
  const hint = focusInfo && nextStar ? `Learn ${starLabel(nextStar.ref)} to uncover what's joined to it.` : null;

  // ---- Cards ----
  const titleOfConstellation = (constellationId?: string) => CONSTELLATIONS.find((c) => c.id === constellationId)?.title;
  // A card never takes more than the bottom half of the screen (or the map, if that's smaller); past that it scrolls.
  const cardMax = Math.max(120, Math.min(mapHeight ? mapHeight - space(20) : windowHeight, Math.round(windowHeight * 0.5)));
  const onCardLayout = (full: number) => {
    const h = Math.min(full, cardMax);
    cardHeight.current = h;
    if (selectedStar && positions[selectedStar]) camera.current?.reveal([positions[selectedStar], ...ghosts.map((g) => g.p)], h + 12);
  };
  // A card the same height as the last one doesn't lay out again, so moving
  // from star to star reveals here too.
  // Keyed on where the ghosts are, not on the array: a layout save hands back a new array of the same spots, and must not slide the camera.
  const ghostSpots = ghosts.map((g) => g.p.join(',')).join('|');
  useEffect(() => {
    if (selectedStar && positions[selectedStar] && cardHeight.current)
      camera.current?.reveal([positions[selectedStar], ...ghosts.map((g) => g.p)], cardHeight.current + 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStar, ghostSpots]);

  // A star on its own, with nothing joined to it, can be taken off the sky again.
  const soloIdsFor = (key: string): string[] | null => {
    const ids = links.filter((l) => l.solo && starKey(l.a) === key).map((l) => l.id);
    const joined = result.lines.some((l) => l.kind === 'user' && (l.from === key || l.to === key));
    return ids.length > 0 && !joined ? ids : null;
  };
  const removeSoloStar = (key: string) => {
    setSelection(null);
    for (const id of soloIdsFor(key) ?? []) void deleteVerseLink(id);
  };

  let card: React.ReactNode = null;
  if (selection?.kind === 'star') {
    const s = starsByKey.get(selection.key);
    if (s)
      card = (
        <StarCard
          refr={s.ref}
          constellationTitle={titleOfConstellation(s.curated?.constellationId)}
          queue={queue}
          echoes={echoes}
          onCompare={(index) => setSelection({ kind: 'echo', key: selection.key, index })}
          onClose={() => setSelection(null)}
          onLayout={onCardLayout}
          actions={actions}
          compact={mapHeight > 0 && mapHeight < 520}
          suggested={!!looks[selection.key]?.suggested}
          onRemove={soloIdsFor(selection.key) ? () => removeSoloStar(selection.key) : undefined}
        />
      );
  } else if (selection?.kind === 'echo') {
    const v = echoes[selection.index];
    if (v)
      card = (
        <EchoCard
          view={v}
          queue={queue}
          translationId={translationId}
          onBack={() => setSelection({ kind: 'star', key: selection.key })}
          onClose={() => setSelection(null)}
          onLayout={onCardLayout}
          actions={actions}
        />
      );
  } else if (selection?.kind === 'line') {
    const a = starsByKey.get(selection.from);
    const b = starsByKey.get(selection.to);
    if (a && b) {
      const curatedId = selection.lineKind === 'curated' ? selection.id : null;
      const pair = [starKey(a.ref), starKey(b.ref)].sort().join();
      // The user's label on a curated line is a link with `curated` set; their own lines are links by id.
      const link = curatedId
        ? links.find((l) => l.curated === curatedId && [starKey(l.a), starKey(l.b)].sort().join() === pair)
        : verseLinks[selection.id];
      card = (
        <LineCard
          a={a.ref}
          b={b.ref}
          key={`${selection.from}~${selection.to}`}
          label={lineLabels[`${selection.from}~${selection.to}`]}
          constellationTitle={selection.lineKind === 'curated' ? titleOfConstellation(selection.id) : undefined}
          queue={queue}
          onClose={() => setSelection(null)}
          onLayout={(h) => (cardHeight.current = Math.min(h, cardMax))}
          actions={actions}
          onSaveLabel={(text) => {
            if (link) void relabelVerseLink(link.id, text);
            else if (curatedId && text.trim()) void addVerseLink(a.ref, b.ref, { label: text, curated: curatedId });
          }}
          onDelete={
            curatedId || !link
              ? undefined
              : () => {
                  setSelection(null);
                  void deleteVerseLink(link.id);
                }
          }
          onGuide={curatedId ? () => setGuideFor(curatedId) : undefined}
        />
      );
    }
  }
  const hiddenKey = selection?.kind === 'hidden' ? selection.key : null;
  const foundRef = selection?.kind === 'found' ? starsByKey.get(selection.key)?.ref ?? null : null;
  const closePopup = () => setSelection(null);

  const bottomRow = !card && !empty && focus !== null;

  return (
    <View className="flex-1" style={{ gap: space(10) }}>
      <ScreenHeader
        title={header.title}
        subtitle={header.subtitle}
        backLabel={header.backLabel}
        onBack={header.onBack}
        actions={
          focus && focusInfo ? (
            <AppButton variant="secondary" size="sm" label="Guide" onPress={() => setGuideFor(focus)} />
          ) : !focus && !empty && skyReady ? (
            <AppButton variant="secondary" size="sm" label="Add a star" onPress={() => setAddOpen(true)} />
          ) : undefined
        }
      />
      <OneTimeTip id="constellationMap" text="Tap a constellation to zoom in. A soft glow is a star you haven't found yet." />

      <View className="flex-1 rounded-card" style={{ overflow: 'hidden', backgroundColor: SKY.bg, borderWidth: 1, borderColor: SKY.edge }}>
        {/* A scatter of faint background stars, behind everything. */}
        <Svg width="100%" height="100%" style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
          {BACKDROP_STARS.map((s, i) => (
            <Circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill={SKY.ink} fillOpacity={s.o * 0.7} />
          ))}
        </Svg>
        <MapCanvas
          ref={camera}
          bounds={result.bounds}
          onTap={onTap}
          onSize={(_, h) => {
            setSized(true);
            setMapHeight(h);
          }}
          onLabelsChange={setShowLabels}
        >
          <MapDrawing
            result={result}
            positions={positions}
            appear={appear}
            looks={looks}
            found={found}
            lineLabels={lineLabels}
            showLabels={showLabels}
            selectedKey={selectedStar ?? hiddenKey}
            selectedLine={selection?.kind === 'line' ? `${selection.from}~${selection.to}` : null}
            dim={false}
            palette={palette}
            paper={paper}
            hidden={view.hidden}
            groupOpacity={groupOpacity}
            userLineColor={SKY.link}
            glowColor={SKY.glow}
            nextColor={SKY.next}
            titles={titleOpacity > 0.01 ? titles : undefined}
            titleOpacity={titleOpacity}
          />
          <EchoGhosts
            from={selectedStar ? positions[selectedStar] ?? null : null}
            views={echoes}
            positions={positions}
            opacity={selectedStar ? ghostT * 0.9 : 0}
            showLabels={showLabels}
            palette={palette}
            paper={paper}
          />
        </MapCanvas>

        {/* Zoom without pinching. */}
        <View style={{ position: 'absolute', top: space(10), right: space(10), gap: space(8) }}>
          <NightButton label="Zoom in" onPress={() => camera.current?.zoomBy(1.5)}>
            <Plus size={20} color={SKY.ink} />
          </NightButton>
          <NightButton label="Zoom out" onPress={() => camera.current?.zoomBy(1 / 1.5)}>
            <Minus size={20} color={SKY.ink} />
          </NightButton>
        </View>

        {(card || empty || bottomRow) && (
          <View style={{ position: 'absolute', left: space(10), right: space(10), bottom: space(10), maxHeight: cardMax }}>
            {card ? (
              // Never taller than the map: a long echo scrolls inside its card.
              <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
                {card}
              </ScrollView>
            ) : empty ? (
              <View style={{ padding: space(16), gap: space(10), borderRadius: 16, backgroundColor: SKY.bgSoft, borderWidth: 1, borderColor: SKY.edge }}>
                <AppText variant="label" className="font-sans" style={{ color: SKY.ink }}>
                  Your sky is empty. Add a constellation and its stars will appear here.
                </AppText>
                <View className="flex-row">
                  <AppButton size="md" variant="primary" label="Find constellations" onPress={onBrowse} />
                </View>
              </View>
            ) : (
              <View style={{ gap: space(8) }}>
                {hint ? (
                  <AppText variant="caption" className="font-sans text-center" style={{ color: SKY.ink2 }}>
                    {hint}
                  </AppText>
                ) : null}
                <View className="flex-row" style={{ gap: space(10) }}>
                  <SkyAction primary label="Listen" Icon={Headphones} onPress={() => focus && onListen(listenItems(focus))} />
                  {focus && walkable(focus) ? <SkyAction label="Walk it" Icon={Footprints} onPress={() => setWalkGroup(focus)} /> : null}
                </View>
              </View>
            )}
          </View>
        )}
      </View>

      <HiddenStarPopup
        visible={!!hiddenKey}
        joined={hiddenKey ? view.joinedRef[hiddenKey] ?? null : null}
        queue={queue}
        actions={actions}
        onClose={closePopup}
      />
      <FoundStarPopup refr={foundRef} queue={queue} translationId={translationId} play={play} actions={actions} onClose={closePopup} />
      <AddStarSheet
        visible={addOpen}
        queue={queue}
        mapRefs={result.stars.map((s) => s.ref)}
        translationId={translationId}
        onClose={() => setAddOpen(false)}
        onAdd={addSoloStar}
      />
      <ConnectSheet
        from={connectFrom}
        queue={queue}
        links={links}
        onClose={() => setConnectFrom(null)}
        onSave={(a, b) => {
          setConnectFrom(null);
          void addVerseLink(a, b);
          onJoined?.();
        }}
      />
      <GuideSheet
        constellation={CONSTELLATIONS.find((c) => c.id === guideFor) ?? null}
        onClose={() => setGuideFor(null)}
        onWalk={guideFor && walkable(guideFor) ? () => { setWalkGroup(guideFor); setGuideFor(null); } : undefined}
        onRemove={
          guideFor
            ? () => {
                const id = guideFor;
                setGuideFor(null);
                onRemoveFromSky(id);
              }
            : undefined
        }
      />
      {walkGroup ? (
        <WalkConstellation result={result} groupId={walkGroup} queue={queue} deps={walk} onClose={() => setWalkGroup(null)} />
      ) : null}
    </View>
  );
}
