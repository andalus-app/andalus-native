import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, useWindowDimensions } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useApp } from '../context/AppContext';

// ── constants ─────────────────────────────────────────────────────────────────

const GOLD    = '#c9a84c';
const CARD_H  = 200;   // total fixed height including padding — never changes
const CARD_PH = 14;
const CARD_PV = 12;
const GAP     = 8;
const PEEK    = 20;    // px of next card visible on right edge

// ── tiny helpers ──────────────────────────────────────────────────────────────

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function fmtShortDate(d: Date): string {
  const day   = d.getDate();
  const month = capitalize(d.toLocaleDateString('sv-SE', { month: 'long' }));
  return `${day} ${month}`;
}

function getDates(hijriDate: any, testMode: boolean) {
  const today = new Date();
  if (testMode) {
    const day1 = addDays(today, -1); // dag 2 → dag 1 var igår
    return { day1, day9: addDays(day1, 8), day10: addDays(day1, 9), currentDay: 2 };
  }
  if (!hijriDate || hijriDate.month?.number !== 12) return null;
  const d = parseInt(String(hijriDate.day), 10);
  // Extend to day 13 so the component survives the Tashriq days
  if (isNaN(d) || d < 1 || d > 13) return null;
  const day1 = addDays(today, -(d - 1));
  return { day1, day9: addDays(day1, 8), day10: addDays(day1, 9), currentDay: d };
}

// ── slide data ────────────────────────────────────────────────────────────────

type SlideVariant = 'splash' | 'overview' | 'info' | 'quote' | 'dual-quote' | 'text' | 'deeds' | 'tashriq';

type Slide = {
  id: string;
  variant: SlideVariant;
  title: string;
  subtitle?: string;
  body?: string;
  quote?: string;
  reference?: string;
  secondBody?: string;
  secondQuote?: string;
  secondReference?: string;
  bullets?: string[];
  footer?: string;
};

// Two Tashriq slides — shown from Fajr day 9 through Maghrib day 13.
const TASHRIQ_SLIDES: Slide[] = [
  {
    id: 'tashriq-1',
    variant: 'tashriq',
    title: 'Tashriq-dagarna',
    subtitle: 'Dagar fyllda med dhikr och tacksamhet',
    body:
      'Att minnas Allah under tashriq-dagarna är en stor handling av dyrkan. ' +
      'Bland det bästa man kan göra är att recitera takbîr efter de obligatoriska bönerna:',
    quote:
      'Allahu Akbar Allahu Akbar, lâ ilâha illa-Allah,\n' +
      'wa-Allahu Akbar, Allahu Akbar, wa lillâhil-hamd.',
  },
  {
    id: 'tashriq-2',
    variant: 'tashriq',
    title: 'Tashriq-dagarna',
    subtitle: 'Takbîrens betydelse',
    body: 'Detta betyder:',
    quote:
      'Allah är större, Allah är större.\n' +
      'Ingen har rätt att dyrkas förutom Allah.\n' +
      'Allah är större, Allah är större, och all pris och tacksamhet tillhör Allah.',
    secondQuote: 'Och prisa Allah under de [tre] fastställda dagarna.',
    reference: 'Koranen 2:203',
    footer:
      'Takbîr reciteras direkt efter de obligatoriska bönerna från Fajr på Arafah-dagen fram till slutet av den tredje tashriq-dagen.',
  },
];

