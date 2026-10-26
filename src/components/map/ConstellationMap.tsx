import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { Maximize2, Minimize2, Minus, Plus } from 'lucide-react-native';

import type { MapLayout, QueueItem, StarRef, VerseLink, VerseState } from '../../types';
import type { VersePageRef } from '../../state/useAppState';
import { AppButton, AppIconButton, AppText, useScaledSpace } from '../design';
import { useThemeColors } from '../theme';
import { OneTimeTip } from '../OneTimeTip';
import { setAppPref, useAppPrefs } from '../../lib/appPrefs';
import { setMapFullscreen, useMapFullscreen } from '../../lib/mapFullscreen';
import { starKey, starLit } from '../../lib/constellations';
import { CONSTELLATIONS } from '../../content/constellations';
import { layout, LayoutResult, Pt, StarMove, viewBounds } from '../../lib/mapLayout';
import { MapCamera, MapCanvas } from './MapCanvas';
import { EchoGhosts, MapDrawing } from './MapDrawing';
import { CardActions, EchoCard, LineCard, StarCard } from './MapCards';
import { JumpChips } from './JumpChips';
import ConnectSheet from './ConnectSheet';
import AddStarSheet from './AddStarSheet';
import { ConstellationListSheet, GuideSheet } from './ConstellationSheets';
import { versesForStars } from './addStars';
import WalkConstellation, { WalkDeps } from './WalkConstellation';
import { echoViews, foundEchoes, hitTest, lineLabels as lineLabelsFor, starLooks } from './mapModel';

// ============================================================================
// CONSTELLATION MAP -- the Map view of My Verses (CONSTELLATION_PLAN.md, stage 4)
// ----------------------------------------------------------------------------
// Curated constellations, plus the user's verses that are linked to something
// (unlinked ones stay off the map). Stars arrange themselves (lib/mapLayout.ts)
// and stay put: the settled spots are saved, and when a link changes the map,
// the stars that moved glide from their old spot to the new one.
//
// Tap a star for its card; tap a line for the line's; tap empty sky to clear.
// A star with an echo shows it only while it's tapped -- a faint ghost star
// and a dotted line -- until the user holds both ends, when the dotted line
// stays for good.
// ============================================================================

const MOVE_MS = 700;
const GHOST_FADE_MS = 260;
const WHOLE = 'whole';
const SHOW_HIDE = 'showhide';
const ADD_STAR = 'addstar';

type Selection =
  | { kind: 'star'; key: string }
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

