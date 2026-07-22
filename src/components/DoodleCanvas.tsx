import React, { useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Eraser } from 'lucide-react-native';

// ============================================================================
// DOODLE CANVAS -- deliberate backbone/v1, not a full drawing tool.
// ----------------------------------------------------------------------------
// Single black pen, fixed width, no undo/eraser-per-stroke/color picker --
// per explicit product direction ("don't fully flesh this out, just make a
// backbone"). Strokes are plain SVG path "d" strings (no extra drawing lib --
// react-native-svg is already a dependency), so persistence is just an array
// of strings the caller owns; this component is otherwise fully controlled.
//
// Coordinate capture uses the same locationX/locationY-with-DOM-offset-
// fallback pattern as DiscreteSlider/StepperRow in ui.tsx (RN Web's
// PanResponder events don't reliably populate locationX/Y). Only verified in
// the web preview -- real touch precision on a native device is untested and
// may need tuning.
// ============================================================================

const CANVAS_SIZE = 260;

interface DoodleCanvasProps {
  strokes: string[];
  onChange: (strokes: string[]) => void;
}

export default function DoodleCanvas({ strokes, onChange }: DoodleCanvasProps) {
  const [liveStroke, setLiveStroke] = useState<string>('');
  const pointsRef = useRef<string[]>([]);

  const pointFromEvent = (evt: any): [number, number] => {
    const ne = evt.nativeEvent;
    const x = typeof ne.locationX === 'number' && !Number.isNaN(ne.locationX) ? ne.locationX : ne.offsetX ?? 0;
    const y = typeof ne.locationY === 'number' && !Number.isNaN(ne.locationY) ? ne.locationY : ne.offsetY ?? 0;
    return [Math.max(0, Math.min(CANVAS_SIZE, x)), Math.max(0, Math.min(CANVAS_SIZE, y))];
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const [x, y] = pointFromEvent(evt);
        pointsRef.current = [`M${x.toFixed(1)},${y.toFixed(1)}`];
        setLiveStroke(pointsRef.current[0]);
      },
      onPanResponderMove: (evt) => {
        const [x, y] = pointFromEvent(evt);
        pointsRef.current.push(`L${x.toFixed(1)},${y.toFixed(1)}`);
        setLiveStroke(pointsRef.current.join(' '));
      },
      onPanResponderRelease: () => {
        if (pointsRef.current.length > 1) onChange([...strokes, pointsRef.current.join(' ')]);
        pointsRef.current = [];
        setLiveStroke('');
      },
    })
  ).current;

  return (
    <View style={{ gap: 8 }}>
      <View
        {...panResponder.panHandlers}
        style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
        className="bg-white border-2 border-[#1A1A1A] rounded-xl overflow-hidden"
      >
        <Svg width={CANVAS_SIZE} height={CANVAS_SIZE}>
          {strokes.map((d, i) => (
            <Path key={i} d={d} stroke="#1A1A1A" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          ))}
          {liveStroke !== '' && <Path d={liveStroke} stroke="#1A1A1A" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />}
        </Svg>
      </View>
      <Pressable
        onPress={() => onChange([])}
        disabled={strokes.length === 0}
        className={`flex-row items-center justify-center gap-1.5 py-2 rounded-lg border ${strokes.length === 0 ? 'border-neutral-200' : 'border-neutral-300'}`}
      >
        <Eraser size={13} color={strokes.length === 0 ? '#d4d4d4' : '#525252'} />
        <Text className={`text-xs font-sans font-bold ${strokes.length === 0 ? 'text-neutral-300' : 'text-neutral-600'}`}>Clear</Text>
      </Pressable>
    </View>
  );
}