function buildSlides(
  day1: Date | null,
  day9: Date | null,
  day10: Date | null,
): Slide[] {
  const infoBullets: string[] = [
    'De 10 första dagarna är bland årets mest välsignade.',
  ];
  if (day1)  infoBullets.push(`1 Dhul Hijjah — ${fmtShortDate(day1)}`);
  if (day9)  infoBullets.push(`Arafah-dagen — ${fmtShortDate(day9)}`);
  if (day10) infoBullets.push(`Eid al-Adha — ${fmtShortDate(day10)}`);

  return [
    {
      id: 's1',
      variant: 'info',
      title: 'Dhul Hijjah',
      body: 'och de 10 bästa dagarna på året',
      bullets: [
        'Vad är Dhul Hijjah?',
        'Vad står i Koranen och haditherna?',
        "Dygden av att fasta på 'Arafah-dagen!",
        'Eid ul-Adha.',
      ],
      footer: 'Svep för att läsa mer →',
    },
    {
      id: 's2',
      variant: 'info',
      title: 'Vad är Dhul Hijjah?',
      body: 'Dhul Hijjah är den 12:e månaden i den islamiska kalendern — en av islams fyra heliga månader.',
      bullets: infoBullets,
    },
    {
      id: 's3',
      variant: 'quote',
      title: 'Från Koranen',
      body: 'Allah säger i betydelse:',
      quote: '"Vid gryningen. Och vid de tio nätterna."',
      reference: 'Surah Al-Fajr 89:1–2',
      footer: 'Många lärda tolkar de tio nätterna som de första tio dagarna av Dhul Hijjah.',
    },
    {
      id: 's4',
      variant: 'quote',
      title: 'De bästa dagarna',
      body: 'Profeten ﷺ sade:',
      quote: '"Det finns inga dagar då goda handlingar är mer älskade av Allah än under dessa tio dagar."',
      reference: 'Sunan Abu Dawud 2438',
    },
    {
      id: 's5a',
      variant: 'quote',
      title: 'Fastan på Arafah (dag 9)',
      body: 'Profeten ﷺ sade:',
      quote: '"Den som fastar ʼArafah-dagen förlåts för det föregående året och det eftergående året."',
      reference: '[Sahih Targhib wat-Tarhib]',
    },
    {
      id: 's5a2',
      variant: 'quote',
      title: 'Fastan på Arafah (dag 9)',
      body: "Abu Qatadah (må Allah vara nöjd med honom) berättade att Allahs Sändebud ﷺ blev tillfrågad om fastan på 'Arafah-dagen. Han ﷺ sade:",
      quote: '"Den stryker bort förra årets och det resterande årets synder."',
      reference: '[Sahih Targhib wat-Tarhib]',
    },
    {
      id: 's5b',
      variant: 'text',
      title: 'Kan fasta även om man har dagar att ta igen från Ramadan?',
      body: 'Vissa lärda har den åsikten att man kan göra det, det finns även åsikter om man kan kombinera sin avsikt att ta igen en Ramadan-dag samtidigt som man har avsikt att fasta Arafah dagen och Allah vet bäst.',
    },
    {
      id: 's6',
      variant: 'deeds',
      title: 'Goda handlingar',
      bullets: [
        'Fasta, särskilt Arafah-dagen',
        'Dhikr: Allahu Akbar, Alhamdulillah, La ilaha illa Allah',
        'Extra böner',
        'Sadaqah',
        'Koran-läsning',
        'Qurbani/Udhiyyah på Eid',
      ],
      footer: 'Du kan kontakta en välgörenhetsorganisation för Qurbani/Udhiyyah.',
    },
  ];
}

// ── slide content renderers ───────────────────────────────────────────────────

function SlideOverview({ slide, T, isDark }: { slide: Slide; T: any; isDark: boolean }) {
  const mutedText  = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.82)';
  const dividerClr = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)';

  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 19, fontWeight: '800', color: GOLD, letterSpacing: -0.4, lineHeight: 23 }}>
        {slide.title}
      </Text>
      <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 2, marginBottom: 7, lineHeight: 14 }}>
        {slide.subtitle}
      </Text>
      <View style={{ height: 0.5, backgroundColor: dividerClr, marginBottom: 8 }} />

      <View style={{ flex: 1, gap: 5 }}>
        {slide.bullets?.map((b, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 8, color: GOLD, lineHeight: 12, opacity: 0.9 }}>◆</Text>
            <Text style={{ flex: 1, fontSize: 11.5, color: mutedText, lineHeight: 16 }}>{b}</Text>
          </View>
        ))}
      </View>

      {slide.footer && (
        <Text style={{
          fontSize: 10, color: T.textMuted, textAlign: 'center',
          marginTop: 7, letterSpacing: 0.2, opacity: 0.8,
        }}>
          {slide.footer} →
        </Text>
      )}
    </View>
  );
}

