/**
 * Zakat Calculator — Zakatkalkylator
 *
 * Two calculators:
 *   1. Årlig Zakat (Annual Zakat) — 6-step wizard
 *   2. Zakat al-Fitr
 *
 * All rules are derived from the Zakat booklet (source of truth).
 * All user-facing text is in Swedish.
 *
 * Nisab: uses the LOWER of gold nisab (85 g) and silver nisab (595 g)
 * converted to SEK via user-entered spot prices.
 * Zakat rate: 2.5% of total zakatable assets.
 * Debt rule: debts are NOT subtracted from zakatable wealth.
 * Jewelry: included by default (majority scholarly opinion).
 * Business: applied via ownership percentage.
 * Loans given: included if expected to be repaid.
 */

import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import BackButton from '../components/BackButton';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import SvgIcon from '../components/SvgIcon';

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY       = 'andalus_zakat_state_v1';
const PRICE_CACHE_KEY   = 'andalus_zakat_prices_v1';

const NISAB_GOLD_GRAMS   = 85;   // grams of pure gold
const NISAB_SILVER_GRAMS = 595;  // grams of silver
const ZAKAT_RATE         = 0.025; // 2.5%

const KARAT_OPTIONS = [
  { label: '24 karat (99.9% rent)',  value: 24 },
  { label: '22 karat (91.6% rent)',  value: 22 },
  { label: '21 karat (87.5% rent)',  value: 21 },
  { label: '18 karat (75% rent)',    value: 18 },
  { label: '14 karat (58.3% rent)',  value: 14 },
  { label: '10 karat (41.7% rent)',  value: 10 },
  { label: '9 karat (37.5% rent)',   value:  9 },
];

// Zakat al-Fitr: 3 kg per person of a staple food.
// The value used here is exactly 3 kg per the booklet.
const FITR_KG_PER_PERSON = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

type GoldItem = { id: string; weightGrams: string; karat: number };
type MissedYear = { year: string; totalAssets: string };

type AnnualState = {
  // Step 1 – eligibility
  isMuslim: boolean | null;
  heldFullYear: boolean | null;
  assetAccessible: boolean | null;
  assetHalal: boolean | null;
  // Step 2 – prices
  goldPricePerGram: string;   // SEK
  silverPricePerGram: string; // SEK
  // Step 3 – metals
  goldItems: GoldItem[];
  silverGrams: string;
  // Step 4 – cash & trade
  cashSEK: string;
  bankSEK: string;
  inventoryValueSEK: string;
  businessCashSEK: string;
  receivablesSEK: string;
  materialsSEK: string;
  ownershipPct: string;        // 0–100
  // Step 5 – loans
  loansRepayableSEK: string;   // loans given that are expected to be repaid
  // Step 6 – missed years
  missedYears: MissedYear[];
};

