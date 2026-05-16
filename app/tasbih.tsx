import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Modal, Dimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import BackButton from '../components/BackButton';

const SCREEN_W = Dimensions.get('window').width;
const COUNTER_SIZE = Math.min(220, Math.round(SCREEN_W * 0.58));

const TASBIH_AFTER_PRAYER_SEQUENCE = [
  { id: 'subhanallah', label: 'SubhanAllah', target: 33 },
  { id: 'alhamdulillah', label: 'Alhamdulillah', target: 33 },
  { id: 'allahu_akbar', label: 'Allahu Akbar', target: 33 },
] as const;

const TASBIH_DHIKR_OPTIONS = [
  { id: 'subhanallah', label: 'SubhanAllah' },
  { id: 'alhamdulillah', label: 'Alhamdulillah' },
  { id: 'allahu_akbar', label: 'Allahu Akbar' },
  { id: 'la_ilaha_illa_allah', label: 'La ilaha illa Allah' },
  { id: 'astaghfirullah', label: 'Astaghfirullah' },
] as const;

const TASBIH_TARGETS = [33, 99, 100] as const;

// ─── Counter Button ───────────────────────────────────────────────────────────
function CounterButton({
  count, target, onPress, label, disabled, T, isDark,
}: {
  count: number; target: number; onPress: () => void;
  label?: string; disabled?: boolean; T: any; isDark: boolean;
}) {
  const pct = Math.min(count / target, 1);
  const size = COUNTER_SIZE;
  const strokeW = 5;
  const r = (size / 2) - strokeW;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;

  return (
    <TouchableOpacity
      accessibilityLabel="Öka tasbih-räknaren"
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.82}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
        borderWidth: 2,
        borderColor: disabled ? (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)') : T.accent,
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {/* Progress ring */}
      <Svg
        width={size}
        height={size}
        style={{ position: 'absolute' }}
      >
        {/* Track */}
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}
          strokeWidth={strokeW}
          fill="none"
        />
        {/* Progress */}
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={T.accent}
          strokeWidth={strokeW}
          fill="none"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(-90, ${size / 2}, ${size / 2})`}
          opacity={pct > 0 ? 1 : 0}
        />
      </Svg>

      {label ? (
        <Text style={{
          fontSize: 18,
          fontWeight: '700',
          color: T.accent,
          textAlign: 'center',
          paddingHorizontal: 20,
        }}>
          {label}
        </Text>
      ) : (
        <View style={{ alignItems: 'center' }}>
          <Text style={{
            fontSize: COUNTER_SIZE > 180 ? 68 : 52,
            fontWeight: '700',
            color: T.text,
            fontVariant: ['tabular-nums'],
            lineHeight: COUNTER_SIZE > 180 ? 76 : 58,
          }}>
            {count}
          </Text>
          <Text style={{
            fontSize: 15,
            fontWeight: '500',
            color: T.textMuted,
            marginTop: 2,
          }}>
            av {target}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Thin action button ───────────────────────────────────────────────────────
function ActionButton({
  label, onPress, accent, T, isDark,
}: {
  label: string; onPress: () => void; accent?: boolean; T: any; isDark: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={{
        paddingVertical: 11,
        paddingHorizontal: 20,
        borderRadius: 12,
        backgroundColor: accent
          ? (isDark ? 'rgba(36,100,93,0.25)' : 'rgba(36,100,93,0.12)')
          : (isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'),
        borderWidth: 1,
        borderColor: accent ? T.accent : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'),
      }}
    >
      <Text style={{
        fontSize: 14,
        fontWeight: '600',
        color: accent ? T.accent : T.textMuted,
        textAlign: 'center',
      }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── After Prayer View ────────────────────────────────────────────────────────
function AfterPrayerView({
  T, isDark,
  sequenceIndex, sequenceCount, isSequenceComplete, totalCount,
  onCount, onReset,
}: {
  T: any; isDark: boolean;
  sequenceIndex: number; sequenceCount: number;
  isSequenceComplete: boolean; totalCount: number;
  onCount: () => void; onReset: () => void;
}) {
  const current = TASBIH_AFTER_PRAYER_SEQUENCE[sequenceIndex];
  const cardBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';

  return (
    <View style={{ alignItems: 'center', width: '100%', gap: 20 }}>
      {/* Dhikr info card */}
      <View style={{
        width: '100%',
        backgroundColor: cardBg,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: cardBorder,
        paddingVertical: 16,
        paddingHorizontal: 20,
        alignItems: 'center',
        gap: 4,
      }}>
        <Text style={{
          fontSize: 22,
          fontWeight: '800',
          color: isSequenceComplete ? T.accent : T.text,
          letterSpacing: -0.3,
          textAlign: 'center',
        }}>
          {isSequenceComplete ? 'Sekvens klar' : current.label}
        </Text>
        {!isSequenceComplete && (
          <Text style={{ fontSize: 13, fontWeight: '500', color: T.textMuted }}>
            Steg {sequenceIndex + 1} av {TASBIH_AFTER_PRAYER_SEQUENCE.length}
          </Text>
        )}
        {/* Sequence steps dots */}
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
          {TASBIH_AFTER_PRAYER_SEQUENCE.map((s, i) => {
            const done = isSequenceComplete || i < sequenceIndex;
            const active = !isSequenceComplete && i === sequenceIndex;
            return (
              <View
                key={s.id}
                style={{
                  width: done || active ? 20 : 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: done
                    ? T.accent
                    : active
                    ? T.accent
                    : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'),
                  opacity: done ? 1 : active ? 1 : 0.5,
                }}
              />
            );
          })}
        </View>
      </View>

      {/* Counter button */}
      <CounterButton
        count={isSequenceComplete ? current.target : sequenceCount}
        target={current.target}
        onPress={onCount}
        label={isSequenceComplete ? undefined : undefined}
        disabled={isSequenceComplete}
        T={T}
        isDark={isDark}
      />

      {/* Total progress */}
      <View style={{ width: '100%', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: T.textMuted }}>
          Totalt: {totalCount} av 99
        </Text>
        {/* Progress bar */}
        <View style={{
          width: '100%',
          height: 4,
          borderRadius: 2,
          backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        }}>
          <View style={{
            height: '100%',
            borderRadius: 2,
            backgroundColor: T.accent,
            width: `${(totalCount / 99) * 100}%` as any,
          }} />
        </View>
      </View>

      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
        {isSequenceComplete && (
          <ActionButton
            label="Börja om"
            onPress={onReset}
            accent
            T={T}
            isDark={isDark}
          />
        )}
        <TouchableOpacity
          accessibilityLabel="Nollställ räknaren"
          onPress={onReset}
          activeOpacity={0.75}
          style={{
            paddingVertical: 11,
            paddingHorizontal: 20,
            borderRadius: 12,
            backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
            borderWidth: 1,
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: T.textMuted }}>
            Nollställ
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Single Mode View ─────────────────────────────────────────────────────────
function SingleView({
  T, isDark,
  dhikr, target, count, isTargetReached,
  onCount, onReset, onSelectDhikr, onSelectTarget,
}: {
  T: any; isDark: boolean;
  dhikr: typeof TASBIH_DHIKR_OPTIONS[number];
  target: number; count: number; isTargetReached: boolean;
  onCount: () => void; onReset: () => void;
  onSelectDhikr: () => void; onSelectTarget: () => void;
}) {
  const cardBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';

  return (
    <View style={{ alignItems: 'center', width: '100%', gap: 20 }}>
      {/* Dhikr info card */}
      <View style={{
        width: '100%',
        backgroundColor: cardBg,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: cardBorder,
        paddingVertical: 16,
        paddingHorizontal: 20,
        alignItems: 'center',
        gap: 4,
      }}>
        <Text style={{
          fontSize: 22,
          fontWeight: '800',
          color: T.text,
          letterSpacing: -0.3,
          textAlign: 'center',
        }}>
          {dhikr.label}
        </Text>
        <Text style={{ fontSize: 13, fontWeight: '500', color: T.textMuted }}>
          Mål: {target}
        </Text>
        {isTargetReached && (
          <View style={{
            marginTop: 6,
            paddingHorizontal: 12,
            paddingVertical: 4,
            borderRadius: 20,
            backgroundColor: isDark ? 'rgba(36,100,93,0.25)' : 'rgba(36,100,93,0.12)',
            borderWidth: 1,
            borderColor: T.accent,
          }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: T.accent }}>
              Mål uppnått
            </Text>
          </View>
        )}
      </View>

      {/* Counter button */}
      <CounterButton
        count={count}
        target={target}
        onPress={onCount}
        T={T}
        isDark={isDark}
      />

      {/* Progress bar */}
      <View style={{ width: '100%', alignItems: 'center', gap: 8 }}>
        <View style={{
          width: '100%',
          height: 4,
          borderRadius: 2,
          backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        }}>
          <View style={{
            height: '100%',
            borderRadius: 2,
            backgroundColor: T.accent,
            width: `${Math.min((count / target) * 100, 100)}%` as any,
          }} />
        </View>
      </View>

      {/* Action buttons */}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
        <ActionButton
          label="Byt dhikr"
          onPress={onSelectDhikr}
          T={T}
          isDark={isDark}
        />
        <ActionButton
          label="Byt mål"
          onPress={onSelectTarget}
          T={T}
          isDark={isDark}
        />
        <TouchableOpacity
          accessibilityLabel="Nollställ räknaren"
          onPress={onReset}
          activeOpacity={0.75}
          style={{
            paddingVertical: 11,
            paddingHorizontal: 20,
            borderRadius: 12,
            backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
            borderWidth: 1,
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: T.textMuted }}>
            Nollställ
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function TasbihScreen() {
  const { theme: T, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [mode, setMode] = useState<'afterPrayer' | 'single'>('afterPrayer');

  // After prayer mode state
  const [sequenceIndex, setSequenceIndex] = useState(0);
  const [sequenceCount, setSequenceCount] = useState(0);
  const [isSequenceComplete, setIsSequenceComplete] = useState(false);

  // Simple mode state
  const [singleDhikrIdx, setSingleDhikrIdx] = useState(0);
  const [singleTarget, setSingleTarget] = useState<typeof TASBIH_TARGETS[number]>(33);
  const [singleCount, setSingleCount] = useState(0);
  const [isTargetReached, setIsTargetReached] = useState(false);

  // Pickers
  const [showDhikrPicker, setShowDhikrPicker] = useState(false);
  const [showTargetPicker, setShowTargetPicker] = useState(false);

  const totalAfterPrayer = useMemo(() => {
    if (isSequenceComplete) return 99;
    return sequenceIndex * 33 + sequenceCount;
  }, [isSequenceComplete, sequenceIndex, sequenceCount]);

  const handleAfterPrayerCount = useCallback(() => {
    if (isSequenceComplete) return;
    const current = TASBIH_AFTER_PRAYER_SEQUENCE[sequenceIndex];
    const newCount = sequenceCount + 1;
    if (newCount >= current.target) {
      if (sequenceIndex >= TASBIH_AFTER_PRAYER_SEQUENCE.length - 1) {
        setIsSequenceComplete(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setSequenceIndex(prev => prev + 1);
        setSequenceCount(0);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } else {
      setSequenceCount(newCount);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [isSequenceComplete, sequenceCount, sequenceIndex]);

  const handleSingleCount = useCallback(() => {
    const newCount = singleCount + 1;
    setSingleCount(newCount);
    if (newCount >= singleTarget && !isTargetReached) {
      setIsTargetReached(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [singleCount, singleTarget, isTargetReached]);

  const resetAfterPrayer = useCallback(() => {
    Haptics.selectionAsync();
    setSequenceIndex(0);
    setSequenceCount(0);
    setIsSequenceComplete(false);
  }, []);

  const resetSingle = useCallback(() => {
    Haptics.selectionAsync();
    setSingleCount(0);
    setIsTargetReached(false);
  }, []);

  const segmentBg = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
  const segmentActiveBg = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.95)';

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* ── Header ── */}
      <View style={{
        paddingTop: insets.top,
        borderBottomWidth: 1,
        borderBottomColor: T.border,
        backgroundColor: T.bg,
      }}>
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 14,
          paddingTop: 10,
          paddingBottom: 10,
        }}>
          <BackButton onPress={() => router.back()} />
          <View>
            <Text style={{ fontSize: 19, fontWeight: '800', color: T.text, letterSpacing: -0.3 }}>
              Tasbih
            </Text>
            <Text style={{ fontSize: 11, fontWeight: '500', color: T.textMuted, marginTop: 1 }}>
              Räkna dina dhikr
            </Text>
          </View>
        </View>
      </View>

      {/* ── Body ── */}
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + 100,
          paddingHorizontal: 16,
          paddingTop: 20,
          alignItems: 'center',
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Mode segment */}
        <View
          accessibilityLabel="Välj tasbih-läge"
          style={{
            flexDirection: 'row',
            backgroundColor: segmentBg,
            borderRadius: 12,
            padding: 3,
            width: '100%',
            marginBottom: 28,
          }}
        >
          {(['afterPrayer', 'single'] as const).map(m => {
            const isActive = mode === m;
            return (
              <TouchableOpacity
                key={m}
                onPress={() => {
                  Haptics.selectionAsync();
                  setMode(m);
                }}
                style={{
                  flex: 1,
                  paddingVertical: 9,
                  borderRadius: 9,
                  backgroundColor: isActive ? segmentActiveBg : 'transparent',
                  alignItems: 'center',
                  shadowColor: '#000',
                  shadowOpacity: isActive ? 0.1 : 0,
                  shadowOffset: { width: 0, height: 1 },
                  shadowRadius: 2,
                  elevation: isActive ? 2 : 0,
                }}
              >
                <Text style={{
                  fontSize: 14,
                  fontWeight: isActive ? '700' : '500',
                  color: isActive ? T.accent : T.textMuted,
                }}>
                  {m === 'afterPrayer' ? 'Efter bön' : 'Enkel'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {mode === 'afterPrayer' ? (
          <AfterPrayerView
            T={T}
            isDark={isDark}
            sequenceIndex={sequenceIndex}
            sequenceCount={sequenceCount}
            isSequenceComplete={isSequenceComplete}
            totalCount={totalAfterPrayer}
            onCount={handleAfterPrayerCount}
            onReset={resetAfterPrayer}
          />
        ) : (
          <SingleView
            T={T}
            isDark={isDark}
            dhikr={TASBIH_DHIKR_OPTIONS[singleDhikrIdx]}
            target={singleTarget}
            count={singleCount}
            isTargetReached={isTargetReached}
            onCount={handleSingleCount}
            onReset={resetSingle}
            onSelectDhikr={() => setShowDhikrPicker(true)}
            onSelectTarget={() => setShowTargetPicker(true)}
          />
        )}
      </ScrollView>

      {/* ── Dhikr Picker Modal ── */}
      <Modal
        visible={showDhikrPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDhikrPicker(false)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.48)', justifyContent: 'flex-end' }}
          activeOpacity={1}
          onPress={() => setShowDhikrPicker(false)}
        >
          <TouchableOpacity activeOpacity={1}>
            <View style={{
              backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7',
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              paddingBottom: insets.bottom + 12,
              paddingTop: 12,
            }}>
              <View style={{
                width: 36, height: 4, borderRadius: 2,
                backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)',
                alignSelf: 'center', marginBottom: 16,
              }} />
              <Text style={{
                textAlign: 'center', fontSize: 16, fontWeight: '700',
                color: T.text, marginBottom: 8,
              }}>
                Välj dhikr
              </Text>
              {TASBIH_DHIKR_OPTIONS.map((opt, idx) => (
                <TouchableOpacity
                  key={opt.id}
                  accessibilityLabel={`Välj dhikr ${opt.label}`}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSingleDhikrIdx(idx);
                    setSingleCount(0);
                    setIsTargetReached(false);
                    setShowDhikrPicker(false);
                  }}
                  style={{
                    paddingVertical: 16, paddingHorizontal: 20,
                    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                    borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: T.border,
                  }}
                >
                  <Text style={{ fontSize: 17, color: T.text }}>{opt.label}</Text>
                  {singleDhikrIdx === idx && (
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M20 6L9 17l-5-5"
                        stroke={T.accent}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Target Picker Modal ── */}
      <Modal
        visible={showTargetPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTargetPicker(false)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.48)', justifyContent: 'flex-end' }}
          activeOpacity={1}
          onPress={() => setShowTargetPicker(false)}
        >
          <TouchableOpacity activeOpacity={1}>
            <View style={{
              backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7',
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              paddingBottom: insets.bottom + 12,
              paddingTop: 12,
            }}>
              <View style={{
                width: 36, height: 4, borderRadius: 2,
                backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)',
                alignSelf: 'center', marginBottom: 16,
              }} />
              <Text style={{
                textAlign: 'center', fontSize: 16, fontWeight: '700',
                color: T.text, marginBottom: 8,
              }}>
                Välj mål
              </Text>
              {TASBIH_TARGETS.map((target, idx) => (
                <TouchableOpacity
                  key={target}
                  accessibilityLabel={`Välj mål ${target}`}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSingleTarget(target);
                    setSingleCount(0);
                    setIsTargetReached(false);
                    setShowTargetPicker(false);
                  }}
                  style={{
                    paddingVertical: 16, paddingHorizontal: 20,
                    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                    borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: T.border,
                  }}
                >
                  <Text style={{ fontSize: 17, color: T.text }}>{target}</Text>
                  {singleTarget === target && (
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M20 6L9 17l-5-5"
                        stroke={T.accent}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
