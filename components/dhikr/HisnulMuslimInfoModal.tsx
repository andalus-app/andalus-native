import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Animated, Easing,
  PanResponder, Dimensions, LayoutAnimation, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import BackButton from '../BackButton';
import { useTheme } from '../../context/ThemeContext';

const SCREEN_W = Dimensions.get('window').width;

// ─── Content types ─────────────────────────────────────────────────────────────
type Block =
  | { t: 'p'; text: string }
  | { t: 'quote'; text: string; source: string }
  | { t: 'bullets'; items: string[] }
  | { t: 'numbered'; items: string[] }
  | { t: 'h2'; text: string }
  | { t: 'table'; rows: [string, string][] }
  | { t: 'attribution'; text: string }
  | { t: 'refs'; items: string[] };

type InfoSection = { id: string; title: string; blocks: Block[] };

// ─── Content ───────────────────────────────────────────────────────────────────
const SECTIONS: InfoSection[] = [
  {
    id: 'forord',
    title: 'Förord',
    blocks: [
      {
        t: 'p',
        text: 'Appen är känd som Hisnul Muslim eller Fortress of the Muslim och är en sammanställning av åminnelser och åkallelser från Koranen och profetens (ﷺ) sunnah. Hisnul Muslim betyder Muslimens fästning ¹. Profeten (ﷺ) sade i en del av en hadith:',
      },
      {
        t: 'quote',
        text: '...och Han befalde er att minnas Allah. Att minnas Allah är som liknelsen av den man vars fiender följde honom i hans fotspår till dess att han kom fram till en befäst fästning och kunde skydda sig från dem. På samma sätt är det för muslimen; han kan inte skydda sig från djävulen förutom genom att minnas och nämna Allah.',
        source: '¹',
      },
      {
        t: 'p',
        text: 'Åkallan och åminnelser skyddar alltså muslimen. Åkallan och åminnelser ger liv till hjärtat, styrka till kroppen, lycka till själen och är ett skydd och en räddning från allt ont. Att minnas Allah är ett av de bästa sätten att nämna sig Allah på, och en av de bästa dyrkanshandlingarna en muslim kan utföra. Att minnas Allah för med sig många goda frukter och leder till lycka i både detta och nästkommande liv.',
      },
      {
        t: 'p',
        text: 'Hisnul Muslim sammanställdes av Shaykh Sa\'id bin Ali bin Wahf al-Qahtani (rahimahullah) — en av de mest korrekta, omfattande och lätta hjälpmedlen till att kunna minnas och åkalla Allah.',
      },
      {
        t: 'p',
        text: 'Det är därför en stor ära att få presentera denna app översatt direkt från dess originalspråk till svenska, och jag hoppas att den kommer att gladja och gynna Sveriges muslimer och vara en källa till att åkallan och åminnelser blir en större del av deras vardag.',
      },
      {
        t: 'quote',
        text: 'Och de män och de kvinnor som alltid har Allah i tankarna och minns Honom — för dem alla har Allah i beredskap förlåtelse för deras synder och en rik belöning.',
        source: 'Koranen 33:35',
      },
      {
        t: 'quote',
        text: 'Men först och störst är åkallandet av Allahs namn. Och Allah vet vad ni gör.',
        source: 'Koranen 29:45',
      },
      {
        t: 'p',
        text: 'Utöver den stora belöningen som finns i att minnas Allah finner vi även att dessa åminnelser och åkallelser lär oss mycket om vår religion och stärker den troendes tro. De hör till Profetens (ﷺ) korta och koncisa uttalanden som kommer med en djup innebörd och mäktig betydelse. De är lätta att uttala och lära sig, de väger tungt på vågskålen på Domedagen och de är älskade av Allah.',
      },
      {
        t: 'p',
        text: 'Jag vill även tacka alla som varit med och stöttat detta projekt på olika sätt — och all framgång är från Allah.',
      },
      { t: 'attribution', text: 'Översatt och sammanställd av:\nYosuf Abdul-Hamid och Moosa Assal' },
      { t: 'refs', items: ['¹ Ahmad 4/202 och At-Tirmidhî nr 2872.'] },
    ],
  },
  {
    id: 'tillvagagangssatt',
    title: 'Tillvägagångssätt',
    blocks: [
      {
        t: 'p',
        text: 'Appen är översatt till svenska direkt från originalspråket arabiska. Målet har först och främst varit att förmedla betydelsen av de åminnelser och åkallelser som finns där, så att läsaren kan förstå innebörden av dem, samtidigt som målet varit att ligga så nära den arabiska texten som möjligt i översättningen.',
      },
      {
        t: 'p',
        text: 'Alla verser från Koranen och uttalanden från Profeten (ﷺ) är översättningar av dess betydelser på svenska.',
      },
      {
        t: 'p',
        text: 'En translitteration har tagits fram som ett hjälpmedel för de som ännu inte lärt sig att läsa på arabiska, för att underlätta för dem att lära sig och memorera dessa åminnelser. Ljudfiler där man kan lyssna på dessa åminnelser och lära sig hur de uttalas på arabiska finns på www.hisnulmuslim.se',
      },
      {
        t: 'p',
        text: 'Translitterationen är anpassad efter ljudfilerna och det kan finnas mer än ett korrekt sätt att läsa vissa av de åkallan och åminnelser som finns i appen.',
      },
    ],
  },
  {
    id: 'translitteration',
    title: 'Translitterationstabell',
    blocks: [
      {
        t: 'p',
        text: 'Vissa bokstäver och uttal på arabiska har ingen motsvarighet på svenska. Därför har en lista tagits fram för att förklara hur vissa bokstäver som finns i translitterationen skall uttalas.',
      },
      {
        t: 'table',
        rows: [
          ['Â / â', 'Lång vokal. Uttalas som ett långt a eller långt â.'],
          ['Û / û', 'Lång vokal. Uttalas som ett långt o.'],
          ['Î / î', 'Lång vokal. Uttalas som ett långt i.'],
          ['th / ث', 'Ingen motsvarighet på svenska. Uttalas som engelskans "think" eller "three".'],
          ['dj / ج', 'Ingen motsvarighet på svenska. Uttalas "dj" som engelskans "jungle".'],
          ['kh / خ', 'Ingen motsvarighet på svenska. Ett fräsande "sjeljud" bildat genom att tungroten nuddar den översta delen av halsen.'],
          ['th / ذ', 'Ingen motsvarighet på svenska. Uttalas som engelskans "the".'],
          ['sh / ش', 'Ett sje-ljud som i svenskans "kind".'],
          ['d / ص', 'Ingen motsvarighet på svenska. Ett "d-ljud" som bildas från sidan av kinden.'],
          ['t / ط', 'Ingen motsvarighet på svenska. Ett "t-ljud" bildat genom att tungan pressas mot gommen.'],
          ['dh / ظ', 'Ingen motsvarighet på svenska. Uttalas nästan som engelskans "the", fast med ett a på slutet.'],
          ['a / ع', 'Ingen motsvarighet på svenska. Ett djupt "a-ljud" bildat genom att man delvis stoppar lufttillförseln i den mellersta delen av halsen.'],
          ['gh / غ', 'Uttalas som ett franskt "r".'],
          ['q / ق', 'Ingen motsvarighet på svenska. Ett kluckande ljud bildat när tungroten nuddar den bakersta, mjuka delen av gommen.'],
        ],
      },
    ],
  },
  {
    id: 'fortraffligheten',
    title: 'Förträffligheten i att minnas Allah',
    blocks: [
      {
        t: 'p',
        text: 'Att minnas Allah omfattar många olika former av dyrkan; att göra dhikr, åkalla Allah och läsa Koranen.',
      },
      { t: 'p', text: 'Det finns många nyttor med att minnas Allah, bland dessa är:' },
      {
        t: 'bullets',
        items: [
          'Det stöter bort djävulen.',
          'Det gör Allah nöjd.',
          'Det tar bort sorg och förtvivlan från hjärtat.',
          'Det stärker kroppen och hjärtat och leder till att hjärtat får liv.',
          'Det leder till att man får mer försörjning.',
          'Det leder till att man kommer närmare Allah och känner att Allah vakar över en.',
          'Detta i sin tur leder till att man blir mer gudfruktig och håller sig inom de gränser Allah har satt vad gäller det som är tillåtet och otillåtet.',
          'Ju mer vi nämner Allah desto närmare Honom kommer vi, och ju mer vi försummar att minnas Allah desto längre från Honom kommer vi.',
          'Dessa åminnelser lär oss mycket om Allah, och ju mer dhikr vi gör, desto mer lär vi oss om Allah. Ju mer vi lär oss om Allah desto mer kommer vi att älska Allah.',
          'Den som minns Allah i lätta tider kommer Allah att minnas i svåra tider.',
          'Det är en räddning från Allahs straff.',
          'En person som vänjer sig att minnas Allah på olika sätt kommer att vara upptagen med det istället för att prata illa om andra, baktala, ljuga, svära och liknande.',
          'Sittningar där Allah nämns är även änglarnas sittningar.',
          'Det är en av de lättaste formerna av dyrkan, samtidigt det är en av de bästa.',
          'Att minnas Allah är ett ljus för den troende i detta liv, ett ljus i graven och ljus på Domedagen.',
          'Att minnas Allah är ett botemedel för hjärtat, och att försumma att minnas Allah är en sjukdom.',
          'Att minnas Allah är ett av de bästa hjälpmedlen till att lyda Honom.',
          'Den som minns Allah mycket får styrka.',
          'Att minnas Allah gör det svåra lättare.',
          'Den som gör mest dhikr i en dyrkan är den som utför den bäst. Den som minns Allah mest i bönen och med ett närvarande hjärta utför bönen bättre än den som inte gör det. Om man minns Allah genom att läsa Koranen, göra mycket dhikr och du\'â är man bättre än den som fastar men inte gör detta. Samma sak gäller alla dyrkanshandlingar.',
        ],
      },
      {
        t: 'quote',
        text: 'Och minns Mig, så skall Jag minnas er; var Mig tacksam och förneka Mig inte!',
        source: 'Koranen 2:152',
      },
      {
        t: 'quote',
        text: 'Troende! Åkalla Allah — och minns Honom ständigt!',
        source: 'Koranen 33:41',
      },
      {
        t: 'quote',
        text: 'Och de män och de kvinnor som alltid minns Allah — för dem alla har Allah i beredskap förlåtelse för deras synder och en rik belöning.',
        source: 'Koranen 33:35',
      },
      {
        t: 'quote',
        text: 'Och — [du som är troende] — åkalla i tysthet din Herre ödmjukt och med fruktan. Och var inte som de tanklösa, de likgiltiga.',
        source: 'Koranen 7:205',
      },
      {
        t: 'quote',
        text: 'Den som minns sin Herre och den som inte minns sin Herre — är som den levande och den döde. ¹',
        source: 'Profeten (ﷺ)',
      },
      {
        t: 'quote',
        text: 'Allah den Högste säger: "Jag är med Min tjänare när han tänker på Mig och Jag är med honom när han nämner Mig. Om han nämner Mig för sig själv så nämner Jag honom för Mig själv, och om han nämner Mig i en samling så nämner Jag honom i en bättre samling. Om han närmar sig Mig med en handslängd så nämner Jag honom med en armslängd. Och om han närmar sig Mig med en armslängd så nämner Jag honom med två armslängder. Och om han kommer mot mig gåendes så skyndar Jag mig mot honom." ²',
        source: 'Profeten (ﷺ)',
      },
      {
        t: 'quote',
        text: 'Låt din tunga ständigt minnas Allah. ³',
        source: 'Profeten (ﷺ) — till en man som bad om ett råd',
      },
      {
        t: 'quote',
        text: 'Den som läser en bokstav från Allahs Bok kommer att få en hasanah, och en hasanah kommer med tio till. Jag säger inte att "Alif, Lâm, Mîm" är en bokstav tillsammans. Utan Alif är en bokstav, Lâm en bokstav och Mîm en bokstav. ⁴',
        source: 'Profeten (ﷺ)',
      },
      {
        t: 'quote',
        text: 'Inga människor sitter i en samling utan att nämna Allah och utan att upphöja sin profet, förutom att det kommer att bli en källa till sorg för dem. Om Allah vill kommer Han att straffa dem, och om Han vill kommer Han att förlåta dem. ⁵',
        source: 'Profeten (ﷺ)',
      },
      {
        t: 'quote',
        text: 'Inga människor reser sig från en samling vari de inte nämnt Allahs Namn, utan att det är som att de kliver ner från en död åsnas ruttnande rygg. Och det skulle vara en orsak till sorg för dem. ⁶',
        source: 'Profeten (ﷺ)',
      },
      { t: 'h2', text: 'Vad man bör göra för att höra till de som ständigt minns Allah' },
      {
        t: 'p',
        text: 'Profeten (ﷺ) sade: "Al-mufarridûn ⁷ har gått före!"\n\nDå sade hans följeslagare: "Vilka är al-mufarridûn?"\n\nHan (ﷺ) sade: "De män och kvinnor som alltid har Allah i tankarna och minns Honom mycket."',
      },
      {
        t: 'p',
        text: 'För att tillhöra dessa skall man hålla sig till det Allah har befallt och lyda Allah och Hans sändebud (ﷺ), samt vara upptagen med att minnas Allah genom att göra olika former av dhikr. Gör man detta uppriktigt för Allahs skull i hopp om belöning från Allah, så tillhör man dessa.',
      },
      {
        t: 'refs',
        items: [
          '¹ Al-Bukhârî 11/208. Muslim 1/539.',
          '² Al-Bukhârî 171. Muslim 4/2061.',
          '³ At-Tirmidhî 5/458. Ibn Mâdjah 2/1246.',
          '⁴ At-Tirmidhî 5/175.',
          '⁵ Sahîh-ut-Tirmidhî 3/140. Imam al-Albânî.',
          '⁶ Abû Dâwûd 4/264. Ahmad 2/389.',
          '⁷ De som skiljer sig från sin omgivning genom att minnas Allah när andra inte gör det.',
        ],
      },
    ],
  },
  {
    id: 'tankapa',
    title: "Att tänka på när man gör dhikr och du'â",
    blocks: [
      {
        t: 'p',
        text: 'När man skall minnas Allah eller åkalla Honom finns det saker man bör tänka på som Islam lärt oss. Den som gör dessa saker i samband med sin åkallan och åminnelse har större möjlighet att uppnå det han söker efter, till skillnad från den som slarvar med dessa saker.',
      },
      { t: 'p', text: 'Här följer några av de saker som är bra att tänka på:' },
      {
        t: 'numbered',
        items: [
          'Att be om förlåtelse för sina synder innan man ber Allah om det man vill ha. Samt att ångra sig för sina synder och lova att inte återvända till dem.',
          'Att vara ödmjuk och att hjärtat är närvarande och koncentrerat.',
          'Att prisa Allah innan man ber om det man vill ha.',
          'Att be Allah att upphöja profeten Muhammed (ﷺ).',
          'Att vara uppriktig och undergiven.',
          'Att inte ge upp hoppet om Allahs nåd och att ha starkt hopp och tillit till Allah.',
          'Att också be för sina muslimska bröder och systrar.',
        ],
      },
      { t: 'h2', text: 'Andra saker att tänka på' },
      {
        t: 'numbered',
        items: [
          'Att vara vänd mot Qibla i Mecka.',
          'Om du sitter ner, tänk på att sitta i lugn och ro, på ett ödmjukt sätt. Det är dock tillåtet att minnas Allah var man än är, utom på vissa platser som när man sitter på toaletten och liknande.',
          'Att höja händerna när man åkallar Allah och vara vänd mot Qibla i Mecka.',
          'Att vara ren och göra wudû innan man börjar.',
          'Att göra sig av med det som distraherar en från att minnas Allah med ett närvarande hjärta.',
        ],
      },
      {
        t: 'quote',
        text: 'De var alltid beredda att göra gott och åkallade Mig med hopp och fruktan och visade stor undergivenhet.',
        source: 'Koranen 21:90',
      },
    ],
  },
  {
    id: 'tider',
    title: 'Tider då ens åkallan besvaras',
    blocks: [
      {
        t: 'p',
        text: 'Det finns tider då det är extra rekommenderat att göra mycket åkallan. Några av dessa tider är:',
      },
      {
        t: 'numbered',
        items: [
          'Den sista tredjedelen av natten innan gryningen.',
          'När man är i sudjûd i bönen.',
          "Under fredagen och speciellt tiden efter 'asr innan solnedgången.",
          'Tiden mellan böneutropet och iqâmah.',
          'Under laylat-ul-qadr i månaden Ramadan.',
          'Under fastan.',
          'När man är på resande fot.',
        ],
      },
      {
        t: 'p',
        text: 'Dessa tider är det starkt rekommenderat att göra åkallan, men det betyder inte att man inte skall åkalla Allah under andra tider. Allah älskar de som vänder sig till Honom i alla tider och Han älskar de som minns Honom under alla tider.',
      },
      {
        t: 'p',
        text: 'Tänk på att Allah är god och endast accepterar det goda. Var noga med att det ni äter är tillåtet (halâl) och att ni tjänar era pengar på ett tillåtet sätt. Akta er för att förtrycka andra människor och akta er för synder och de saker som hindrar åkallan från att accepteras.',
      },
      {
        t: 'quote',
        text: 'ER HERRE säger: "Be till Mig, så skall Jag besvara er [bön]. De som håller sig för goda för att i ödmjukhet tjäna Mig skall gå med böjt huvud in i helvetet."',
        source: 'Koranen 40:60',
      },
      {
        t: 'quote',
        text: 'NÄR MINA tjänare frågar dig om Mig då är Jag nära; Jag besvarar den bedjandes bön, när han ber till Mig. Och de uppmanas att svara när Jag kallar och att tro på Mig — kanske skall de ledas på rätt väg.',
        source: 'Koranen 2:186',
      },
      {
        t: 'quote',
        text: 'Åkalla Allah er Herre i det tysta med ödmjukt sinne; Han älskar inte dem som går till överdrift. Och stör inte ordningen och sprid inte sedefördärv på jorden, sedan allt där har ställts till rätta. Åkalla Honom med bävan och hopp; Allahs nåd är nära dem som gör det goda och det rätta.',
        source: 'Koranen 7:55–56',
      },
      { t: 'h2', text: 'Exempel på saker som är bra att be om' },
      {
        t: 'numbered',
        items: [
          'Vägledning och gudsfruktan.',
          'Förlåtelse för synder.',
          'Paradiset och att söka skydd från elden.',
          'Att skonas i detta och nästa liv.',
          'Stadfasthet i religionen.',
          'Ett gott slut i alla angelägenheter.',
          'Att Allah ska tillrättaställa ens religion, världsliga angelägenheter och nästa liv.',
          'Att Allahs gåvor aldrig skall upphöra.',
          'Att söka skydd från allt ont.',
        ],
      },
      { t: 'h2', text: 'Sammanfattning' },
      { t: 'p', text: 'När du åkallar Allah, tänk på att uppfylla följande:' },
      {
        t: 'numbered',
        items: [
          'Att du inte åkallar någon annan än Allah och att du följer profetens (ﷺ) vägledning i allt.',
          'Att du är säker på att Allah kommer att besvara din åkallan, eller spara den till belöning i nästa liv.',
          'Att ditt hjärta är närvarande och ödmjukt.',
        ],
      },
      { t: 'h2', text: 'I samband med åkallan bör du akta dig för' },
      {
        t: 'numbered',
        items: [
          'Att du syndar och gör det som är förbjudet.',
          'Att du snabbt ger upp och slutar åkalla Allah.',
          'Att du ber om något som inte är tillåtet.',
          'Att du ber mot dig själv, dina barn eller din familj.',
        ],
      },
    ],
  },
];