type FitrState = {
  adults: string;
  children: string;
  foodPricePerKg: string; // SEK, optional
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const defaultAnnual: AnnualState = {
  isMuslim: null, heldFullYear: null, assetAccessible: null, assetHalal: null,
  goldPricePerGram: '', silverPricePerGram: '',
  goldItems: [], silverGrams: '',
  cashSEK: '', bankSEK: '',
  inventoryValueSEK: '', businessCashSEK: '', receivablesSEK: '',
  materialsSEK: '', ownershipPct: '100',
  loansRepayableSEK: '',
  missedYears: [],
};

const defaultFitr: FitrState = { adults: '1', children: '0', foodPricePerKg: '' };

function useZakatStorage() {
  const [annual, setAnnualRaw] = useState<AnnualState>(defaultAnnual);
  const [fitr,   setFitrRaw]   = useState<FitrState>(defaultFitr);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (!raw) return;
      try {
        const { annual: a, fitr: f } = JSON.parse(raw);
        if (a) setAnnualRaw({ ...defaultAnnual, ...a });
        if (f) setFitrRaw({ ...defaultFitr, ...f });
      } catch {}
    });
  }, []);

  const persist = useCallback((a: AnnualState, f: FitrState) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ annual: a, fitr: f })).catch(() => {});
  }, []);

  const setAnnual = useCallback((updater: (prev: AnnualState) => AnnualState) => {
    setAnnualRaw(prev => {
      const next = updater(prev);
      setFitrRaw(f => { persist(next, f); return f; });
      return next;
    });
  }, [persist]);

  const setFitr = useCallback((updater: (prev: FitrState) => FitrState) => {
    setFitrRaw(prev => {
      const next = updater(prev);
      setAnnualRaw(a => { persist(a, next); return a; });
      return next;
    });
  }, [persist]);

  return { annual, setAnnual, fitr, setFitr };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(s: string): number {
  const v = parseFloat(s.replace(',', '.'));
  return isNaN(v) || v < 0 ? 0 : v;
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('sv-SE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtSEK(n: number): string {
  return fmt(n, 0) + ' kr';
}

function fmtKg(n: number): string {
  return fmt(n, 1) + ' kg';
}

// ─── Live Metal Price Hook ────────────────────────────────────────────────────
// Sources: Yahoo Finance (GC=F gold, SI=F silver, USDSEK=X exchange rate)
// All prices in USD per troy oz, converted: SEK/g = (USD/oz ÷ 31.1035) × USD/SEK
// Yahoo Finance works in React Native without API keys or CORS restrictions.

const YF_HEADERS = { 'User-Agent': 'Mozilla/5.0' };
const YF_BASE    = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** Extract regularMarketPrice from a Yahoo Finance v8 chart response. */
function yfPrice(json: unknown): number | null {
  const price = (json as any)?.chart?.result?.[0]?.meta?.regularMarketPrice;
  return typeof price === 'number' && price > 0 ? price : null;
}

type CachedPrices = {
  goldSEKPerGram: number;
  silverSEKPerGram: number | null;
  usdSEK: number;
  savedAt: string; // ISO date string
};

type LivePricesState = {
  goldSEKPerGram: number | null;
  silverSEKPerGram: number | null;
  usdSEK: number | null;
  fetchedAt: Date | null;
  cachedAt: Date | null; // set when showing stale cache due to fetch failure
  loading: boolean;
  error: string | null;
  fromCache: boolean;    // true = live fetch failed, prices are from last successful fetch
};

function useLiveMetalPrices() {
  const [prices, setPrices] = useState<LivePricesState>({
    goldSEKPerGram: null, silverSEKPerGram: null,
    usdSEK: null, fetchedAt: null, cachedAt: null,
    loading: true, error: null, fromCache: false,
  });
  const abortRef = useRef<AbortController | null>(null);

  const fetchPrices = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPrices(p => ({ ...p, loading: true, error: null, fromCache: false }));
    try {
      // Fetch gold (GC=F), silver (SI=F), USD/SEK (USDSEK=X) in parallel
      const opts = { signal: ctrl.signal, headers: YF_HEADERS };
      const [goldRes, silverRes, fxRes] = await Promise.all([
        fetch(`${YF_BASE}/GC%3DF?interval=1d&range=1d`, opts),
        fetch(`${YF_BASE}/SI%3DF?interval=1d&range=1d`, opts),
        fetch(`${YF_BASE}/USDSEK%3DX?interval=1d&range=1d`, opts),
      ]);

      if (!goldRes.ok)  throw new Error(`Guldpris: HTTP ${goldRes.status}`);
      if (!fxRes.ok)    throw new Error(`USD/SEK: HTTP ${fxRes.status}`);

      const [goldJson, silverJson, fxJson] = await Promise.all([
        goldRes.json(),
        silverRes.ok ? silverRes.json() : Promise.resolve(null),
        fxRes.json(),
      ]);

      const goldUSDPerOz   = yfPrice(goldJson);
      const silverUSDPerOz = silverJson ? yfPrice(silverJson) : null;
      const usdSEK         = yfPrice(fxJson);

      if (!goldUSDPerOz) throw new Error('Ogiltigt guldpris från Yahoo Finance');
      if (!usdSEK)       throw new Error('Ogiltigt USD/SEK-svar från Yahoo Finance');

      const TROY_OZ_TO_GRAM = 31.1035;
      const goldSEKPerGram   = (goldUSDPerOz   / TROY_OZ_TO_GRAM) * usdSEK;
      const silverSEKPerGram = silverUSDPerOz ? (silverUSDPerOz / TROY_OZ_TO_GRAM) * usdSEK : null;

      // Persist successful fetch so we can show it on future failures
      const toCache: CachedPrices = {
        goldSEKPerGram, silverSEKPerGram, usdSEK,
        savedAt: new Date().toISOString(),
      };
      AsyncStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(toCache)).catch(() => {});

      setPrices({
        goldSEKPerGram, silverSEKPerGram, usdSEK,
        fetchedAt: new Date(), cachedAt: null,
        loading: false, error: null, fromCache: false,
      });
    } catch (e: unknown) {
      if ((e as Error)?.name === 'AbortError') return;
      const errMsg = (e as Error)?.message ?? 'Okänt fel vid hämtning av metallpriser';

      // Fall back to last cached prices if available
      let cached: CachedPrices | null = null;
      try {
        const raw = await AsyncStorage.getItem(PRICE_CACHE_KEY);
        if (raw) cached = JSON.parse(raw) as CachedPrices;
      } catch {}

      if (cached) {
        setPrices({
          goldSEKPerGram:   cached.goldSEKPerGram,
          silverSEKPerGram: cached.silverSEKPerGram ?? null,
          usdSEK:           cached.usdSEK,
          fetchedAt: null,
          cachedAt: new Date(cached.savedAt),
          loading: false,
          error: errMsg,
          fromCache: true,
        });
      } else {
        setPrices(p => ({
          ...p, loading: false, error: errMsg, fromCache: false,
        }));
      }
    }
  }, []);

  useEffect(() => {
    fetchPrices();
    return () => { abortRef.current?.abort(); };
  }, [fetchPrices]);

  return { ...prices, refetch: fetchPrices };
}

/** Pure gold grams from total weight and karat. */
function pureGoldGrams(totalGrams: number, karat: number): number {
  return (totalGrams / 24) * karat;
}

/** SEK value of a gold item. */
function goldItemValue(item: GoldItem, pricePerGram: number): number {
  const pg = pureGoldGrams(num(item.weightGrams), item.karat);
  return pg * pricePerGram;
}

function newGoldItem(): GoldItem {
  return { id: Math.random().toString(36).slice(2), weightGrams: '', karat: 18 };
}

// ─── Calculation Engine ───────────────────────────────────────────────────────

type CalcResult = {
  eligible: boolean;
  ineligibleReason: string | null;
  nisabGoldSEK: number;
  nisabSilverSEK: number;
  nisabApplied: number;   // the lower value
  nisabSource: 'guld' | 'silver';
  breakdown: { label: string; valueSEK: number }[];
  totalSEK: number;
  zakatSEK: number;
  aboveNisab: boolean;
  // missed years
  missedZakatTotal: number;
};