function SlideInfo({ slide, T, isDark }: { slide: Slide; T: any; isDark: boolean }) {
  const mutedText  = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.82)';
  const dividerClr = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)';

  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: T.text, lineHeight: 18, marginBottom: 5 }}>
        {slide.title}
      </Text>
      <Text style={{ fontSize: 11.5, color: mutedText, lineHeight: 16, marginBottom: 8 }}>
        {slide.body}
      </Text>
      <View style={{ height: 0.5, backgroundColor: dividerClr, marginBottom: 8 }} />

      <View style={{ flex: 1, gap: 5 }}>
        {slide.bullets?.map((b, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
            <View style={{
              width: 4, height: 4, borderRadius: 2,
              backgroundColor: T.accent, marginTop: 5.5, flexShrink: 0, opacity: 0.85,
            }} />
            <Text style={{ flex: 1, fontSize: 11.5, color: mutedText, lineHeight: 16 }}>{b}</Text>
          </View>
        ))}
      </View>

      {slide.footer ? (
        <Text style={{ fontSize: 10, color: T.textMuted, textAlign: 'center', marginTop: 5, opacity: 0.65 }}>
          {slide.footer}
        </Text>
      ) : null}
    </View>
  );
}

function SlideQuote({ slide, T, isDark }: { slide: Slide; T: any; isDark: boolean }) {
  const mutedText   = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.82)';
  const quoteBg     = isDark ? 'rgba(201,168,76,0.07)' : 'rgba(201,168,76,0.06)';
  const quoteLeft   = isDark ? 'rgba(201,168,76,0.50)' : 'rgba(201,168,76,0.65)';

  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: T.text, lineHeight: 18, marginBottom: 4 }}>
        {slide.title}
      </Text>
      {slide.body ? (
        <Text style={{ fontSize: 11, color: T.textMuted, lineHeight: 15, marginBottom: 6 }}>
          {slide.body}
        </Text>
      ) : null}

      {/* Quote block — takes all remaining vertical space */}
      <View style={{
        flex: 1,
        backgroundColor: quoteBg,
        borderLeftWidth: 2.5,
        borderLeftColor: quoteLeft,
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 8,
        justifyContent: 'center',
      }}>
        <Text style={{ fontSize: 12.5, fontStyle: 'italic', color: mutedText, lineHeight: 19 }}>
          {slide.quote}
        </Text>
      </View>

      {slide.reference ? (
        <Text style={{ fontSize: 10, color: T.textMuted, marginTop: 5, fontStyle: 'italic', opacity: 0.7 }}>
          {slide.reference}
        </Text>
      ) : null}
      {slide.footer ? (
        <Text style={{
          fontSize: 10, color: T.textMuted, marginTop: 4, lineHeight: 14, opacity: 0.75,
        }} numberOfLines={3}>
          {slide.footer}
        </Text>
      ) : null}
    </View>
  );
}

function SlideDeeds({ slide, T, isDark }: { slide: Slide; T: any; isDark: boolean }) {
  const mutedText  = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.82)';
  const dividerClr = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)';

  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: T.text, lineHeight: 18, marginBottom: 8 }}>
        {slide.title}
      </Text>

      {/* Single left-aligned column — items in defined order */}
      <View style={{ flex: 1, gap: 6 }}>
        {(slide.bullets ?? []).map((b, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <View style={{
              width: 5, height: 5, borderRadius: 2.5,
              backgroundColor: GOLD, marginTop: 4.5, flexShrink: 0,
            }} />
            <Text style={{ flex: 1, fontSize: 11.5, color: mutedText, lineHeight: 16 }}>
              {b}
            </Text>
          </View>
        ))}
      </View>

      {slide.footer ? (
        <>
          <View style={{ height: 0.5, backgroundColor: dividerClr, marginTop: 6, marginBottom: 5 }} />
          <Text style={{ fontSize: 10, color: T.textMuted, lineHeight: 14, opacity: 0.8 }} numberOfLines={2}>
            {slide.footer}
          </Text>
        </>
      ) : null}
    </View>
  );
}