export default function ConstellationMap({
  queue,
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
}: {
  queue: QueueItem[];
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
  /** A star was put on the map on its own. */
  onAdded?: () => void;
  /** What Walk the constellation needs to credit a review. */
  walk: WalkDeps;
}) {
  const space = useScaledSpace();
  const palette = useThemeColors();
  const paper = palette.surface;

  // ---- Which curated constellations are shown (a choice kept on this device) ----
  const { hiddenConstellations } = useAppPrefs();
  const shownConstellations = useMemo(() => CONSTELLATIONS.filter((c) => !hiddenConstellations.includes(c.id)), [hiddenConstellations]);
  const [listOpen, setListOpen] = useState(false);
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

  // ---- Layout: once per change, never per frame ----
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

  const looks = useMemo(() => starLooks(result, queue), [result, queue]);
  const found = useMemo(() => foundEchoes(result, queue), [result, queue]);
  const lineLabels = useMemo(() => lineLabelsFor(result, links), [result, links]);
  const starsByKey = useMemo(() => new Map(result.stars.map((s) => [s.key, s])), [result]);
  const ownLinks = links.filter((l) => !l.curated).length;
  const empty = ownLinks === 0;

  // ---- Selection ----
  const [selection, setSelection] = useState<Selection>(null);
  const selectedStar = selection?.kind === 'star' || selection?.kind === 'echo' ? selection.key : null;
  // A star that left the map (its link was deleted) can't stay selected.
  useEffect(() => {
    if (selectedStar && !starsByKey.has(selectedStar)) setSelection(null);
    else if (selection?.kind === 'line' && !(starsByKey.has(selection.from) && starsByKey.has(selection.to))) setSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStar, starsByKey]);
  const echoes = useMemo(() => (selectedStar ? echoViews(result, selectedStar, found) : []), [result, selectedStar, found]);
  const ghostT = useTween(selectedStar, GHOST_FADE_MS);
  const ghosts = useMemo(() => echoes.map((e, i) => ({ p: e.ghost, i })).filter((g): g is { p: Pt; i: number } => !!g.p), [echoes]);

  // ---- Camera ----
  const camera = useRef<MapCamera>(null);
  const fullscreen = useMapFullscreen();
  // Leaving the Map (or My Verses) must give the tab bar back.
  useEffect(() => () => setMapFullscreen(false), []);
  const windowHeight = useWindowDimensions().height;
  const [showLabels, setShowLabels] = useState(true);
  const [chip, setChip] = useState(WHOLE);
  const [sized, setSized] = useState(false);
  // layout-ok: measured height, not a style
  const [mapHeight, setMapHeight] = useState(0);
  const cardHeight = useRef(0);
  const framedOnce = useRef(false);
  // The empty-state note sits over the bottom of the map: frame above it.
  const insets = () => ({ top: 8, bottom: selection ? cardHeight.current + 12 : empty ? 96 : 8 });

  // Open on the user's biggest constellation (the first curated one if they
  // have none yet): the whole map is usually too far out to read names.
  useEffect(() => {
    if (!sized || framedOnce.current) return;
    framedOnce.current = true;
    const first = result.groups.find((g) => g.kind === 'user') ?? result.groups[0];
    if (first) setChip(first.id);
    camera.current?.frame(viewBounds(result, first?.id), insets(), true);
  }, [sized, result]);

  // Showing or hiding a constellation changes what's on the map: look at all of it again.
  const shownBefore = useRef(shownConstellations);
  useEffect(() => {
    if (shownBefore.current === shownConstellations) return;
    shownBefore.current = shownConstellations;
    setChip(WHOLE);
    camera.current?.frame(viewBounds(result), insets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownConstellations]);

  // The map's room changes with full screen: look at the same constellation again once it has resized.
  const fullscreenBefore = useRef(fullscreen);
  useEffect(() => {
    if (fullscreenBefore.current === fullscreen) return;
    fullscreenBefore.current = fullscreen;
    const t = setTimeout(() => camera.current?.frame(viewBounds(result, chip === WHOLE ? undefined : chip), insets()), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);

  const pickChip = (id: string) => {
    if (id === SHOW_HIDE) {
      setListOpen(true);
      return;
    }
    if (id === ADD_STAR) {
      setAddOpen(true);
      return;
    }
    setChip(id);
    setSelection(null);
    camera.current?.frame(viewBounds(result, id === WHOLE ? undefined : id), insets());
  };

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
    if (group) setChip(group.id);
    setSelection({ kind: 'star', key });
    camera.current?.frame(viewBounds(result, group?.id), insets());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const onTap = useCallback(
    (x: number, y: number, zoom: number) => {
      const hit = hitTest([x, y], zoom, result, positions, selectedStar ? ghosts.map((g) => g.p) : []);
      if (hit.kind === 'ghost' && selectedStar) setSelection({ kind: 'echo', key: selectedStar, index: ghosts[hit.index].i });
      else if (hit.kind === 'star') setSelection({ kind: 'star', key: hit.key });
      else if (hit.kind === 'line') setSelection({ kind: 'line', from: hit.from, to: hit.to, lineKind: hit.lineKind, id: hit.id });
      else setSelection(null);
    },
    [result, positions, ghosts, selectedStar]
  );

  // ---- Chips ----
  const chips = useMemo(() => {
    const degree = new Map<string, number>();
    for (const l of result.lines) {
      degree.set(l.from, (degree.get(l.from) ?? 0) + 1);
      degree.set(l.to, (degree.get(l.to) ?? 0) + 1);
    }
    const out = [{ id: WHOLE, label: 'Whole map' }];
    for (const g of result.groups) {
      if (g.kind === 'curated') {
        out.push({ id: g.id, label: CONSTELLATIONS.find((c) => c.id === g.id)?.title ?? g.id });
      } else {
        // The user's own have no names: call them after their busiest star.
        const hub = [...g.keys].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || (a < b ? -1 : 1))[0];
        const name = starsByKey.get(hub)?.label ?? hub;
        out.push({ id: g.id, label: g.keys.length > 1 ? `${name} and ${g.keys.length - 1} more` : name });
      }
    }
    out.push({ id: ADD_STAR, label: 'Add a star' });
    out.push({ id: SHOW_HIDE, label: 'Show or hide' });
    return out;
  }, [result, starsByKey]);
  const chipConstellation = CONSTELLATIONS.find((c) => c.id === chip);
  // A group can be walked once two of its stars are in My Verses.
  const walkable = (groupId: string) => {
    const g = result.groups.find((x) => x.id === groupId);
    return !!g && g.keys.filter((k) => starsByKey.get(k) && starLit(starsByKey.get(k)!.ref, queue)).length >= 2;
  };
  useEffect(() => {
    if (chip !== WHOLE && !result.groups.some((g) => g.id === chip)) setChip(WHOLE);
  }, [chip, result]);

  // A star placed on its own, with nothing joined to it, can be taken off the map again.
  const soloIdsFor = (key: string): string[] | null => {
    const ids = links.filter((l) => l.solo && starKey(l.a) === key).map((l) => l.id);
    const joined = result.lines.some((l) => l.kind === 'user' && (l.from === key || l.to === key));
    return ids.length > 0 && !joined ? ids : null;
  };
  const removeSoloStar = (key: string) => {
    setSelection(null);
    for (const id of soloIdsFor(key) ?? []) void deleteVerseLink(id);
  };

  // ---- The card ----
  const titleOf = (constellationId?: string) => CONSTELLATIONS.find((c) => c.id === constellationId)?.title;
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
  let card: React.ReactNode = null;
  if (selection?.kind === 'star') {
    const s = starsByKey.get(selection.key);
    if (s)
      card = (
        <StarCard
          refr={s.ref}
          constellationTitle={titleOf(s.curated?.constellationId)}
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
    const view = echoes[selection.index];
    if (view)
      card = (
        <EchoCard
          view={view}
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
          constellationTitle={selection.lineKind === 'curated' ? titleOf(selection.id) : undefined}
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

  return (
    <View className="flex-1" style={{ gap: space(10) }}>
      <OneTimeTip id="constellationMap" text="Tap any star to see its passage. Some stars hide something more." />
      <View style={{ gap: space(6) }}>
        <JumpChips chips={chips} value={chip} onPick={pickChip} />
        {chipConstellation || chip !== WHOLE ? (
          <View className="flex-row items-center" style={{ gap: space(8), paddingHorizontal: space(4) }}>
            <AppText variant="caption" className="font-sans text-ink-2 flex-1">
              {chipConstellation?.description ?? ''}
            </AppText>
            {walkable(chip) ? <AppButton variant="secondary" size="sm" label="Walk this constellation" onPress={() => setWalkGroup(chip)} /> : null}
          </View>
        ) : null}
      </View>

      <View className="flex-1 bg-surface border border-line rounded-card" style={{ overflow: 'hidden' }}>
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
            selectedKey={selectedStar}
            selectedLine={selection?.kind === 'line' ? `${selection.from}~${selection.to}` : null}
            dim={empty}
            palette={palette}
            paper={paper}
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
        <View style={{ position: 'absolute', top: space(10), right: space(10) }}>
          <AppIconButton
            Icon={fullscreen ? Minimize2 : Maximize2}
            variant="outline"
            diameter={40}
            className="bg-surface"
            accessibilityLabel={fullscreen ? 'Leave full screen' : 'Full screen'}
            onPress={() => setMapFullscreen(!fullscreen)}
          />
        </View>
        <View style={{ position: 'absolute', top: space(10) + 40 + space(18), right: space(10), gap: space(8) }}>
          <AppIconButton Icon={Plus} variant="outline" diameter={40} className="bg-surface" accessibilityLabel="Zoom in" onPress={() => camera.current?.zoomBy(1.5)} />
          <AppIconButton Icon={Minus} variant="outline" diameter={40} className="bg-surface" accessibilityLabel="Zoom out" onPress={() => camera.current?.zoomBy(1 / 1.5)} />
        </View>

        {(card || empty) && (
          <View style={{ position: 'absolute', left: space(10), right: space(10), bottom: space(10), maxHeight: cardMax }}>
            {card ? (
              // Never taller than the map: a long echo scrolls inside its card.
              <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
                {card}
              </ScrollView>
            ) : (
              <View className="bg-surface border border-line-strong rounded-card" style={{ padding: space(14) }}>
                <AppText variant="label" className="font-sans text-ink">
                  Add a star, or connect two of your verses, and they'll shine here next to these.
                </AppText>
                <View className="flex-row" style={{ marginTop: space(8) }}>
                  <AppButton size="md" variant="secondary" label="Add a star" onPress={() => setAddOpen(true)} />
                </View>
              </View>
            )}
          </View>
        )}
      </View>

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
        queue={queue}
        onClose={() => setGuideFor(null)}
        onAddRest={(refs) => void addStars(refs)}
        onWalk={guideFor && walkable(guideFor) ? () => { setWalkGroup(guideFor); setGuideFor(null); } : undefined}
      />
      <ConstellationListSheet
        visible={listOpen}
        constellations={CONSTELLATIONS}
        hidden={hiddenConstellations}
        onToggle={(id, show) =>
          setAppPref('hiddenConstellations', show ? hiddenConstellations.filter((x) => x !== id) : [...hiddenConstellations, id])
        }
        onClose={() => setListOpen(false)}
      />
      {walkGroup ? (
        <WalkConstellation result={result} groupId={walkGroup} queue={queue} deps={walk} onClose={() => setWalkGroup(null)} />
      ) : null}
    </View>
  );
}
