import React, { useEffect, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, View } from 'react-native';

import { AppButton, AppText, useFontScale, useScaledSpace } from './design';
import { Dialog } from './blocks';

// ============================================================
// TimeWheel: the scrolling hour / minute / AM-PM wheels people know from
// alarms and reminders. Plain ScrollViews that snap, so it ships over the air
// without a native date-picker module.
// ============================================================

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0..55
const HALVES = ['AM', 'PM'];
const VISIBLE = 5; // rows shown; the middle one is the pick

export function formatClock(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

function Wheel({
  items,
  index,
  onChange,
  rowHeight,
  width,
  label,
}: {
  items: string[];
  index: number;
  onChange: (i: number) => void;
  rowHeight: number;
  width: number;
  label: string;
}) {
  const ref = useRef<ScrollView>(null);
  const current = useRef(index);

  // Jump to the starting value once laid out (contentOffset isn't reliable on Android).
  useEffect(() => {
    const t = setTimeout(() => ref.current?.scrollTo({ y: index * rowHeight, animated: false }), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.y / rowHeight)));
    if (i !== current.current) {
      current.current = i;
      onChange(i);
    }
  };

  return (
    <ScrollView
      ref={ref}
      style={{ width, height: rowHeight * VISIBLE }} /* layout-ok: wheel window; rows scale with text */
      contentContainerStyle={{ paddingVertical: rowHeight * Math.floor(VISIBLE / 2) }}
      showsVerticalScrollIndicator={false}
      snapToInterval={rowHeight}
      decelerationRate="fast"
      onScroll={onScroll}
      scrollEventThrottle={16}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: items[index] }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const next = e.nativeEvent.actionName === 'increment' ? index + 1 : index - 1;
        if (next < 0 || next >= items.length) return;
        ref.current?.scrollTo({ y: next * rowHeight, animated: true });
        current.current = next;
        onChange(next);
      }}
    >
      {items.map((it, i) => (
        <View key={it} style={{ height: rowHeight }} className="items-center justify-center" /* layout-ok: one wheel row */>
          <AppText
            variant="title"
            maxScale={1.4}
            className={`font-sans ${i === index ? 'font-semibold text-ink' : 'text-ink-3'}`}
          >
            {it}
          </AppText>
        </View>
      ))}
    </ScrollView>
  );
}

/** Hour (0–23) and minute pickers in a centered pop-up with Cancel / Done. */
export function TimeWheelDialog({
  visible,
  title,
  hour,
  minute,
  onClose,
  onDone,
}: {
  visible: boolean;
  title: string;
  hour: number;
  minute: number;
  onClose: () => void;
  onDone: (hour: number, minute: number) => void;
}) {
  const scale = Math.min(useFontScale(), 1.4);
  const space = useScaledSpace();
  const rowHeight = Math.round(40 * scale);
  const [h, setH] = useState(hour);
  const [m, setM] = useState(Math.round(minute / 5) * 5 % 60);

  useEffect(() => {
    if (visible) {
      setH(hour);
      setM((Math.round(minute / 5) * 5) % 60);
    }
  }, [visible, hour, minute]);

  const h12 = h % 12 === 0 ? 12 : h % 12;
  const pm = h >= 12;
  const setParts = (nextH12: number, nextPm: boolean) => setH((nextH12 % 12) + (nextPm ? 12 : 0));

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      title={title}
      actions={
        <>
          <AppButton variant="quiet" label="Cancel" onPress={onClose} />
          <AppButton variant="primary" label="Done" onPress={() => onDone(h, m)} />
        </>
      }
    >
      {visible ? (
        <View className="items-center justify-center" style={{ paddingVertical: space(4) }}>
          {/* The band behind the middle row marks the pick. */}
          <View
            pointerEvents="none"
            className="absolute left-0 right-0 bg-fill rounded-btn"
            style={{ height: rowHeight, top: space(4) + rowHeight * Math.floor(VISIBLE / 2) }} /* layout-ok: highlight band, no text */
          />
          <View className="flex-row items-center" style={{ gap: space(4) }}>
            <Wheel
              label="Hour"
              items={HOURS.map(String)}
              index={HOURS.indexOf(h12)}
              onChange={(i) => setParts(HOURS[i], pm)}
              rowHeight={rowHeight}
              width={Math.round(56 * scale)}
            />
            <AppText variant="title" maxScale={1.4} className="font-sans font-semibold text-ink">
              :
            </AppText>
            <Wheel
              label="Minute"
              items={MINUTES.map((x) => String(x).padStart(2, '0'))}
              index={MINUTES.indexOf(m)}
              onChange={(i) => setM(MINUTES[i])}
              rowHeight={rowHeight}
              width={Math.round(56 * scale)}
            />
            <Wheel
              label="AM or PM"
              items={HALVES}
              index={pm ? 1 : 0}
              onChange={(i) => setParts(h12, i === 1)}
              rowHeight={rowHeight}
              width={Math.round(64 * scale)}
            />
          </View>
        </View>
      ) : null}
    </Dialog>
  );
}
