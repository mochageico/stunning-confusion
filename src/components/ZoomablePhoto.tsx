import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  clamp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/**
 * One pinch-zoomable, pannable photo.
 *
 * This is where the feature earns its keep. A Bible page shown letterboxed on a
 * phone is a grey rectangle; the whole point of the full-screen view is that you
 * can push into 8pt type and actually read it.
 *
 * ZOOM IS FOCAL-ANCHORED: the content under the midpoint of your fingers stays
 * under it as you pinch, and the same for the point you double-tap. That is the
 * difference between feeling like the OS photo viewer and feeling like a slider
 * bolted to an image. See `anchorTranslate` for the one line of algebra it takes.
 *
 * Note the GestureDetector wraps the OUTER, UNTRANSFORMED box rather than the
 * animated child. Gesture coordinates are reported relative to the view the
 * handler is attached to, so attaching it to the transformed view would report
 * focal points in already-scaled space and feed the zoom back into itself.
 */

const MAX_SCALE = 6;
/** Below this, a "zoom" is really a wobble -- snap back rather than half-commit. */
const ZOOM_EPSILON = 1.01;
/** Fallback when the image already fills the width, so fit-width would be a no-op. */
const FALLBACK_ZOOM = 2;

export default function ZoomablePhoto({
  uri,
  width: fixedWidth,
  imageWidth,
  imageHeight,
  isActive = true,
  onZoomChange,
}: {
  uri: string;
  /**
   * Page width when inside a pager, where every page must be exactly one screen
   * wide. Omit to fill the parent and measure instead.
   */
  width?: number;
  /** Stored dimensions of the photo, used to compute pan bounds. */
  imageWidth: number;
  imageHeight: number;
  isActive?: boolean;
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [zoomed, setZoomed] = useState(false);

  const width = fixedWidth ?? box.width;
  const height = box.height;

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  // Captured at pinch start: where the fingers were, and what the transform was
  // then. Anchoring has to work from the state the gesture BEGAN in, or each
  // frame compounds the previous frame's correction.
  const focalStartX = useSharedValue(0);
  const focalStartY = useSharedValue(0);
  const originScale = useSharedValue(1);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);

  // The letterboxed size the image actually occupies inside its box, which is
  // what pan bounds have to be computed against -- NOT the box itself. Held as
  // shared values so the gesture worklets can read them without the gestures
  // needing to be rebuilt every time a layout lands.
  const displayedWidth = useSharedValue(0);
  const displayedHeight = useSharedValue(0);
  const boxWidth = useSharedValue(0);
  const boxHeight = useSharedValue(0);

  useEffect(() => {
    boxWidth.value = width;
    boxHeight.value = height;
    if (!width || !height || !imageWidth || !imageHeight) {
      displayedWidth.value = width;
      displayedHeight.value = height;
      return;
    }
    const imageAspect = imageWidth / imageHeight;
    const boxAspect = width / height;
    if (imageAspect > boxAspect) {
      displayedWidth.value = width;
      displayedHeight.value = width / imageAspect;
    } else {
      displayedWidth.value = height * imageAspect;
      displayedHeight.value = height;
    }
  }, [width, height, imageWidth, imageHeight]);

  // Leaving a page zoomed in means coming back to it later at some arbitrary
  // crop, with no memory of how you got there. Reset as it scrolls out of view.
  useEffect(() => {
    if (isActive) return;
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedX.value = 0;
    savedY.value = 0;
    setZoomed(false);
  }, [isActive]);

  // Only the active page may claim the horizontal swipe from whatever owns it.
  useEffect(() => {
    if (isActive) onZoomChange?.(zoomed);
  }, [zoomed, isActive]);

  const boundTranslate = (x: number, y: number, atScale: number) => {
    'worklet';
    const maxX = Math.max(0, (displayedWidth.value * atScale - boxWidth.value) / 2);
    const maxY = Math.max(0, (displayedHeight.value * atScale - boxHeight.value) / 2);
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  };

  /**
   * The translate that keeps the content under `focal` pinned there while the
   * scale goes from `fromScale` to `toScale`.
   *
   * A point p (measured from the box centre) renders at `translate + scale * p`.
   * Holding the rendered position of whatever sits under the focal fixed and
   * solving for the new translate gives, with k = toScale / fromScale:
   *
   *     translate' = focal * (1 - k) + k * translate
   */
  const anchorTranslate = (
    focalX: number,
    focalY: number,
    fromScale: number,
    toScale: number,
    fromX: number,
    fromY: number
  ) => {
    'worklet';
    const k = toScale / fromScale;
    return { x: focalX * (1 - k) + k * fromX, y: focalY * (1 - k) + k * fromY };
  };

  const settleToRest = () => {
    'worklet';
    scale.value = withTiming(1);
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedScale.value = 1;
    savedX.value = 0;
    savedY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      focalStartX.value = e.focalX - boxWidth.value / 2;
      focalStartY.value = e.focalY - boxHeight.value / 2;
      originScale.value = scale.value;
      originX.value = translateX.value;
      originY.value = translateY.value;
    })
    .onUpdate((e) => {
      const next = clamp(originScale.value * e.scale, 1, MAX_SCALE);
      const anchored = anchorTranslate(
        focalStartX.value,
        focalStartY.value,
        originScale.value,
        next,
        originX.value,
        originY.value
      );
      // Two fingers moving together should drag the image as well as zoom it --
      // without this the picture feels pinned in place while you pinch.
      const driftX = e.focalX - boxWidth.value / 2 - focalStartX.value;
      const driftY = e.focalY - boxHeight.value / 2 - focalStartY.value;
      const bounded = boundTranslate(anchored.x + driftX, anchored.y + driftY, next);
      scale.value = next;
      translateX.value = bounded.x;
      translateY.value = bounded.y;
    })
    .onEnd(() => {
      const next = scale.value <= ZOOM_EPSILON ? 1 : scale.value;
      if (next === 1) {
        settleToRest();
      } else {
        savedScale.value = next;
        savedX.value = translateX.value;
        savedY.value = translateY.value;
      }
      runOnJS(setZoomed)(next > 1);
    });

  const pan = Gesture.Pan()
    // Disabled at rest so the gesture never competes with whatever owns
    // horizontal movement outside -- a pager's swipe, or Listen's fling.
    .enabled(zoomed)
    .averageTouches(true)
    .onUpdate((e) => {
      const bounded = boundTranslate(
        savedX.value + e.translationX,
        savedY.value + e.translationY,
        scale.value
      );
      translateX.value = bounded.x;
      translateY.value = bounded.y;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((e) => {
      if (scale.value > ZOOM_EPSILON) {
        settleToRest();
        runOnJS(setZoomed)(false);
        return;
      }
      // Fit-width is the gesture people actually want on a page of text: fill
      // the screen edge to edge so the column is as large as it can get. When
      // the image already spans the width (a landscape two-page spread), that
      // ratio is 1 and would do nothing, so fall back to a plain 2x.
      const fitWidth =
        displayedWidth.value > 0 ? boxWidth.value / displayedWidth.value : FALLBACK_ZOOM;
      const target = clamp(fitWidth > ZOOM_EPSILON ? fitWidth : FALLBACK_ZOOM, 1, MAX_SCALE);
      // Zoom toward the tapped point, not the middle -- double-tapping a verse
      // low on the page should bring THAT verse up, not the centre of the page.
      const anchored = anchorTranslate(
        e.x - boxWidth.value / 2,
        e.y - boxHeight.value / 2,
        scale.value,
        target,
        translateX.value,
        translateY.value
      );
      const bounded = boundTranslate(anchored.x, anchored.y, target);
      scale.value = withTiming(target);
      translateX.value = withTiming(bounded.x);
      translateY.value = withTiming(bounded.y);
      savedScale.value = target;
      savedX.value = bounded.x;
      savedY.value = bounded.y;
      runOnJS(setZoomed)(true);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan))}>
      <View
        style={fixedWidth != null ? { width: fixedWidth } : undefined}
        className="flex-1 items-center justify-center overflow-hidden"
        onLayout={(e) =>
          setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
        }
      >
        <Animated.View style={[{ width: '100%', height: '100%' }, animatedStyle]}>
          <Image
            source={{ uri }}
            style={{ width: '100%', height: '100%' }}
            // Letterbox, never crop-to-fill: a Bible page is dense to the
            // margins, so filling the box would slice off the outer column --
            // exactly the text this screen exists to show.
            contentFit="contain"
            transition={150}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