function SlideDualQuote({ slide, T, isDark }: { slide: Slide; T: any; isDark: boolean }) {
  const mutedText  = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.82)';
  const quoteBg    = isDark ? 'rgba(201,168,76,0.07)' : 'rgba(201,168,76,0.06)';
  const quoteLeft  = isDark ? 'rgba(201,168,76,0.50)' : 'rgba(201,168,76,0.65)';

  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: T.text, lineHeight: 17, marginBottom: 6 }}>
        {slide.title}
      </Text>

      {/* First hadith block */}
      <View style={{ flex: 1, backgroundColor: quoteBg, borderLeftWidth: 2.5, borderLeftColor: quoteLeft, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 7 }}>
        {slide.body ? (
          <Text style={{ fontSize: 10, color: T.textMuted, lineHeight: 14, marginBottom: 4 }}>
            {slide.body}
          </Text>
        ) : null}
        <Text style={{ flex: 1, fontSize: 11.5, fontStyle: 'italic', color: mutedText, lineHeight: 17 }}>
          {slide.quote}
        </Text>
        {slide.reference ? (
          <Text style={{ fontSize: 9.5, color: T.textMuted, marginTop: 4, opacity: 0.7 }}>
            {slide.reference}
          </Text>
        ) : null}
      </View>

      <View style={{ height: 5 }} />

      {/* Second hadith block */}
      <View style={{ flex: 1, backgroundColor: quoteBg, borderLeftWidth: 2.5, borderLeftColor: quoteLeft, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 7 }}>
        {slide.secondBody ? (
          <Text style={{ fontSize: 10, color: T.textMuted, lineHeight: 14, marginBottom: 4 }}>
            {slide.secondBody}
          </Text>
        ) : null}
        <Text style={{ flex: 1, fontSize: 11.5, fontStyle: 'italic', color: mutedText, lineHeight: 17 }}>
          {slide.secondQuote}
        </Text>
        {slide.secondReference ? (
          <Text style={{ fontSize: 9.5, color: T.textMuted, marginTop: 4, opacity: 0.7 }}>
            {slide.secondReference}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function SlideText({ slide, T, isDark }: { slide: Slide; T: any; isDark: boolean }) {
  const mutedText  = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.82)';
  const dividerClr = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)';

  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 13.5, fontWeight: '700', color: T.text, lineHeight: 19, marginBottom: 8 }}>
        {slide.title}
      </Text>
      <View style={{ height: 0.5, backgroundColor: dividerClr, marginBottom: 9 }} />
      <Text style={{ flex: 1, fontSize: 12, color: mutedText, lineHeight: 19 }}>
        {slide.body}
      </Text>
      {slide.footer ? (
        <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 8, fontStyle: 'italic', opacity: 0.8 }}>
          {slide.footer}
        </Text>
      ) : null}
    </View>
  );
}

const SPLASH_BG = '#2D7D8C';

function SlideSplash({ slide }: { slide: Slide }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      {/* Title block */}
      <View style={{ alignItems: 'center', gap: 5 }}>
        <Text style={{
          fontSize: 26, fontWeight: '300', letterSpacing: 3,
          color: '#fff', textAlign: 'center',
        }}>
          {slide.title}
        </Text>
        <Text style={{
          fontSize: 14, fontWeight: '700',
          color: '#fff', textAlign: 'center', lineHeight: 19,
        }}>
          {slide.subtitle}
        </Text>
      </View>

      {/* TOC items — centered, no bullets */}
      <View style={{ alignItems: 'center', gap: 4 }}>
        {slide.bullets?.map((b, i) => (
          <Text key={i} style={{
            fontSize: 12, color: 'rgba(255,255,255,0.88)',
            textAlign: 'center', lineHeight: 17,
          }}>
            {b}
          </Text>
        ))}
      </View>

      {/* Swipe hint */}
      {slide.footer ? (
        <Text style={{
          fontSize: 11, color: 'rgba(255,255,255,0.60)',
          textAlign: 'center', marginTop: 2,
        }}>
          {slide.footer}
        </Text>
      ) : null}
    </View>
  );
}

