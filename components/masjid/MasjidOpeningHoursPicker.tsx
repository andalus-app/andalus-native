/**
 * MasjidOpeningHoursPicker — modal dialog with two iOS-style wheel pickers
 * (Från / Till), each split into HH (00–23) and MM (00–59). Confirms with
 * a single "HH:MM–HH:MM" string (en dash, Swedish convention).
 *
 * Built on FlatList + snapToInterval so we don't pull in a picker dependency
 * (none is installed). The wheel is internally uncontrolled — it snaps on
 * momentum end and reports the new value to the parent.
 *
 * Isolation: rendered only while `visible` is true. State is (re)seeded from
 * `initialValue` on every open so reopening always reflects the latest saved
 * string. No timers, no listeners.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, FlatList,
  StyleSheet, type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { masjidLabelColor } from './colors';

const HOURS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

const ITEM_HEIGHT = 40;
const VISIBLE     = 5;            // odd → there's a true center row
const PAD         = ITEM_HEIGHT * Math.floor(VISIBLE / 2);
const WHEEL_H     = ITEM_HEIGHT * VISIBLE;

const DEFAULT_FROM_H = '05';
const DEFAULT_FROM_M = '00';
const DEFAULT_TO_H   = '23';
const DEFAULT_TO_M   = '00';

/** Sentinel value stored when the masjid is open 24/7. Rendered as-is in the
 *  card ("Mån–Sön: Dygnet runt") and on the form row. */
export const ALL_DAY_VALUE = 'Dygnet runt';

/**
 * Parse a stored "HH:MM–HH:MM" (or "HH:MM-HH:MM") string back into the four
 * picker positions. Falls back to a sensible default (05:00–23:00) for any
 * unrecognised / empty input so the picker always opens on something
 * meaningful instead of a blank state.
 */
function parseHours(s: string | undefined | null): {
  fromH: string; fromM: string; toH: string; toM: string;
} {
  const def = { fromH: DEFAULT_FROM_H, fromM: DEFAULT_FROM_M, toH: DEFAULT_TO_H, toM: DEFAULT_TO_M };
  if (!s) return def;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})$/);
  if (!m) return def;
  const clampH = (n: number) => Math.max(0, Math.min(23, n));
  const clampM = (n: number) => Math.max(0, Math.min(59, n));
  return {
    fromH: String(clampH(parseInt(m[1], 10))).padStart(2, '0'),
    fromM: String(clampM(parseInt(m[2], 10))).padStart(2, '0'),
    toH:   String(clampH(parseInt(m[3], 10))).padStart(2, '0'),
    toM:   String(clampM(parseInt(m[4], 10))).padStart(2, '0'),
  };
}

function Wheel({
  values, value, onChange, T,
}: {
  values: string[]; value: string; onChange: (v: string) => void; T: ReturnType<typeof useTheme>['theme'];
}) {
  const ref = useRef<FlatList<string>>(null);
  // Track the value we ourselves last reported so we don't programmatically
  // re-scroll the wheel in response to our own onChange and start a feedback
  // loop with the snap.
  const lastReported = useRef(value);
  const idx = Math.max(0, values.indexOf(value));

  useEffect(() => {
    if (lastReported.current === value) return;
    lastReported.current = value;
    try { ref.current?.scrollToIndex({ index: idx, animated: false }); } catch { /* list not laid out yet */ }
  }, [value, idx]);

  const handleMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(values.length - 1, i));
    const next = values[clamped];
    if (next !== lastReported.current) {
      lastReported.current = next;
      onChange(next);
    }
  }, [values, onChange]);

  return (
    <View style={[styles.wheelBox, { borderColor: T.separator }]}>
      <FlatList
        ref={ref}
        data={values}
        keyExtractor={(item) => item}
        renderItem={({ item }) => (
          <View style={styles.wheelItem}>
            <Text style={[styles.wheelText, { color: T.text }]}>{item}</Text>
          </View>
        )}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        initialScrollIndex={idx}
        getItemLayout={(_, i) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * i, index: i })}
        contentContainerStyle={{ paddingVertical: PAD }}
        onMomentumScrollEnd={handleMomentumEnd}
        // Recover if initialScrollIndex couldn't land (e.g. very fast first paint)
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            try { ref.current?.scrollToIndex({ index: info.index, animated: false }); } catch { /* noop */ }
          }, 50);
        }}
      />
      {/* Center band marks the selected row. pointerEvents='none' so scrolling
          still works through the band. */}
      <View
        pointerEvents="none"
        style={[styles.centerBand, { borderColor: T.separator, backgroundColor: T.accentGlow }]}
      />
    </View>
  );
}

