import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, InputAccessoryView, Keyboard, PanResponder, Platform, Pressable, TextInputProps, View } from 'react-native';

import { CircleHelp, Minus, Plus } from 'lucide-react-native';

import { AppIconButton, AppTextInput, AppText, useFontScale, useScaledSpace } from './design';
import { Avatar, Dialog, SegmentedControl } from './blocks';
import { useThemeColors } from './theme';

// ============================================================
// useKeyboardHeight — manual native keyboard-height tracking, used instead
// of KeyboardAvoidingView's automatic "measure my own frame" approach.
// That approach turned out unreliable for the chat screens (still
// undershot even once they were full-screen with no sibling bars below) --
// listening directly to the native show/hide events and applying the
// reported height as padding is the deterministic alternative.
// ============================================================
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  return height;
}

// ============================================================
// HelpTooltip — original was a hover-to-show "?" bubble; RN has
// no hover, so this is tap-to-toggle (the web original already
// supported tap-to-toggle as a fallback via its onClick handler).
//
// Renders through a real Modal (a true portal, escaping wherever the "?"
// trigger sits in the layout) instead of a View positioned relative to the
// trigger -- the previous version anchored the bubble directly above the
// trigger with no viewport-boundary awareness, so a "?" near a screen edge
// (extremely common; tooltips mostly sit next to section headers) could
// render the bubble partially or fully off-screen with no way to see it.
// A centered modal is always fully on-screen regardless of where the
// trigger is, at the cost of the bubble no longer visually pointing at its
// trigger -- an acceptable tradeoff for "the tooltip must actually be
// readable" over "the tooltip points precisely at the field."
// ============================================================
export function HelpTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  const palette = useThemeColors();
  const scale = useFontScale();
  return (
    <>
      {/* A plain help icon in ink-3 (job F3), no bubble. hitSlop brings the
          small glyph up to a comfortable tap target. */}
      <Pressable
        onPress={() => setShow(true)}
        accessibilityRole="button"
        accessibilityLabel="More info"
        hitSlop={14}
        className="ml-1.5 shrink-0 active:opacity-60"
      >
        <CircleHelp size={Math.round(16 * scale)} color={palette.ink3} strokeWidth={2} />
      </Pressable>
      <Dialog visible={show} onClose={() => setShow(false)}>
        <AppText variant="body" className="font-sans text-ink">{text}</AppText>
      </Dialog>
    </>
  );
}

// ============================================================
// ChipRow — replaces web <select>/<option> dropdowns with the
// same horizontal segmented-chip pattern the rest of the app
// already uses, so pickers stay visually consistent.
// ============================================================
export interface ChipOption<T extends string | number> {
  id: T;
  label: string;
}