function SlideTashriq({ slide, T, isDark }: { slide: Slide; T: any; isDark: boolean }) {
  const mutedText  = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.82)';
  const dividerClr = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)';

  return (
    <View>
      {/* Title — same style as SlideInfo */}
      <Text style={{ fontSize: 14, fontWeight: '700', color: T.text, lineHeight: 18, marginBottom: 5 }}>
        {slide.title}
      </Text>

      {/* Subtitle */}
      {slide.subtitle ? (
        <Text style={{ fontSize: 11, color: T.textMuted, lineHeight: 14, marginBottom: 5 }}>
          {slide.subtitle}
        </Text>
      ) : null}

      {/* Divider — same as SlideInfo */}
      <View style={{ height: 0.5, backgroundColor: dividerClr, marginBottom: 8 }} />

      {/* Body text */}
      {slide.body ? (
        <Text style={{ fontSize: 11.5, color: mutedText, lineHeight: 16, marginBottom: 6 }}>
          {slide.body}
        </Text>
      ) : null}

      {/* Quote block — grows with content, no clipping */}
      <View style={{
        alignSelf: 'stretch',
        backgroundColor: T.accentGlow,
        borderLeftWidth: 2.5,
        borderLeftColor: T.accent,
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 10,
      }}>
        <Text style={{ fontSize: 12, fontStyle: 'italic', color: mutedText, lineHeight: 20, flexShrink: 1 }}>
          {slide.quote}
        </Text>
      </View>

      {/* Quran verse + citation */}
      {slide.secondQuote ? (
        <View style={{ marginTop: 6 }}>
          <Text style={{
            fontSize: 11.5, fontStyle: 'italic',
            color: mutedText,
            lineHeight: 17, letterSpacing: 0.1,
          }}>
            {slide.secondQuote}
          </Text>
          {slide.reference ? (
            <Text style={{
              fontSize: 10, fontStyle: 'italic',
              color: T.textMuted,
              marginTop: 2,
            }}>
              — {slide.reference}
            </Text>
          ) : null}
        </View>
      ) : slide.reference ? (
        <Text style={{ fontSize: 10, color: T.textMuted, marginTop: 5, opacity: 0.8 }}>
          {slide.reference}
        </Text>
      ) : null}
      {slide.footer ? (
        <Text style={{ fontSize: 10, color: T.textMuted, marginTop: 4, lineHeight: 14, opacity: 0.65 }}>
          {slide.footer}
        </Text>
      ) : null}
    </View>
  );
}

function SlideContent({ slide, T, isDark }: { slide: Slide; T: any; isDark: boolean }) {
  switch (slide.variant) {
    case 'splash':      return <SlideSplash      slide={slide} />;
    case 'overview':    return <SlideOverview    slide={slide} T={T} isDark={isDark} />;
    case 'info':        return <SlideInfo        slide={slide} T={T} isDark={isDark} />;
    case 'quote':       return <SlideQuote       slide={slide} T={T} isDark={isDark} />;
    case 'dual-quote':  return <SlideDualQuote   slide={slide} T={T} isDark={isDark} />;
    case 'text':        return <SlideText        slide={slide} T={T} isDark={isDark} />;
    case 'deeds':       return <SlideDeeds       slide={slide} T={T} isDark={isDark} />;
    case 'tashriq':     return <SlideTashriq     slide={slide} T={T} isDark={isDark} />;
  }
}

// Card accent colours per variant
function cardAccent(variant: SlideVariant, T: any, isDark: boolean) {
  switch (variant) {
    case 'splash':
      return { bg: SPLASH_BG, border: SPLASH_BG, top: SPLASH_BG };
    case 'overview':
      return {
        bg:     isDark ? 'rgba(201,168,76,0.07)' : 'rgba(201,168,76,0.05)',
        border: isDark ? 'rgba(201,168,76,0.20)' : 'rgba(201,168,76,0.25)',
        top:    GOLD,
      };
    case 'info':
      return { bg: T.card, border: T.border, top: T.accent };
    case 'quote':
      return { bg: T.card, border: T.border, top: GOLD };
    case 'dual-quote':
      return { bg: T.card, border: T.border, top: GOLD };
    case 'text':
      return { bg: T.card, border: T.border, top: T.accent };
    case 'deeds':
      return { bg: T.card, border: T.border, top: T.accent };
    case 'tashriq':
      return { bg: T.card, border: T.border, top: T.accent };
  }
}

// ── main component ────────────────────────────────────────────────────────────

type Props = {
  testMode?: boolean;
  fajr:      Date | null;
  maghrib:   Date | null;
  now:       Date;
};

