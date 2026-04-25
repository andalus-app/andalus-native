import React, {
  useEffect,
  useRef,
  memo,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  LayoutAnimation,
  UIManager,
  StyleSheet,
  Platform,
  Switch,
  Alert,
  TextInput,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { BlurView } from 'expo-blur';
import SvgIcon from '../SvgIcon';
import { useTheme } from '../../context/ThemeContext';
import { useQuranContext } from '../../context/QuranContext';
import { RECITERS, deleteReciterCache, cachedReciterBytes } from '../../services/quranAudioService';
import {
  DEFAULT_TRANSLATION_ID,
  LOCAL_BERNSTROM_ID,
  API_BERNSTROM_ID,
  BERNSTROM_META,
  clearAllTranslationCaches,
  cachedTranslationPageCount,
  fetchAllTranslations,
  getDownloadedTranslations,
  addDownloadedTranslation,
  type ApiTranslation,
} from '../../services/quranTranslationService';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

// ── Language name → Swedish display name ─────────────────────────────────────
// Keys are lowercase English language names as returned by the Quran Foundation API.
// Fallback: capitalize the original name.

const LANG_SV: Record<string, string> = {
  afrikaans:      'Afrikaans',
  albanian:       'Albanska',
  amharic:        'Amhariska',
  arabic:         'Arabiska',
  azerbaijani:    'Azerbajdzjanska',
  bangla:         'Bengali',
  bengali:        'Bengali',
  bosnian:        'Bosniska',
  bulgarian:      'Bulgariska',
  chinese:        'Kinesiska',
  croatian:       'Kroatiska',
  czech:          'Tjeckiska',
  danish:         'Danska',
  dari:           'Dari',
  divehi:         'Divehi',
  dutch:          'Nederländska',
  english:        'Engelska',
  farsi:          'Persiska',
  finnish:        'Finska',
  french:         'Franska',
  german:         'Tyska',
  greek:          'Grekiska',
  gujarati:       'Gujarati',
  hausa:          'Hausa',
  hindi:          'Hindi',
  hungarian:      'Ungerska',
  indonesian:     'Indonesiska',
  italian:        'Italienska',
  japanese:       'Japanska',
  kannada:        'Kannada',
  kazakh:         'Kazakiska',
  korean:         'Koreanska',
  kurdish:        'Kurdiska',
  kyrgyz:         'Kirgiziska',
  macedonian:     'Makedonska',
  malay:          'Malajiska',
  malayalam:      'Malayalam',
  marathi:        'Marathi',
  nepali:         'Nepali',
  norwegian:      'Norska',
  pashto:         'Pashto',
  persian:        'Persiska',
  polish:         'Polska',
  portuguese:     'Portugisiska',
  punjabi:        'Punjabi',
  romanian:       'Rumänska',
  russian:        'Ryska',
  serbian:        'Serbiska',
  sindhi:         'Sindhi',
  sinhala:        'Singalesiska',
  somali:         'Somali',
  spanish:        'Spanska',
  swahili:        'Swahili',
  swedish:        'Svenska',
  tagalog:        'Tagalog',
  tajik:          'Tadzjikiska',
  tamil:          'Tamilska',
  telugu:         'Telugu',
  thai:           'Thailändska',
  turkish:        'Turkiska',
  ukrainian:      'Ukrainska',
  urdu:           'Urdu',
  uyghur:         'Uiguriska',
  uzbek:          'Uzbekiska',
  yoruba:         'Yoruba',
};

function toLangSv(apiName: string): string {
  return LANG_SV[apiName.toLowerCase()] ?? (apiName.charAt(0).toUpperCase() + apiName.slice(1));
}

// ── Font scale helpers ────────────────────────────────────────────────────────

const FONT_SCALE_MIN  = 0.8;
const FONT_SCALE_MAX  = 2.0;
const FONT_SCALE_STEP = 0.1;

function clampScale(v: number): number {
  return Math.round(Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, v)) * 10) / 10;
}

// ── FontSizeControl ───────────────────────────────────────────────────────────

type FontSizeControlProps = {
  value:    number;
  onChange: (next: number) => void;
  isDark:   boolean;
  T:        ReturnType<typeof useTheme>['theme'];
};