function calcAnnual(s: AnnualState): CalcResult | null {
  // Eligibility — all four conditions must be yes
  if (s.isMuslim === null) return null;

  const ineligible =
    !s.isMuslim
      ? 'Du måste vara muslim för att zakat ska vara obligatorisk.'
    : !s.heldFullYear
      ? 'Förmögenheten måste ha ägts i minst ett månårsår (~354 dagar).'
    : !s.assetAccessible
      ? 'Förmögenheten måste vara tillgänglig och fri (ej fryst, pantsatt eller förlorad).'
    : !s.assetHalal
      ? 'Obs: Förmögenhet förvärvad på haram-sätt inkluderas ändå i zakatsberäkningen.'
    : null;

  // For haram assets the booklet says they are still zakatable — only warn, don't block.
  const eligible = s.isMuslim === true && s.heldFullYear === true && s.assetAccessible === true;

  const goldPrice   = num(s.goldPricePerGram);
  const silverPrice = num(s.silverPricePerGram);

  // Nisab
  const nisabGoldSEK   = NISAB_GOLD_GRAMS * goldPrice;
  const nisabSilverSEK = NISAB_SILVER_GRAMS * silverPrice;
  // Use lower nisab per the booklet (safer, protective of the poor)
  const nisabApplied = (nisabSilverSEK > 0 && nisabSilverSEK < nisabGoldSEK)
    ? nisabSilverSEK : nisabGoldSEK;
  const nisabSource: 'guld' | 'silver' = (nisabSilverSEK > 0 && nisabSilverSEK < nisabGoldSEK)
    ? 'silver' : 'guld';

  // Assets
  const breakdown: { label: string; valueSEK: number }[] = [];

  // Cash
  const cash = num(s.cashSEK);
  if (cash > 0) breakdown.push({ label: 'Kontanter', valueSEK: cash });

  const bank = num(s.bankSEK);
  if (bank > 0) breakdown.push({ label: 'Banktillgångar', valueSEK: bank });

  // Gold — each item with pure gold formula
  if (s.goldItems.length > 0 && goldPrice > 0) {
    const totalGoldSEK = s.goldItems.reduce((acc, item) => acc + goldItemValue(item, goldPrice), 0);
    if (totalGoldSEK > 0) breakdown.push({ label: 'Guld (smycken, mynt, tackor)', valueSEK: totalGoldSEK });
  }

  // Silver
  const silverG = num(s.silverGrams);
  if (silverG > 0 && silverPrice > 0) {
    breakdown.push({ label: 'Silver', valueSEK: silverG * silverPrice });
  }

  // Trade goods — apply ownership %
  const ownerPct = Math.min(100, Math.max(0, num(s.ownershipPct))) / 100;
  const inventory   = num(s.inventoryValueSEK)  * ownerPct;
  const bizCash     = num(s.businessCashSEK)    * ownerPct;
  const receivables = num(s.receivablesSEK)     * ownerPct;
  const materials   = num(s.materialsSEK)       * ownerPct;
  if (inventory   > 0) breakdown.push({ label: 'Varulager',            valueSEK: inventory   });
  if (bizCash     > 0) breakdown.push({ label: 'Affärslikviditet',     valueSEK: bizCash     });
  if (receivables > 0) breakdown.push({ label: 'Kundfordringar',       valueSEK: receivables });
  if (materials   > 0) breakdown.push({ label: 'Råmaterial & tillbehör', valueSEK: materials });

  // Loans given (repayable)
  const loans = num(s.loansRepayableSEK);
  if (loans > 0) breakdown.push({ label: 'Lån att återfå', valueSEK: loans });

  // NOTE: Debts owed are NOT subtracted per the booklet.

  const totalSEK = breakdown.reduce((a, b) => a + b.valueSEK, 0);
  const aboveNisab = nisabApplied > 0 && totalSEK >= nisabApplied;
  const zakatSEK = (eligible && aboveNisab) ? totalSEK * ZAKAT_RATE : 0;

  // Missed years
  const missedZakatTotal = s.missedYears.reduce((acc, y) => {
    const v = num(y.totalAssets);
    return acc + (v >= nisabApplied && nisabApplied > 0 ? v * ZAKAT_RATE : 0);
  }, 0);

  return {
    eligible,
    ineligibleReason: ineligible,
    nisabGoldSEK, nisabSilverSEK, nisabApplied, nisabSource,
    breakdown, totalSEK, zakatSEK, aboveNisab,
    missedZakatTotal,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 16, marginBottom: 20 }}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={{
          flex: 1, height: 3, borderRadius: 2,
          backgroundColor: i < step ? '#668468' : 'rgba(128,128,128,0.2)',
        }} />
      ))}
    </View>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const { theme: T } = useTheme();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color: T.text, marginBottom: subtitle ? 4 : 0 }}>
        {title}
      </Text>
      {subtitle && (
        <Text style={{ fontSize: 13, color: T.textMuted, lineHeight: 18 }}>{subtitle}</Text>
      )}
    </View>
  );
}

function InfoBox({ text }: { text: string }) {
  const { theme: T } = useTheme();
  return (
    <View style={{
      backgroundColor: T.accentGlow,
      borderRadius: 10, padding: 12,
      marginBottom: 12,
    }}>
      <Text style={{ fontSize: 12, color: T.accent, lineHeight: 17 }}>{text}</Text>
    </View>
  );
}

function YesNoRow({
  label, value, onChange, T,
}: { label: string; value: boolean | null; onChange: (v: boolean) => void; T: any }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 14, color: T.text, marginBottom: 8, fontWeight: '500' }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {([true, false] as const).map(v => (
          <TouchableOpacity
            key={String(v)}
            onPress={() => onChange(v)}
            style={{
              flex: 1, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
              backgroundColor: value === v ? T.accent : T.card,
              borderWidth: 0.5,
              borderColor: value === v ? T.accent : T.border,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: value === v ? '#fff' : T.textMuted }}>
              {v ? 'Ja' : 'Nej'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function InputRow({
  label, value, onChangeText, placeholder, keyboardType = 'decimal-pad', unit, T,
}: {
  label: string; value: string; onChangeText: (s: string) => void;
  placeholder?: string; keyboardType?: 'decimal-pad' | 'number-pad';
  unit?: string; T: any;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, color: T.textMuted, marginBottom: 6, fontWeight: '500' }}>{label}</Text>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: T.card, borderRadius: 10, borderWidth: 0.5, borderColor: T.border,
        paddingHorizontal: 12, height: 44,
      }}>
        <TextInput
          style={{ flex: 1, fontSize: 15, color: T.text }}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? '0'}
          placeholderTextColor={T.textMuted}
          keyboardType={keyboardType}
        />
        {unit && <Text style={{ fontSize: 13, color: T.textMuted, marginLeft: 6 }}>{unit}</Text>}
      </View>
    </View>
  );
}

