import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ScrollView, TextInput,
  StyleSheet, Animated, Easing, ActivityIndicator, PanResponder, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';
import BackButton from '../components/BackButton';
import * as Haptics from 'expo-haptics';
import Svg, { Path, Circle, Line, Rect } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
// expo-av loaded lazily inside useNameAudio to avoid crashing if native module is missing
import { useTheme } from '../context/ThemeContext';
import { pauseYoutubePlayer } from '../context/YoutubePlayerContext';
import { SURAH_INDEX } from '../data/surahIndex';
import asmaulData from './asmaul_husna.json';
import AUDIO_MAP from '../assets/audio/audioMap';

/* ─────────────────────────────────────────────────────────────
   DATA TYPES & SEARCH INDEX
───────────────────────────────────────────────────────────── */
type Name = {
  nr: number; arabic: string; transliteration: string; swedish: string;
  forklaring: string; koranvers_arabiska: string; koranvers_svenska: string;
  sura_ayat: string; antal_i_koranen: number; hadith: string | null;
};

const names: Name[] = asmaulData as Name[];

function normalize(s: string): string {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics (ā→a, ī→i …)
    .replace(/[''ʼʻ`´']/g, '')         // remove apostrophes entirely
    .replace(/[-–—]/g, ' ')            // hyphens → space (al-mumin = al mumin)
    .replace(/\s+/g, ' ')              // collapse runs of spaces
    .trim()
    .toLowerCase();
}

const SEARCH_INDEX = names.map(n => ({
  norm: normalize(n.transliteration + ' ' + n.swedish + ' ' + String(n.nr)),
  arabic: n.arabic,
}));

const FAV_KEY = 'asmaul_husna_favorites';

// Font size persistence keys + step arrays for the detail view
const ASMAUL_FS_ARABIC    = 'asmaul-arabic-font-size-v1';
const ASMAUL_FS_UTTAL     = 'asmaul-uttal-font-size-v1';
const ASMAUL_FS_FORKLARING = 'asmaul-forklaring-font-size-v1';
const ASMAUL_FS_KORANVERS  = 'asmaul-koranvers-font-size-v1';
// Hero Arabic name steps — default index 3 (= 58px, matches current hardcoded value)
const ASMAUL_ARABIC_STEPS     = [32, 40, 50, 58, 70, 82, 96] as const;
// Transliteration steps — default index 2 (= 22px)
const ASMAUL_UTTAL_STEPS      = [14, 18, 22, 26, 30, 36, 42] as const;
// Förklaring text steps — default index 2 (= 15px)
const ASMAUL_FORKLARING_STEPS = [11, 13, 15, 18, 22, 27, 32] as const;
// Koranvers text steps — default index 1 (= 14px)
const ASMAUL_KORANVERS_STEPS  = [11, 14, 16, 18, 22, 27, 32] as const;

// Global stopper — ensures only one audio plays at a time across the whole screen.
let _stopActiveNameAudio: (() => void) | null = null;

/* ─────────────────────────────────────────────────────────────
   LARDOMAR DATA
───────────────────────────────────────────────────────────── */
const LARDOMAR_DATA = [
  { nr: 1, titel: 'När Allah vill en människa väl', stycken: ['Profeten ﷺ sa: "Den som Allah vill väl, skänker han förståelse i religionen." (al-Bukhari nr. 71)', 'En av de mest betydelsefulla formerna av förståelse är att en människa fördjupar sin kunskap om Allah. Kunskap om Allah är grunden för all rättfärdighet, verklig framgång och räddning – både i detta liv och i det kommande.', 'Ju djupare en människas kunskap om Allah är, desto starkare blir hennes gudsfruktan. Hennes dyrkan blir mer uppriktig och hängiven, och hennes vilja att undvika synd stärks.', 'När människor brister i sin dyrkan beror det ofta på att deras kunskap om Allah är ofullständig – om hans rättigheter, hans storhet och hans fullkomlighet.'] },
  { nr: 2, titel: 'Att lära känna Allah genom hans namn', stycken: ['Profeten ﷺ sa: "Allah har nittionio namn – hundra minus ett. Den som gör ihsa av dessa namn kommer att träda in i paradiset." (al-Bukhari nr. 2736, Muslim nr. 2677)', 'Att göra ihsa av Allahs namn innebär inte bara att känna till dem, utan sker på flera nivåer:', 'Första nivån: att memorera namnen. Detta innebär att lära sig Allahs namn och bära dem i sitt minne.', 'Andra nivån: att förstå namnen. Det innebär att förstå deras betydelse och vad de säger om Allah och hans fullkomliga egenskaper.', 'Tredje nivån: att leva i enlighet med namnen. Den som vet att Allah är den ende sanne guden vänder sig inte till någon annan i dyrkan. Och den som vet att Allah är al-Basir, den seende, aktar sig för synder även när ingen människa ser honom.', 'Fjärde nivån: att åkalla Allah med hans namn. Allah säger, i betydelse: "Till Allah hör de allra vackraste namnen, åkalla honom därför med dem." [al-A\'raf 7:180]', 'Detta kan till exempel vara att säga:\nYa Rahman (O, den Nåderike), visa mig barmhärtighet.\nYa Ghafur (O, den Förlåtande), förlåt mig.\nYa Tawwab (O, Ångermottagren), ta emot min ånger.'] },
  { nr: 3, titel: 'Det är förbjudet att beskriva Allah på ett sätt han inte själv har beskrivit sig', stycken: ['Allah är fullkomlig och upphöjd över alla brister. Därför är det inte tillåtet att beskriva Allah med namn eller egenskaper som han själv inte har nämnt i Koranen eller som profeten ﷺ inte har förmedlat. Människans förstånd är begränsat, och utan vägledning från uppenbarelsen riskerar man att tillskriva Allah sådant som inte passar honom.', 'Islam lär oss att tala om Allah med vördnad och försiktighet. När vi håller oss till de namn och egenskaper som finns i uppenbarelsen bevarar vi en korrekt och ren förståelse av tron. Att gå utöver detta, genom spekulation eller egna formuleringar, kan leda till förvirring och felaktiga föreställningar om Allah.', 'Därför är en grundläggande princip i islamisk tro att Allah endast beskrivs så som han själv har valt att beskriva sig. Detta är ett uttryck för ödmjukhet inför hans storhet och ett skydd för den sanna tron.'] },
  { nr: 4, titel: 'Kunskap om Allahs namn är nödvändig för att kunna dyrka honom med insikt', stycken: ['Dyrkan i islam handlar inte bara om yttre handlingar, utan om hjärtats närvaro och medvetenhet. För att en människa ska kunna dyrka Allah på ett meningsfullt sätt behöver hon känna honom. Denna kännedom kommer i första hand genom Allahs namn och egenskaper.', 'När en muslim lär sig vad Allahs namn betyder, förändras relationen till honom. Bönen blir mer uppriktig, tilliten starkare och gudsfruktan djupare. Man förstår vem man vänder sig till, vem som hör, ser, förlåter och visar barmhärtighet.', 'Utan kunskap om Allahs namn riskerar dyrkan att bli mekanisk och tom. Med kunskap blir den levande, medveten och fylld av mening. Därför är lärandet om Allahs namn och egenskaper en central del av tron och en nyckel till en djupare och mer äkta dyrkan.'] },
  { nr: 5, titel: 'Det finns ingen autentisk hadith som nämner alla de 99 namnen tillsammans', stycken: ['Det är fastslaget i autentiska hadither att Allah har nittionio namn och att den som gör ihsa av dem lovas paradiset. Däremot finns det ingen tillförlitlig hadith där alla dessa namn räknas upp i en och samma lista.', 'Därför bör man vara försiktig med att påstå att en specifik lista med namn med säkerhet utgör exakt de nittionio.', 'Detta innebär dock inte att kunskapen om Allahs namn förlorar sin betydelse. Tvärtom uppmanas muslimer att lära sig, reflektera över och leva med de namn som finns i Koranen och i autentiska hadither, även om de inte samlas i en enda lista.'] },
  { nr: 6, titel: 'Att lära känna Allah leder till kärlek till honom', stycken: ['När en människa lär känna Allah genom hans namn, egenskaper och handlingar, växer kärleken till honom naturligt i hjärtat. Kunskap om Allah gör tron levande och relationen personlig.', 'Ju mer man förstår om Allahs barmhärtighet, visdom, rättvisa och omsorg, desto mer känner man tacksamhet, hopp och tillit. Kärleken till Allah uppstår inte genom ord enbart, utan genom insikt och reflektion över vem han är och hur han tar hand om sina skapelser.', 'Denna kärlek blir i sin tur en drivkraft till lydnad, uppriktighet och tålamod. Att lära känna Allah är därför inte bara en intellektuell resa, utan en väg som leder hjärtat närmare honom.'] },
  { nr: 7, titel: 'Människans tillkortakommanden hänger samman med bristande kunskap om Allah', stycken: ['När en människa brister i sin tro, i sina handlingar eller i sin ånger inför Allah, är det sällan ett tecken på illvilja eller likgiltighet. Ofta har det sin grund i en bristande kunskap om Allah och vem han är.', 'Den som inte verkligen känner sin Herre har svårt att frukta honom på rätt sätt, att hoppas på honom fullt ut eller att vända sig till honom med uppriktighet. Människans praktiserande försvagas när tron på Allah blir svag, och handlingarna blir inkonsekventa när hjärtat saknar djup insikt.', 'Kunskap om Allah ger tron stadga. När en människa förstår Allahs storhet, barmhärtighet och visdom, stärks hennes iman, hennes handlingar blir mer uppriktiga och hennes ånger blir mer ärlig. Brist på kunskap leder ofta till slapphet, medan sann kunskap väcker hjärtat och driver människan mot förbättring och närhet till Allah.'] },
  { nr: 8, titel: 'Tron på Allahs namn och egenskaper formar hjärtat och handlingarna', stycken: ['Tron på Allahs namn och egenskaper är inte bara en teoretisk fråga, utan något som har en djup och konkret påverkan på människans inre och yttre liv. När en muslim verkligen tror på Allahs namn och reflekterar över deras innebörd, börjar denna tro sätta tydliga spår i hjärtat.', 'Kärlek till Allah växer när man lär känna hans barmhärtighet och omsorg. Fruktan uppstår när man inser hans storhet och rättvisa. Hopp stärks när man förstår hans förlåtelse och generositet. Och tilliten till Allah fördjupas när man ser hans visdom i allt som sker.', 'Denna inre förändring speglar sig i människans beteende. Hennes ord blir varsammare, hennes handlingar mer medvetna och hennes relation till Allah mer levande. Tron på Allahs namn och egenskaper formar därmed både hjärtat och vardagen, och leder till ett liv präglat av balans mellan kärlek, fruktan och hopp.'] },
  { nr: 9, titel: 'Tron på Allah ger livet riktning och mening', stycken: ['Att tro på Allah innebär mer än att acceptera en troslära. Det ger livet en tydlig riktning och ett djupare sammanhang. När en människa tror på Allah vet hon varifrån hon kommer, varför hon lever och vart hon är på väg. Detta skapar inre stabilitet, även när livet är prövande och ovisst.', 'Tron på Allah hjälper människan att tolka både glädje och svårigheter på ett meningsfullt sätt. Framgång leder till tacksamhet, och motgångar möts med tålamod och hopp. Livet upplevs inte som slumpmässigt, utan som en del av Allahs visdom och plan.', 'Denna övertygelse ger ro i hjärtat och skyddar mot tomhet och uppgivenhet. Tron på Allah gör att människan lever med syfte, ansvar och förtröstan.'] },
  { nr: 10, titel: 'Tron på Allah skapar inre styrka och trygghet', stycken: ['När en människa verkligen tror på Allah förändras hennes sätt att möta världen. Hon vet att hon aldrig är ensam, att Allah ser henne, hör henne och tar hand om henne. Detta skapar en djup inre trygghet som inte är beroende av yttre omständigheter.', 'Rädsla för människor, framtiden eller det okända minskar när tilliten till Allah växer. Tron ger mod att stå fast vid det rätta, även när det är svårt, och styrka att fortsätta när krafterna känns svaga.', 'Den som litar på Allah lär sig att göra sitt bästa och sedan överlåta resultatet till honom. Detta befriar hjärtat från ständig oro och ger en balanserad syn på ansvar och tillit.'] },
  { nr: 11, titel: 'Tron på Allah formar moral och ansvar', stycken: ['Tron på Allah påverkar hur en människa beter sig, även när ingen annan ser henne. Medvetenheten om att Allah ser allt och känner till allt gör att samvetet blir levande och starkt.', 'Den troende strävar efter ärlighet, rättvisa och god karaktär, inte för människors skull, utan för Allahs. Tron skapar ansvarstagande – i ord, handlingar och avsikter. Den påminner människan om att varje val har betydelse och att livet inte är utan ansvar.', 'På detta sätt blir tron på Allah inte bara något som finns i hjärtat, utan något som genomsyrar hela livet och formar människans relation till både sin Herre och till andra människor.'] },
  { nr: 12, titel: 'Trosfrågor tas från uppenbarelsen – inte från åsikter och spekulation', stycken: ['En grundläggande princip i Ahl us-Sunnas troslära är att tron bygger på uppenbarelsen. Det är Koranen och profetens ﷺ autentiska sunnah som utgör grunden för vad vi tror om Allah, om det osedda och om religionens kärna.', 'Trosfrågor formas inte av personliga åsikter, filosofiska resonemang eller kulturella trender. Människans förnuft har sin plats, men i frågor som rör Allah och det osedda är uppenbarelsen den yttersta vägledningen. Därför accepteras inte trosuppfattningar som saknar stöd i Koranen och sunnah, även om de kan framstå som logiska eller tilltalande.', 'Denna princip skyddar tron från att förändras över tid och bevarar dess renhet. Genom att hålla sig till uppenbarelsen förblir tron stabil, tydlig och gemensam för muslimer oavsett tid och plats.'] },
  { nr: 13, titel: 'Balans mellan bekräftelse och ödmjukhet i tron på Allah', stycken: ['Ahl us-Sunnas troslära kännetecknas av balans. När det gäller Allahs namn och egenskaper bekräftar man det som Allah har nämnt om sig själv, utan att förneka, förvränga eller spekulera om hur dessa egenskaper är.', 'Allahs namn och egenskaper accepteras som de har kommit i uppenbarelsen, samtidigt som man erkänner att Allah är olik sin skapelse och att människan inte kan föreställa sig hans verklighet. Tron kombinerar därmed bekräftelse med ödmjukhet inför Allahs storhet.', 'Denna balanserade hållning skyddar både från att tömma texterna på deras innebörd och från att likna Allah vid skapade varelser. Det är en väg som bevarar både tron och vördnaden.'] },
  { nr: 14, titel: 'Tron visar sig i hjärta, ord och handling', stycken: ['En central princip i Ahl us-Sunnas troslära är att tron inte enbart är något inre. Tron omfattar hjärtats övertygelse, tungans uttal och kroppens handlingar. Alla dessa delar hör samman och påverkar varandra.', 'Tron kan stärkas genom lydnad, goda handlingar och kunskap, och den kan försvagas genom synder och försummelse. Därför ses tron som levande och dynamisk, inte statisk eller oföränderlig.', 'Denna förståelse gör att religionen blir praktisk och verklighetsnära. Tron påverkar hur en människa ber, hur hon behandlar andra och hur hon lever sitt liv. På så sätt blir tron enligt Ahl us-Sunnas förståelse något som genomsyrar hela människans tillvaro.'] },
];

const QA_DATA = [
  { fraga: 'Har Allah endast 99 namn?', subtitle: 'Bevis från hadith: fler namn än 99', svar_kort: 'Nej.', forklaring: 'Beviset för det är hadithen där Profeten (salla Allahu \'alayhi wa sallam) sade:', citat: 'Jag ber dig vid varje namn som du har namngivit dig själv med eller som du har uppenbarat i din bok eller som du har lärt någon av din skapelse eller som du har hållit dolt för dig själv.', kalla: 'Ahmad (3712). Autentisk enligt Imam al-Albani i Silsilah as-Sahihah (199)', slutsats: 'Frasen "... eller som du har hållit dolt för dig själv" bevisar att Allah har namn som endast han känner till.' },
];

/* ─────────────────────────────────────────────────────────────
   ICONS
───────────────────────────────────────────────────────────── */
function HeartIcon({ filled, size = 20, color }: { filled: boolean; size?: number; color?: string }) {
  const c = filled ? '#e53e3e' : (color ?? 'rgba(128,128,128,0.7)');
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? '#e53e3e' : 'none'} stroke={c} strokeWidth={1.8}>
      <Path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function GridIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
      <Rect x={3} y={3} width={7} height={7} /><Rect x={14} y={3} width={7} height={7} />
      <Rect x={14} y={14} width={7} height={7} /><Rect x={3} y={14} width={7} height={7} />
    </Svg>
  );
}

function ListIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
      <Line x1={8} y1={6} x2={21} y2={6} /><Line x1={8} y1={12} x2={21} y2={12} /><Line x1={8} y1={18} x2={21} y2={18} />
      <Line x1={3} y1={6} x2={3} y2={6} /><Line x1={3} y1={12} x2={3} y2={12} /><Line x1={3} y1={18} x2={3} y2={18} />
    </Svg>
  );
}

function ChevronLeft({ color }: { color: string }) {
  return (
    <Svg width={8} height={14} viewBox="0 0 8 14" fill="none">
      <Path d="M7 1L1 7l6 6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function PlayIcon({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M8 5v14l11-7z" />
    </Svg>
  );
}

function PauseIcon({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </Svg>
  );
}

/* ─────────────────────────────────────────────────────────────
   AUDIO HOOK
───────────────────────────────────────────────────────────── */
function useNameAudio(nr: number) {
  const playerRef  = useRef<any>(null);
  const mountedRef = useRef(true);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  // stopSelf: stops + removes this hook's player and resets state.
  // Registered in _stopActiveNameAudio so any new play call can preempt it.
  const stopSelf = useCallback(() => {
    if (playerRef.current) {
      try { playerRef.current.pause(); } catch {}
      try { playerRef.current.remove(); } catch {}
      playerRef.current = null;
    }
    if (mountedRef.current) { setPlaying(false); setLoading(false); }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    try { require('expo-audio').setAudioModeAsync({ playsInSilentModeIOS: true }); } catch {}
    return () => {
      mountedRef.current = false;
      if (_stopActiveNameAudio === stopSelf) _stopActiveNameAudio = null;
      try { playerRef.current?.remove(); } catch {}
    };
  }, [stopSelf]);

  const toggle = useCallback(async () => {
    if (loading) return;
    let expoAudio: any;
    try { expoAudio = require('expo-audio'); } catch { return; }

    if (playerRef.current) {
      const p = playerRef.current;
      if (p.playing) {
        p.pause();
        setPlaying(false);
        if (_stopActiveNameAudio === stopSelf) _stopActiveNameAudio = null;
        return;
      }
      // Resume: stop any other player that started while this was paused.
      if (_stopActiveNameAudio && _stopActiveNameAudio !== stopSelf) {
        _stopActiveNameAudio();
        _stopActiveNameAudio = null;
      }
      if (p.currentTime >= (p.duration ?? 0) - 0.2) p.seekTo(0);
      p.play();
      setPlaying(true);
      _stopActiveNameAudio = stopSelf;
      return;
    }

    // New player: preempt whoever is currently playing (including YouTube live).
    if (_stopActiveNameAudio) { _stopActiveNameAudio(); _stopActiveNameAudio = null; }
    pauseYoutubePlayer();

    const source = AUDIO_MAP[nr];
    if (!source) return;
    setLoading(true);
    try {
      const player = expoAudio.createAudioPlayer(source);
      playerRef.current = player;
      _stopActiveNameAudio = stopSelf;
      player.play();
      if (mountedRef.current) setPlaying(true);
      player.addListener('playbackStatusUpdate', (status: any) => {
        if (status.didJustFinish) {
          if (mountedRef.current) setPlaying(false);
          if (_stopActiveNameAudio === stopSelf) _stopActiveNameAudio = null;
        }
      });
    } catch (e) {
      console.warn('[Audio]', e);
      if (_stopActiveNameAudio === stopSelf) _stopActiveNameAudio = null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [nr, loading, stopSelf]);

  return { playing, loading, toggle };
}

/* ─────────────────────────────────────────────────────────────
   GRID CARD
───────────────────────────────────────────────────────────── */
function GridCard({ name, onPress, isFav, onToggleFav, T }: { name: Name; onPress: () => void; isFav: boolean; onToggleFav: () => void; T: any }) {
  return (
    <View style={{ flex: 1, position: 'relative' }}>
      {/* Heart */}
      <TouchableOpacity
        onPress={onToggleFav}
        style={{ position: 'absolute', top: 10, right: 10, zIndex: 2, padding: 4 }}
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
      >
        <HeartIcon filled={isFav} size={18} />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
          onPress();
        }}
        style={{
          backgroundColor: T.card, borderWidth: 1, borderColor: T.border,
          borderRadius: 22, padding: 14, paddingBottom: 16,
          alignItems: 'center', gap: 8,
          shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
          shadowOpacity: T.isDark ? 0.4 : 0.09, shadowRadius: 10, elevation: 4,
        }}
        activeOpacity={0.7}
      >
        {/* Number badge */}
        <View style={{
          alignSelf: 'flex-start', width: 26, height: 26, borderRadius: 13,
          backgroundColor: T.accent + '18', alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: T.accent }}>{name.nr}</Text>
        </View>

        {/* Arabic */}
        <Text style={{
          fontSize: 46, lineHeight: 62, color: T.text,
          textAlign: 'center', width: '100%', writingDirection: 'rtl',
        }}>
          {name.arabic}
        </Text>

        {/* Transliteration */}
        <Text style={{ fontSize: 13, fontWeight: '700', color: T.text, lineHeight: 16, textAlign: 'center', letterSpacing: -0.1 }}>
          {name.transliteration}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────
   LIST ROW
───────────────────────────────────────────────────────────── */
function ListRow({ name, onPress, isFav, onToggleFav, T }: { name: Name; onPress: () => void; isFav: boolean; onToggleFav: () => void; T: any }) {
  return (
    <TouchableOpacity
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        onPress();
      }}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: T.card, borderWidth: 1, borderColor: T.border,
        borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12,
        marginHorizontal: 16, marginBottom: 7,
      }}
      activeOpacity={0.7}
    >
      {/* Number badge */}
      <View style={{
        width: 30, height: 30, borderRadius: 15, flexShrink: 0,
        backgroundColor: T.accent + '18', alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ fontSize: 11, fontWeight: '700', color: T.accent }}>{name.nr}</Text>
      </View>

      {/* Transliteration + Swedish */}
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: T.text, lineHeight: 18 }}>{name.transliteration}</Text>
        <Text style={{ fontSize: 12, color: T.textMuted, lineHeight: 16, marginTop: 1 }}>{name.swedish}</Text>
      </View>

      {/* Arabic */}
      <Text style={{ fontSize: 22, color: T.text, lineHeight: 32, writingDirection: 'rtl', textAlign: 'right', flexShrink: 0 }}>{name.arabic}</Text>

      {/* Heart */}
      <TouchableOpacity onPress={onToggleFav} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <HeartIcon filled={isFav} size={18} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

/* ─────────────────────────────────────────────────────────────
   FONT SIZE PANEL
───────────────────────────────────────────────────────────── */
function AsmaulFontSizeRow({ label, index, steps, onDecrease, onIncrease, T, last }: {
  label: string; index: number; steps: readonly number[];
  onDecrease: () => void; onIncrease: () => void;
  T: any; last?: boolean;
}) {
  const atMin = index === 0;
  const atMax = index === steps.length - 1;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 9,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: T.border,
    }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: T.textMuted, width: 72 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TouchableOpacity onPress={onDecrease} disabled={atMin} activeOpacity={0.7}
          style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: T.border, backgroundColor: T.card, alignItems: 'center', justifyContent: 'center' }}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: atMin ? T.textMuted : T.text }}>A</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {steps.map((_, i) => (
            <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i <= index ? T.accent : T.border }} />
          ))}
        </View>
        <TouchableOpacity onPress={onIncrease} disabled={atMax} activeOpacity={0.7}
          style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: T.border, backgroundColor: T.card, alignItems: 'center', justifyContent: 'center' }}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: atMax ? T.textMuted : T.text }}>A</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────
   DETAIL SCREEN
───────────────────────────────────────────────────────────── */
function DetailScreen({ name, onBack, isFav, onToggleFav, T }: { name: Name; onBack: () => void; isFav: boolean; onToggleFav: () => void; T: any }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { playing, loading, toggle } = useNameAudio(name.nr);
  const SCREEN_W = Dimensions.get('window').width;
  const [verseLoading, setVerseLoading] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  // Font size state
  const [arabicIdx,     setArabicIdx]     = useState(3); // default 58px
  const [uttalIdx,      setUttalIdx]      = useState(2); // default 22px
  const [forklaringIdx, setForklaringIdx] = useState(2); // default 15px
  const [koranversIdx,  setKoranversIdx]  = useState(1); // default 14px
  const [showFontPanel, setShowFontPanel] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(ASMAUL_FS_ARABIC),
      AsyncStorage.getItem(ASMAUL_FS_UTTAL),
      AsyncStorage.getItem(ASMAUL_FS_FORKLARING),
      AsyncStorage.getItem(ASMAUL_FS_KORANVERS),
    ]).then(([a, u, f, k]) => {
      if (a !== null) { const n = parseInt(a, 10); if (!isNaN(n) && n >= 0 && n < ASMAUL_ARABIC_STEPS.length) setArabicIdx(n); }
      if (u !== null) { const n = parseInt(u, 10); if (!isNaN(n) && n >= 0 && n < ASMAUL_UTTAL_STEPS.length) setUttalIdx(n); }
      if (f !== null) { const n = parseInt(f, 10); if (!isNaN(n) && n >= 0 && n < ASMAUL_FORKLARING_STEPS.length) setForklaringIdx(n); }
      if (k !== null) { const n = parseInt(k, 10); if (!isNaN(n) && n >= 0 && n < ASMAUL_KORANVERS_STEPS.length) setKoranversIdx(n); }
    });
  }, []);

  const decArabic     = useCallback(() => setArabicIdx(i => { const n = Math.max(0, i-1); AsyncStorage.setItem(ASMAUL_FS_ARABIC, String(n)); return n; }), []);
  const incArabic     = useCallback(() => setArabicIdx(i => { const n = Math.min(ASMAUL_ARABIC_STEPS.length-1, i+1); AsyncStorage.setItem(ASMAUL_FS_ARABIC, String(n)); return n; }), []);
  const decUttal      = useCallback(() => setUttalIdx(i => { const n = Math.max(0, i-1); AsyncStorage.setItem(ASMAUL_FS_UTTAL, String(n)); return n; }), []);
  const incUttal      = useCallback(() => setUttalIdx(i => { const n = Math.min(ASMAUL_UTTAL_STEPS.length-1, i+1); AsyncStorage.setItem(ASMAUL_FS_UTTAL, String(n)); return n; }), []);
  const decForklaring = useCallback(() => setForklaringIdx(i => { const n = Math.max(0, i-1); AsyncStorage.setItem(ASMAUL_FS_FORKLARING, String(n)); return n; }), []);
  const incForklaring = useCallback(() => setForklaringIdx(i => { const n = Math.min(ASMAUL_FORKLARING_STEPS.length-1, i+1); AsyncStorage.setItem(ASMAUL_FS_FORKLARING, String(n)); return n; }), []);
  const decKoranvers  = useCallback(() => setKoranversIdx(i => { const n = Math.max(0, i-1); AsyncStorage.setItem(ASMAUL_FS_KORANVERS, String(n)); return n; }), []);
  const incKoranvers  = useCallback(() => setKoranversIdx(i => { const n = Math.min(ASMAUL_KORANVERS_STEPS.length-1, i+1); AsyncStorage.setItem(ASMAUL_FS_KORANVERS, String(n)); return n; }), []);

  const arabicFs     = ASMAUL_ARABIC_STEPS[arabicIdx];
  const uttalFs      = ASMAUL_UTTAL_STEPS[uttalIdx];
  const forklaringFs = ASMAUL_FORKLARING_STEPS[forklaringIdx];
  const koranversFs  = ASMAUL_KORANVERS_STEPS[koranversIdx];
  const verseAbortRef = useRef<AbortController | null>(null);
  const tooltipOpacity = useRef(new Animated.Value(0)).current;
  const tooltipSlide   = useRef(new Animated.Value(-6)).current;

  // Show tooltip once after 1 s — fade in + 5-bounce settle animation
  useEffect(() => {
    if (!name.sura_ayat) return;
    const timer = setTimeout(() => {
      setTooltipVisible(true);
      // Fade in
      Animated.timing(tooltipOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      // Slide in then bounce 5 times with decaying amplitude
      Animated.sequence([
        Animated.timing(tooltipSlide, { toValue: 0,  duration: 160, useNativeDriver: true }),
        Animated.timing(tooltipSlide, { toValue: -8, duration: 100, useNativeDriver: true }),
        Animated.timing(tooltipSlide, { toValue: 0,  duration: 100, useNativeDriver: true }),
        Animated.timing(tooltipSlide, { toValue: -6, duration: 85,  useNativeDriver: true }),
        Animated.timing(tooltipSlide, { toValue: 0,  duration: 85,  useNativeDriver: true }),
        Animated.timing(tooltipSlide, { toValue: -4, duration: 70,  useNativeDriver: true }),
        Animated.timing(tooltipSlide, { toValue: 0,  duration: 70,  useNativeDriver: true }),
        Animated.timing(tooltipSlide, { toValue: -2, duration: 55,  useNativeDriver: true }),
        Animated.timing(tooltipSlide, { toValue: 0,  duration: 55,  useNativeDriver: true }),
        Animated.timing(tooltipSlide, { toValue: -1, duration: 45,  useNativeDriver: true }),
        Animated.timing(tooltipSlide, { toValue: 0,  duration: 45,  useNativeDriver: true }),
      ]).start();
    }, 1000);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVersePress = useCallback(async (suraAyat: string) => {
    if (verseLoading) return;
    const [surahStr, ayahStr] = suraAyat.split(':');
    const surahId = parseInt(surahStr, 10);
    if (isNaN(surahId)) return;

    setVerseLoading(true);
    if (verseAbortRef.current) verseAbortRef.current.abort();
    const ctrl = new AbortController();
    verseAbortRef.current = ctrl;

    try {
      const resp = await fetch(
        `https://api.quran.com/api/v4/verses/by_key/${surahStr}:${ayahStr}?words=false&fields=page_number`,
        { signal: ctrl.signal },
      );
      const data = await resp.json() as { verse?: { page_number?: number } };
      const page = data?.verse?.page_number
        ?? (SURAH_INDEX.find((s) => s.id === surahId)?.firstPage ?? 1);
      router.push(`/quran?page=${page}&verseKey=${suraAyat}`);
    } catch {
      if (!ctrl.signal.aborted) {
        const fallbackPage = SURAH_INDEX.find((s) => s.id === surahId)?.firstPage ?? 1;
        router.push(`/quran?page=${fallbackPage}&verseKey=${suraAyat}`);
      }
    } finally {
      if (!ctrl.signal.aborted) setVerseLoading(false);
    }
  }, [verseLoading, router]);

  useEffect(() => {
    return () => { verseAbortRef.current?.abort(); };
  }, []);
  const translateX = useRef(new Animated.Value(0)).current;

  const edgePan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (evt, gs) =>
      evt.nativeEvent.pageX < 30 && gs.dx > 8 && gs.dx > Math.abs(gs.dy) * 2,
    onPanResponderMove: (_, gs) => {
      if (gs.dx > 0) translateX.setValue(gs.dx);
    },
    onPanResponderRelease: (_, gs) => {
      if (gs.dx > SCREEN_W * 0.35 || gs.vx > 0.5) {
        Animated.timing(translateX, { toValue: SCREEN_W, duration: 220, useNativeDriver: true }).start(onBack);
      } else {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 120, friction: 14 }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 120, friction: 14 }).start();
    },
  })).current;

  const shadowOpacity = translateX.interpolate({ inputRange: [0, SCREEN_W * 0.5], outputRange: [0.2, 0], extrapolate: 'clamp' });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, zIndex: 10, transform: [{ translateX }] }]}>
        {/* Vänsterkantsskugga */}
        <Animated.View pointerEvents="none" style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 16, zIndex: 1,
          opacity: shadowOpacity,
          shadowColor: '#000', shadowOffset: { width: -8, height: 0 }, shadowOpacity: 1, shadowRadius: 16,
        }} />
        {/* Edge swipe-zon */}
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 20 }} {...edgePan.panHandlers} />
      {/* Floating back */}
      <TouchableOpacity
        onPress={onBack}
        style={[styles.floatingBtn, {
          top: insets.top + 12, left: 10,
          backgroundColor: T.card,
          borderColor: T.border,
          borderWidth: 0.5,
        }]}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={{ fontSize: 18, color: T.text, marginTop: -2 }}>‹</Text>
      </TouchableOpacity>

      {/* Floating gear — font size toggle */}
      <TouchableOpacity
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); setShowFontPanel(p => !p); }}
        style={[styles.floatingBtn, {
          top: insets.top + 12, right: 54,
          backgroundColor: T.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.75)',
          borderColor: showFontPanel ? T.accent : T.border,
        }]}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"
          stroke={showFontPanel ? T.accent : T.textMuted}
          strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
          <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </Svg>
      </TouchableOpacity>

      {/* Floating heart */}
      <TouchableOpacity
        onPress={onToggleFav}
        style={[styles.floatingBtn, {
          top: insets.top + 12, right: 10,
          backgroundColor: T.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.75)',
          borderColor: T.border,
        }]}
      >
        <HeartIcon filled={isFav} size={20} color={T.textMuted} />
      </TouchableOpacity>

      {/* Font size panel overlay */}
      {showFontPanel && (
        <View style={{
          position: 'absolute', top: insets.top + 56, left: 0, right: 0, zIndex: 25,
          backgroundColor: T.bg, borderBottomWidth: 1, borderBottomColor: T.border,
          shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8,
        }}>
          <AsmaulFontSizeRow label="Arabisk" index={arabicIdx} steps={ASMAUL_ARABIC_STEPS} onDecrease={decArabic} onIncrease={incArabic} T={T} />
          <AsmaulFontSizeRow label="Uttal" index={uttalIdx} steps={ASMAUL_UTTAL_STEPS} onDecrease={decUttal} onIncrease={incUttal} T={T} />
          <AsmaulFontSizeRow label="Förklaring" index={forklaringIdx} steps={ASMAUL_FORKLARING_STEPS} onDecrease={decForklaring} onIncrease={incForklaring} T={T} />
          <AsmaulFontSizeRow label="Koranvers" index={koranversIdx} steps={ASMAUL_KORANVERS_STEPS} onDecrease={decKoranvers} onIncrease={incKoranvers} T={T} last />
        </View>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + 130 }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={{ alignItems: 'center', paddingTop: insets.top + 56, paddingHorizontal: 24, paddingBottom: 20 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>{name.nr}</Text>
          </View>
          <Text style={{ fontSize: arabicFs, lineHeight: Math.round(arabicFs * 1.41), color: T.text, textAlign: 'center', writingDirection: 'rtl', marginBottom: 14 }}>
            {name.arabic}
          </Text>
          <Text style={{ fontSize: uttalFs, fontWeight: '700', color: T.text, letterSpacing: -0.2, marginBottom: 4, textAlign: 'center', lineHeight: Math.round(uttalFs * 1.35) }}>
            {name.transliteration}
          </Text>
          <Text style={{ fontSize: 15, color: T.textMuted, textAlign: 'center', marginBottom: 20, lineHeight: 23 }}>
            {name.swedish}
          </Text>

          {/* Play button */}
          <TouchableOpacity
            onPress={toggle}
            activeOpacity={0.75}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              backgroundColor: playing ? T.accent : (T.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
              borderRadius: 50, paddingHorizontal: 22, paddingVertical: 10,
              borderWidth: 1, borderColor: playing ? T.accent : T.border,
              marginBottom: 4,
            }}
          >
            {loading
              ? <ActivityIndicator size="small" color={playing ? '#fff' : T.accent} />
              : playing
                ? <PauseIcon color='#fff' size={18} />
                : <PlayIcon color={T.accent} size={18} />
            }
          </TouchableOpacity>
        </View>

        <View style={{ height: 1, backgroundColor: T.border, marginHorizontal: 18, marginBottom: 20 }} />

        {/* Förklaring */}
        {!!name.forklaring && (
          <View style={{ paddingHorizontal: 18, marginBottom: 20 }}>
            <Text style={[styles.sectionLabel, { color: T.accent }]}>Förklaring</Text>
            <Text style={{ fontSize: forklaringFs, lineHeight: Math.round(forklaringFs * 1.73), color: T.textSecondary }}>{name.forklaring}</Text>
          </View>
        )}

        {/* Koranvers */}
        {!!name.koranvers_arabiska && (
          <View style={{ paddingHorizontal: 18, marginBottom: 20 }}>
            <Text style={[styles.sectionLabel, { color: T.accent }]}>Koranvers</Text>
            <View style={{
              backgroundColor: T.isDark ? 'rgba(45,139,120,0.1)' : 'rgba(36,100,93,0.06)',
              borderWidth: 1, borderColor: T.accent + '30', borderRadius: 16, padding: 16,
            }}>
              <Text style={{ fontSize: Math.round(koranversFs * 1.7), lineHeight: Math.round(koranversFs * 1.7 * 1.7), textAlign: 'center', color: T.text, writingDirection: 'rtl', marginBottom: 14 }}>
                {name.koranvers_arabiska}
              </Text>
              <View style={{ height: 1, backgroundColor: T.accent + '25', marginBottom: 12 }} />
              <Text style={{ fontSize: koranversFs, color: T.textMuted, lineHeight: Math.round(koranversFs * 1.64) }}>{name.koranvers_svenska}</Text>
              {!!name.sura_ayat && (
                <View style={{ marginTop: 12 }}>
                  {/* Verse badge — number only */}
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
                      handleVersePress(name.sura_ayat);
                    }}
                    activeOpacity={0.75}
                    disabled={verseLoading}
                    style={{
                      alignSelf: 'flex-start',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 5,
                      backgroundColor: T.isDark ? 'rgba(102,132,104,0.25)' : 'rgba(36,100,93,0.12)',
                      borderWidth: 1,
                      borderColor: T.accent + '55',
                      borderRadius: 20,
                      paddingVertical: 6,
                      paddingHorizontal: 12,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: T.accent, letterSpacing: 0.2 }}>
                      {name.sura_ayat}
                    </Text>
                    {verseLoading && (
                      <ActivityIndicator size="small" color={T.accent} />
                    )}
                  </TouchableOpacity>

                  {/* Tooltip — in normal flow, pushes content below it down */}
                  {tooltipVisible && (
                    <Animated.View
                      style={{
                        alignSelf: 'flex-start',
                        marginTop: 4,
                        opacity: tooltipOpacity,
                        transform: [{ translateY: tooltipSlide }],
                      }}
                    >
                      {/* Arrow pointing up */}
                      <View style={{
                        width: 0,
                        height: 0,
                        borderLeftWidth: 6,
                        borderRightWidth: 6,
                        borderBottomWidth: 7,
                        borderLeftColor: 'transparent',
                        borderRightColor: 'transparent',
                        borderBottomColor: T.isDark ? '#2C2C2E' : '#FFFFFF',
                        marginLeft: 12,
                      }} />
                      {/* Body */}
                      <TouchableOpacity
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
                          handleVersePress(name.sura_ayat);
                        }}
                        activeOpacity={0.75}
                        disabled={verseLoading}
                        style={{
                        backgroundColor: T.isDark ? '#2C2C2E' : '#FFFFFF',
                        borderRadius: 10,
                        paddingVertical: 7,
                        paddingHorizontal: 11,
                        borderWidth: 1,
                        borderColor: T.border,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: T.isDark ? 0.35 : 0.12,
                        shadowRadius: 10,
                        elevation: 6,
                      }}>
                        <Text style={{ fontSize: 12, fontWeight: '500', color: T.textSecondary }} numberOfLines={1}>
                          Gå till versen i Koranen
                        </Text>
                      </TouchableOpacity>
                    </Animated.View>
                  )}
                </View>
              )}
            </View>
          </View>
        )}

        {/* Hadith */}
        {!!name.hadith && (
          <View style={{ paddingHorizontal: 18, marginBottom: 20 }}>
            <Text style={[styles.sectionLabel, { color: '#C47B2B' }]}>Hadith</Text>
            <View style={{
              backgroundColor: T.isDark ? 'rgba(196,123,43,0.1)' : 'rgba(196,123,43,0.06)',
              borderWidth: 1, borderColor: 'rgba(196,123,43,0.25)', borderRadius: 16, padding: 16,
            }}>
              <Text style={{ fontSize: 14, color: T.textSecondary, lineHeight: 24 }}>{name.hadith}</Text>
            </View>
          </View>
        )}

        {/* Antal i Koranen */}
        {name.antal_i_koranen != null && (
          <View style={{ marginHorizontal: 18 }}>
            <View style={{ backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 14, color: T.textMuted }}>Antal i Koranen</Text>
              <Text style={{ fontSize: 22, fontWeight: '700', color: T.accent }}>{name.antal_i_koranen}</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </Animated.View>
  );
}

