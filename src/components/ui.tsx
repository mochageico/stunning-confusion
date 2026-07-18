import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, PanResponder, Pressable, Text, View, Image } from 'react-native';

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
  return (
    <>
      <Pressable
        onPress={() => setShow(true)}
        className="w-4 h-4 rounded-full border border-neutral-300 items-center justify-center bg-white/95 ml-1.5 shrink-0"
      >
        <Text className="text-[9px] font-sans font-black text-neutral-400">?</Text>
      </Pressable>
      <Modal visible={show} transparent animationType="none" onRequestClose={() => setShow(false)}>
        {/* RN-Web's Modal wraps children in a container that defaults to
            pointerEvents:'none' (so an off-screen/zero-size modal region
            never blocks the page under it) -- a plain flex-1 child doesn't
            reliably fill that container on web, so a tap outside the bubble
            landed on the page behind the modal instead of this backdrop.
            Pinning all four edges explicitly, with pointerEvents="auto" set
            directly, guarantees this actually captures the dismiss tap. */}
        <Pressable
          onPress={() => setShow(false)}
          pointerEvents="auto"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          className="bg-black/40 items-center justify-center p-8"
        >
          {/* Swallows the tap so it doesn't also bubble to the backdrop
              Pressable above and immediately dismiss itself. */}
          <Pressable onPress={() => {}} className="w-full bg-white border border-neutral-300 rounded-xl p-3.5 shadow-lg" style={{ maxWidth: 320 }}>
            <Text className="text-xs leading-relaxed font-sans font-normal text-neutral-800 text-left">{text}</Text>
          </Pressable>
        </Pressable>
      </Modal>
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
  // NOTE: column width uses an inline `style` (not a NativeWind className) because
  // NativeWind statically scans source text for class names — a computed/interpolated
  // class name like `basis-[${n}%]` never appears literally in the file, so it would
  // silently fail to generate any style at all.
  return (
    <View className={columns || wrap ? 'flex-row flex-wrap gap-1' : 'flex-row gap-1'}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <Pressable
            key={String(opt.id)}
            onPress={() => onChange(opt.id)}
            style={columns ? { width: `${100 / columns}%`, padding: 2 } : wrap ? { minWidth: 30 } : undefined}
            className={`py-1 rounded-lg border ${wrap ? 'px-2.5' : 'px-2'} ${columns || wrap ? '' : 'flex-1'} ${
              active ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-200'
            }`}
          >
            <Text
              className={`text-[9.5px] font-bold text-center ${active ? 'text-white' : 'text-neutral-600'}`}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
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
  return (
    <View className="flex-row items-center gap-2.5" style={{ height: 32 }}>
      <Pressable
        onPress={() => setClamped(snapped - step)}
        disabled={atMin}
        className={`w-7 h-7 rounded-lg border items-center justify-center ${
          atMin ? 'bg-neutral-50 border-neutral-200' : 'bg-white border-neutral-400'
        }`}
      >
        <Text className={`font-black text-sm ${atMin ? 'text-neutral-300' : 'text-[#1A1A1A]'}`}>−</Text>
      </Pressable>
      <View className="flex-1 bg-neutral-200 h-1.5 rounded-full overflow-hidden">
        <View className="bg-[#1A1A1A] h-full rounded-full" style={{ width: `${percent}%` }} />
      </View>
      <Pressable
        onPress={() => setClamped(snapped + step)}
        disabled={atMax}
        className={`w-7 h-7 rounded-lg border items-center justify-center ${
          atMax ? 'bg-neutral-50 border-neutral-200' : 'bg-white border-neutral-400'
        }`}
      >
        <Text className={`font-black text-sm ${atMax ? 'text-neutral-300' : 'text-[#1A1A1A]'}`}>+</Text>
      </Pressable>
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
          <View className="w-full bg-neutral-200 h-1.5 rounded-full overflow-hidden">
            <View className="bg-[#1A1A1A] h-full rounded-full" style={{ width: `${percent}%` }} />
          </View>
          <View
            {...panResponder.panHandlers}
            className="absolute w-6 h-6 rounded-full bg-white border-2 border-[#1A1A1A] shadow"
            style={{ left: `${percent}%`, marginLeft: -12 }}
          />
        </View>
      </Pressable>
      <View className="flex-row justify-between px-0.5">
        {options.map((opt) => (
          <Text key={String(opt.id)} className="text-[9px] font-mono font-bold text-neutral-400">
            {opt.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ============================================================
// AvatarCircle — letter-avatar or photo, used across profile,
// community, and recording-attribution UI.
// ============================================================
export function AvatarCircle({
  name,
  photoUri,
  size = 44,
}: {
  name?: string | null;
  photoUri?: string | null;
  size?: number;
}) {
  if (photoUri) {
    return (
      <Image
        source={{ uri: photoUri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        className="border-2 border-[#1A1A1A]"
      />
    );
  }
  const initial = (name || 'K').trim().charAt(0).toUpperCase() || 'K';
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className="border-2 border-[#1A1A1A] bg-[#F3F2F1] items-center justify-center"
    >
      <Text className="font-serif font-bold text-[#1A1A1A]" style={{ fontSize: size * 0.4 }}>
        {initial}
      </Text>
    </View>
  );
}

// ============================================================
// ProgressBar — simple filled percentage bar.
// ============================================================
export function ProgressBar({ percent, className = 'h-1.5' }: { percent: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View className={`w-full bg-neutral-200 rounded-full overflow-hidden ${className}`}>
      <View className="bg-[#1A1A1A] h-full" style={{ width: `${clamped}%` }} />
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

/** Bars used by the Listen-mode "sound wave" indicator — animates height randomly while `active`. */
export function WaveBars({ active, count = 5 }: { active: boolean; count?: number }) {
  return (
    <View className="flex-row items-end gap-0.5 h-5">
      {Array.from({ length: count }).map((_, i) => (
        <WaveBar key={i} active={active} delay={i * 90} />
      ))}
    </View>
  );
}

function WaveBar({ active, delay }: { active: boolean; delay: number }) {
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
      className="w-0.5 bg-[#1A1A1A] rounded-full"
      style={{ height: height.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }}
    />
  );
}