function KaratPicker({ value, onChange, T }: { value: number; onChange: (k: number) => void; T: any }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, color: T.textMuted, marginBottom: 8, fontWeight: '500' }}>Karat</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -2 }}>
        {KARAT_OPTIONS.map(o => (
          <TouchableOpacity
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{
              marginHorizontal: 3, paddingHorizontal: 10, height: 32, borderRadius: 8,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: value === o.value ? T.accent : T.card,
              borderWidth: 0.5, borderColor: value === o.value ? T.accent : T.border,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: value === o.value ? '#fff' : T.textMuted }}>
              {o.value}k
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function StepButtons({
  onBack, onNext, backLabel = 'Tillbaka', nextLabel = 'Nästa', T,
}: {
  onBack?: () => void; onNext: () => void;
  backLabel?: string; nextLabel?: string; T: any;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 24 }}>
      {onBack && (
        <TouchableOpacity
          onPress={onBack}
          style={{
            flex: 1, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
            backgroundColor: T.card, borderWidth: 0.5, borderColor: T.border,
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: '600', color: T.textMuted }}>{backLabel}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        onPress={onNext}
        style={{
          flex: onBack ? 2 : 1, height: 48, borderRadius: 14,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: T.accent,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>{nextLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

function ResultRow({
  label, value, accent = false, large = false, T,
}: { label: string; value: string; accent?: boolean; large?: boolean; T: any }) {
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 10, borderBottomWidth: 0.5, borderColor: T.border,
    }}>
      <Text style={{
        fontSize: large ? 15 : 13,
        fontWeight: large ? '700' : '500',
        color: T.text, flex: 1,
      }}>{label}</Text>
      <Text style={{
        fontSize: large ? 16 : 14,
        fontWeight: '700',
        color: accent ? T.accent : T.text,
      }}>{value}</Text>
    </View>
  );
}

// ─── Annual Zakat Wizard ──────────────────────────────────────────────────────

function AnnualZakatWizard({
  state, setState,
}: { state: AnnualState; setState: (f: (p: AnnualState) => AnnualState) => void }) {
  const { theme: T } = useTheme();
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 6;

  const result = useMemo(() => calcAnnual(state), [state]);
  const livePrices = useLiveMetalPrices();

  // Helpers
  const set = <K extends keyof AnnualState>(k: K, v: AnnualState[K]) =>
    setState(p => ({ ...p, [k]: v }));

  const addGoldItem = () =>
    setState(p => ({ ...p, goldItems: [...p.goldItems, newGoldItem()] }));

  const removeGoldItem = (id: string) =>
    setState(p => ({ ...p, goldItems: p.goldItems.filter(g => g.id !== id) }));

  const updateGoldItem = (id: string, patch: Partial<GoldItem>) =>
    setState(p => ({
      ...p,
      goldItems: p.goldItems.map(g => g.id === id ? { ...g, ...patch } : g),
    }));

  const addMissedYear = () =>
    setState(p => ({
      ...p,
      missedYears: [...p.missedYears, { year: String(new Date().getFullYear() - p.missedYears.length - 1), totalAssets: '' }],
    }));

  const removeMissedYear = (idx: number) =>
    setState(p => ({ ...p, missedYears: p.missedYears.filter((_, i) => i !== idx) }));

  const updateMissedYear = (idx: number, patch: Partial<MissedYear>) =>
    setState(p => ({
      ...p,
      missedYears: p.missedYears.map((y, i) => i === idx ? { ...y, ...patch } : y),
    }));

  const validate = (): string | null => {
    if (step === 1) {
      if (state.isMuslim === null)       return 'Svara på alla frågor för att fortsätta.';
      if (state.heldFullYear === null)   return 'Svara på alla frågor för att fortsätta.';
      if (state.assetAccessible === null) return 'Svara på alla frågor för att fortsätta.';
      if (state.assetHalal === null)     return 'Svara på alla frågor för att fortsätta.';
      if (!state.isMuslim)              return null; // Will show ineligible on step 6
      if (!state.heldFullYear)          return null;
      if (!state.assetAccessible)       return null;
    }
    if (step === 2) {
      if (!num(state.goldPricePerGram) && !num(state.silverPricePerGram))
        return 'Ange minst ett metallpris för att beräkna nisab.';
    }
    return null;
  };

  const next = () => {
    const err = validate();
    if (err) { Alert.alert('Kontrollera', err); return; }
    setStep(s => Math.min(TOTAL_STEPS, s + 1));
  };

  const back = () => setStep(s => Math.max(1, s - 1));

  // ── Step 1: Eligibility ────────────────────────────────────────────────────
  const renderStep1 = () => (
    <>
      <SectionTitle
        title="Berättigande"
        subtitle="Zakat är obligatorisk om alla fyra villkor uppfylls."
      />
      <InfoBox text="Zakat är en av islams fem pelare och obligatorisk för varje muslim som äger egendom över nisab-gränsen under ett fullt månårsår." />
      <YesNoRow label="Är du muslim?" value={state.isMuslim} onChange={v => set('isMuslim', v)} T={T} />
      <YesNoRow
        label="Har du ägt förmögenheten i minst ett månårsår (~354 dagar)?"
        value={state.heldFullYear}
        onChange={v => set('heldFullYear', v)}
        T={T}
      />
      <YesNoRow
        label="Är förmögenheten tillgänglig och fri (ej fryst, pantsatt eller bortglömd)?"
        value={state.assetAccessible}
        onChange={v => set('assetAccessible', v)}
        T={T}
      />
      <YesNoRow
        label="Är förmögenheten förvärvad på halal-sätt?"
        value={state.assetHalal}
        onChange={v => set('assetHalal', v)}
        T={T}
      />
      {state.assetHalal === false && (
        <InfoBox text="Förmögenhet förvärvad på haram-sätt inkluderas ändå i zakatsberäkningen enligt den säkrare åsikten." />
      )}
      <StepButtons onNext={next} nextLabel="Nästa" T={T} />
    </>
  );

  // ── Step 2: Metal prices for Nisab ────────────────────────────────────────
  const renderStep2 = () => {
    const gp = num(state.goldPricePerGram);
    const sp = num(state.silverPricePerGram);
    const nisabG = gp > 0 ? NISAB_GOLD_GRAMS * gp : null;
    const nisabS = sp > 0 ? NISAB_SILVER_GRAMS * sp : null;

    const applyLivePrices = () => {
      if (livePrices.goldSEKPerGram !== null)
        set('goldPricePerGram', livePrices.goldSEKPerGram.toFixed(2));
      if (livePrices.silverSEKPerGram !== null)
        set('silverPricePerGram', livePrices.silverSEKPerGram.toFixed(2));
    };

    return (
      <>
        <SectionTitle
          title="Metallpriser & Nisab"
          subtitle="Aktuella spotpriser hämtas automatiskt. Du kan justera dem manuellt."
        />
        <InfoBox
          text={`Nisab beräknas på det LÄGRE av guldnisab (${NISAB_GOLD_GRAMS} g guld) och silvernisab (${NISAB_SILVER_GRAMS} g silver). Den lägre gränsen används för att skydda de fattiga.`}
        />

        {/* Live price suggestion card */}
        <View style={{
          backgroundColor: T.card, borderRadius: 12, padding: 14, marginBottom: 14,
          borderWidth: 0.5, borderColor: T.border,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: T.text }}>Rekommenderat pris</Text>
            <TouchableOpacity onPress={livePrices.refetch} disabled={livePrices.loading} style={{ padding: 4 }}>
              <Text style={{ fontSize: 12, color: livePrices.loading ? T.textMuted : T.accent, fontWeight: '600' }}>
                {livePrices.loading ? 'Hämtar…' : 'Uppdatera'}
              </Text>
            </TouchableOpacity>
          </View>

          {livePrices.loading && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color={T.accent} />
              <Text style={{ fontSize: 12, color: T.textMuted }}>
                Hämtar priser från Yahoo Finance…
              </Text>
            </View>
          )}

          {/* Error without cache: ask user to enter manually */}
          {!!livePrices.error && !livePrices.loading && !livePrices.fromCache && (
            <Text style={{ fontSize: 12, color: '#FF3B30', lineHeight: 17 }}>
              {livePrices.error}. Ange priset manuellt nedan.
            </Text>
          )}

          {livePrices.goldSEKPerGram !== null && !livePrices.loading && (
            <>
              <View style={{ gap: 4, marginBottom: livePrices.fromCache ? 8 : 12 }}>
                <Text style={{ fontSize: 14, color: T.text }}>
                  {'Guld: '}
                  <Text style={{ fontWeight: '700', color: T.accent }}>
                    {livePrices.goldSEKPerGram.toFixed(2)} kr/g
                  </Text>
                </Text>
                {livePrices.silverSEKPerGram !== null && (
                  <Text style={{ fontSize: 14, color: T.text }}>
                    {'Silver: '}
                    <Text style={{ fontWeight: '700', color: T.accent }}>
                      {livePrices.silverSEKPerGram.toFixed(2)} kr/g
                    </Text>
                  </Text>
                )}
                {!livePrices.fromCache && (
                  <>
                    <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                      {`USD/SEK: ${livePrices.usdSEK?.toFixed(4)}`}
                      {livePrices.fetchedAt
                        ? ` · Uppdaterad ${livePrices.fetchedAt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`
                        : ''}
                    </Text>
                    <Text style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic' }}>
                      Källa: Yahoo Finance (GC=F, SI=F, USDSEK=X)
                    </Text>
                  </>
                )}
              </View>

              {/* Stale-cache warning — shown only when live fetch failed */}
              {livePrices.fromCache && (
                <View style={{
                  backgroundColor: '#FF9500' + '18',
                  borderRadius: 8, padding: 10, marginBottom: 12,
                  borderWidth: 0.5, borderColor: '#FF9500' + '50',
                }}>
                  <Text style={{ fontSize: 12, color: '#FF9500', lineHeight: 17 }}>
                    {'⚠ Kunde inte hämta aktuellt pris. Visar senast hämtade pris'}
                    {livePrices.cachedAt
                      ? ` (${livePrices.cachedAt.toLocaleDateString('sv-SE')})`
                      : ''}
                    {'. Kontrollera alltid priset innan du genomför beräkningen.'}
                  </Text>
                </View>
              )}

              <TouchableOpacity
                onPress={applyLivePrices}
                style={{
                  height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: T.accentGlow, borderWidth: 0.5, borderColor: T.accent,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: T.accent }}>
                  Använd rekommenderat pris
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Disclaimer */}
        <View style={{
          backgroundColor: '#FF3B3012', borderRadius: 10, padding: 12, marginBottom: 14,
          borderWidth: 0.5, borderColor: '#FF3B3030',
        }}>
          <Text style={{ fontSize: 12, color: '#FF3B30', lineHeight: 18 }}>
            {'Kontrollera alltid det senaste guld- och silverpriset per gram — priset varierar dagligen.\n'}
            <Text style={{ fontWeight: '600' }}>Rekommenderade källor: </Text>
            {'goldprice.org  ·  metals.live  ·  kitco.com'}
          </Text>
        </View>

        {/* Editable inputs */}
        <InputRow
          label="Guldpris per gram"
          value={state.goldPricePerGram}
          onChangeText={v => set('goldPricePerGram', v)}
          unit="kr/g"
          T={T}
        />
        <InputRow
          label="Silverpris per gram"
          value={state.silverPricePerGram}
          onChangeText={v => set('silverPricePerGram', v)}
          unit="kr/g"
          T={T}
        />

        {/* Live nisab preview */}
        {(nisabG !== null || nisabS !== null) && (
          <View style={{
            backgroundColor: T.card, borderRadius: 12, padding: 14, marginBottom: 12,
            borderWidth: 0.5, borderColor: T.border,
          }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: T.text, marginBottom: 8 }}>Beräknat nisab</Text>
            {nisabG !== null && (
              <Text style={{ fontSize: 13, color: T.textMuted, marginBottom: 4 }}>
                {`Guld (${NISAB_GOLD_GRAMS} g): ${fmtSEK(nisabG)}`}
              </Text>
            )}
            {nisabS !== null && (
              <Text style={{ fontSize: 13, color: T.textMuted, marginBottom: 4 }}>
                {`Silver (${NISAB_SILVER_GRAMS} g): ${fmtSEK(nisabS)}`}
              </Text>
            )}
            {nisabG !== null && nisabS !== null && (
              <Text style={{ fontSize: 13, fontWeight: '700', color: T.accent, marginTop: 4 }}>
                {`Tillämpas: ${fmtSEK(Math.min(nisabG, nisabS))} (${nisabS < nisabG ? 'silver' : 'guld'})`}
              </Text>
            )}
          </View>
        )}

        <StepButtons onBack={back} onNext={next} T={T} />
      </>
    );
  };

  // ── Step 3: Gold & Silver ─────────────────────────────────────────────────
  const renderStep3 = () => (
    <>
      <SectionTitle
        title="Guld & Silver"
        subtitle="Smycken, mynt och tackor är alla zakatspliktiga."
      />
      <InfoBox text="Zakatsformeln för guld: Rent guld (g) = total vikt ÷ 24 × karat. Alla guldtyper inkluderas — smycken, mynt och tackor." />

      <Text style={{ fontSize: 15, fontWeight: '600', color: T.text, marginBottom: 10 }}>Guld</Text>
      {state.goldItems.map((item, idx) => (
        <View key={item.id} style={{
          backgroundColor: T.card, borderRadius: 12, padding: 12, marginBottom: 10,
          borderWidth: 0.5, borderColor: T.border,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: T.text }}>Guldföremål {idx + 1}</Text>
            <TouchableOpacity onPress={() => removeGoldItem(item.id)}>
              <Text style={{ fontSize: 13, color: '#FF3B30' }}>Ta bort</Text>
            </TouchableOpacity>
          </View>
          <InputRow
            label="Vikt (gram)"
            value={item.weightGrams}
            onChangeText={v => updateGoldItem(item.id, { weightGrams: v })}
            unit="g"
            T={T}
          />
          <KaratPicker value={item.karat} onChange={k => updateGoldItem(item.id, { karat: k })} T={T} />
          {num(item.weightGrams) > 0 && (
            <Text style={{ fontSize: 12, color: T.accent }}>
              Rent guld: {fmt(pureGoldGrams(num(item.weightGrams), item.karat), 2)} g
              {num(state.goldPricePerGram) > 0 && ` · ${fmtSEK(goldItemValue(item, num(state.goldPricePerGram)))}`}
            </Text>
          )}
        </View>
      ))}
      <TouchableOpacity
        onPress={addGoldItem}
        style={{
          height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: T.accent, borderStyle: 'dashed', marginBottom: 16,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '600', color: T.accent }}>+ Lägg till guldföremål</Text>
      </TouchableOpacity>

      <Text style={{ fontSize: 15, fontWeight: '600', color: T.text, marginBottom: 10 }}>Silver</Text>
      <InputRow label="Total silvervikt" value={state.silverGrams} onChangeText={v => set('silverGrams', v)} unit="g" T={T} />
      {num(state.silverGrams) > 0 && num(state.silverPricePerGram) > 0 && (
        <Text style={{ fontSize: 12, color: T.accent, marginTop: -8, marginBottom: 12 }}>
          Värde: {fmtSEK(num(state.silverGrams) * num(state.silverPricePerGram))}
        </Text>
      )}

      <StepButtons onBack={back} onNext={next} T={T} />
    </>
  );

  // ── Step 4: Cash & Trade ──────────────────────────────────────────────────
  const renderStep4 = () => (
    <>
      <SectionTitle
        title="Kontanter & Handelsgods"
        subtitle="Ange all tillgänglig förmögenhet i pengar och handel."
      />
      <InfoBox text="Skulder du är skyldig dras INTE av från zakatsunderlaget. Zakat betalas på det man äger, inte på nettotillgångar." />

      <Text style={{ fontSize: 14, fontWeight: '600', color: T.text, marginBottom: 10 }}>Pengar</Text>
      <InputRow label="Kontanter" value={state.cashSEK} onChangeText={v => set('cashSEK', v)} unit="kr" T={T} />
      <InputRow label="Banktillgångar" value={state.bankSEK} onChangeText={v => set('bankSEK', v)} unit="kr" T={T} />

      <View style={{ height: 1, backgroundColor: T.border, marginVertical: 12 }} />
      <Text style={{ fontSize: 14, fontWeight: '600', color: T.text, marginBottom: 10 }}>Handelsgods & Företag</Text>
      <InputRow
        label="Din ägarandel i företaget"
        value={state.ownershipPct}
        onChangeText={v => set('ownershipPct', v)}
        unit="%"
        T={T}
      />
      <InputRow label="Varulager (marknadsvärde)" value={state.inventoryValueSEK} onChangeText={v => set('inventoryValueSEK', v)} unit="kr" T={T} />
      <InputRow label="Affärslikviditet (kassa/bank)" value={state.businessCashSEK} onChangeText={v => set('businessCashSEK', v)} unit="kr" T={T} />
      <InputRow label="Kundfordringar (förväntade intäkter)" value={state.receivablesSEK} onChangeText={v => set('receivablesSEK', v)} unit="kr" T={T} />
      <InputRow label="Råmaterial & tillbehör" value={state.materialsSEK} onChangeText={v => set('materialsSEK', v)} unit="kr" T={T} />

      <StepButtons onBack={back} onNext={next} T={T} />
    </>
  );

  // ── Step 5: Loans & Missed Years ──────────────────────────────────────────
  const renderStep5 = () => (
    <>
      <SectionTitle
        title="Fordringar & Missade år"
        subtitle="Lån du kan kräva tillbaka och eventuella ej betalda zakatår."
      />
      <InfoBox text="Lån du gett ut som förväntas återbetalas inkluderas. Stulna eller förlorade tillgångar inkluderas inte — om de återfås betalas zakat för ett år." />
      <InputRow
        label="Lån du kan kräva tillbaka (förväntade)"
        value={state.loansRepayableSEK}
        onChangeText={v => set('loansRepayableSEK', v)}
        unit="kr"
        T={T}
      />

      <View style={{ height: 1, backgroundColor: T.border, marginVertical: 12 }} />
      <Text style={{ fontSize: 14, fontWeight: '600', color: T.text, marginBottom: 4 }}>Missade zakatår</Text>
      <Text style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>
        Om du missat att betala zakat tidigare år kan du beräkna det här. Ange ungefärliga totaltillgångar för respektive år.
      </Text>
      {state.missedYears.map((y, idx) => (
        <View key={idx} style={{
          backgroundColor: T.card, borderRadius: 10, padding: 12, marginBottom: 10,
          borderWidth: 0.5, borderColor: T.border, flexDirection: 'row', gap: 8,
        }}>
          <View style={{ flex: 1 }}>
            <InputRow label="År" value={y.year} onChangeText={v => updateMissedYear(idx, { year: v })} keyboardType="number-pad" T={T} />
            <InputRow label="Totala tillgångar det året" value={y.totalAssets} onChangeText={v => updateMissedYear(idx, { totalAssets: v })} unit="kr" T={T} />
          </View>
          <TouchableOpacity onPress={() => removeMissedYear(idx)} style={{ justifyContent: 'center', paddingLeft: 4 }}>
            <Text style={{ fontSize: 13, color: '#FF3B30' }}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity
        onPress={addMissedYear}
        style={{
          height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: T.accent, borderStyle: 'dashed', marginBottom: 16,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '600', color: T.accent }}>+ Lägg till missat år</Text>
      </TouchableOpacity>

      <StepButtons onBack={back} onNext={next} nextLabel="Beräkna" T={T} />
    </>
  );

  // ── Step 6: Result ────────────────────────────────────────────────────────
  const renderStep6 = () => {
    if (!result) return null;
    const notEligible = !result.eligible;
    return (
      <>
        <SectionTitle title="Resultat" />

        {/* Eligibility / Ineligibility notice */}
        {result.ineligibleReason && (
          <View style={{
            backgroundColor: '#FF3B3018', borderRadius: 10, padding: 12, marginBottom: 14,
          }}>
            <Text style={{ fontSize: 13, color: '#FF3B30', lineHeight: 18 }}>
              {result.ineligibleReason}
            </Text>
          </View>
        )}
        {state.assetHalal === false && (
          <InfoBox text="Obs: Förmögenhet förvärvad på haram-sätt är ändå zakatspliktigt. Zakat är inkluderad i beräkningen nedan." />
        )}

        {/* Nisab summary */}
        <View style={{
          backgroundColor: T.card, borderRadius: 12, padding: 14, marginBottom: 14,
          borderWidth: 0.5, borderColor: T.border,
        }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: T.text, marginBottom: 10 }}>Nisab-gräns</Text>
          <ResultRow label={`Guldnisab (${NISAB_GOLD_GRAMS} g)`} value={result.nisabGoldSEK > 0 ? fmtSEK(result.nisabGoldSEK) : 'Pris saknas'} T={T} />
          <ResultRow label={`Silvernisab (${NISAB_SILVER_GRAMS} g)`} value={result.nisabSilverSEK > 0 ? fmtSEK(result.nisabSilverSEK) : 'Pris saknas'} T={T} />
          <ResultRow
            label="Tillämpas (lägst)"
            value={result.nisabApplied > 0 ? `${fmtSEK(result.nisabApplied)} (${result.nisabSource})` : 'Pris saknas'}
            accent
            T={T}
          />
        </View>

        {/* Asset breakdown */}
        {result.breakdown.length > 0 && (
          <View style={{
            backgroundColor: T.card, borderRadius: 12, padding: 14, marginBottom: 14,
            borderWidth: 0.5, borderColor: T.border,
          }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: T.text, marginBottom: 10 }}>Tillgångar</Text>
            {result.breakdown.map(b => (
              <ResultRow key={b.label} label={b.label} value={fmtSEK(b.valueSEK)} T={T} />
            ))}
            <ResultRow label="Totalt" value={fmtSEK(result.totalSEK)} large T={T} />
          </View>
        )}

        {/* Zakat due */}
        <View style={{
          backgroundColor: result.aboveNisab && result.eligible
            ? T.accentGlow : T.card,
          borderRadius: 12, padding: 14, marginBottom: 14,
          borderWidth: 0.5,
          borderColor: result.aboveNisab && result.eligible ? T.accent : T.border,
        }}>
          {notEligible ? (
            <Text style={{ fontSize: 14, color: T.textMuted }}>Zakat är inte obligatorisk baserat på dina svar.</Text>
          ) : !result.aboveNisab ? (
            <>
              <Text style={{ fontSize: 14, fontWeight: '700', color: T.text, marginBottom: 6 }}>
                Under nisab-gränsen
              </Text>
              <Text style={{ fontSize: 13, color: T.textMuted }}>
                Dina zakatspliktiga tillgångar ({fmtSEK(result.totalSEK)}) överstiger inte nisab-gränsen ({result.nisabApplied > 0 ? fmtSEK(result.nisabApplied) : '–'}). Ingen zakat är skyldig.
              </Text>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 14, fontWeight: '700', color: T.text, marginBottom: 10 }}>
                Zakat att betala (2,5%)
              </Text>
              <ResultRow label="Totalt underlag" value={fmtSEK(result.totalSEK)} T={T} />
              <ResultRow label="Zakat (2,5%)" value={fmtSEK(result.zakatSEK)} accent large T={T} />
            </>
          )}
        </View>

        {/* Missed years */}
        {result.missedZakatTotal > 0 && (
          <View style={{
            backgroundColor: T.card, borderRadius: 12, padding: 14, marginBottom: 14,
            borderWidth: 0.5, borderColor: T.border,
          }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: T.text, marginBottom: 6 }}>Missade zakatår</Text>
            {state.missedYears.map((y, i) => {
              const v = num(y.totalAssets);
              const z = v >= result.nisabApplied && result.nisabApplied > 0 ? v * ZAKAT_RATE : 0;
              return (
                <ResultRow key={i} label={`År ${y.year}`} value={z > 0 ? fmtSEK(z) : 'Under nisab'} T={T} />
              );
            })}
            <ResultRow label="Totalt att betala (missade år)" value={fmtSEK(result.missedZakatTotal)} large accent T={T} />
          </View>
        )}

        {/* Recipients info */}
        <View style={{
          backgroundColor: T.card, borderRadius: 12, padding: 14, marginBottom: 14,
          borderWidth: 0.5, borderColor: T.border,
        }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: T.text, marginBottom: 8 }}>Zakatmottagare (8 kategorier)</Text>
          {[
            'De fattiga (al-fuqarāʾ)',
            'De behövande (al-masākīn)',
            'Zakatinsamlare (al-ʿāmilīna ʿalayhā)',
            'Hjärtans försoning (al-muʾallafati qulūbuhum)',
            'Frisläppande av fångar/slavar (fī al-riqāb)',
            'Skuldsatta (al-ghārimūn)',
            'Allahs väg – dawa & goda syften (fī sabīl Allāh)',
            'Resande utan medel (ibn al-sabīl)',
          ].map((r, i) => (
            <Text key={i} style={{ fontSize: 12, color: T.textMuted, marginBottom: 3 }}>• {r}</Text>
          ))}
          <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 8, fontStyle: 'italic' }}>
            Zakat kan fördelas på flera mottagare. Föräldrar och barn får inte ta emot zakat från varandra.
          </Text>
        </View>

        <StepButtons onBack={back} onNext={() => setStep(1)} nextLabel="Börja om" T={T} />
      </>
    );
  };

  const stepContent = [renderStep1, renderStep2, renderStep3, renderStep4, renderStep5, renderStep6];

  return (
    <>
      <ProgressBar step={step} total={TOTAL_STEPS} />
      {stepContent[step - 1]?.()}
    </>
  );
}