/* ─────────────────────────────────────────────────────────────
   LARDOMAR DETAIL
───────────────────────────────────────────────────────────── */
function LardomarDetail({ lardom, onBack, T }: { lardom: typeof LARDOMAR_DATA[0]; onBack: () => void; T: any }) {
  const insets    = useSafeAreaInsets();
  const SCREEN_W  = Dimensions.get('window').width;
  const translateX = useRef(new Animated.Value(SCREEN_W)).current;

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: 0, duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);

  const dismiss = useCallback(() => {
    Animated.timing(translateX, {
      toValue: SCREEN_W, duration: 240,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(onBack);
  }, [onBack, SCREEN_W]);

  const edgePan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (evt, gs) =>
      evt.nativeEvent.pageX < 30 && gs.dx > 8 && gs.dx > Math.abs(gs.dy) * 2,
    onPanResponderMove: (_, gs) => { if (gs.dx > 0) translateX.setValue(gs.dx); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dx > SCREEN_W * 0.35 || gs.vx > 0.5) {
        Animated.timing(translateX, { toValue: SCREEN_W, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(onBack);
      } else {
        Animated.timing(translateX, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.timing(translateX, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    },
  })).current;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, zIndex: 25, transform: [{ translateX }] }]}>
      {/* Edge swipe hit area */}
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 30 }} {...edgePan.panHandlers} />
      {/* Fixed header with back button */}
      <View style={{ paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 0.5, borderColor: T.border }}>
        <BackButton onPress={dismiss} />
        <Text style={{ fontSize: 17, fontWeight: '700', color: T.text }} numberOfLines={1}>Lärdom {lardom.nr}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: T.text, lineHeight: 34, marginBottom: 24 }}>{lardom.titel}</Text>
        {lardom.stycken.map((s, i) => (
          <Text key={i} style={{ fontSize: 16, color: T.text, lineHeight: 28, marginBottom: 18 }}>{s}</Text>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

/* ─────────────────────────────────────────────────────────────
   LARDOMAR LIST
───────────────────────────────────────────────────────────── */
function LardomarList({ onBack, T }: { onBack: () => void; T: any }) {
  const insets    = useSafeAreaInsets();
  const SCREEN_W  = Dimensions.get('window').width;
  const translateX = useRef(new Animated.Value(SCREEN_W)).current;
  const [active, setActive] = useState<typeof LARDOMAR_DATA[0] | null>(null);

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: 0, duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);

  const dismiss = useCallback(() => {
    Animated.timing(translateX, {
      toValue: SCREEN_W, duration: 240,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(onBack);
  }, [onBack, SCREEN_W]);

  const edgePan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (evt, gs) =>
      evt.nativeEvent.pageX < 30 && gs.dx > 8 && gs.dx > Math.abs(gs.dy) * 2,
    onPanResponderMove: (_, gs) => { if (gs.dx > 0) translateX.setValue(gs.dx); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dx > SCREEN_W * 0.35 || gs.vx > 0.5) {
        Animated.timing(translateX, { toValue: SCREEN_W, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(onBack);
      } else {
        Animated.timing(translateX, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.timing(translateX, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    },
  })).current;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, zIndex: 20, transform: [{ translateX }] }]}>
      {active && <LardomarDetail lardom={active} onBack={() => setActive(null)} T={T} />}
      {/* Edge swipe hit area */}
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 30 }} {...edgePan.panHandlers} />
      {/* Fixed header with back button */}
      <View style={{ paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 0.5, borderColor: T.border }}>
        <BackButton onPress={dismiss} />
        <Text style={{ fontSize: 17, fontWeight: '700', color: T.text }}>Lärdomar</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {LARDOMAR_DATA.map(l => (
          <TouchableOpacity
            key={l.nr}
            onPress={() => setActive(l)}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 16, padding: 16, marginBottom: 10 }}
            activeOpacity={0.7}
          >
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: '#fff' }}>{l.nr}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: T.text, lineHeight: 20, marginBottom: 5 }}>{l.titel}</Text>
              <Text style={{ fontSize: 13, color: T.textMuted, lineHeight: 18 }} numberOfLines={2}>{l.stycken[0]}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

