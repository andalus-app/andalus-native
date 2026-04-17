/**
 * Quiz screen — V2
 *
 * Data contract:
 * - Difficulty selection is shown ONLY for categories where the JSON questions
 *   carry a `difficulty` field with more than one distinct value.
 *   In the current dataset that is exclusively "Profeter i islam".
 * - All other categories use all their questions with no difficulty filter.
 * - No option is ever shown that leads to 0 questions.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useRouter, Stack } from 'expo-router';
import QuizCategoryGrid from '../components/QuizCategoryGrid';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import BackButton from '../components/BackButton';
import {
  getPlayableCategories,
  getAvailableCount,
  buildQuizSession,
  calculateSummary,
  loadQuizStats,
  saveQuizSummary,
  shuffleArray,
  type QuizDifficulty,
  type QuizPlayableCategory,
  type QuizSessionConfig,
  type QuizSessionQuestion,
  type QuizAnswerResult,
  type QuizSummary,
  type QuizStoredStats,
} from '../data/quizData';

// ── Constants ─────────────────────────────────────────────────────────────────

const PLAYABLE_CATEGORIES: QuizPlayableCategory[] = getPlayableCategories();

const TIME_OPTIONS: { label: string; value: number }[] = [
  { label: '10s', value: 10 },
  { label: '20s', value: 20 },
  { label: '30s', value: 30 },
  { label: '60s', value: 60 },
  { label: '∞',   value: 0  },
];

const DIFF_COLOR: Record<QuizDifficulty, string> = {
  'Lätt':  '#34C759',
  'Medel': '#FF9F0A',
  'Svår':  '#FF3B30',
};

// ── Types ─────────────────────────────────────────────────────────────────────

type QuizView = 'start' | 'config' | 'playing' | 'results';

interface QuizConfig {
  categoryId:   string;
  difficulty?:  QuizDifficulty;
  limit:        number;
  timeLimitSec: number;
}

interface PlayState {
  questions:    QuizSessionQuestion[];
  answers:      QuizAnswerResult[];
  streak:       number;
  maxStreak:    number;
  questionStart: number; // Date.now() when current question began
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function maxAvailableCount(cfg: QuizConfig): number {
  const cat = PLAYABLE_CATEGORIES.find(c => c.id === cfg.categoryId);
  if (!cat) return 0;
  return getAvailableCount(cfg.categoryId, cat.hasDifficultyLevels ? cfg.difficulty : undefined);
}

// ── Small shared components ───────────────────────────────────────────────────

function SectionLabel({ label, T }: { label: string; T: any }) {
  return (
    <Text style={{
      fontSize: 11, fontWeight: '700', color: T.textMuted,
      textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
    }}>
      {label}
    </Text>
  );
}

function PillButton({
  label, active, disabled, onPress, T, isDark, accentColor,
}: {
  label:        string;
  active:       boolean;
  disabled?:    boolean;
  onPress:      () => void;
  T:            any;
  isDark:       boolean;
  accentColor?: string;
}) {
  const bg = active
    ? (accentColor ?? T.accent)
    : (isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)');
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={disabled ? 1 : 0.75}
      style={{
        paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
        backgroundColor: bg,
        borderWidth: 0.5,
        borderColor: active ? 'transparent' : T.border,
        opacity: disabled ? 0.3 : 1,
      }}
    >
      <Text style={{
        fontSize: 13, fontWeight: '700',
        color: active ? '#fff' : T.textMuted,
      }}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── StartView ─────────────────────────────────────────────────────────────────

function StartView({
  onStart, stats, T, isDark, insets,
}: {
  onStart: () => void;
  stats:   QuizStoredStats;
  T:       any;
  isDark:  boolean;
  insets:  any;
}) {
  const router   = useRouter();
  const hasStats = stats.totalCompletedRuns > 0;

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <View style={{
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 12,
        borderBottomWidth: 0.5, borderBottomColor: T.border,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <BackButton onPress={() => router.back()} />
          <View>
            <Text style={{ fontSize: 19, fontWeight: '800', color: T.text, letterSpacing: -0.3 }}>
              Testa din kunskap
            </Text>
            <Text style={{ fontSize: 11, fontWeight: '500', color: T.textMuted, marginTop: 1 }}>
              Islamisk kunskapsquiz
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center', marginTop: 16, marginBottom: 36 }}>
          <View style={{
            width: 90, height: 90, borderRadius: 45,
            backgroundColor: isDark ? 'rgba(36,100,93,0.18)' : 'rgba(36,100,93,0.1)',
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: isDark ? 'rgba(36,100,93,0.35)' : 'rgba(36,100,93,0.2)',
          }}>
            <Svg width={44} height={44} viewBox="0 0 24 24" fill="none">
              <Circle cx="12" cy="12" r="9.5" stroke={T.accent} strokeWidth="1.4"/>
              <Path d="M9.5 9.5C9.5 8.12 10.62 7 12 7c1.38 0 2.5 1.12 2.5 2.5 0 1-.56 1.87-1.4 2.34C12.42 12.18 12 12.79 12 13.5V14"
                stroke={T.accent} strokeWidth="1.4" strokeLinecap="round"/>
              <Circle cx="12" cy="16.5" r="0.8" fill={T.accent}/>
            </Svg>
          </View>
          <Text style={{
            fontSize: 26, fontWeight: '800', color: T.text,
            marginTop: 20, letterSpacing: -0.5, textAlign: 'center',
          }}>
            Testa din{'\n'}islamiska kunskap
          </Text>
          <Text style={{
            fontSize: 14, color: T.textMuted, marginTop: 8,
            textAlign: 'center', lineHeight: 21,
          }}>
            Välj kategori och antal frågor{'\n'}för att börja
          </Text>
        </View>

        {hasStats && (
          <View style={[styles.card, {
            backgroundColor: T.card, borderColor: T.border,
            flexDirection: 'row', marginBottom: 28,
          }]}>
            <StatCell label="Omgångar" value={String(stats.totalCompletedRuns)} T={T} />
            <View style={{ width: 0.5, backgroundColor: T.border }} />
            <StatCell label="Bästa resultat" value={`${stats.highScorePercentage}%`} T={T} />
            <View style={{ width: 0.5, backgroundColor: T.border }} />
            <StatCell label="Bästa streak" value={String(stats.bestStreak)} T={T} />
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: T.accent }]}
          onPress={onStart}
          activeOpacity={0.82}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Starta quiz</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function StatCell({ label, value, T }: { label: string; value: string; T: any }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 14 }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color: T.text }}>{value}</Text>
      <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 2, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

// ── ConfigView ────────────────────────────────────────────────────────────────

function ConfigView({
  config, setConfig, onStart, onBack, T, isDark,
}: {
  config:    QuizConfig;
  setConfig: React.Dispatch<React.SetStateAction<QuizConfig>>;
  onStart:   () => void;
  onBack:    () => void;
  T:         any;
  isDark:    boolean;
}) {
  const selectedCat = PLAYABLE_CATEGORIES.find(c => c.id === config.categoryId)!;

  // How many questions actually available for current selection
  const available = useMemo(() => {
    return getAvailableCount(
      config.categoryId,
      selectedCat.hasDifficultyLevels ? config.difficulty : undefined,
    );
  }, [config.categoryId, config.difficulty, selectedCat.hasDifficultyLevels]);

  // Always play all available questions — keep limit in sync
  useEffect(() => {
    setConfig(c => ({ ...c, limit: available }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <TouchableOpacity
            onPress={onBack}
            style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 20, color: T.text, lineHeight: 22 }}>‹</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: T.text }}>Välj quiz</Text>
        </View>

        {/* Category */}
        <SectionLabel label="Kategori" T={T} />
        <View style={{ marginBottom: 24 }}>
          <QuizCategoryGrid
            items={PLAYABLE_CATEGORIES.map(cat => ({
              id:    cat.id,
              title: cat.title,
              count: cat.totalQuestions,
            }))}
            selectedId={config.categoryId}
            onSelect={(id) => {
              const cat = PLAYABLE_CATEGORIES.find(c => c.id === id)!;
              const newDiff = cat.hasDifficultyLevels
                ? cat.availableDifficulties[0]
                : undefined;
              setConfig(c => ({ ...c, categoryId: id, difficulty: newDiff }));
            }}
            T={T}
            isDark={isDark}
          />
        </View>

        {/* Difficulty — only for categories that have it */}
        {selectedCat.hasDifficultyLevels && (
          <>
            <SectionLabel label="Svårighetsgrad" T={T} />
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
              {selectedCat.availableDifficulties.map(d => (
                <TouchableOpacity
                  key={d}
                  onPress={() => setConfig(c => ({ ...c, difficulty: d }))}
                  style={{
                    flex: 1, paddingVertical: 12, borderRadius: 12,
                    alignItems: 'center',
                    backgroundColor: config.difficulty === d
                      ? DIFF_COLOR[d]
                      : (isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)'),
                    borderWidth: 0.5,
                    borderColor: config.difficulty === d ? 'transparent' : T.border,
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={{
                    fontSize: 14, fontWeight: '700',
                    color: config.difficulty === d ? '#fff' : T.textMuted,
                  }}>{d}</Text>
                  <Text style={{
                    fontSize: 11, color: config.difficulty === d ? 'rgba(255,255,255,0.7)' : T.textMuted,
                    marginTop: 2,
                  }}>
                    {getAvailableCount(config.categoryId, d)} frågor
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* Time per question */}
        <SectionLabel label="Tid per fråga" T={T} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 32 }}>
          {TIME_OPTIONS.map(t => (
            <PillButton
              key={t.value}
              label={t.label}
              active={config.timeLimitSec === t.value}
              onPress={() => setConfig(c => ({ ...c, timeLimitSec: t.value }))}
              T={T} isDark={isDark}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: T.accent }]}
          onPress={onStart}
          activeOpacity={0.82}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Starta quiz</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ── AnswerOption ──────────────────────────────────────────────────────────────

function AnswerOption({
  opt, bg, bc, tc, revealed, isCorrect, isSelected, onPress,
}: {
  opt:        string;
  bg:         string;
  bc:         string;
  tc:         string;
  revealed:   boolean;
  isCorrect:  boolean;
  isSelected: boolean;
  onPress:    () => void;
}) {
  const scale   = useRef(new Animated.Value(1)).current;
  const iconOp  = useRef(new Animated.Value(0)).current;
  const iconScl = useRef(new Animated.Value(0.4)).current;

  // Icon + wrong-answer shake when revealed
  useEffect(() => {
    if (revealed && (isCorrect || isSelected)) {
      // Pop in icon
      Animated.parallel([
        Animated.timing(iconOp,  { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(iconScl, { toValue: 1, bounciness: 8, useNativeDriver: true }),
      ]).start();

      // Wrong answer: squeeze harder then spring back
      if (isSelected && !isCorrect) {
        Animated.sequence([
          Animated.timing(scale, { toValue: 0.93, duration: 80,  useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1, bounciness: 10,   useNativeDriver: true }),
        ]).start();
      }
    } else {
      iconOp.setValue(0);
      iconScl.setValue(0.4);
    }
  }, [revealed]);

  const handlePressIn = useCallback(() => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    Animated.timing(scale, { toValue: 0.97, duration: 80, useNativeDriver: true }).start();
  }, []);

  const handlePressOut = useCallback(() => {
    Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }).start();
  }, []);

  const showIcon  = revealed && (isCorrect || isSelected);
  const iconText  = isCorrect ? '✓' : '✕';
  const iconColor = isCorrect ? '#34C759' : '#FF3B30';

  return (
    <Animated.View style={{ transform: [{ scale }], marginBottom: 10 }}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={revealed ? undefined : handlePressIn}
        onPressOut={revealed ? undefined : handlePressOut}
        activeOpacity={1}
        style={{
          backgroundColor: bg,
          borderWidth: isSelected && !revealed ? 1.5 : 1,
          borderColor: bc,
          borderRadius: 14, paddingVertical: 16, paddingHorizontal: 16,
          flexDirection: 'row', alignItems: 'center',
        }}
      >
        <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: tc, lineHeight: 20 }}>
          {opt}
        </Text>
        {showIcon && (
          <Animated.View style={{
            opacity: iconOp,
            transform: [{ scale: iconScl }],
            width: 26, height: 26, borderRadius: 13,
            backgroundColor: iconColor + '25',
            alignItems: 'center', justifyContent: 'center',
            marginLeft: 10,
          }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: iconColor }}>{iconText}</Text>
          </Animated.View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── PlayView ──────────────────────────────────────────────────────────────────

function PlayView({
  play, config, currentIndex, onAnswer, onQuit, T, isDark,
}: {
  play:         PlayState;
  config:       QuizConfig;
  currentIndex: number;
  onAnswer:     (answer: string | null) => void;
  onQuit:       () => void;
  T:            any;
  isDark:       boolean;
}) {
  const q            = play.questions[currentIndex];
  const total        = play.questions.length;
  const progressAnim  = useRef(new Animated.Value(currentIndex / total)).current;
  const timerBarAnim  = useRef(new Animated.Value(1)).current;
  const timerAnimRef  = useRef<Animated.CompositeAnimation | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(config.timeLimitSec);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset per question
  useEffect(() => {
    setSelected(null);
    setRevealed(false);
    setTimeLeft(config.timeLimitSec);

    // Progress bar — smooth fill to next step
    Animated.timing(progressAnim, {
      toValue: (currentIndex + 1) / total,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // Timer bar — smooth continuous countdown from full to empty
    timerBarAnim.setValue(1);
    if (config.timeLimitSec > 0) {
      timerAnimRef.current = Animated.timing(timerBarAnim, {
        toValue: 0,
        duration: config.timeLimitSec * 1000,
        easing: Easing.linear,
        useNativeDriver: false,
      });
      timerAnimRef.current.start();
    }

    return () => { timerAnimRef.current?.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  // Stop timer bar smoothly when answer is revealed
  useEffect(() => {
    if (revealed) timerAnimRef.current?.stop();
  }, [revealed]);

  // Integer countdown for the number display only
  useEffect(() => {
    if (config.timeLimitSec === 0 || revealed) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current!); handleAnswer(null); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, revealed]);

  const handleAnswer = useCallback((answer: string | null) => {
    if (revealed) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setSelected(answer);
    setRevealed(true);
    const correct = answer === q.correctAnswer;
    try {
      if (correct) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        // Fel svar: Error-notification + tung impact för extra kraftfull feedback
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setTimeout(() => {
          try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); } catch {}
        }, 80);
      }
    } catch {}
    setTimeout(() => onAnswer(answer), 1100);
  }, [revealed, q.correctAnswer, onAnswer]);

  const timerPct   = config.timeLimitSec > 0 ? timeLeft / config.timeLimitSec : 1;
  const timerColor = timeLeft > 10 ? T.accent : timeLeft > 5 ? '#FF9F0A' : '#FF3B30';

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      {/* Top bar */}
      <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <TouchableOpacity
            onPress={onQuit} activeOpacity={0.7}
            style={{
              paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
              backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
            }}
          >
            <Text style={{ fontSize: 12, color: T.textMuted, fontWeight: '600' }}>Avsluta</Text>
          </TouchableOpacity>
          <Text style={{ flex: 1, textAlign: 'center', fontSize: 13, color: T.textMuted, fontWeight: '600' }}>
            {currentIndex + 1} / {total}
          </Text>
          {config.timeLimitSec > 0
            ? <Text style={{ fontSize: 22, fontWeight: '800', color: timerColor, minWidth: 36, textAlign: 'right' }}>{timeLeft}</Text>
            : <View style={{ width: 36 }} />}
        </View>

        {/* Progress bar */}
        <View style={{
          height: 4, borderRadius: 2, overflow: 'hidden',
          backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        }}>
          <Animated.View style={{
            height: '100%', borderRadius: 2, backgroundColor: T.accent,
            width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          }} />
        </View>

      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Streak badge */}
        {play.streak >= 2 && (
          <View style={{
            alignSelf: 'center', marginBottom: 10,
            flexDirection: 'row', alignItems: 'center', gap: 5,
            backgroundColor: isDark ? 'rgba(255,159,10,0.15)' : 'rgba(255,159,10,0.1)',
            paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20,
            borderWidth: 0.5, borderColor: 'rgba(255,159,10,0.3)',
          }}>
            <Text style={{ fontSize: 14 }}>🔥</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#FF9F0A' }}>
              {play.streak} i rad
            </Text>
          </View>
        )}

        {/* Meta badges */}
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14 }}>
          <View style={{
            paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
          }}>
            <Text style={{ fontSize: 11, color: T.textMuted, fontWeight: '600' }}>
              {q.categoryTitle}
            </Text>
          </View>
          {q.difficulty && (
            <View style={{
              paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
              backgroundColor: DIFF_COLOR[q.difficulty] + '22',
            }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: DIFF_COLOR[q.difficulty] }}>
                {q.difficulty}
              </Text>
            </View>
          )}
        </View>

        {/* Question */}
        <Text style={{
          fontSize: 18, fontWeight: '700', color: T.text,
          lineHeight: 26, marginBottom: 24, letterSpacing: -0.2,
        }}>
          {q.question}
        </Text>

        {/* Answers */}
        {q.shuffledOptions.map(opt => {
          const isSelected = selected === opt;
          const isCorrect  = opt === q.correctAnswer;

          let bg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
          let bc = T.border;
          let tc = T.text;

          if (revealed) {
            if (isCorrect)        { bg = isDark ? 'rgba(52,199,89,0.15)' : 'rgba(52,199,89,0.1)'; bc = 'rgba(52,199,89,0.4)'; tc = '#34C759'; }
            else if (isSelected)  { bg = isDark ? 'rgba(255,59,48,0.15)' : 'rgba(255,59,48,0.1)'; bc = 'rgba(255,59,48,0.4)'; tc = '#FF3B30'; }
          } else if (isSelected)  { bg = isDark ? 'rgba(36,100,93,0.2)' : 'rgba(36,100,93,0.1)'; bc = T.accent; }

          return (
            <AnswerOption
              key={opt}
              opt={opt}
              bg={bg} bc={bc} tc={tc}
              revealed={revealed}
              isCorrect={isCorrect}
              isSelected={isSelected}
              onPress={() => !revealed && handleAnswer(opt)}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── ResultsView ───────────────────────────────────────────────────────────────

function ResultsView({
  play, summary, isNewHighScore,
  onRetryWrong, onNewQuiz, onHome, T, isDark, insets,
}: {
  play:           PlayState;
  summary:        QuizSummary;
  isNewHighScore: boolean;
  onRetryWrong:   () => void;
  onNewQuiz:      () => void;
  onHome:         () => void;
  T:              any;
  isDark:         boolean;
  insets:         any;
}) {
  const { percentage, correctAnswers, totalQuestions, bestStreak } = summary;
  const scoreColor = percentage >= 80 ? '#34C759' : percentage >= 50 ? '#FF9F0A' : '#FF3B30';
  const scoreMsg   = percentage >= 80 ? 'Utmärkt!' : percentage >= 60 ? 'Bra jobbat!' : percentage >= 40 ? 'Fortsätt öva!' : 'Försök igen!';

  const actualWrong = play.answers.filter(a => !a.isCorrect && a.selectedAnswer !== null);
  const missed      = play.answers.filter(a => !a.isCorrect && a.selectedAnswer === null);
  const allWrong    = play.answers.filter(a => !a.isCorrect);
  const [showWrong,  setShowWrong]  = useState(false);
  const [showMissed, setShowMissed] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: insets.top + 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center', marginBottom: 28 }}>
          <View style={{
            width: 120, height: 120, borderRadius: 60,
            backgroundColor: scoreColor + (isDark ? '22' : '18'),
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 3, borderColor: scoreColor + '55',
            marginBottom: 16,
          }}>
            <Text style={{ fontSize: 32, fontWeight: '800', color: scoreColor }}>{percentage}%</Text>
          </View>
          <Text style={{ fontSize: 24, fontWeight: '800', color: T.text, letterSpacing: -0.4 }}>
            {scoreMsg}
          </Text>
          <Text style={{ fontSize: 15, color: T.textMuted, marginTop: 6 }}>
            {correctAnswers} av {totalQuestions} rätta svar
          </Text>
          {isNewHighScore && (
            <View style={{
              marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 5,
              backgroundColor: isDark ? 'rgba(255,214,10,0.15)' : 'rgba(255,214,10,0.1)',
              paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20,
              borderWidth: 0.5, borderColor: 'rgba(255,214,10,0.35)',
            }}>
              <Text style={{ fontSize: 13 }}>🏆</Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFD60A' }}>Nytt rekord!</Text>
            </View>
          )}
        </View>

        {/* Stats */}
        <View style={[styles.card, {
          backgroundColor: T.card, borderColor: T.border,
          flexDirection: 'row', marginBottom: 20,
        }]}>
          <StatCell label="Rätt"         value={String(correctAnswers)}       T={T} />
          <View style={{ width: 0.5, backgroundColor: T.border }} />
          <StatCell label="Fel"          value={String(actualWrong.length)}   T={T} />
          <View style={{ width: 0.5, backgroundColor: T.border }} />
          <StatCell label="Missade"      value={String(missed.length)}        T={T} />
          <View style={{ width: 0.5, backgroundColor: T.border }} />
          <StatCell label="Bästa streak" value={String(bestStreak)}           T={T} />
        </View>

        {/* Felaktiga svar */}
        {actualWrong.length > 0 && (
          <TouchableOpacity
            onPress={() => setShowWrong(v => !v)}
            style={[styles.card, {
              backgroundColor: T.card, borderColor: T.border,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8,
            }]}
            activeOpacity={0.75}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: T.text }}>
              Felaktiga svar ({actualWrong.length})
            </Text>
            <Text style={{ fontSize: 16, color: T.textMuted }}>{showWrong ? '∧' : '∨'}</Text>
          </TouchableOpacity>
        )}

        {showWrong && actualWrong.map(a => (
          <View key={a.questionId} style={[styles.card, {
            backgroundColor: T.card, borderColor: T.border, marginBottom: 8, gap: 8,
          }]}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: T.text, lineHeight: 19 }}>
              {a.question}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <View style={{
                flexDirection: 'row', gap: 4, alignItems: 'center',
                backgroundColor: 'rgba(255,59,48,0.1)', borderRadius: 6,
                paddingHorizontal: 8, paddingVertical: 4,
              }}>
                <Text style={{ fontSize: 11, color: '#FF3B30' }}>✕</Text>
                <Text style={{ fontSize: 11, color: '#FF3B30', fontWeight: '500', flexShrink: 1 }}>
                  {a.selectedAnswer}
                </Text>
              </View>
              <View style={{
                flexDirection: 'row', gap: 4, alignItems: 'center',
                backgroundColor: 'rgba(52,199,89,0.1)', borderRadius: 6,
                paddingHorizontal: 8, paddingVertical: 4,
              }}>
                <Text style={{ fontSize: 11, color: '#34C759' }}>✓</Text>
                <Text style={{ fontSize: 11, color: '#34C759', fontWeight: '500', flexShrink: 1 }}>
                  {a.correctAnswer}
                </Text>
              </View>
            </View>
          </View>
        ))}

        {/* Missade svar (timeout) */}
        {missed.length > 0 && (
          <TouchableOpacity
            onPress={() => setShowMissed(v => !v)}
            style={[styles.card, {
              backgroundColor: T.card, borderColor: T.border,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8, marginTop: actualWrong.length > 0 ? 4 : 0,
            }]}
            activeOpacity={0.75}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: T.text }}>
              Missade svar ({missed.length})
            </Text>
            <Text style={{ fontSize: 16, color: T.textMuted }}>{showMissed ? '∧' : '∨'}</Text>
          </TouchableOpacity>
        )}

        {showMissed && missed.map(a => (
          <View key={a.questionId} style={[styles.card, {
            backgroundColor: T.card, borderColor: T.border, marginBottom: 8, gap: 8,
          }]}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: T.text, lineHeight: 19 }}>
              {a.question}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <View style={{
                flexDirection: 'row', gap: 4, alignItems: 'center',
                backgroundColor: 'rgba(255,159,10,0.1)', borderRadius: 6,
                paddingHorizontal: 8, paddingVertical: 4,
              }}>
                <Text style={{ fontSize: 11, color: '#FF9F0A' }}>⏱</Text>
                <Text style={{ fontSize: 11, color: '#FF9F0A', fontWeight: '500' }}>
                  Hann inte svara
                </Text>
              </View>
              <View style={{
                flexDirection: 'row', gap: 4, alignItems: 'center',
                backgroundColor: 'rgba(52,199,89,0.1)', borderRadius: 6,
                paddingHorizontal: 8, paddingVertical: 4,
              }}>
                <Text style={{ fontSize: 11, color: '#34C759' }}>✓</Text>
                <Text style={{ fontSize: 11, color: '#34C759', fontWeight: '500', flexShrink: 1 }}>
                  {a.correctAnswer}
                </Text>
              </View>
            </View>
          </View>
        ))}

        <View style={{ gap: 10, marginTop: 12 }}>
          {allWrong.length > 0 && (
            <TouchableOpacity
              style={[styles.primaryBtn, {
                backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)',
                borderWidth: 0.5, borderColor: T.border,
              }]}
              onPress={onRetryWrong} activeOpacity={0.8}
            >
              <Text style={{ color: T.text, fontSize: 15, fontWeight: '700' }}>
                Träna fel svar ({allWrong.length})
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: T.accent }]}
            onPress={onNewQuiz} activeOpacity={0.82}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Ny quiz</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: 'transparent', borderWidth: 0.5, borderColor: T.border }]}
            onPress={onHome} activeOpacity={0.8}
          >
            <Text style={{ color: T.textMuted, fontSize: 15, fontWeight: '600' }}>Till startsidan</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function QuizScreen() {
  const { theme: T, isDark } = useTheme();
  const insets               = useSafeAreaInsets();

  const [view, setView]     = useState<QuizView>('start');
  const [config, setConfig] = useState<QuizConfig>(() => {
    const firstCat  = PLAYABLE_CATEGORIES[0];
    const firstDiff = firstCat.hasDifficultyLevels
      ? firstCat.availableDifficulties[0]
      : undefined;
    return {
      categoryId:   firstCat.id,
      difficulty:   firstDiff,
      limit:        getAvailableCount(firstCat.id, firstDiff),
      timeLimitSec: 20,
    };
  });

  const [play, setPlay]           = useState<PlayState | null>(null);
  const [currentIndex, setIndex]  = useState(0);
  const [summary, setSummary]     = useState<QuizSummary | null>(null);
  const [stats, setStats]         = useState<QuizStoredStats>({
    highScorePercentage: 0, bestStreak: 0, totalCompletedRuns: 0,
  });
  const [isNewHS, setIsNewHS]     = useState(false);

  useEffect(() => {
    loadQuizStats().then(setStats).catch(() => {});
  }, []);

  const startQuiz = useCallback((overrideQuestions?: QuizSessionQuestion[]) => {
    const cat = PLAYABLE_CATEGORIES.find(c => c.id === config.categoryId)!;
    const sessionConfig: QuizSessionConfig = {
      categoryId:   config.categoryId,
      difficulty:   cat.hasDifficultyLevels ? config.difficulty : undefined,
      limit:        config.limit,
      timeLimitSec: config.timeLimitSec,
    };
    const questions = overrideQuestions ?? buildQuizSession(sessionConfig);
    if (questions.length === 0) return;
    setPlay({
      questions,
      answers:       [],
      streak:        0,
      maxStreak:     0,
      questionStart: Date.now(),
    });
    setIndex(0);
    setSummary(null);
    setIsNewHS(false);
    setView('playing');
  }, [config]);

  const handleAnswer = useCallback((answer: string | null) => {
    if (!play) return;
    const q          = play.questions[currentIndex];
    const isCorrect  = answer === q.correctAnswer;
    const newStreak  = isCorrect ? play.streak + 1 : 0;
    const newMax     = Math.max(play.maxStreak, newStreak);
    const timeMs     = Date.now() - play.questionStart;

    if (newStreak > 0 && newStreak % 3 === 0) {
      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    }

    const result: QuizAnswerResult = {
      questionId:     q.id,
      categoryId:     q.categoryId,
      categoryTitle:  q.categoryTitle,
      difficulty:     q.difficulty,
      question:       q.question,
      selectedAnswer: answer,
      correctAnswer:  q.correctAnswer,
      isCorrect,
      timeSpentMs:    timeMs,
    };
    const newAnswers = [...play.answers, result];
    const updatedPlay: PlayState = {
      ...play,
      answers:       newAnswers,
      streak:        newStreak,
      maxStreak:     newMax,
      questionStart: Date.now(),
    };
    setPlay(updatedPlay);

    if (currentIndex + 1 >= play.questions.length) {
      // Quiz complete
      const s = calculateSummary(newAnswers);
      setSummary(s);
      saveQuizSummary(s).then(saved => {
        setStats(saved);
        setIsNewHS(s.percentage > stats.highScorePercentage);
      }).catch(() => {});
      setView('results');
    } else {
      setIndex(i => i + 1);
    }
  }, [play, currentIndex, stats.highScorePercentage]);

  const handleRetryWrong = useCallback(() => {
    if (!play) return;
    const wrongQs = play.answers
      .filter(a => !a.isCorrect)
      .map(a => play.questions.find(q => q.id === a.questionId)!)
      .filter(Boolean)
      .map(q => ({ ...q, shuffledOptions: shuffleArray(q.options) }));
    if (wrongQs.length === 0) return;
    startQuiz(wrongQs);
  }, [play, startQuiz]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (view === 'start') {
    return (
      <>
        <Stack.Screen options={{ gestureEnabled: true, fullScreenGestureEnabled: false }} />
        <StartView onStart={() => setView('config')} stats={stats} T={T} isDark={isDark} insets={insets} />
      </>
    );
  }

  if (view === 'config') {
    return (
      <View style={{ flex: 1, backgroundColor: T.bg, paddingTop: insets.top }}>
        <Stack.Screen options={{ gestureEnabled: false, fullScreenGestureEnabled: false }} />
        <ConfigView
          config={config} setConfig={setConfig}
          onStart={() => startQuiz()} onBack={() => setView('start')}
          T={T} isDark={isDark}
        />
      </View>
    );
  }

  if (view === 'playing' && play) {
    return (
      <View style={{ flex: 1, backgroundColor: T.bg, paddingTop: insets.top }}>
        <Stack.Screen options={{ gestureEnabled: false, fullScreenGestureEnabled: false }} />
        <PlayView
          play={play} config={config} currentIndex={currentIndex}
          onAnswer={handleAnswer} onQuit={() => setView('start')}
          T={T} isDark={isDark}
        />
      </View>
    );
  }

  if (view === 'results' && play && summary) {
    return (
      <>
        <Stack.Screen options={{ gestureEnabled: false, fullScreenGestureEnabled: false }} />
        <ResultsView
          play={play} summary={summary} isNewHighScore={isNewHS}
          onRetryWrong={handleRetryWrong}
          onNewQuiz={() => setView('config')}
          onHome={() => setView('start')}
          T={T} isDark={isDark} insets={insets}
        />
      </>
    );
  }

  return null;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    borderWidth: 0.5,
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
