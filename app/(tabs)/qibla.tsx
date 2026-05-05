import {
  View, Text, StyleSheet, Dimensions, Animated,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { Qibla } from 'adhan';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, {
  Circle, Line, Text as SvgText, G, Path, Polygon, Rect, Defs, RadialGradient, Stop,
} from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../context/ThemeContext';
import { nativeReverseGeocode } from '../../services/geocoding';

const { width } = Dimensions.get('window');
const COMPASS_SIZE            = Math.min(width - 32, 320);
const C                       = COMPASS_SIZE / 2;
const OR                      = C - 2;      // outer bezel radius
const TR                      = OR - 6;     // tick outer edge
const TI                      = TR - 50;    // tick inner edge (ring = 50px wide)
const CR                      = TI - 14;    // center circle radius
const AR                      = TI - 6;     // arrow (needle tip) radius
const QIBLA_ALIGNED_THRESHOLD = 5;
const GREEN                   = '#4CAF82';

// ── Calibration animation constants ──────────────────────────────────────────
const CALIB_W  = 240;                    // container width
const CALIB_H  = 120;                    // container height (landscape ∞)
const CALIB_CX = CALIB_W / 2;           // 120
const CALIB_CY = CALIB_H / 2;           // 60
const LISSA_A  = 88;                     // horizontal half-extent
const LISSA_B  = 32;                     // vertical half-extent
const PHONE_W  = 22;                     // phone icon width
const PHONE_H  = 38;                     // phone icon height

// Pre-compute smooth horizontal ∞ path for the SVG guide
const FIG8_PATH = (() => {
  const pts: string[] = [];
  const N = 240;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * 2 * Math.PI;
    const x = CALIB_CX + LISSA_A * Math.sin(t);
    const y = CALIB_CY + LISSA_B * Math.sin(2 * t);
    pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pts.join(' ') + ' Z';
})();

function normDeg(d: number)   { return ((d % 360) + 360) % 360; }
function toRad(a: number)     { return (a - 90) * Math.PI / 180; }
function px(a: number, r: number) { return C + Math.cos(toRad(a)) * r; }
function py(a: number, r: number) { return C + Math.sin(toRad(a)) * r; }
function lowPass(current: number, target: number, factor = 0.15): number {
  let diff = target - current;
  if (diff > 180)  diff -= 360;
  if (diff < -180) diff += 360;
  return current + diff * factor;
}
function getCardinalLabel(deg: number): string {
  const dirs = ['N', 'NÖ', 'Ö', 'SÖ', 'S', 'SV', 'V', 'NV'];
  return dirs[Math.round(normDeg(deg) / 45) % 8];
}

// ── Red arrow needle (red-arrow.svg inlined) ─────────────────────────────────
// SVG pivot (base-centre) = (258.14, 256.93), tip = (258.14, 22.09)
// Scale so the tip reaches CR * 0.75 above compass centre; pivot maps to (C, C).
const ARROW_PIVOT_X = 258.14;
const ARROW_PIVOT_Y = 256.93;
const ARROW_SCALE   = (CR * 0.375) / (ARROW_PIVOT_Y - 22.09); // half of original ≈ 0.14 for CR=88

// ── Calibration overlay ────────────────────────────────────────────────────────
function CalibrationOverlay({ progress, onDismiss, T, isDark }: {
  progress: number; onDismiss: () => void; T: any; isDark: boolean;
}) {
  const phoneX         = useRef(new Animated.Value(0)).current;
  const phoneY         = useRef(new Animated.Value(0)).current;
  const rotAnim        = useRef(new Animated.Value(0)).current;
  const rafRef         = useRef<number>(0);
  const tRef           = useRef(0);
  const prevRotRef     = useRef(0);
  const cumRotRef      = useRef(0);

  useEffect(() => {
    const PERIOD = 5000; // ms per full ∞ cycle
    let lastTime: number | null = null;

    const loop = (now: number) => {
      if (lastTime === null) lastTime = now;
      const dt = Math.min(now - lastTime, 64); // clamp to avoid big jumps after tab switch
      lastTime = now;

      tRef.current = (tRef.current + dt / PERIOD) % 1;
      const angle = tRef.current * 2 * Math.PI;

      // Lissajous position: x=A·sin(t), y=B·sin(2t) → smooth horizontal ∞
      const x = LISSA_A * Math.sin(angle);
      const y = LISSA_B * Math.sin(2 * angle);

      // Tangent vector (velocity direction)
      const vx =  LISSA_A * Math.cos(angle);
      const vy =  2 * LISSA_B * Math.cos(2 * angle); // screen-Y (positive = down)

      // Phone rotation: 0° = pointing up, 90° = pointing right
      const targetRot = Math.atan2(vx, -vy) * 180 / Math.PI;

      // Unwrap against previous raw angle to avoid ±180° jumps
      let diff = targetRot - prevRotRef.current;
      if (diff >  180) diff -= 360;
      if (diff < -180) diff += 360;
      prevRotRef.current  = targetRot;
      cumRotRef.current  += diff;

      phoneX.setValue(x);
      phoneY.setValue(y);
      rotAnim.setValue(cumRotRef.current);

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const rotateStr = rotAnim.interpolate({
    inputRange: [-36000, 36000],
    outputRange: ['-36000deg', '36000deg'],
  });

  const circ             = 2 * Math.PI * 26;
  const strokeDashoffset = circ * (1 - progress / 100);

  return (
    <View style={[cs.overlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.90)' : 'rgba(245,248,247,0.96)' }]}>
      <Text style={[cs.calibTitle, { color: T.text }]}>Kalibrera kompassen</Text>
      <Text style={[cs.calibSub, { color: T.textMuted }]}>
        Rör telefonen långsamt i en ∞-form för bästa noggrannhet
      </Text>

      {/* ∞ path guide + phone icon */}
      <View style={cs.fig8Wrap}>
        <Svg width={CALIB_W} height={CALIB_H} style={StyleSheet.absoluteFill}>
          <Path d={FIG8_PATH}
            fill="none" stroke={T.accent} strokeWidth={1.5}
            strokeDasharray="5 6" opacity={0.3} />
        </Svg>

        {/* Phone icon — centered at (CALIB_CX, CALIB_CY), then offset by translateX/Y */}
        <Animated.View style={[
          cs.phoneDot,
          { transform: [
            { translateX: phoneX },
            { translateY: phoneY },
            { rotate: rotateStr },
          ]},
        ]}>
          <Svg width={PHONE_W} height={PHONE_H} viewBox="0 0 22 38">
            <Rect x={0} y={0} width={22} height={38} rx={4}
              fill={isDark ? '#ffffff' : '#222'} opacity={0.9} />
            <Rect x={3} y={5} width={16} height={24} rx={2}
              fill={T.accent} opacity={0.75} />
            <Circle cx={11} cy={33} r={2.5}
              fill={isDark ? '#ffffff' : '#222'} opacity={0.5} />
          </Svg>
        </Animated.View>
      </View>

      <View style={cs.progressWrap}>
        <Svg width={64} height={64} viewBox="0 0 64 64">
          <Circle cx={32} cy={32} r={26} fill="none" stroke={T.border} strokeWidth={4} />
          <Circle cx={32} cy={32} r={26} fill="none"
            stroke={T.accent} strokeWidth={4} strokeLinecap="round"
            strokeDasharray={`${circ}`} strokeDashoffset={`${strokeDashoffset}`}
            rotation={-90} originX={32} originY={32} />
        </Svg>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Text style={{ flex: 1, textAlign: 'center', textAlignVertical: 'center', fontSize: 13, fontWeight: '600', color: T.text, lineHeight: 64 }}>
            {progress}%
          </Text>
        </View>
      </View>
      <TouchableOpacity onPress={onDismiss} style={[cs.skipBtn, { borderColor: T.border }]}>
        <Text style={{ color: T.textMuted, fontSize: 13, fontWeight: '500' }}>Hoppa över</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Huvudskärm ─────────────────────────────────────────────────────────────────
export default function QiblaScreen() {
  const { theme: T, isDark } = useTheme();

  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [qiblaDeg,       setQiblaDeg]       = useState<number | null>(null);
  const [locationLabel,  setLocationLabel]  = useState('');
  const [compassAlive,   setCompassAlive]   = useState(false);
  const [displayHeading, setDisplayHeading] = useState(0);
  const [aligned,        setAligned]        = useState(false);
  const [showCalib,      setShowCalib]      = useState(true);
  const [calibProgress,  setCalibProgress]  = useState(0);

  const headingRef    = useRef(0);
  const smoothRef     = useRef(0);
  const rafRef        = useRef<number>(0);
  const headingSubRef = useRef<Location.LocationSubscription | null>(null);
  const alignedRef    = useRef(false);

  // ── Hämta plats ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [settingsRaw, locationRaw] = await Promise.all([
          AsyncStorage.getItem('andalus_settings'),
          AsyncStorage.getItem('andalus_location'),
        ]);
        const saved        = settingsRaw ? JSON.parse(settingsRaw) : {};
        const autoLocation = saved.autoLocation ?? true;

        let lat: number, lng: number;
        let city = '', suburb = '', country = '';

        if (!autoLocation && locationRaw) {
          const loc = JSON.parse(locationRaw);
          lat     = loc.lat;
          lng     = loc.lng;
          city    = loc.city    || '';
          country = loc.country || '';
        } else {
          // Check only — never request automatically. User grants via onboarding or Settings.
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status !== 'granted') { setError('Platsåtkomst nekad'); setLoading(false); return; }
          const loc = await Location.getCurrentPositionAsync({});
          lat = loc.coords.latitude;
          lng = loc.coords.longitude;
          const geo = await nativeReverseGeocode(lat, lng);
          city    = geo.city;
          suburb  = geo.subLocality;
          country = geo.country;
        }

        const q = Qibla({ latitude: lat, longitude: lng });
        setQiblaDeg(q);
        setLocationLabel([suburb, city, country].filter(Boolean).join(', '));
      } catch { setError('Kunde inte hämta plats'); }
      setLoading(false);
    })();
  }, []);

  // ── Location heading (iOS Core Location — tiltkorrigerad) ──────────────────
  // useFocusEffect: starts the magnetometer only when this tab is visible and
  // stops it (+ clears the compass-alive indicator) when the user navigates
  // away. Using plain useEffect left the sensor running on every other tab.
  //
  // ── Async-cleanup race (fixed 2026-04-30) ──
  // watchHeadingAsync is async. If the user leaves the tab WHILE the await is
  // still pending, the cleanup runs before headingSubRef has been assigned —
  // the subscription is then installed orphaned and streams forever. Each
  // quick Qibla→other-tab cycle leaks another subscription, which is what
  // caused the progressive slowdown reported after navigating tabs for a few
  // minutes. The fix: keep the subscription in a closure-local var and
  // re-check `active` after the await — if cleanup already ran, remove the
  // just-resolved subscription immediately. A second guard inside the callback
  // discards any events that arrive after blur but before native fully tears
  // the listener down.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      let sub: Location.LocationSubscription | null = null;
      (async () => {
        // Check only — never request automatically.
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted' || !active) return;
        const installed = await Location.watchHeadingAsync((headingData) => {
          // Drop events that arrive after cleanup — protects against state
          // updates on an unfocused screen if native delivers a queued event.
          if (!active) return;
          const raw = headingData.trueHeading >= 0
            ? headingData.trueHeading : headingData.magHeading;
          headingRef.current = normDeg(raw);
          setCompassAlive(true);
          const acc = headingData.accuracy;
          if (acc >= 0) {
            const p = Math.min(100, Math.round(((acc + 1) / 4) * 100));
            setCalibProgress(p);
            if (p >= 100) setShowCalib(false);
          }
        });
        // Cleanup may have already run while we awaited — if so, remove the
        // newly-installed subscription before it leaks.
        if (!active) {
          installed.remove();
          return;
        }
        sub = installed;
        headingSubRef.current = installed;
      })();
      return () => {
        active = false;
        const s = sub ?? headingSubRef.current;
        s?.remove();
        sub = null;
        headingSubRef.current = null;
        setCompassAlive(false);
      };
    }, []),
  );

  // ── RAF-loop (60fps smooth) ──────────────────────────────────────────────────
  // useFocusEffect: stops the 60 fps loop (and with it, all haptic feedback)
  // when the tab is not focused. Without this, Haptics.notificationAsync fired
  // on every other tab whenever the device happened to face Qibla direction.
  useFocusEffect(
    useCallback(() => {
      let lastTime = 0;
      const loop = (time: number) => {
        if (time - lastTime > 16) {
          lastTime = time;
          smoothRef.current = normDeg(lowPass(smoothRef.current, headingRef.current, 0.12));
          setDisplayHeading(Math.round(smoothRef.current));
          if (qiblaDeg !== null) {
            const diff = normDeg(smoothRef.current - qiblaDeg);
            const isAligned = diff <= QIBLA_ALIGNED_THRESHOLD || diff >= 360 - QIBLA_ALIGNED_THRESHOLD;
            if (isAligned !== alignedRef.current) {
              if (isAligned) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              alignedRef.current = isAligned;
              setAligned(isAligned);
            }
          }
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(rafRef.current);
    }, [qiblaDeg]),
  );

  // ── Memoized SVG elements — only recomputed when theme / aligned changes, never at 60fps ──
  const ticks = useMemo(() => Array.from({ length: 72 }, (_, i) => i * 5).map(d => {
    const is90 = d % 90 === 0;
    const is30 = d % 30 === 0;
    const is10 = d % 10 === 0;
    const tl   = is90 ? 18 : is30 ? 13 : is10 ? 8 : 4;
    const sw   = is90 ? 2.5 : is30 ? 1.5 : 0.8;
    const col  = is90 ? T.text : is30 ? T.textSecondary : T.textMuted;
    const op   = is90 ? 1 : is30 ? 0.6 : 0.25;
    return (
      <Line key={d}
        x1={px(d, TR - 1)} y1={py(d, TR - 1)}
        x2={px(d, TR - tl)} y2={py(d, TR - tl)}
        stroke={col} strokeWidth={sw} opacity={op} />
    );
  }), [T]);

  const degLabels = useMemo(() => Array.from({ length: 12 }, (_, i) => i * 30).map(d => {
    const lx = px(d, OR - 4);
    const ly = py(d, OR - 4);
    return (
      <SvgText key={d}
        x={lx} y={ly + 4.5}
        textAnchor="middle"
        fontSize={d % 90 === 0 ? 13 : 11}
        fontWeight={d % 90 === 0 ? '700' : '400'}
        fill={d % 90 === 0 ? T.text : T.textMuted}
        opacity={d % 90 === 0 ? 1 : 0.6}
        rotation={d}
        origin={`${lx},${ly}`}>
        {d}
      </SvgText>
    );
  }), [T]);

  const cardinalLetters = useMemo(() => (
    [{ l: 'N', d: 0 }, { l: 'Ö', d: 90 }, { l: 'S', d: 180 }, { l: 'V', d: 270 }]
      .map(({ l, d }) => {
        const lx = px(d, TI + 20);
        const ly = py(d, TI + 20);
        return (
          <SvgText key={l}
            x={lx} y={ly + 6}
            textAnchor="middle"
            fontSize={20} fontWeight="800"
            fill={l === 'N' ? (aligned ? GREEN : T.accent) : T.text}
            rotation={d}
            origin={`${lx},${ly}`}>
            {l}
          </SvgText>
        );
      })
  ), [T, aligned]);

  function getInstruction(): string {
    if (qiblaDeg === null) return '';
    const diff = normDeg(qiblaDeg - displayHeading);
    if (diff <= QIBLA_ALIGNED_THRESHOLD || diff >= 360 - QIBLA_ALIGNED_THRESHOLD) return '';
    return diff <= 180
      ? 'Rotera åt höger för att rikta dig mot Qibla.'
      : 'Rotera åt vänster för att rikta dig mot Qibla.';
  }

  if (loading) return (
    <View style={[s.center, { backgroundColor: T.bg }]}>
      <ActivityIndicator size="large" color={T.accent} />
    </View>
  );
  if (error) return (
    <View style={[s.center, { backgroundColor: T.bg }]}>
      <Text style={{ color: T.textMuted, fontSize: 15 }}>{error}</Text>
    </View>
  );

  // ── Kompass-beräkningar ────────────────────────────────────────────────────
  const ringRot    = -normDeg(displayHeading);
  const instruction = getInstruction();

  return (
    <View style={[s.container, { backgroundColor: T.bg }]}>

      {/* ── Kompass SVG ── */}
      <View style={{ width: COMPASS_SIZE, height: COMPASS_SIZE, alignSelf: 'center' }}>
        <Svg width={COMPASS_SIZE} height={COMPASS_SIZE}>
          <Defs>
            <RadialGradient id="centerbg" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={T.card} />
              <Stop offset="100%" stopColor={T.bg} />
            </RadialGradient>
          </Defs>

          {/* Yttre bezel — grön när alignad */}
          <Circle cx={C} cy={C} r={OR}
            fill="none"
            stroke={aligned ? GREEN : T.border}
            strokeWidth={aligned ? 3 : 1.5} />

          {/* ── ROTERANDE RING ── */}
          <G rotation={ringRot} originX={C} originY={C}>
            {/* Ringfyllning */}
            <Circle cx={C} cy={C} r={TR} fill={T.bgSecondary} />
            <Circle cx={C} cy={C} r={TI} fill={T.bg} />

            {/* Streck */}
            {ticks}

            {/* Gradsiffror utanför ringen */}
            {degLabels}

            {/* N / Ö / S / V */}
            {cardinalLetters}

            {/* Qibla-linje på ringen */}
            {qiblaDeg !== null && (
              <Line
                x1={px(qiblaDeg, TR - 1)} y1={py(qiblaDeg, TR - 1)}
                x2={px(qiblaDeg, TI + 4)}  y2={py(qiblaDeg, TI + 4)}
                stroke={aligned ? GREEN : T.accent}
                strokeWidth={3} strokeLinecap="round" />
            )}
          </G>
          {/* ── END ROTERANDE RING ── */}

          {/* Centercirkel */}
          <Circle cx={C} cy={C} r={CR}
            fill="url(#centerbg)"
            stroke={T.border} strokeWidth={1} />

          {/* Kaaba — renderas ovanpå centercirkeln så hela ikonen syns */}
          {qiblaDeg !== null && (() => {
            const screenAngle = qiblaDeg + ringRot;
            const kx = px(screenAngle, TI - 2);
            const ky = py(screenAngle, TI - 2);
            return (
              <SvgText x={kx} y={ky + 9}
                textAnchor="middle" fontSize={28}>🕋</SvgText>
            );
          })()}


          {/* ── RED ARROW NEEDLE (red-arrow.svg, static — does not rotate) ── */}
          {/* transform: move SVG pivot to compass centre, then scale */}
          <G transform={`translate(${C}, ${C}) scale(${ARROW_SCALE}) translate(${-ARROW_PIVOT_X}, ${-ARROW_PIVOT_Y})`}>
            {/* Right half — dark red shadow */}
            <Polygon
              points="258.14,256.93 490.94,326.74 258.14,22.09"
              fill={aligned ? GREEN : '#af1917'} />
            {/* Left half — bright red */}
            <Polygon
              points="258.14,256.93 25.33,326.74 258.14,22.09"
              fill={aligned ? GREEN : '#e52a1e'} />
          </G>


          {/* Extra grön ring när alignad */}
          {aligned && (
            <Circle cx={C} cy={C} r={OR + 1}
              fill="none" stroke={GREEN} strokeWidth={4} opacity={0.5} />
          )}
        </Svg>
      </View>

      {/* ── Stor heading + kardinal ── */}
      <View style={{ alignItems: 'center', marginTop: 20 }}>
        <Text style={{ fontSize: 56, fontWeight: '900', color: aligned ? GREEN : T.text, lineHeight: 60 }}>
          {displayHeading}° {getCardinalLabel(displayHeading)}
        </Text>
        {qiblaDeg !== null && (
          <Text style={{ fontSize: 14, color: T.textMuted, marginTop: 6 }}>
            Qiblas riktning är{' '}
            <Text style={{ fontWeight: '700', color: T.text }}>{Math.round(qiblaDeg)}°</Text>
          </Text>
        )}
        <View style={{ minHeight: 28, marginTop: 10, alignItems: 'center', paddingHorizontal: 24 }}>
          {aligned ? (
            <Text style={{ fontSize: 17, fontWeight: '700', color: GREEN, textAlign: 'center' }}>
              Du är vänd mot rätt håll.
            </Text>
          ) : instruction ? (
            <Text style={{ fontSize: 15, fontWeight: '500', color: T.textMuted, textAlign: 'center' }}>
              {instruction}
            </Text>
          ) : null}
        </View>
      </View>

      {/* ── Plats + live-status ── */}
      <View style={{ alignItems: 'center', marginTop: 14, gap: 4 }}>
        {locationLabel ? (
          <Text style={{ fontSize: 13, color: T.textMuted, opacity: 0.6 }}>
            🌙 {locationLabel}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4,
            backgroundColor: compassAlive ? '#4CAF82' : '#888' }} />
          <Text style={{ fontSize: 12, color: T.textMuted }}>
            {compassAlive ? 'Live-kompass aktiv' : 'Startar kompass...'}
          </Text>
        </View>
      </View>

      {/* ── Kalibreringsoverlay ── */}
      {showCalib && compassAlive && (
        <CalibrationOverlay
          progress={calibProgress}
          onDismiss={() => setShowCalib(false)}
          T={T}
          isDark={isDark}
        />
      )}

    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingBottom: 100, justifyContent: 'center' },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

const cs = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 999, paddingHorizontal: 24,
  },
  calibTitle: { fontSize: 18, fontWeight: '600', textAlign: 'center', marginBottom: 6 },
  calibSub:   {
    fontSize: 13, fontWeight: '400', textAlign: 'center',
    lineHeight: 20, maxWidth: 240, marginBottom: 36,
  },
  // Container matches CALIB_W × CALIB_H; phone starts centered at (CALIB_CX, CALIB_CY)
  fig8Wrap: { width: CALIB_W, height: CALIB_H, marginBottom: 36, alignItems: 'center', justifyContent: 'center' },
  phoneDot: { position: 'absolute', left: CALIB_CX - PHONE_W / 2, top: CALIB_CY - PHONE_H / 2 },
  progressWrap:{ marginBottom: 24 },
  skipBtn:     { borderWidth: 1, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 10 },
});