/* ─────────────────────────────────────────────────────────────
   Q&A DETAIL
───────────────────────────────────────────────────────────── */
function QADetail({ qa, onBack, T }: { qa: typeof QA_DATA[0]; onBack: () => void; T: any }) {
  const insets    = useSafeAreaInsets();
  const SCREEN_W  = Dimensions.get('window').width;
  const translateX = useRef(new Animated.Value(SCREEN_W)).current;

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: 0, duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);

  const dismiss = useCallback(() => {
    Animated.timing(translateX, {
      toValue: SCREEN_W, duration: 240,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(onBack);
  }, [onBack, SCREEN_W]);

  const edgePan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (evt, gs) =>
      evt.nativeEvent.pageX < 30 && gs.dx > 8 && gs.dx > Math.abs(gs.dy) * 2,
    onPanResponderMove: (_, gs) => { if (gs.dx > 0) translateX.setValue(gs.dx); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dx > SCREEN_W * 0.35 || gs.vx > 0.5) {
        Animated.timing(translateX, { toValue: SCREEN_W, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(onBack);
      } else {
        Animated.timing(translateX, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.timing(translateX, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    },
  })).current;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, zIndex: 30, transform: [{ translateX }] }]}>
      {/* Edge swipe hit area */}
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 40 }} {...edgePan.panHandlers} />
      {/* Fixed header with back button */}
      <View style={{ paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 0.5, borderColor: T.border }}>
        <BackButton onPress={dismiss} />
        <Text style={{ fontSize: 17, fontWeight: '700', color: T.text }} numberOfLines={1}>{qa.fraga}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: T.text, lineHeight: 34, marginBottom: 6 }}>{qa.fraga}</Text>
        <Text style={{ fontSize: 14, color: T.textMuted, marginBottom: 24 }}>{qa.subtitle}</Text>
        {/* Fråga box */}
        <View style={{ backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderLeftWidth: 3, borderLeftColor: T.accent, borderRadius: 14, padding: 14, marginBottom: 12 }}>
          <Text style={[styles.sectionLabel, { color: T.accent }]}>Fråga</Text>
          <Text style={{ fontSize: 15, color: T.text, lineHeight: 24 }}>{qa.fraga}</Text>
        </View>
        {/* Svar box */}
        <View style={{ backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderLeftWidth: 3, borderLeftColor: T.accent, borderRadius: 14, padding: 14, marginBottom: 20 }}>
          <Text style={[styles.sectionLabel, { color: T.accent }]}>Svar</Text>
          <Text style={{ fontSize: 17, fontWeight: '700', color: T.text, lineHeight: 24 }}>{qa.svar_kort}</Text>
        </View>
        {!!qa.forklaring && <Text style={{ fontSize: 15, color: T.text, lineHeight: 26, marginBottom: 20 }}>{qa.forklaring}</Text>}
        {!!qa.citat && (
          <View style={{ backgroundColor: T.isDark ? 'rgba(45,139,120,0.12)' : 'rgba(36,100,93,0.07)', borderWidth: 1, borderColor: T.accent + '30', borderRadius: 14, padding: 16, marginBottom: 10 }}>
            <Text style={{ fontSize: 15, color: T.text, lineHeight: 28, fontStyle: 'italic' }}>"{qa.citat}"</Text>
          </View>
        )}
        {!!qa.kalla && <Text style={{ fontSize: 12, color: T.textMuted, marginBottom: 20, lineHeight: 18 }}>[{qa.kalla}]</Text>}
        {!!qa.slutsats && <Text style={{ fontSize: 15, color: T.text, lineHeight: 26 }}>{qa.slutsats}</Text>}
      </ScrollView>
    </Animated.View>
  );
}