// ─── Block renderers ────────────────────────────────────────────────────────────
function BlockParagraph({ text, T }: { text: string; T: any }) {
  return (
    <Text style={{ fontSize: 14, lineHeight: 22, color: T.textSecondary, marginBottom: 12 }}>
      {text}
    </Text>
  );
}

function BlockQuote({ text, source, T, isDark }: { text: string; source: string; T: any; isDark: boolean }) {
  return (
    <View style={{
      borderLeftWidth: 3, borderLeftColor: T.accent,
      marginVertical: 10,
      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
      borderRadius: 6, paddingVertical: 12, paddingRight: 12, paddingLeft: 14,
    }}>
      <Text style={{ fontSize: 13.5, lineHeight: 21, color: T.text, fontStyle: 'italic' }}>
        "{text}"
      </Text>
      {!!source && (
        <Text style={{ fontSize: 11, color: T.accent, fontWeight: '600', marginTop: 6 }}>
          [{source}]
        </Text>
      )}
    </View>
  );
}

function BlockBullets({ items, T }: { items: string[]; T: any }) {
  return (
    <View style={{ marginBottom: 12, gap: 6 }}>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
          <Text style={{ fontSize: 14, color: T.accent, marginTop: 1, flexShrink: 0 }}>•</Text>
          <Text style={{ fontSize: 14, lineHeight: 21, color: T.textSecondary, flex: 1 }}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function BlockNumbered({ items, T }: { items: string[]; T: any }) {
  return (
    <View style={{ marginBottom: 12, gap: 8 }}>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: T.accentGlow, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: T.accent }}>{i + 1}</Text>
          </View>
          <Text style={{ fontSize: 14, lineHeight: 21, color: T.textSecondary, flex: 1 }}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function BlockH2({ text, T }: { text: string; T: any }) {
  return (
    <Text style={{ fontSize: 15, fontWeight: '700', color: T.text, marginTop: 14, marginBottom: 8, lineHeight: 22 }}>
      {text}
    </Text>
  );
}

function BlockTable({ rows, T, isDark }: { rows: [string, string][]; T: any; isDark: boolean }) {
  const headerBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const altBg    = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
  return (
    <View style={{ borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: T.border, marginBottom: 12 }}>
      {/* Header row */}
      <View style={{ flexDirection: 'row', backgroundColor: headerBg }}>
        <View style={{ width: 80, padding: 8, borderRightWidth: 1, borderRightColor: T.border }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>Bokstav</Text>
        </View>
        <View style={{ flex: 1, padding: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>Förklaring</Text>
        </View>
      </View>
      {rows.map(([letter, explanation], i) => (
        <View key={i} style={{ flexDirection: 'row', backgroundColor: i % 2 === 1 ? altBg : 'transparent', borderTopWidth: 1, borderTopColor: T.border }}>
          <View style={{ width: 80, padding: 9, borderRightWidth: 1, borderRightColor: T.border, justifyContent: 'center' }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: T.accent, fontFamily: 'monospace' }}>{letter}</Text>
          </View>
          <View style={{ flex: 1, padding: 9 }}>
            <Text style={{ fontSize: 12.5, lineHeight: 18, color: T.textSecondary }}>{explanation}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function BlockAttribution({ text, T }: { text: string; T: any }) {
  return (
    <View style={{ borderRadius: 10, borderWidth: 1, borderColor: T.border, padding: 12, marginVertical: 10, alignItems: 'center' }}>
      <Text style={{ fontSize: 13, color: T.textMuted, textAlign: 'center', lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

function BlockRefs({ items, T }: { items: string[]; T: any }) {
  return (
    <View style={{ marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: T.border }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        Källor
      </Text>
      {items.map((item, i) => (
        <Text key={i} style={{ fontSize: 11, color: T.textMuted, lineHeight: 17, marginBottom: 2 }}>{item}</Text>
      ))}
    </View>
  );
}

function renderBlock(block: Block, T: any, isDark: boolean, idx: number) {
  switch (block.t) {
    case 'p':         return <BlockParagraph key={idx} text={block.text} T={T} />;
    case 'quote':     return <BlockQuote key={idx} text={block.text} source={block.source} T={T} isDark={isDark} />;
    case 'bullets':   return <BlockBullets key={idx} items={block.items} T={T} />;
    case 'numbered':  return <BlockNumbered key={idx} items={block.items} T={T} />;
    case 'h2':        return <BlockH2 key={idx} text={block.text} T={T} />;
    case 'table':     return <BlockTable key={idx} rows={block.rows} T={T} isDark={isDark} />;
    case 'attribution': return <BlockAttribution key={idx} text={block.text} T={T} />;
    case 'refs':      return <BlockRefs key={idx} items={block.items} T={T} />;
    default:          return null;
  }
}

// ─── Accordion section card ─────────────────────────────────────────────────────
function SectionCard({
  section, isOpen, onToggle, T, isDark,
}: {
  section: InfoSection; isOpen: boolean; onToggle: () => void; T: any; isDark: boolean;
}) {
  const chevAnim = useRef(new Animated.Value(isOpen ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(chevAnim, {
      toValue: isOpen ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
      easing: Easing.out(Easing.quad),
    }).start();
  }, [isOpen, chevAnim]);
  const chevRotate = chevAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });
  const openBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';

  return (
    <View style={{ borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: T.border, marginBottom: 10 }}>
      <TouchableOpacity
        onPress={() => {
          LayoutAnimation.configureNext({
            duration: 240,
            create:  { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
            update:  { type: LayoutAnimation.Types.easeInEaseOut },
            delete:  { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
          });
          onToggle();
        }}
        activeOpacity={0.75}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, backgroundColor: isOpen ? openBg : T.bg }}
      >
        <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: isOpen ? T.accent : (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'), minHeight: 36 }} />
        <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: isOpen ? T.accent : T.text, lineHeight: 20 }}>
          {section.title}
        </Text>
        <Animated.View style={{ transform: [{ rotate: chevRotate }] }}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none"
            stroke={isOpen ? T.accent : T.textMuted} strokeWidth={2.2}>
            <Path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Animated.View>
      </TouchableOpacity>

      {isOpen && (
        <View style={{ padding: 16, paddingTop: 4, borderTopWidth: 1, borderTopColor: T.border, backgroundColor: openBg }}>
          {section.blocks.map((block, i) => renderBlock(block, T, isDark, i))}
        </View>
      )}
    </View>
  );
}

// ─── Main modal ─────────────────────────────────────────────────────────────────
export default function HisnulMuslimInfoModal({ onClose }: { onClose: () => void }) {
  const { theme: T, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  // Slide-in animation
  const translateX = useRef(new Animated.Value(SCREEN_W)).current;
  useEffect(() => {
    Animated.timing(translateX, {
      toValue: 0, duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);

  const goBack = useCallback(() => {
    Animated.timing(translateX, {
      toValue: SCREEN_W, duration: 240,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(onClose);
  }, [onClose, translateX]);

  // Edge swipe
  const edgePan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (evt, gs) =>
      evt.nativeEvent.pageX < 30 && gs.dx > 8 && gs.dx > Math.abs(gs.dy) * 2,
    onPanResponderMove: (_, gs) => { if (gs.dx > 0) translateX.setValue(gs.dx); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dx > SCREEN_W * 0.35 || gs.vx > 0.5) {
        Animated.timing(translateX, { toValue: SCREEN_W, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(onClose);
      } else {
        Animated.timing(translateX, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.timing(translateX, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    },
  })).current;

  const shadowOpacity = translateX.interpolate({ inputRange: [0, SCREEN_W * 0.5], outputRange: [0.18, 0], extrapolate: 'clamp' });

  const toggleSection = useCallback((id: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: T.bg, zIndex: 20, transform: [{ translateX }] }]}>
      {/* Edge shadow */}
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 16, zIndex: 1, opacity: shadowOpacity, shadowColor: '#000', shadowOffset: { width: -8, height: 0 }, shadowOpacity: 1, shadowRadius: 16 }}
      />
      {/* Edge swipe capture zone */}
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, zIndex: 30 }} {...edgePan.panHandlers} />

      {/* Header */}
      <View style={{ paddingTop: insets.top, borderBottomWidth: 1, borderBottomColor: T.border, backgroundColor: T.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 12, paddingTop: 10 }}>
          <BackButton onPress={goBack} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 19, fontWeight: '800', color: T.text, letterSpacing: -0.3 }}>Om Hisnul Muslim</Text>
            <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>Muslimens Fästning — information & guide</Text>
          </View>
        </View>
      </View>

      {/* Scrollable content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ fontSize: 12, color: T.textMuted, marginBottom: 16, lineHeight: 18 }}>
          Tryck på en rubrik för att läsa mer om Hisnul Muslim — förord, tillvägagångssätt, translitteration och vägledning för dhikr och du'â.
        </Text>

        {SECTIONS.map(section => (
          <SectionCard
            key={section.id}
            section={section}
            isOpen={openSections.has(section.id)}
            onToggle={() => toggleSection(section.id)}
            T={T}
            isDark={isDark}
          />
        ))}
      </ScrollView>
    </Animated.View>
  );
}
