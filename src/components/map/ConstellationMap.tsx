import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Minus, Plus } from 'lucide-react-native';

import type { MapLayout, QueueItem, VerseLink } from '../../types';
import { AppIconButton, AppText, useScaledSpace } from '../design';
import { useThemeColors } from '../theme';
import { OneTimeTip } from '../OneTimeTip';
import { CONSTELLATIONS } from '../../content/constellations';
import { layout, LayoutResult, Pt, StarMove, viewBounds } from '../../lib/mapLayout';
import { MapCamera, MapCanvas } from './MapCanvas';
import { EchoGhosts, MapDrawing } from './MapDrawing';
import { CardActions, EchoCard, LineCard, StarCard } from './MapCards';
import { JumpChips } from './JumpChips';
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
  actions,
}: {
  queue: QueueItem[];
  verseLinks: Record<string, VerseLink>;
  mapLayout: MapLayout | null;
  saveMapLayout: (layout: MapLayout) => void;
  /** For fetching an echo's text the user doesn't hold. */
  translationId: string;
  actions: CardActions;
}) {
  const space = useScaledSpace();
  const palette = useThemeColors();
  const paper = palette.surface;

  // ---- Layout: once per change, never per frame ----
  const links = useMemo(() => Object.values(verseLinks), [verseLinks]);
  const { result, animate } = useMemo(
    () => ({
      result: layout({ constellations: CONSTELLATIONS, links }, mapLayout),
      // The very first layout just appears; after that, changes glide.
      animate: !!mapLayout,
    }),
    [links, mapLayout]
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
  }, [selectedStar, starsByKey]);
  const echoes = useMemo(() => (selectedStar ? echoViews(result, selectedStar, found) : []), [result, selectedStar, found]);
  const ghostT = useTween(selectedStar, GHOST_FADE_MS);
  const ghosts = useMemo(() => echoes.map((e, i) => ({ p: e.ghost, i })).filter((g): g is { p: Pt; i: number } => !!g.p), [echoes]);

  // ---- Camera ----
  const camera = useRef<MapCamera>(null);
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

  const pickChip = (id: string) => {
    setChip(id);
    camera.current?.frame(viewBounds(result, id === WHOLE ? undefined : id), insets());
  };

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
    return out;
  }, [result, starsByKey]);
  const chipConstellation = CONSTELLATIONS.find((c) => c.id === chip);
  useEffect(() => {
    if (chip !== WHOLE && !result.groups.some((g) => g.id === chip)) setChip(WHOLE);
  }, [chip, result]);

  // ---- The card ----
  const titleOf = (constellationId?: string) => CONSTELLATIONS.find((c) => c.id === constellationId)?.title;
  const onCardLayout = (full: number) => {
    const h = mapHeight ? Math.min(full, mapHeight - 20) : full;
    cardHeight.current = h;
    if (selectedStar && positions[selectedStar]) camera.current?.reveal([positions[selectedStar], ...ghosts.map((g) => g.p)], h + 12);
  };
  // A card the same height as the last one doesn't lay out again, so moving
  // from star to star reveals here too.
  useEffect(() => {
    if (selectedStar && positions[selectedStar] && cardHeight.current)
      camera.current?.reveal([positions[selectedStar], ...ghosts.map((g) => g.p)], cardHeight.current + 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStar, ghosts]);
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
    if (a && b)
      card = (
        <LineCard
          a={a.ref}
          b={b.ref}
          label={lineLabels[`${selection.from}~${selection.to}`]}
          constellationTitle={selection.lineKind === 'curated' ? titleOf(selection.id) : undefined}
          queue={queue}
          onClose={() => setSelection(null)}
          onLayout={(h) => (cardHeight.current = h)}
          actions={actions}
        />
      );
  }

  return (
    <View className="flex-1" style={{ gap: space(10) }}>
      <OneTimeTip id="constellationMap" text="Tap any star to see its passage. Some stars hide something more." />
      <View style={{ gap: space(6) }}>
        <JumpChips chips={chips} value={chip} onPick={pickChip} />
        {chipConstellation ? (
          <AppText variant="caption" className="font-sans text-ink-2" style={{ paddingHorizontal: space(4) }}>
            {chipConstellation.description}
          </AppText>
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
        <View style={{ position: 'absolute', top: space(10), right: space(10), gap: space(8) }}>
          <AppIconButton Icon={Plus} variant="outline" diameter={40} className="bg-surface" accessibilityLabel="Zoom in" onPress={() => camera.current?.zoomBy(1.5)} />
          <AppIconButton Icon={Minus} variant="outline" diameter={40} className="bg-surface" accessibilityLabel="Zoom out" onPress={() => camera.current?.zoomBy(1 / 1.5)} />
        </View>

        {(card || empty) && (
          <View style={{ position: 'absolute', left: space(10), right: space(10), bottom: space(10), maxHeight: mapHeight ? mapHeight - space(20) : undefined }}>
            {card ? (
              // Never taller than the map: a long echo scrolls inside its card.
              <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
                {card}
              </ScrollView>
            ) : (
              <View className="bg-surface border border-line-strong rounded-card" style={{ padding: space(14) }}>
                <AppText variant="label" className="font-sans text-ink">
                  Connect two of your verses and they'll shine here as stars, next to these.
                </AppText>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}