// ─── Zakat al-Fitr ────────────────────────────────────────────────────────────

function ZakatAlFitrCalc({
  state, setState,
}: { state: FitrState; setState: (f: (p: FitrState) => FitrState) => void }) {
  const { theme: T } = useTheme();

  const set = <K extends keyof FitrState>(k: K, v: FitrState[K]) =>
    setState(p => ({ ...p, [k]: v }));

  const adults   = Math.max(0, Math.round(num(state.adults)));
  const children = Math.max(0, Math.round(num(state.children)));
  const totalPersons = adults + children;
  const totalKg = totalPersons * FITR_KG_PER_PERSON;
  const price = num(state.foodPricePerKg);
  const totalSEK = price > 0 ? totalKg * price : null;

  return (
    <>
      <SectionTitle
        title="Zakat al-Fitr"
        subtitle="Betalas före Eid-bönen på Ramadans sista dag. Obligatorisk för varje muslim som har råd."
      />
      <InfoBox text={`Varje person (vuxen och barn) betalar ${FITR_KG_PER_PERSON} kg av ett baslivsmedel (t.ex. ris, vete, dadlar, korn eller russin).`} />

      <InputRow
        label="Antal vuxna"
        value={state.adults}
        onChangeText={v => set('adults', v)}
        keyboardType="number-pad"
        T={T}
      />
      <InputRow
        label="Antal barn"
        value={state.children}
        onChangeText={v => set('children', v)}
        keyboardType="number-pad"
        T={T}
      />
      <InputRow
        label="Pris per kg (valfritt)"
        value={state.foodPricePerKg}
        onChangeText={v => set('foodPricePerKg', v)}
        placeholder="Valfritt"
        unit="kr/kg"
        T={T}
      />

      {totalPersons > 0 && (
        <View style={{
          backgroundColor: T.accentGlow, borderRadius: 12, padding: 16, marginTop: 8,
          borderWidth: 0.5, borderColor: T.accent,
        }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: T.text, marginBottom: 10 }}>Resultat</Text>
          <ResultRow label="Totalt antal personer" value={String(totalPersons)} T={T} />
          <ResultRow label={`${FITR_KG_PER_PERSON} kg × ${totalPersons} pers.`} value={fmtKg(totalKg)} accent large T={T} />
          {totalSEK !== null && (
            <ResultRow label="Uppskattat värde" value={fmtSEK(totalSEK)} T={T} />
          )}
          <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 10 }}>
            Zakat al-Fitr betalas senast före Eid-bönen. Den som är ansvarig (familjens försörjare) betalar för sig själv och dem i hans/hennes hushåll.
          </Text>
        </View>
      )}

      <View style={{
        backgroundColor: T.card, borderRadius: 12, padding: 14, marginTop: 14,
        borderWidth: 0.5, borderColor: T.border,
      }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: T.text, marginBottom: 8 }}>Regler att notera</Text>
        {[
          'Betalas senast innan Eid-bönen börjar.',
          'Obligatorisk för alla muslimer som har råd — vuxna och barn.',
          'Familjens försörjare betalar för hela hushållet.',
          'Mängd: 3 kg baslivsmedel per person.',
          'Kan ges som matvaruvärde i pengar (om lokala scholars tillåter).',
          'Prioritera att ge till de fattiga i din närmaste omgivning.',
        ].map((r, i) => (
          <Text key={i} style={{ fontSize: 12, color: T.textMuted, marginBottom: 3 }}>• {r}</Text>
        ))}
      </View>

      <View style={{ marginBottom: 24 }} />
    </>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ZakatScreen() {
  const router = useRouter();
  const { theme: T } = useTheme();
  const [tab, setTab] = useState<'annual' | 'fitr'>('annual');
  const { annual, setAnnual, fitr, setFitr } = useZakatStorage();

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      {/* Header */}
      <View style={{
        paddingTop: 56, paddingHorizontal: 16, paddingBottom: 10,
        flexDirection: 'row', alignItems: 'center',
      }}>
        <BackButton onPress={() => router.back()} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, marginLeft: 12 }}>
          <SvgIcon name="zakat" size={24} color={T.accent} />
          <Text style={{ fontSize: 22, fontWeight: '700', color: T.text }}>Zakat kalkylator</Text>
        </View>
      </View>

      {/* Tab switcher */}
      <View style={{
        flexDirection: 'row', marginHorizontal: 16, marginBottom: 8,
        backgroundColor: T.card, borderRadius: 12, padding: 3,
        borderWidth: 0.5, borderColor: T.border,
      }}>
        {([
          { key: 'annual', label: 'Årlig zakat' },
          { key: 'fitr',   label: 'Zakat al-Fitr' },
        ] as const).map(t => (
          <TouchableOpacity
            key={t.key}
            onPress={() => setTab(t.key)}
            style={{
              flex: 1, height: 34, borderRadius: 10,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: tab === t.key ? T.accent : 'transparent',
            }}
          >
            <Text style={{
              fontSize: 13, fontWeight: '600',
              color: tab === t.key ? '#fff' : T.textMuted,
            }}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ paddingTop: 8 }}>
            {tab === 'annual'
              ? <AnnualZakatWizard state={annual} setState={setAnnual} />
              : <ZakatAlFitrCalc state={fitr} setState={setFitr} />
            }
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// (All layout is inline to respect the existing app pattern)
const _styles = StyleSheet.create({});