function FontSizeControl({ value, onChange, isDark, T }: FontSizeControlProps) {
  const canDecrease = value > FONT_SCALE_MIN;
  const canIncrease = value < FONT_SCALE_MAX;
  return (
    <View style={[fsc.pill, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)' }]}>
      <TouchableOpacity
        style={[fsc.btn, !canDecrease && fsc.btnDisabled]}
        onPress={() => canDecrease && onChange(clampScale(value - FONT_SCALE_STEP))}
        activeOpacity={canDecrease ? 0.7 : 1}
      >
        <Text style={[fsc.labelSmall, { color: canDecrease ? T.text : T.textMuted }]}>A</Text>
      </TouchableOpacity>
      <View style={[fsc.divider, { backgroundColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)' }]} />
      <TouchableOpacity
        style={[fsc.btn, !canIncrease && fsc.btnDisabled]}
        onPress={() => canIncrease && onChange(clampScale(value + FONT_SCALE_STEP))}
        activeOpacity={canIncrease ? 0.7 : 1}
      >
        <Text style={[fsc.labelLarge, { color: canIncrease ? T.text : T.textMuted }]}>A</Text>
      </TouchableOpacity>
    </View>
  );
}

const fsc = StyleSheet.create({
  pill:       { flexDirection: 'row', borderRadius: 10, overflow: 'hidden', height: 38 },
  btn:        { width: 48, alignItems: 'center', justifyContent: 'center' },
  btnDisabled:{ opacity: 0.38 },
  divider:    { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  labelSmall: { fontSize: 13, fontWeight: '500' },
  labelLarge: { fontSize: 19, fontWeight: '500' },
});

// ── AccordionSection ──────────────────────────────────────────────────────────

type AccordionSectionProps = {
  title:    string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  T:        ReturnType<typeof useTheme>['theme'];
  isDark:   boolean;
};

const AccordionSection = memo(function AccordionSection({
  title, expanded, onToggle, children, T, isDark,
}: AccordionSectionProps) {
  return (
    <View style={[acc.wrapper, { borderColor: T.border }]}>
      {/* Header row */}
      <TouchableOpacity
        style={[acc.header, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }]}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        {/* Chevron — rotates 90° when expanded */}
        <View style={[acc.chevronWrap, { transform: [{ rotate: expanded ? '90deg' : '0deg' }] }]}>
          <Text style={[acc.chevron, { color: T.textMuted }]}>›</Text>
        </View>
        <Text style={[acc.title, { color: T.text }]}>{title}</Text>
      </TouchableOpacity>

      {/* Expandable content */}
      {expanded && (
        <View style={[acc.content, { borderTopColor: T.separator }]}>
          {children}
        </View>
      )}
    </View>
  );
});

const acc = StyleSheet.create({
  wrapper:     { borderRadius: 12, borderWidth: 0.5, marginHorizontal: 16, marginTop: 8, overflow: 'hidden' },
  header:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, gap: 10 },
  chevronWrap: { width: 18, alignItems: 'center' },
  chevron:     { fontSize: 20, lineHeight: 22, fontWeight: '300' },
  title:       { flex: 1, fontSize: 14, fontWeight: '600' },
  content:     { borderTopWidth: StyleSheet.hairlineWidth },
});

// ── QuranSettingsPanel ────────────────────────────────────────────────────────

function QuranSettingsPanel() {
  const { theme: T, isDark, mode, setMode } = useTheme();
  const { settingsPanelOpen, closeSettingsPanel, settings, updateSettings, audioCacheRefreshRef } =
    useQuranContext();

  const [reciterCacheMB,         setReciterCacheMB]         = useState<Record<number, number>>({});
  const [cachedPages,            setCachedPages]             = useState(0);
  const [allTranslations,        setAllTranslations]         = useState<ApiTranslation[]>([]);
  const [downloadedTranslations, setDownloadedTranslations] = useState<ApiTranslation[]>([]);
  const [transLoading,           setTransLoading]            = useState(false);
  const [transQuery,             setTransQuery]              = useState('');

  // Accordion open states — all collapsed by default
  const [reciterOpen,  setReciterOpen]  = useState(false);
  const [transOpen,    setTransOpen]    = useState(false);
  const [storageOpen,  setStorageOpen]  = useState(false);

  const slideAnim    = useRef(new Animated.Value(800)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const kbOffsetAnim = useRef(new Animated.Value(0)).current;
  const mountedRef   = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Push the sheet up when the keyboard appears so search results stay visible.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = Keyboard.addListener(showEvent, (e) => {
      Animated.timing(kbOffsetAnim, {
        toValue: -e.endCoordinates.height,
        duration: Platform.OS === 'ios' ? (e.duration ?? 250) : 150,
        useNativeDriver: true,
      }).start();
    });
    const onHide = Keyboard.addListener(hideEvent, (e) => {
      Animated.timing(kbOffsetAnim, {
        toValue: 0,
        duration: Platform.OS === 'ios' ? (e.duration ?? 250) : 150,
        useNativeDriver: true,
      }).start();
    });

    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [kbOffsetAnim]);

  // Accordion toggles — LayoutAnimation makes the layout change feel native
  const toggleReciter = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setReciterOpen((v) => !v);
  }, []);
  const toggleTrans = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setTransOpen((v) => !v);
  }, []);
  const toggleStorage = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setStorageOpen((v) => !v);
  }, []);

  const loadReciterCaches = useCallback(async () => {
    const entries = await Promise.all(
      RECITERS.map(async (r) => {
        const bytes = await cachedReciterBytes(r.id);
        return [r.id, Math.round((bytes / (1024 * 1024)) * 10) / 10] as [number, number];
      }),
    );
    if (!mountedRef.current) return;
    setReciterCacheMB(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    audioCacheRefreshRef.current = () => {
      loadReciterCaches().catch(() => undefined);
    };
    return () => { audioCacheRefreshRef.current = null; };
  }, [audioCacheRefreshRef, loadReciterCaches]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: settingsPanelOpen ? 0 : 800,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: settingsPanelOpen ? 1 : 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    if (!settingsPanelOpen) {
      Keyboard.dismiss();
    }

    if (settingsPanelOpen) {
      loadReciterCaches().catch(() => undefined);
      cachedTranslationPageCount()
        .then((pages) => { if (mountedRef.current) setCachedPages(pages); })
        .catch(() => undefined);
      getDownloadedTranslations()
        .then((list) => { if (mountedRef.current) setDownloadedTranslations(list); })
        .catch(() => undefined);
      if (allTranslations.length === 0) {
        setTransLoading(true);
        fetchAllTranslations()
          .then((list) => { if (mountedRef.current) setAllTranslations(list); })
          .catch(() => undefined)
          .finally(() => { if (mountedRef.current) setTransLoading(false); });
      }
    }
  }, [settingsPanelOpen, slideAnim, backdropAnim, loadReciterCaches, allTranslations.length]);

  const handleDeleteAudio = useCallback((reciterId: number, reciterName: string) => {
    Alert.alert(
      'Rensa ljud',
      `Ta bort cachad audio för ${reciterName}?`,
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Ta bort',
          style: 'destructive',
          onPress: async () => {
            await deleteReciterCache(reciterId);
            if (!mountedRef.current) return;
            const bytes = await cachedReciterBytes(reciterId);
            setReciterCacheMB((prev) => ({
              ...prev,
              [reciterId]: Math.round((bytes / (1024 * 1024)) * 10) / 10,
            }));
          },
        },
      ],
    );
  }, []);

  const handleDeleteTranslations = useCallback(() => {
    Alert.alert(
      'Rensa översättningar',
      'Ta bort alla cachade översättningssidor?',
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Ta bort',
          style: 'destructive',
          onPress: async () => {
            await clearAllTranslationCaches();
            if (!mountedRef.current) return;
            const pages = await cachedTranslationPageCount();
            setCachedPages(pages);
          },
        },
      ],
    );
  }, [settings.translationId]);

  const groupedTranslations = useMemo(() => {
    // Replace the API Bernström (ID 48) with the local offline version so it
    // appears in the Swedish group without a duplicate.
    const localBernstrom: ApiTranslation = {
      id: LOCAL_BERNSTROM_ID,
      name: 'Knut Bernström',
      authorName: BERNSTROM_META.credit,
      languageName: 'swedish',
    };
    const base = [
      localBernstrom,
      ...allTranslations.filter((t) => t.id !== API_BERNSTROM_ID),
    ];

    const q = transQuery.trim().toLowerCase();
    const filtered = q
      ? base.filter(
          (t) =>
            t.languageName.toLowerCase().includes(q) ||
            toLangSv(t.languageName).toLowerCase().includes(q) ||
            t.name.toLowerCase().includes(q) ||
            t.authorName.toLowerCase().includes(q),
        )
      : base;

    const map = new Map<string, ApiTranslation[]>();
    for (const t of filtered) {
      const lang = t.languageName;
      if (!map.has(lang)) map.set(lang, []);
      map.get(lang)!.push(t);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'sv'))
      .map(([language, translations]) => ({
        language,
        translations: [...translations].sort((a, b) =>
          a.name.localeCompare(b.name, 'sv'),
        ),
      }));
  }, [allTranslations, transQuery]);

  // LOCAL_BERNSTROM is always "downloaded" (bundled). All other user-selected
  // translations are stored in AsyncStorage and merged here.
  const LOCAL_BERNSTROM_ENTRY: ApiTranslation = {
    id: LOCAL_BERNSTROM_ID,
    name: 'Knut Bernström',
    authorName: BERNSTROM_META.credit,
    languageName: 'swedish',
  };

  const pinnedTranslations = useMemo<ApiTranslation[]>(() => {
    const extra = downloadedTranslations.filter((t) => t.id !== LOCAL_BERNSTROM_ID);
    return [LOCAL_BERNSTROM_ENTRY, ...extra];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadedTranslations]);

  const totalCacheMB = Math.round(
    Object.values(reciterCacheMB).reduce((a, b) => a + b, 0) * 10,
  ) / 10;

  return (
    <>
      {/* Backdrop */}
      <Animated.View
        style={[styles.backdrop, { opacity: backdropAnim }]}
        pointerEvents={settingsPanelOpen ? 'auto' : 'none'}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={closeSettingsPanel}
          activeOpacity={1}
        />
      </Animated.View>

      {/* Sheet */}
      <Animated.View style={[styles.sheet, { transform: [{ translateY: Animated.add(slideAnim, kbOffsetAnim) }] }]}>
        <BlurView
          intensity={isDark ? 80 : 95}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: isDark ? 'rgba(10,10,10,0.82)' : 'rgba(248,248,252,0.82)' },
          ]}
        />

        {/* Handle */}
        <View style={styles.handleWrapper}>
          <View style={[styles.handle, { backgroundColor: T.textMuted }]} />
        </View>

        {/* Header — always visible */}
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: T.text }]}>Tema &amp; inställningar</Text>
          <TouchableOpacity onPress={closeSettingsPanel} activeOpacity={0.7}>
            <SvgIcon name="close" size={20} color={T.text} />
          </TouchableOpacity>
        </View>

        {/* Scrollable body */}
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Platform.OS === 'ios' ? 32 : 24 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Textstorlek ──────────────────────────────────────────────── */}
          <Text style={[styles.sectionHeader, { color: T.textMuted }]}>
            TEXTSTORLEK (VERS-FÖR-VERS)
          </Text>

          <View style={[styles.settingCard, { borderColor: T.border }]}>
            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: T.text }]} numberOfLines={2}>
                Korantextens storlek
              </Text>
              <FontSizeControl
                value={settings.fontScale}
                onChange={(v) => updateSettings({ fontScale: v })}
                isDark={isDark}
                T={T}
              />
            </View>
            <View style={[styles.rowDivider, { backgroundColor: T.separator }]} />
            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: T.text }]} numberOfLines={2}>
                Översättningens storlek
              </Text>
              <FontSizeControl
                value={settings.translationFontScale}
                onChange={(v) => updateSettings({ translationFontScale: v })}
                isDark={isDark}
                T={T}
              />
            </View>
          </View>

          {/* ── Utseende ─────────────────────────────────────────────────── */}
          <Text style={[styles.sectionHeader, { color: T.textMuted }]}>UTSEENDE</Text>

          <View style={[styles.settingCard, { borderColor: T.border }]}>
            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: T.text }]}>Utseende</Text>
              <View style={styles.appearanceRow}>
                {(
                  [
                    { label: 'Ljust', value: 'light' },
                    { label: 'Mörkt', value: 'dark'  },
                  ] as const
                ).map(({ label, value }) => {
                  const active =
                    mode === value ||
                    (mode === 'system' && (value === 'dark' ? isDark : !isDark));
                  return (
                    <TouchableOpacity
                      key={value}
                      style={[
                        styles.appearanceBtn,
                        { borderColor: active ? T.accent : T.border },
                        active && { backgroundColor: T.accent },
                      ]}
                      onPress={() => setMode(value)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.appearanceBtnText, { color: active ? '#fff' : T.text }]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>

          {/* ── Recitatör accordion ──────────────────────────────────────── */}
          <Text style={[styles.sectionHeader, { color: T.textMuted }]}>RECITATÖR</Text>
          <AccordionSection
            title="Recitatör"
            expanded={reciterOpen}
            onToggle={toggleReciter}
            T={T}
            isDark={isDark}
          >
            {RECITERS.map((r) => {
              const mb = reciterCacheMB[r.id] ?? 0;
              return (
                <TouchableOpacity
                  key={r.id}
                  style={[
                    styles.optionRow,
                    r.id === settings.reciterId && { backgroundColor: T.accentGlow },
                  ]}
                  onPress={() => updateSettings({ reciterId: r.id })}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionText, { color: T.text }]}>{r.name}</Text>
                    <Text style={[styles.optionMeta, { color: T.textMuted }]}>
                      {r.style}{mb > 0 ? `  ·  ${mb} MB` : ''}
                    </Text>
                  </View>
                  {mb > 0 && (
                    <TouchableOpacity
                      onPress={() => handleDeleteAudio(r.id, r.name)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{ marginRight: 8 }}
                    >
                      <SvgIcon name="trash" size={18} color={T.accentRed} />
                    </TouchableOpacity>
                  )}
                  {r.id === settings.reciterId && (
                    <View style={[styles.checkmark, { backgroundColor: T.accent }]}>
                      <Text style={styles.checkmarkText}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </AccordionSection>

          {/* ── Översättning accordion ───────────────────────────────────── */}
          <Text style={[styles.sectionHeader, { color: T.textMuted }]}>ÖVERSÄTTNING</Text>
          <AccordionSection
            title="Översättning"
            expanded={transOpen}
            onToggle={toggleTrans}
            T={T}
            isDark={isDark}
          >
            {/* Translation on/off */}
            <View style={[styles.switchRow, { borderBottomColor: T.separator }]}>
              <Text style={[styles.switchLabel, { color: T.text }]}>Visa översättning</Text>
              <Switch
                value={settings.translationId !== null}
                onValueChange={(v) =>
                  updateSettings({ translationId: v ? DEFAULT_TRANSLATION_ID : null })
                }
                trackColor={{ true: T.accent, false: T.cardSecondary }}
                thumbColor="#fff"
              />
            </View>

            {settings.translationId !== null && (
              <>
                {/* ── Nedladdade — all selected/bundled translations ── */}
                <View style={[styles.langHeader, { backgroundColor: T.card, borderColor: T.border }]}>
                  <Text style={[styles.langHeaderText, { color: T.accent }]}>Nedladdade</Text>
                  <View style={[styles.langCountBadge, { backgroundColor: T.accentGlow }]}>
                    <Text style={[styles.langCount, { color: T.accent }]}>{pinnedTranslations.length}</Text>
                  </View>
                </View>
                {pinnedTranslations.map((tr) => {
                  const isActive = tr.id === settings.translationId;
                  return (
                    <TouchableOpacity
                      key={tr.id}
                      style={[styles.optionRow, isActive && { backgroundColor: T.accentGlow }]}
                      onPress={() => updateSettings({ translationId: tr.id })}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[styles.optionText, { color: T.text }]}>{tr.name}</Text>
                        </View>
                        <Text style={[styles.optionMeta, { color: T.textMuted }]}>
                          {toLangSv(tr.languageName)} · {tr.authorName}
                        </Text>
                      </View>
                      {/* Checkmark — tapping deactivates if currently active */}
                      {isActive && (
                        <TouchableOpacity
                          onPress={() => updateSettings({ translationId: null })}
                          activeOpacity={0.7}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <View style={[styles.checkmark, { backgroundColor: T.accent }]}>
                            <Text style={styles.checkmarkText}>✓</Text>
                          </View>
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                })}

                {/* Search */}
                <View style={[styles.searchRow, { borderColor: T.border, backgroundColor: T.card, marginTop: 10 }]}>
                  <SvgIcon name="search" size={16} color={T.textMuted} />
                  <TextInput
                    style={[styles.searchInput, { color: T.text }]}
                    placeholder="Sök språk eller översättare…"
                    placeholderTextColor={T.textMuted}
                    value={transQuery}
                    onChangeText={setTransQuery}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  {transQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={() => setTransQuery('')}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <SvgIcon name="close" size={14} color={T.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Grouped translation list */}
                {transLoading ? (
                  <ActivityIndicator color={T.accent} style={{ marginVertical: 16 }} />
                ) : (
                  groupedTranslations.map(({ language, translations }) => (
                    <React.Fragment key={language}>
                      <View style={[styles.langHeader, { backgroundColor: T.card, borderColor: T.border }]}>
                        <Text style={[styles.langHeaderText, { color: T.accent }]}>
                          {toLangSv(language)}
                        </Text>
                        <View style={[styles.langCountBadge, { backgroundColor: T.accentGlow }]}>
                          <Text style={[styles.langCount, { color: T.accent }]}>
                            {translations.length}
                          </Text>
                        </View>
                      </View>
                      {translations.map((tr) => (
                        <TouchableOpacity
                          key={tr.id}
                          style={[
                            styles.optionRow,
                            tr.id === settings.translationId && { backgroundColor: T.accentGlow },
                          ]}
                          onPress={() => {
                            updateSettings({ translationId: tr.id });
                            // Track this translation as "downloaded" so it appears
                            // in the Nedladdade section next time the panel opens.
                            addDownloadedTranslation(tr).then(() => {
                              if (!mountedRef.current) return;
                              setDownloadedTranslations((prev) =>
                                prev.find((t) => t.id === tr.id) ? prev : [...prev, tr],
                              );
                            }).catch(() => undefined);
                          }}
                          activeOpacity={0.7}
                        >
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={[styles.optionText, { color: T.text }]}>{tr.name}</Text>
                            </View>
                            <Text style={[styles.optionMeta, { color: T.textMuted }]}>{tr.authorName}</Text>
                          </View>
                          {tr.id === settings.translationId && (
                            <View style={[styles.langCountBadge, { backgroundColor: T.accent }]}>
                              <Text style={[styles.langCount, { color: '#fff' }]}>Vald</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      ))}
                    </React.Fragment>
                  ))
                )}
              </>
            )}
          </AccordionSection>

          {/* ── Lagring accordion ────────────────────────────────────────── */}
          <Text style={[styles.sectionHeader, { color: T.textMuted }]}>LAGRING</Text>
          <AccordionSection
            title="Lagring"
            expanded={storageOpen}
            onToggle={toggleStorage}
            T={T}
            isDark={isDark}
          >
            <View style={[styles.storageRow, { borderBottomColor: T.separator }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.storageLabel, { color: T.text }]}>Recitations-cache</Text>
                <Text style={[styles.storageMeta, { color: T.textMuted }]}>
                  {`${totalCacheMB} MB nedladdad`}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.storageRow}
              onPress={cachedPages > 0 ? handleDeleteTranslations : undefined}
              activeOpacity={cachedPages > 0 ? 0.7 : 1}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.storageLabel, { color: T.text }]}>Översättnings-cache</Text>
                <Text style={[styles.storageMeta, { color: T.textMuted }]}>
                  {`${cachedPages} sidor cachade`}
                </Text>
              </View>
              {cachedPages > 0 && <SvgIcon name="trash" size={20} color={T.accentRed} />}
            </TouchableOpacity>
          </AccordionSection>
        </ScrollView>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    zIndex: 210,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '56%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    zIndex: 211,
  },
  handleWrapper: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  scrollContent: {
    paddingTop: 4,
  },
  sectionHeader: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },

  // ── Compact setting card (font size + appearance) ─────────────────────────
  settingCard: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 10,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 0,
  },
  settingLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 1,
  },

  // ── Appearance toggle ─────────────────────────────────────────────────────
  appearanceRow: {
    flexDirection: 'row',
    gap: 6,
  },
  appearanceBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appearanceBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Option rows (recitatör / translation items) ───────────────────────────
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 14,
    gap: 8,
  },
  optionText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  optionMeta: {
    fontSize: 11,
  },
  checkmark: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },

  // ── Translation accordion internals ───────────────────────────────────────
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  switchLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  langHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  langHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  langCountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  langCount: {
    fontSize: 11,
    fontWeight: '600',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 14,
    marginTop: 8,
    marginBottom: 2,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 0.5,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
  },

  // ── Storage accordion internals ───────────────────────────────────────────
  storageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  storageLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  storageMeta: {
    fontSize: 11,
    marginTop: 2,
  },
});

export default memo(QuranSettingsPanel);