export function ChipRow<T extends string | number>({
  options,
  value,
  onChange,
  columns,
  wrap,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Optional fixed column count (grid-like wrapping); defaults to a scrolling/wrapping row. */
  columns?: number;
  /**
   * Chips size to their own content and wrap onto new lines, instead of
   * dividing the row width evenly (`flex-1`) or by a fixed column count.
   * Use this for lists whose length isn't known ahead of time (e.g. chapter
   * numbers 1..150) — with `flex-1`/`columns`, a long list either overflows
   * unscrollably or squeezes every label down to an unreadable sliver.
   */
  wrap?: boolean;
}) {
  const space = useScaledSpace();
  // Without `wrap` or `columns`, the options divide one row evenly: that is a
  // segmented control, so it is drawn as one (job F3). Labels wrap to two
  // lines there instead of being cut off ("Last 30 D...").
  if (!columns && !wrap) return <SegmentedControl options={options} value={value} onChange={onChange} />;

  // NOTE: column width uses an inline `style` (not a NativeWind className) because
  // NativeWind statically scans source text for class names — a computed/interpolated
  // class name like `basis-[${n}%]` never appears literally in the file, so it would
  // silently fail to generate any style at all.
  // Wrapped rows center themselves rather than packing left: a trailing
  // partial row hanging off the left edge reads as a layout bug, not as a
  // deliberate group.
  return (
    <View className="flex-row flex-wrap justify-center" style={{ gap: columns ? 0 : 6, rowGap: 6 }}>
      {options.map((opt) => {
        const active = opt.id === value;
        const chip = (
          <View
            className={`rounded-full border items-center justify-center ${
              active ? 'bg-accent-soft border-accent' : 'bg-surface border-line-strong'
            }`}
            style={{ paddingHorizontal: space(12), paddingVertical: space(5), minWidth: space(36) }}
          >
            <AppText
              variant="caption"
              className={`font-sans text-center ${active ? 'font-semibold text-accent' : 'font-medium text-ink-2'}`}
              numberOfLines={1}
            >
              {opt.label}
            </AppText>
          </View>
        );
        return (
          <Pressable
            key={String(opt.id)}
            onPress={() => onChange(opt.id)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            aria-checked={active}
            className="active:opacity-70"
            style={columns ? { width: `${100 / columns}%`, paddingHorizontal: 3 } : undefined}
          >
            {chip}
          </Pressable>
        );
      })}
    </View>
  );
}

// ============================================================
// StepperRow — pure-JS replacement for @react-native-community/
// slider. That package's native component was the prime suspect
// in a hard iOS freeze on the New Architecture (JS thread dead
// after a few state changes on the slider-heavy Plan Designer;
// see the known New-Arch issues on callstack/react-native-slider).
// Every setting it backed is a small discrete range, so −/+
// steppers with a progress track lose nothing — and they're
// ordinary Views/Pressables, with no native module to deadlock.
// ============================================================
export function StepperRow({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  // Snap to the step grid first so a legacy off-grid value (e.g. a review
  // cap of 17 saved back when this was a step-1 slider) lands on a clean
  // multiple after one press instead of walking off-grid forever.
  const snapped = Math.round((value - min) / step) * step + min;
  const setClamped = (n: number) => onChange(Math.max(min, Math.min(max, n)));
  const percent = max === min ? 0 : ((Math.max(min, Math.min(max, value)) - min) / (max - min)) * 100;
  const atMin = value <= min;
  const atMax = value >= max;
  // minHeight, not height: the -/+ glyphs are text, so the row has to be able
  // to grow when the OS font scale does. hitSlop keeps the tap target
  // comfortable without inflating the visual button.
  const palette = useThemeColors();
  const space = useScaledSpace();
  // Round outline buttons with the accent -/+ (job F3). AppIconButton scales
  // the circle with the text setting and pads the tap target to 44pt.
  return (
    <View className="flex-row items-center" style={{ minHeight: space(36), gap: space(10) }}>
      <AppIconButton
        Icon={Minus}
        variant="outline"
        diameter={34}
        iconColor={palette.accent}
        disabled={atMin}
        onPress={() => setClamped(snapped - step)}
        accessibilityLabel="Decrease"
      />
      <View className="flex-1 bg-fill h-1.5 rounded-full overflow-hidden">
        <View className="bg-accent h-full rounded-full" style={{ width: `${percent}%` }} />
      </View>
      <AppIconButton
        Icon={Plus}
        variant="outline"
        diameter={34}
        iconColor={palette.accent}
        disabled={atMax}
        onPress={() => setClamped(snapped + step)}
        accessibilityLabel="Increase"
      />
    </View>
  );
}

// ============================================================
// DiscreteSlider — a ChipRow's exact same "pick one of a few labeled
// stops" semantics (so a non-numeric stop like "Off"/"Unlimited"
// works fine), but as a draggable thumb over a track instead of a
// row of tap targets. Stops sit evenly spaced along the track
// regardless of the numeric gaps between their real values -- same
// reason StepperRow above is plain Views + PanResponder rather than
// @react-native-community/slider: no native slider dependency.
// ============================================================
export interface SliderStop<T extends string | number> {
  id: T;
  label: string;
}

export function DiscreteSlider<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: SliderStop<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  const trackWidthRef = useRef(0);
  const trackRef = useRef<View>(null);
  const lastIndex = options.length - 1;
  const activeIndex = Math.max(0, options.findIndex((o) => o.id === value));
  const percent = lastIndex <= 0 ? 0 : (activeIndex / lastIndex) * 100;
  // Read inside the drag handler below instead of closed over directly --
  // the PanResponder instance is created exactly once via useRef, so a
  // plain closure over activeIndex/lastIndex would go stale after the first
  // render (same reasoning as RecordingDetailScreen's DraggableMarker).
  const startFractionRef = useRef(0);
  const dragStateRef = useRef({ activeIndex, lastIndex });
  dragStateRef.current = { activeIndex, lastIndex };

  const jumpToFraction = (fraction: number) => {
    const idx = Math.round(Math.max(0, Math.min(1, fraction)) * lastIndex);
    const stop = options[idx];
    if (stop && stop.id !== value) onChange(stop.id);
  };

  // Deliberately NOT reading width from onLayout: onLayout never fired at
  // all on this View in testing (not even once, on any platform tested so
  // far), so anything nested inside it -- including .measure() -- never got
  // a chance to run. Calling .measure() directly from an effect + a short
  // rAF retry loop gets the real width regardless of whether onLayout ever
  // fires, since .measure() reads current layout on demand rather than
  // waiting on that event.
  useEffect(() => {
    let frame: number;
    let cancelled = false;
    const attempt = (triesLeft: number) => {
      if (cancelled) return;
      trackRef.current?.measure((_x, _y, width) => {
        if (width > 0) trackWidthRef.current = width;
        else if (triesLeft > 0) frame = requestAnimationFrame(() => attempt(triesLeft - 1));
      });
    };
    attempt(30);
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // The thumb's drag uses gestureState.dx (relative movement since the
  // gesture started), not an absolute page coordinate -- avoids needing the
  // track's page-relative offset entirely.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        const { activeIndex, lastIndex } = dragStateRef.current;
        startFractionRef.current = lastIndex <= 0 ? 0 : activeIndex / lastIndex;
      },
      onPanResponderMove: (_evt, gestureState) => {
        const width = trackWidthRef.current;
        if (width <= 0) return;
        jumpToFraction(startFractionRef.current + gestureState.dx / width);
      },
    })
  ).current;

  return (
    <View style={{ gap: 6 }}>
      <Pressable
        onPress={(e) => {
          const width = trackWidthRef.current;
          if (width <= 0) return;
          // nativeEvent.locationX is the real, reliable field on native RN --
          // but on React Native Web it's frequently NaN/undefined (the
          // Pressable there wraps a plain DOM event), so fall back to the
          // DOM's own offsetX, which is relative to this same target.
          const nativeEvt = e.nativeEvent as any;
          const locationX =
            typeof nativeEvt.locationX === 'number' && !Number.isNaN(nativeEvt.locationX) ? nativeEvt.locationX : nativeEvt.offsetX;
          jumpToFraction(locationX / width);
        }}
      >
        <View ref={trackRef} className="w-full justify-center" style={{ height: 28 }}>
          <View className="w-full bg-fill h-1.5 rounded-full overflow-hidden">
            <View className="bg-accent h-full rounded-full" style={{ width: `${percent}%` }} />
          </View>
          <View
            {...panResponder.panHandlers}
            // White knob with a fixed shadow, like the iPhone's slider thumb.
            className="absolute w-6 h-6 rounded-full bg-white border border-line shadow-sm"
            style={{ left: `${percent}%`, marginLeft: -12 }}
          />
        </View>
      </Pressable>
      <View className="flex-row justify-between px-0.5">
        {options.map((opt) => (
          <AppText variant="micro" key={String(opt.id)} className="font-mono font-medium text-ink-3">
            {opt.label}
          </AppText>
        ))}
      </View>
    </View>
  );
}