/* ─────────────────────────────────────────────────────────────
   Q&A LIST
───────────────────────────────────────────────────────────── */
function QAList({ onBack, T }: { onBack: () => void; T: any }) {
  const insets    = useSafeAreaInsets();
  const SCREEN_W  = Dimensions.get('window').width;
  const translateX = useRef(new Animated.Value(SCREEN_W)).current;
  const [activeQA, setActiveQA] = useState<typeof QA_DATA[0] | null>(null);

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: 0, duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);

  const dismiss = useCallback(() => {
    Animated.timing(translateX, {
      toValue: SCREEN_W, duration: 240,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(onBack);
  }, [onBack, SCREEN_W]);

  const edgePan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (evt, gs) =>
      evt.nativeEvent.pageX < 30 && gs.dx > 8 && gs.dx > Math.abs(gs.dy) * 2,
    onPanResponderMove: (_, gs) => { if (gs.dx > 0) translateX.setValue(gs.dx); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dx > SCREEN_W * 0.35 || gs.vx > 0.5) {
        Animated.timing(translateX, { toValue: SCREEN_W, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(onBack);
      } else {
        Animated.timing(translateX, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.timing(translateX, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    },
  })).current;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, zIndex: 20, transform: [{ translateX }] }]}>
      {activeQA && <QADetail qa={activeQA} onBack={() => setActiveQA(null)} T={T} />}
      {/* Edge swipe hit area */}
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 30 }} {...edgePan.panHandlers} />
      {/* Fixed header with back button */}
      <View style={{ paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 0.5, borderColor: T.border }}>
        <BackButton onPress={dismiss} />
        <Text style={{ fontSize: 17, fontWeight: '700', color: T.text }}>Frågor &amp; Svar</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {QA_DATA.map((qa, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => setActiveQA(qa)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 18, padding: 16, marginBottom: 12 }}
            activeOpacity={0.7}
          >
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: T.text, lineHeight: 21 }}>{qa.fraga}</Text>
              <Text style={{ fontSize: 13, color: T.textMuted, marginTop: 3, lineHeight: 18 }}>{qa.subtitle}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

