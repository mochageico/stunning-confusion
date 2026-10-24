import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText, useScaledSpace } from './design';
import { mix, useThemeColors } from './theme';

export interface HeatmapDay {
  day: string; // "October 21"
  weekday: number; // 0 = Sunday
  month: number;
  practice: number; // Learning practice
  reviews: number; // spaced reviews
  count: number; // practice + reviews
}

const GAP = 3;
// On a tablet the squares would otherwise grow to the size of buttons.
const MAX_CELL = 28;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ROW_LABELS: Record<number, string> = { 1: 'M', 3: 'W', 5: 'F' };

// Shade 0 is an empty day; 1-4 step up toward the busiest day in the window.
// The steps are on a log scale: a chapter run-through logs a review per verse,
// so one 1000-review day on a plain scale left a 125-review day in the
// faintest shade, which read as empty.
// Each shade is a solid color mixed from the palette rather than an opacity
// class (bg-success/50): on iPhone those drew as blank, so every day came out
// either white or full green.
const SHADE_AMOUNTS = [0.3, 0.55, 0.8, 1];

function useShades() {
  const palette = useThemeColors();
  return [
    { fill: palette.surface2, edge: palette.line },
    ...SHADE_AMOUNTS.map((amount) => {
      const fill = mix(palette.success, palette.surface, amount);
      return { fill, edge: fill };
    }),
  ];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * An Anki-style calendar heatmap: one square per day, a column per week
 * (Sunday on top), darker for busier days. Tap a square to read its count.
 * Square sizes come from the measured width so they stay square on any phone.
 */
export function ActivityHeatmap({ days }: { days: HeatmapDay[] }) {
  const space = useScaledSpace();
  const palette = useThemeColors();
  const shades = useShades();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState(days.length - 1);

  const lead = days[0]?.weekday ?? 0;
  const columns = Math.ceil((lead + days.length) / 7);
  const labelWidth = space(14);
  const cell = width > 0 ? Math.min(MAX_CELL, Math.floor((width - labelWidth - GAP * columns) / columns)) : 0;
  const max = days.reduce((m, d) => Math.max(m, d.count), 0);
  const shadeOf = (count: number) =>
    count === 0 || max === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((Math.log1p(count) / Math.log1p(max)) * 4)));

  const at = (column: number, row: number) => {
    const index = column * 7 + row - lead;
    return index >= 0 && index < days.length ? index : -1;
  };

  // A month's name sits over the first week that starts in it. The first
  // column only gets one if the next column doesn't start a new month too,
  // so two names never overlap.
  const firstMonth = (column: number) => {
    for (let row = 0; row < 7; row++) {
      const index = at(column, row);
      if (index >= 0) return days[index].month;
    }
    return -1;
  };
  const monthLabels: { column: number; label: string }[] = [];
  for (let c = 0; c < columns; c++) {
    const month = firstMonth(c);
    if (c === 0 ? firstMonth(1) === month : month !== firstMonth(c - 1)) monthLabels.push({ column: c, label: MONTHS[month] });
  }

  const pick = days[selected];
  const pickLabel = pick ? `${selected === days.length - 1 ? 'Today' : `${WEEKDAYS[pick.weekday]}, ${pick.day}`}` : '';
  const pickDetail = !pick
    ? ''
    : pick.count === 0
      ? 'Nothing practiced'
      : [pick.reviews > 0 && plural(pick.reviews, 'review'), pick.practice > 0 && `${plural(pick.practice, 'practice')} on verses you're learning`]
          .filter(Boolean)
          .join(' · ');

  return (
    <View style={{ gap: space(10) }}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {cell > 0 && (
          <View style={{ alignSelf: 'center', gap: GAP }}>
            <View style={{ height: space(16) }}>
              {monthLabels.map(({ column, label }) => (
                <AppText
                  key={column}
                  variant="micro"
                  className="font-sans text-ink-3"
                  style={{ position: 'absolute', left: labelWidth + GAP + column * (cell + GAP) }}
                >
                  {label}
                </AppText>
              ))}
            </View>
            {Array.from({ length: 7 }, (_, row) => (
              <View key={row} className="flex-row items-center" style={{ gap: GAP }}>
                <AppText variant="micro" className="font-sans text-ink-3" style={{ width: labelWidth }}>
                  {ROW_LABELS[row] ?? ''}
                </AppText>
                {Array.from({ length: columns }, (_, column) => {
                  const index = at(column, row);
                  if (index < 0) return <View key={column} style={{ width: cell, height: cell }} />;
                  const isSelected = index === selected;
                  const shade = shades[shadeOf(days[index].count)];
                  return (
                    <Pressable
                      key={column}
                      onPress={() => setSelected(index)}
                      accessibilityLabel={`${days[index].day}: ${plural(days[index].count, 'practice')}`}
                      style={{
                        width: cell,
                        height: cell,
                        borderWidth: isSelected ? 2 : 1,
                        backgroundColor: shade.fill,
                        borderColor: isSelected ? palette.ink : shade.edge,
                      }}
                      className="rounded-sm"
                    />
                  );
                })}
              </View>
            ))}
          </View>
        )}
      </View>

      <View className="flex-row items-center justify-between" style={{ gap: space(8) }}>
        <View className="flex-1">
          <AppText variant="caption" className="font-sans font-semibold text-ink">
            {pickLabel}
          </AppText>
          <AppText variant="caption" className="font-sans text-ink-3">
            {pickDetail}
          </AppText>
        </View>
        <View className="flex-row items-center" style={{ gap: 3 }}>
          <AppText variant="micro" className="font-sans text-ink-3" style={{ marginRight: 2 }}>
            Less
          </AppText>
          {shades.map((shade, i) => (
            <View key={i} style={{ width: 11, height: 11, borderWidth: 1, backgroundColor: shade.fill, borderColor: shade.edge }} className="rounded-sm" />
          ))}
          <AppText variant="micro" className="font-sans text-ink-3" style={{ marginLeft: 2 }}>
            More
          </AppText>
        </View>
      </View>
    </View>
  );
}