// ============================================================
// AvatarCircle — letter-avatar or photo, used across profile,
// community, and recording-attribution UI.
// ============================================================
export function AvatarCircle(props: { name?: string | null; photoUri?: string | null; size?: number }) {
  // Kept as a name so existing call sites don't change; the look is Avatar's
  // (blocks.tsx): accent tint and initial, no thick black ring.
  return <Avatar size={44} {...props} />;
}

// ============================================================
// ProgressBar — simple filled percentage bar.
// ============================================================
export function ProgressBar({ percent, className = 'h-1.5' }: { percent: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View className={`w-full bg-fill rounded-full overflow-hidden ${className}`}>
      <View className="bg-accent h-full" style={{ width: `${clamped}%` }} />
    </View>
  );
}

// ============================================================
// useClampedNumberField — backs a numeric TextInput with its own
// free-typed string so clearing the field doesn't instantly snap back
// to the clamped minimum (which used to force the *next* keystroke to
// land next to a phantom "1" instead of into an empty box). The real
// number only updates -- and the box only re-clamps -- once the user
// leaves the field.
// ============================================================
export function useClampedNumberField(value: number, commit: (n: number) => void, clamp: (n: number) => number) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);
  return {
    value: text,
    onChangeText: setText,
    onBlur: () => {
      const parsed = parseInt(text, 10);
      const next = clamp(Number.isNaN(parsed) ? value : parsed);
      commit(next);
      setText(String(next));
    },
  };
}