export default function DhulHijjahInfoCarousel({ testMode = false, fajr, maghrib, now }: Props) {
  const { theme: T, isDark } = useTheme();
  const { hijriDate }         = useApp();
  const { width: screenWidth } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);

  const CARD_W = Math.floor(screenWidth - 16 - GAP - PEEK);

  const dates = useMemo(() => getDates(hijriDate, testMode), [hijriDate, testMode]);

  const currentDay = dates?.currentDay ?? 0;

  // True when Tashriq slides should be visible:
  //   day 9  — from Fajr onwards
  //   day 10–12 — all day
  //   day 13 — until Maghrib
  const isTashriqPeriod = useMemo(() => {
    if (testMode) return true;
    if (currentDay === 9)  return fajr    !== null && now >= fajr;
    if (currentDay >= 10 && currentDay <= 12) return true;
    if (currentDay === 13) return maghrib !== null && now < maghrib;
    return false;
  }, [testMode, currentDay, fajr, maghrib, now]);

  const slides = useMemo(() => {
    const tashriq = isTashriqPeriod ? TASHRIQ_SLIDES : [];
    // Main slides only on days 1–9; from day 10 onwards only Tashriq slides show
    const main = currentDay <= 9
      ? buildSlides(dates?.day1 ?? null, dates?.day9 ?? null, dates?.day10 ?? null)
      : [];
    return [...tashriq, ...main];
  }, [isTashriqPeriod, currentDay, dates]);

  // Reset pagination when the slide list changes length (e.g. Tashriq slides appear)
  const slidesLenRef = React.useRef(slides.length);
  React.useEffect(() => {
    if (slidesLenRef.current !== slides.length) {
      slidesLenRef.current = slides.length;
      setActiveIndex(0);
    }
  }, [slides.length]);

  if (!dates) return null;
  if (slides.length === 0) return null;

  const handleScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      const idx = Math.round(e.nativeEvent.contentOffset.x / (CARD_W + GAP));
      setActiveIndex(Math.max(0, Math.min(idx, slides.length - 1)));
    },
    [CARD_W, slides.length],
  );

  // paddingRight ensures the last card can fully snap into the left-aligned position.
  // Required minimum = screenWidth − CARD_W − 16 = PEEK + GAP = 28 px
  const contentPaddingRight = screenWidth - CARD_W - 16;

  return (
    <View style={{ marginTop: 12, marginBottom: 4 }}>
      {/* Section header — same style as other home sections */}
      <Text style={{
        fontSize: 12, fontWeight: '600', color: T.textMuted,
        letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 11,
      }}>
        {isTashriqPeriod && currentDay >= 10 ? 'Tashriq-dagarna' : 'Lär dig om Dhul Hijjah'}
      </Text>

      {/* Carousel — negative margin lets it bleed to screen edges for peek + shadow room */}
      <View style={{ marginHorizontal: -16, marginTop: -8, marginBottom: -18 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={CARD_W + GAP}
          snapToAlignment="start"
          disableIntervalMomentum
          contentContainerStyle={{
            paddingLeft: 16,
            paddingRight: contentPaddingRight,
            paddingTop: 8,
            paddingBottom: 18,
          }}
          onScroll={handleScroll}
          scrollEventThrottle={32}
        >
          {slides.map((slide) => {
            const { bg, border, top } = cardAccent(slide.variant, T, isDark);
            const isTashriq = slide.variant === 'tashriq';
            return (
              <View
                key={slide.id}
                style={{
                  width: CARD_W,
                  // Tashriq cards grow with content; regular slides keep fixed height.
                  ...(isTashriq ? { minHeight: CARD_H } : { height: CARD_H }),
                  marginRight: GAP,
                  backgroundColor: bg,
                  borderRadius: 16,
                  borderWidth: 0.5,
                  borderColor: border,
                  borderTopWidth: 1.5,
                  borderTopColor: top,
                  paddingHorizontal: CARD_PH,
                  paddingTop: CARD_PV,
                  paddingBottom: CARD_PV,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 3 },
                  shadowOpacity: isDark ? 0.05 : 0.09,
                  shadowRadius: isDark ? 10 : 14,
                  elevation: 2,
                }}
              >
                <SlideContent slide={slide} T={T} isDark={isDark} />
              </View>
            );
          })}
        </ScrollView>
      </View>

      {/* Pagination dots — generated from slides array, active = ring/outline */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, marginTop: 10,
      }}>
        {slides.map((_, i) => {
          const active = i === activeIndex;
          return (
            <View
              key={i}
              style={{
                width:  active ? 8 : 5,
                height: active ? 8 : 5,
                borderRadius: active ? 4 : 2.5,
                backgroundColor: active ? 'transparent' : T.textMuted,
                borderWidth:  active ? 1.5 : 0,
                borderColor:  active ? T.accent : 'transparent',
                opacity: active ? 1 : 0.38,
              }}
            />
          );
        })}
      </View>
    </View>
  );
}