/* ─────────────────────────────────────────────────────────────
   ROOT SCREEN
───────────────────────────────────────────────────────────── */
export default function AsmaulHusnaScreen() {
  const { theme: T } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ nameNr?: string }>();
  const [viewMode,     setViewMode]     = useState<'grid' | 'list'>('grid');
  const [selected,     setSelected]     = useState<Name | null>(null);
  const [showLardomar, setShowLardomar] = useState(false);
  const [showQA,       setShowQA]       = useState(false);
  const [favs,         setFavs]         = useState<Set<number>>(new Set());
  const [filterFavs,   setFilterFavs]   = useState(false);
  const [search,       setSearch]       = useState('');
  const [debSearch,    setDebSearch]    = useState('');

  // Load favorites from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem(FAV_KEY).then(raw => {
      if (raw) {
        try { setFavs(new Set(JSON.parse(raw))); } catch {}
      }
    });
  }, []);

  // Deep-link from notification: open the specific name directly
  useEffect(() => {
    if (!params.nameNr) return;
    const nr = parseInt(params.nameNr, 10);
    if (isNaN(nr)) return;
    const name = names.find(n => n.nr === nr);
    if (name) setSelected(name);
  }, [params.nameNr]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebSearch(search), 120);
    return () => clearTimeout(t);
  }, [search]);

  const toggleFav = useCallback((nr: number) => {
    setFavs(prev => {
      const next = new Set(prev);
      if (next.has(nr)) next.delete(nr); else next.add(nr);
      AsyncStorage.setItem(FAV_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    if (!debSearch && !filterFavs) return names;
    if (!debSearch) return names.filter(n => favs.has(n.nr));
    const q = normalize(debSearch);
    const isArabic = /[\u0600-\u06FF]/.test(debSearch);
    return names.filter((n, i) => {
      if (filterFavs && !favs.has(n.nr)) return false;
      if (isArabic) return SEARCH_INDEX[i].arabic.includes(debSearch);
      return SEARCH_INDEX[i].norm.includes(q);
    });
  }, [debSearch, filterFavs, favs]);

  const showingSections = !search && !filterFavs;

  // Disable the Stack navigator's native edge swipe when any sub-view is open,
  // so the iOS gesture recognizer doesn't compete with the internal PanResponder.
  const hasSubView = !!selected || showLardomar || showQA;

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <Stack.Screen options={{ gestureEnabled: !hasSubView, fullScreenGestureEnabled: false }} />
      {/* Detail overlay */}
      {selected && (
        <DetailScreen
          name={selected}
          onBack={() => setSelected(null)}
          isFav={favs.has(selected.nr)}
          onToggleFav={() => toggleFav(selected.nr)}
          T={T}
        />
      )}

      {/* Lärdomar overlay */}
      {showLardomar && <LardomarList onBack={() => setShowLardomar(false)} T={T} />}

      {/* Q&A overlay */}
      {showQA && <QAList onBack={() => setShowQA(false)} T={T} />}

      {/* Sticky header */}
      <View style={{ backgroundColor: T.bg, borderBottomWidth: 1, borderBottomColor: T.border, paddingTop: insets.top }}>
        {/* Title row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
          <BackButton onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: T.text, lineHeight: 22 }}>Allahs 99 namn</Text>
            <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>أسماء الله الحسنى</Text>
          </View>
          {/* Grid/List toggle */}
          <TouchableOpacity
            onPress={() => setViewMode(v => v === 'grid' ? 'list' : 'grid')}
            style={{ backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 10, padding: 7 }}
          >
            {viewMode === 'grid' ? <ListIcon color={T.textMuted} /> : <GridIcon color={T.textMuted} />}
          </TouchableOpacity>
        </View>

        {/* Search + fav filter */}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.card, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: T.border }}>
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth={2} strokeLinecap="round">
              <Circle cx={11} cy={11} r={8} /><Line x1={21} y1={21} x2={16.65} y2={16.65} />
            </Svg>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Sök namn..."
              placeholderTextColor={T.textMuted}
              style={{ flex: 1, fontSize: 16, color: T.text, padding: 0 }}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Text style={{ color: T.textMuted, fontSize: 17, lineHeight: 20 }}>×</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            onPress={() => setFilterFavs(f => !f)}
            style={{
              backgroundColor: T.card, borderWidth: 1,
              borderColor: filterFavs ? '#e53e3e44' : T.border,
              borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
              flexDirection: 'row', alignItems: 'center', gap: 5,
            }}
          >
            <HeartIcon filled={filterFavs} size={14} color={T.textMuted} />
            {favs.size > 0 && (
              <Text style={{ fontSize: 13, fontWeight: '600', color: filterFavs ? '#e53e3e' : T.textMuted }}>{favs.size}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Section pills */}
        {showingSections && (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', paddingHorizontal: 16, paddingBottom: 12 }}>
            <TouchableOpacity
              onPress={() => setShowLardomar(true)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: T.accent + '14', borderWidth: 1, borderColor: T.accent + '33', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 }}
            >
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><Path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </Svg>
              <Text style={{ fontSize: 13, fontWeight: '600', color: T.accent }}>Lärdomar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowQA(true)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: T.accent + '14', borderWidth: 1, borderColor: T.accent + '33', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 }}
            >
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <Circle cx={12} cy={12} r={10} /><Path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><Line x1={12} y1={17} x2={12} y2={17} />
              </Svg>
              <Text style={{ fontSize: 13, fontWeight: '600', color: T.accent }}>Frågor &amp; Svar</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Result count */}
        {(search || filterFavs) && filtered.length < names.length && (
          <Text style={{ paddingHorizontal: 16, paddingBottom: 6, fontSize: 12, color: T.textMuted }}>
            Visar {filtered.length} av {names.length} namn
          </Text>
        )}
      </View>

      {/* List / Grid */}
      {filtered.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 15, color: T.textMuted }}>{filterFavs ? 'Inga favoriter ännu.' : 'Inga namn hittades.'}</Text>
        </View>
      ) : viewMode === 'grid' ? (
        <FlatList
          key="grid"
          data={filtered}
          keyExtractor={item => item.nr.toString()}
          numColumns={2}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: 16, marginBottom: 12 }}
          contentContainerStyle={{ paddingTop: 14, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <GridCard
              name={item}
              onPress={() => setSelected(item)}
              isFav={favs.has(item.nr)}
              onToggleFav={() => toggleFav(item.nr)}
              T={T}
            />
          )}
        />
      ) : (
        <FlatList
          key="list"
          data={filtered}
          keyExtractor={item => item.nr.toString()}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ListRow
              name={item}
              onPress={() => setSelected(item)}
              isFav={favs.has(item.nr)}
              onToggleFav={() => toggleFav(item.nr)}
              T={T}
            />
          )}
        />
      )}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────
   STYLES
───────────────────────────────────────────────────────────── */
const styles = StyleSheet.create({
  floatingBtn: {
    position: 'absolute', zIndex: 20, width: 36, height: 36, borderRadius: 18,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.2,
    textTransform: 'uppercase', marginBottom: 10,
  },
});