// ============================================================
// NumericInput / NumericKeyboardAccessory — the fix for "can't get rid of
// the # keyboard".
//
// iOS's numeric keypad (keyboardType 'numeric' | 'number-pad' | 'decimal-pad')
// has NO return key, so a bare numeric TextInput is a dead end: nothing
// on screen dismisses it, and inside a bottom-anchored sheet the keypad
// also covers the submit button, so the form becomes unusable. The standard
// iOS answer is an accessory bar pinned directly above the keyboard, which
// is what InputAccessoryView provides.
//
// Android is unaffected (its numeric keyboard has a system dismiss key) and
// InputAccessoryView is iOS-only, so the accessory renders nothing there.
//
// PAIRING RULE: every NumericInput resolves its accessory by nativeID, and
// an id only resolves within the same native view controller. A RN Modal is
// its own controller on iOS, so any Modal containing numeric inputs must
// render its OWN <NumericKeyboardAccessory nativeID="..."> and pass that
// same id to its inputs as `accessoryID` -- it cannot borrow the app-root
// one. Distinct ids (rather than re-registering the default in the modal)
// keep the two registrations from colliding.
// ============================================================
export const NUMERIC_ACCESSORY_ID = 'numericDoneBar';

export function NumericKeyboardAccessory({ nativeID = NUMERIC_ACCESSORY_ID }: { nativeID?: string }) {
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={nativeID}>
      <View className="bg-surface-2 border-t border-line-strong flex-row justify-end px-2 py-1.5">
        <Pressable onPress={() => Keyboard.dismiss()} hitSlop={10} className="px-4 py-1.5">
          <AppText variant="body" className="font-sans font-bold text-ink">Done</AppText>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

// Drop-in replacement for a numeric <AppTextInput>. Props spread last so a
// caller can still override keyboardType (e.g. 'decimal-pad').
export function NumericInput({
  accessoryID = NUMERIC_ACCESSORY_ID,
  ...props
}: TextInputProps & { accessoryID?: string }) {
  return (
    <AppTextInput
      keyboardType="number-pad"
      inputAccessoryViewID={Platform.OS === 'ios' ? accessoryID : undefined}
      {...props} />
  );
}

// ============================================================
// Animated wrappers replacing Tailwind's animate-fade-in / -pulse
// / -spin / -bounce utilities, implemented with RN's built-in
// Animated API (no extra runtime dependency, guaranteed to work
// regardless of NativeWind's custom-keyframe support).
// ============================================================
export function FadeInView({ children, style }: { children: React.ReactNode; style?: any }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(4)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);
  return <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>{children}</Animated.View>;
}

export function PulseView({ children, style }: { children: React.ReactNode; style?: any }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.4, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ opacity }, style]}>{children}</Animated.View>;
}

export function SpinView({ children, style }: { children: React.ReactNode; style?: any }) {
  const rotate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotate, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [rotate]);
  const spin = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View style={[{ transform: [{ rotate: spin }] }, style]}>{children}</Animated.View>;
}

export function BounceView({ children, style }: { children: React.ReactNode; style?: any }) {
  const translateY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, { toValue: -6, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 400, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [translateY]);
  return <Animated.View style={[{ transform: [{ translateY }] }, style]}>{children}</Animated.View>;
}

/**
 * Bars used by the Listen-mode "sound wave" indicator — animates height
 * randomly while `active`. `onFill` for bars sitting on an accent fill.
 */
export function WaveBars({ active, count = 5, onFill = false }: { active: boolean; count?: number; onFill?: boolean }) {
  return (
    <View className="flex-row items-end gap-0.5 h-5">
      {Array.from({ length: count }).map((_, i) => (
        <WaveBar key={i} active={active} delay={i * 90} onFill={onFill} />
      ))}
    </View>
  );
}

function WaveBar({ active, delay, onFill }: { active: boolean; delay: number; onFill: boolean }) {
  const height = useRef(new Animated.Value(active ? 100 : 15)).current;
  useEffect(() => {
    if (!active) {
      height.setValue(15);
      return;
    }
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      Animated.timing(height, {
        toValue: 20 + Math.random() * 80,
        duration: 350,
        useNativeDriver: false,
      }).start(() => step());
    };
    const t = setTimeout(step, delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [active, delay, height]);
  return (
    <Animated.View
      className={`w-0.5 rounded-full ${onFill ? 'bg-on-accent' : 'bg-accent'}`}
      style={{ height: height.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }}
    />
  );
}