export default function MasjidOpeningHoursPicker({
  visible, initialValue, onCancel, onConfirm,
}: {
  visible: boolean;
  initialValue: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const { theme: T } = useTheme();

  // Re-seed every time the modal opens so the wheels reflect the latest saved
  // value (and the user's mid-edit state doesn't leak across closes).
  const parsed = useMemo(() => parseHours(initialValue), [initialValue, visible]);
  const [fromH, setFromH] = useState(parsed.fromH);
  const [fromM, setFromM] = useState(parsed.fromM);
  const [toH,   setToH]   = useState(parsed.toH);
  const [toM,   setToM]   = useState(parsed.toM);
  // "Öppet dygnet runt" — when on, the wheels are dimmed and confirm stores the
  // ALL_DAY_VALUE sentinel instead of a time range.
  const [allDay, setAllDay] = useState(
    (initialValue ?? '').trim().toLowerCase() === ALL_DAY_VALUE.toLowerCase(),
  );

  useEffect(() => {
    if (!visible) return;
    const p = parseHours(initialValue);
    setFromH(p.fromH); setFromM(p.fromM); setToH(p.toH); setToM(p.toM);
    setAllDay((initialValue ?? '').trim().toLowerCase() === ALL_DAY_VALUE.toLowerCase());
  }, [visible, initialValue]);

  const confirm = useCallback(() => {
    onConfirm(allDay ? ALL_DAY_VALUE : `${fromH}:${fromM}–${toH}:${toM}`);
  }, [allDay, fromH, fromM, toH, toM, onConfirm]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.dialog, { backgroundColor: T.bg, borderColor: T.border }]}>
          <Text style={[styles.title, { color: T.text }]}>Öppettider</Text>

          {/* Öppet dygnet runt — toggles off the time range entirely. */}
          <TouchableOpacity
            style={[
              styles.allDayBtn,
              { borderColor: allDay ? T.accent : T.border, backgroundColor: allDay ? T.accentGlow : 'transparent' },
            ]}
            onPress={() => setAllDay(v => !v)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={allDay ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={allDay ? T.accent : masjidLabelColor(T)}
            />
            <Text style={[styles.allDayText, { color: allDay ? T.accent : T.text }]}>Öppet dygnet runt</Text>
          </TouchableOpacity>

          <View style={[styles.row, allDay && { opacity: 0.35 }]} pointerEvents={allDay ? 'none' : 'auto'}>
            <View style={styles.col}>
              <Text style={[styles.colLabel, { color: masjidLabelColor(T) }]}>Från</Text>
              <View style={styles.wheelPair}>
                <Wheel values={HOURS}   value={fromH} onChange={setFromH} T={T} />
                <Text style={[styles.colon, { color: T.text }]}>:</Text>
                <Wheel values={MINUTES} value={fromM} onChange={setFromM} T={T} />
              </View>
            </View>

            <View style={styles.col}>
              <Text style={[styles.colLabel, { color: masjidLabelColor(T) }]}>Till</Text>
              <View style={styles.wheelPair}>
                <Wheel values={HOURS}   value={toH} onChange={setToH} T={T} />
                <Text style={[styles.colon, { color: T.text }]}>:</Text>
                <Wheel values={MINUTES} value={toM} onChange={setToM} T={T} />
              </View>
            </View>
          </View>

          <View style={[styles.buttons, { borderTopColor: T.separator }]}>
            <TouchableOpacity style={styles.btn} onPress={onCancel} activeOpacity={0.7}>
              <Text style={[styles.btnText, { color: masjidLabelColor(T) }]}>Avbryt</Text>
            </TouchableOpacity>
            <View style={[styles.btnDivider, { backgroundColor: T.separator }]} />
            <TouchableOpacity style={styles.btn} onPress={confirm} activeOpacity={0.7}>
              <Text style={[styles.btnText, { color: T.accent, fontWeight: '700' }]}>Spara</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24,
  },
  dialog: {
    width: '100%', maxWidth: 380,
    borderRadius: 20, borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 18,
    overflow: 'hidden',
  },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 14 },
  allDayBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 16,
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 12,
  },
  allDayText: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 12, paddingBottom: 18 },
  col: { alignItems: 'center' },
  colLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  wheelPair: { flexDirection: 'row', alignItems: 'center' },
  colon: { fontSize: 22, fontWeight: '700', paddingHorizontal: 4 },
  wheelBox: {
    width: 56, height: WHEEL_H,
    overflow: 'hidden',
    borderRadius: 10,
  },
  wheelItem: {
    height: ITEM_HEIGHT,
    alignItems: 'center', justifyContent: 'center',
  },
  wheelText: { fontSize: 20, fontWeight: '500' },
  centerBand: {
    position: 'absolute',
    top: PAD, left: 0, right: 0, height: ITEM_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
  },
  buttons: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  btn: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  btnDivider: { width: StyleSheet.hairlineWidth },
  btnText: { fontSize: 16 },
});
