import type { GuideStep, PhraseGuideItem, RakAhInfo } from './guideTypes';

// ── Snabbguide (9 steg) ───────────────────────────────────────────────────────

export const quickGuideSteps: GuideStep[] = [
  {
    id: 'quick_takbir',
    stepNumber: 1,
    title: 'Takbir',
    shortDescription:
      'Lyft händerna till axlarna eller öronen och säg Allahu Akbar.',
    illustrationKey: 'prayer_takbir',
  },
  {
    id: 'quick_standing',
    stepNumber: 2,
    title: 'Stående',
    shortDescription:
      'Placera höger hand över vänster på bröstet och läs al-Fatihah.',
    illustrationKey: 'prayer_standing_hands',
  },
  {
    id: 'quick_ruku',
    stepNumber: 3,
    title: 'Ruku',
    shortDescription:
      'Böj dig framåt med rak rygg och händerna på knäna.',
    illustrationKey: 'prayer_ruku',
  },
  {
    id: 'quick_rise',
    stepNumber: 4,
    title: 'Res dig upp',
    shortDescription: 'Res dig från ruku och stå helt upprätt.',
    illustrationKey: 'prayer_rise_from_ruku',
  },
  {
    id: 'quick_sujud',
    stepNumber: 5,
    title: 'Sujud',
    shortDescription:
      'Gå ner i nedfall med panna, näsa, händer, knän och tår mot marken.',
    illustrationKey: 'prayer_sujud',
  },
  {
    id: 'quick_sitting',
    stepNumber: 6,
    title: 'Sitt mellan sujud',
    shortDescription: 'Sitt på knä och be om förlåtelse.',
    illustrationKey: 'prayer_sitting_between_sujud',
  },
  {
    id: 'quick_second_sujud',
    stepNumber: 7,
    title: 'Andra sujud',
    shortDescription: 'Gå ner i sujud igen.',
    illustrationKey: 'prayer_second_sujud',
  },
  {
    id: 'quick_tashahhud',
    stepNumber: 8,
    title: 'Tashahhud',
    shortDescription:
      'Sitt ner, peka med höger pekfinger och läs tashahhud.',
    illustrationKey: 'prayer_tashahhud',
  },
  {
    id: 'quick_salam',
    stepNumber: 9,
    title: 'Salam',
    shortDescription:
      'Avsluta bönen genom att vrida huvudet åt höger och vänster.',
    illustrationKey: 'prayer_salam',
  },
];

// ── Fullständig guide (20 steg) ───────────────────────────────────────────────

export const fullGuideSteps: GuideStep[] = [
  {
    id: 'prayer_prepare',
    stepNumber: 1,
    title: 'Förbered dig för bönen',
    shortDescription: 'Efter wudu, ställ dig upp och vänd dig mot qibla.',
    detailedDescription:
      'Efter att du har gjort wudu, ställ dig upp och vänd dig mot qibla. Fötterna ska vara ungefär i axelbredd och peka framåt. Blicken bör vara riktad mot platsen där pannan kommer att nudda marken i sujud.',
    illustrationKey: 'prayer_prepare',
  },
  {
    id: 'prayer_takbir',
    stepNumber: 2,
    title: 'Takbir',
    shortDescription: 'Lyft händerna och inled bönen.',
    detailedDescription:
      'Lyft händerna till axlarna eller öronen med handflatorna riktade framåt.',
    say: {
      transliteration: 'Allahu Akbar',
      meaning: 'Allah är större.',
    },
    notes: ['Detta markerar att bönen börjar.'],
    illustrationKey: 'prayer_takbir',
  },
  {
    id: 'prayer_standing_hands',
    stepNumber: 3,
    title: 'Stående position',
    shortDescription: 'Placera händerna på bröstet.',
    detailedDescription:
      'Placera händerna på bröstet med höger hand över vänster hand.',
    say: {
      transliteration: "A'udhu billahi minash-shaytanir-rajim",
      meaning: 'Jag söker skydd hos Allah från satan den utstötte.',
    },
    illustrationKey: 'prayer_standing_hands',
  },
  {
    id: 'prayer_fatiha',
    stepNumber: 4,
    title: 'Läs al-Fatihah',
    shortDescription: 'Läs Koranens första kapitel.',
    detailedDescription:
      'Läs al-Fatihah. Munnen ska röra sig, även om du läser tyst.',
    say: {
      transliteration:
        "Bismillâhir-Rahmânir-Rahîm\nAl-hamdu-lil-lâhi Rab-bil-'âlamîn\nar-Rahmân-ir-Rahîm\nMâliki yaum-mid-dîn\nIy-yâka na'budu wa Iy-yâka na-sta'în\nIh-dinas-sirâ-tal-mustaqîm\nSira-tal-ladhîna an'amta 'alayhim\nGhai-ril-maghdoubi 'alayhim walad-dâ-ll-în\nÂmîn",
      meaning:
        "I Allahs den Barmhärtige, den Nåderikes namn!\nAllt lov och pris tillkommer Allah, världarnas Herre\nDen Barmhärtige, den Nåderike\nSom Allsmäktig råder över Domens Dag\nEndast Dig dyrkar vi och endast Dig ber vi om hjälp\nVägled oss till den raka vägen\nVägen som de Du har välsignat var och är på\ninte de som har drabbats av (Din) vrede och inte de som har gått vilse",
    },
    notes: ['Al-Fatihah är en nödvändig del av bönen.'],
    illustrationKey: 'prayer_fatiha',
  },
  {
    id: 'prayer_surah',
    stepNumber: 5,
    title: 'Läs en kort surah',
    shortDescription: 'Läs en valfri surah eller några verser.',
    detailedDescription:
      'Efter al-Fatihah läser du en valfri surah eller några verser från Koranen.',
    notes: ['Exempelvis kan du läsa en kort surah som al-Ikhlas.'],
    illustrationKey: 'prayer_surah',
  },
  {
    id: 'prayer_takbir_ruku',
    stepNumber: 6,
    title: 'Takbir inför ruku',
    shortDescription: 'Lyft händerna och säg Allahu Akbar.',
    detailedDescription:
      'Lyft händerna till axlarna eller öronen igen med handflatorna framåt.',
    say: {
      transliteration: 'Allahu Akbar',
      meaning: 'Allah är större.',
    },
    illustrationKey: 'prayer_takbir_ruku',
  },
  {
    id: 'prayer_ruku',
    stepNumber: 7,
    title: 'Ruku',
    shortDescription: 'Böj dig framåt med händerna på knäna.',
    detailedDescription:
      'Böj dig framåt så att rygg och huvud bildar en rak linje. Placera händerna på knäna.',
    say: {
      transliteration: "Subhana Rabbiyal-'Azim",
      meaning: 'Glorifierad är min Herre, den Väldige.',
      repeat: 'Säg tre gånger.',
    },
    notes: ['Recitera inte Koranen i ruku.'],
    illustrationKey: 'prayer_ruku',
  },
  {
    id: 'prayer_rise_from_ruku',
    stepNumber: 8,
    title: 'Res dig från ruku',
    shortDescription: 'Res dig upp och prisa Allah.',
    detailedDescription:
      'Res dig från ruku och lyft händerna till axlarna eller öronen.',
    say: {
      transliteration: "Sami'Allahu liman hamidah",
      meaning: 'Allah hör den som prisar Honom.',
    },
    illustrationKey: 'prayer_rise_from_ruku',
  },
  {
    id: 'prayer_standing_after_ruku',
    stepNumber: 9,
    title: 'Stå upprätt',
    shortDescription: 'Stå helt upprätt efter ruku.',
    detailedDescription:
      'När du står helt upprätt igen säger du lovprisningen.',
    say: {
      transliteration: 'Rabbana wa lakal-hamd',
      meaning: 'Vår Herre, Dig tillkommer all lovprisning.',
    },
    illustrationKey: 'prayer_standing_after_ruku',
  },
  {
    id: 'prayer_sujud',
    stepNumber: 10,
    title: 'Första sujud',
    shortDescription: 'Gå ner i nedfall.',
    detailedDescription:
      'Gå ner till marken så att panna, näsa, båda händerna, båda knäna och tårna vidrör marken.',
    say: {
      transliteration: "Subhâna rabbiy-yal 'alâ",
      meaning: 'Glorifierad är min Herre, den Högste.',
      repeat: 'Säg tre gånger.',
    },
    notes: [
      'Underarmarna ska inte vila platt mot marken.',
      'Panna och näsa ska nudda marken.',
      'Fingrarna riktas framåt.',
      'Tårna riktas mot qibla.',
    ],
    illustrationKey: 'prayer_sujud',
  },
  {
    id: 'prayer_sitting_between_sujud',
    stepNumber: 11,
    title: 'Sitt mellan två sujud',
    shortDescription: 'Sitt upp och be om förlåtelse.',
    detailedDescription:
      'Lyft huvud och överkropp tills du sitter på knä. Låt händerna vila på låren.',
    say: {
      transliteration: 'Rabbighfir li, Rabbighfir li',
      meaning: 'Min Herre, förlåt mig. Min Herre, förlåt mig.',
    },
    notes: [
      'Sitt avslappnad och vinkla vänster fot inåt och sitt på den.',
      'Håll den högra fotens häl upprätt med tårna mot marken pekandes rakt fram mot böneriktningen.',
      'Låt händerna vila utsträckta på låren.',
      'Kan man inte sitta på detta sätt går det bra att sitta på knä, på vanligt vis, med fötternas överdelar mot marken.',
    ],
    illustrationKey: 'prayer_sitting_between_sujud',
  },
  {
    id: 'prayer_second_sujud',
    stepNumber: 12,
    title: 'Andra sujud',
    shortDescription: 'Gå ner i sujud igen.',
    detailedDescription:
      'Gå ner i sujud igen och säg samma dhikr.',
    say: {
      transliteration: "Subhâna rabbiy-yal 'alâ",
      meaning: 'Glorifierad är min Herre, den Högste.',
      repeat: 'Säg tre gånger.',
    },
    notes: ["Detta avslutar en rak'ah."],
    illustrationKey: 'prayer_second_sujud',
  },
  {
    id: 'prayer_rise_next_rakah',
    stepNumber: 13,
    title: "Res dig till nästa rak'ah",
    shortDescription: 'Res dig upp igen.',
    detailedDescription:
      "Res dig från sujud till stående position för nästa rak'ah.",
    say: {
      transliteration: 'Allahu Akbar',
      meaning: 'Allah är större.',
    },
    illustrationKey: 'prayer_rise_next_rakah',
  },
  {
    id: 'prayer_rakah_repeat',
    stepNumber: 14,
    title: "Andra rak'ah",
    shortDescription: 'Upprepa grundstegen.',
    detailedDescription:
      "I andra rak'ah upprepar du stegen: al-Fatihah, en surah, ruku, stående, sujud, sittande och andra sujud.",
    illustrationKey: 'prayer_rakah_repeat',
  },
  {
    id: 'prayer_tashahhud',
    stepNumber: 15,
    title: "Tashahhud efter två rak'ah",
    shortDescription: 'Sitt ner och läs tashahhud.',
    detailedDescription:
      'Sätt dig ner. Vila händerna på låren och peka med höger pekfinger.',
    say: {
      transliteration:
        'At-tahiyyatu lillahi was-salawatu wat-tayyibat.\nAs-salamu \'alayka ayyuhan-nabiyyu wa rahmatullahi wa barakatuh.\nAs-salamu \'alayna wa \'ala \'ibadillahis-salihin.\nAsh-hadu an la ilaha illallah, wa ash-hadu anna Muhammadan \'abduhu wa rasuluh.',
      meaning:
        'Högaktning, bönerna och det goda tillkommer Allah. Må Frid och även Allahs Barmhärtighet och Hans Välsignelser vila över profeten. Må Frid vila över oss och Allahs rättfärdiga tjänare. Jag vittnar om att ingen har rätt att dyrkas förutom Allah, och jag vittnar om att Muhammed är Hans tjänare och sändebud.',
    },
    illustrationKey: 'prayer_tashahhud',
  },
  {
    id: 'prayer_continue',
    stepNumber: 16,
    title: "Om bönen har fler än två rak'ah",
    shortDescription: 'Res dig upp om bönen fortsätter.',
    detailedDescription:
      'Om du ber Dhuhr, Asr, Maghrib eller Isha reser du dig upp igen efter tashahhud. Om du ber Fajr sitter du kvar och avslutar bönen.',
    say: {
      transliteration: 'Allahu Akbar',
      meaning: 'Allah är större.',
    },
    illustrationKey: 'prayer_continue',
  },
  {
    id: 'prayer_final_tashahhud',
    stepNumber: 17,
    title: 'Sista tashahhud',
    shortDescription: 'Läs avslutande tashahhud och salawat.',
    detailedDescription:
      'När du har gjort bönens sista rak\'ah sätter du dig igen och läser tashahhud. Därefter läser du salawat över Profeten ﷺ.',
    say: {
      transliteration:
        "Allahumma salli 'ala Muhammad wa 'ala ali Muhammad, kama sallayta 'ala Ibrahim wa 'ala ali Ibrahim, innaka Hamidun Majid.\nAllahumma barik 'ala Muhammad wa 'ala ali Muhammad, kama barakta 'ala Ibrahim wa 'ala ali Ibrahim, innaka Hamidun Majid.",
      meaning:
        'O Allah, upphöj och ära Muhammed och Muhammeds familj, så som Du upphöjde och ärade Ibrahim och Ibrahims familj. Sannerligen är Du värd all pris, glorifierad. O Allah, sänd välsignelser över Muhammed och Muhammeds familj, så som Du sände välsignelser över Ibrahim och Ibrahims familj. Sannerligen är Du värd all pris, glorifierad.',
    },
    illustrationKey: 'prayer_final_tashahhud',
  },
  {
    id: 'prayer_dua',
    stepNumber: 18,
    title: "Du'a före avslutning",
    shortDescription: 'Sök skydd hos Allah och gör du\'a.',
    detailedDescription:
      'Innan du avslutar bönen är det rekommenderat att söka skydd hos Allah. Du kan även göra egen du\'a.',
    say: {
      transliteration:
        "Allahumma inni a'udhu bika min 'adhabi Jahannam,\nwa min 'adhabil-qabr,\nwa min fitnatil-mahya wal-mamat,\nwa min sharri fitnatil-masihid-dajjal.",
      meaning:
        'O Allah, jag söker Ditt skydd från straffet i Elden, straffet i graven, prövningarna i livet och efter döden samt från Dajjals prövning.',
    },
    illustrationKey: 'prayer_dua',
  },
  {
    id: 'prayer_salam_right',
    stepNumber: 19,
    title: 'Salam åt höger',
    shortDescription: 'Vrid huvudet åt höger.',
    detailedDescription: 'Avsluta bönen genom att vrida huvudet åt höger.',
    say: {
      transliteration: "As-salamu 'alaykum wa rahmatullah",
      meaning: 'Frid vare med er och Allahs barmhärtighet.',
    },
    illustrationKey: 'prayer_salam_right',
  },
  {
    id: 'prayer_salam_left',
    stepNumber: 20,
    title: 'Salam åt vänster',
    shortDescription: 'Vrid huvudet åt vänster.',
    detailedDescription:
      'Vrid sedan huvudet åt vänster och säg samma sak.',
    say: {
      transliteration: "As-salamu 'alaykum wa rahmatullah",
      meaning: 'Frid vare med er och Allahs barmhärtighet.',
    },
    notes: ['Nu är bönen färdig.'],
    illustrationKey: 'prayer_salam_left',
  },
];

// ── Vad säger jag? (fraser) ───────────────────────────────────────────────────

export const prayerPhrases: PhraseGuideItem[] = [
  {
    id: 'phrase_allahu_akbar',
    position: 'Takbir',
    transliteration: 'Allahu Akbar',
    meaning: 'Allah är större.',
    when: 'När bönen börjar och vid vissa övergångar.',
  },
  {
    id: 'phrase_audhu',
    position: 'Stående',
    transliteration: "A'udhu billahi minash-shaytanir-rajim",
    meaning: 'Jag söker skydd hos Allah från satan den utstötte.',
    when: 'Innan al-Fatihah.',
  },
  {
    id: 'phrase_fatiha',
    position: 'Stående',
    transliteration:
      "Bismillâhir-Rahmânir-Rahîm\nAl-hamdu-lil-lâhi Rab-bil-'âlamîn\nar-Rahmân-ir-Rahîm\nMâliki yaum-mid-dîn\nIy-yâka na'budu wa Iy-yâka na-sta'în\nIh-dinas-sirâ-tal-mustaqîm\nSira-tal-ladhîna an'amta 'alayhim\nGhai-ril-maghdoubi 'alayhim walad-dâ-ll-în\nÂmîn",
    meaning:
      "I Allahs den Barmhärtige, den Nåderikes namn!\nAllt lov och pris tillkommer Allah, världarnas Herre\nDen Barmhärtige, den Nåderike\nSom Allsmäktig råder över Domens Dag\nEndast Dig dyrkar vi och endast Dig ber vi om hjälp\nVägled oss till den raka vägen\nVägen som de Du har välsignat var och är på\ninte de som har drabbats av (Din) vrede och inte de som har gått vilse",
    when: "I varje rak'ah.",
  },
  {
    id: 'phrase_ruku',
    position: 'Ruku',
    transliteration: "Subhana Rabbiyal-'Azim",
    meaning: 'Glorifierad är min Herre, den Väldige.',
    repeat: 'Tre gånger.',
    when: 'I ruku.',
  },
  {
    id: 'phrase_rise_ruku',
    position: 'Reser sig från ruku',
    transliteration: "Sami'Allahu liman hamidah",
    meaning: 'Allah hör den som prisar Honom.',
    when: 'När man reser sig från ruku.',
  },
  {
    id: 'phrase_after_ruku',
    position: 'Stående efter ruku',
    transliteration: 'Rabbana wa lakal-hamd',
    meaning: 'Vår Herre, Dig tillkommer all lovprisning.',
    when: 'När man står upprätt efter ruku.',
  },
  {
    id: 'phrase_sujud',
    position: 'Sujud',
    transliteration: "Subhana Rabbiyal-A'la",
    meaning: 'Glorifierad är min Herre, den Högste.',
    repeat: 'Tre gånger.',
    when: 'I sujud.',
  },
  {
    id: 'phrase_between_sujud',
    position: 'Mellan två sujud',
    transliteration: 'Rabbighfir li, Rabbighfir li',
    meaning: 'Min Herre, förlåt mig. Min Herre, förlåt mig.',
    when: 'När man sitter mellan två sujud.',
  },
  {
    id: 'phrase_tashahhud',
    position: 'Sittande',
    transliteration:
      'At-tahiyyatu lillahi was-salawatu wat-tayyibat.\nAs-salamu \'alayka ayyuhan-nabiyyu wa rahmatullahi wa barakatuh.\nAs-salamu \'alayna wa \'ala \'ibadillahis-salihin.\nAsh-hadu an la ilaha illallah, wa ash-hadu anna Muhammadan \'abduhu wa rasuluh.',
    meaning:
      'Högaktning, bönerna och det goda tillkommer Allah. Må Frid och även Allahs Barmhärtighet och Hans Välsignelser vila över profeten. Må Frid vila över oss och Allahs rättfärdiga tjänare. Jag vittnar om att ingen har rätt att dyrkas förutom Allah, och jag vittnar om att Muhammed är Hans tjänare och sändebud.',
    when: "Efter två rak'ah och i sista sittningen.",
  },
  {
    id: 'phrase_salawat',
    position: 'Avslutande tashahhud',
    transliteration:
      "Allahumma salli 'ala Muhammad wa 'ala ali Muhammad, kama sallayta 'ala Ibrahim wa 'ala ali Ibrahim, innaka Hamidun Majid.\nAllahumma barik 'ala Muhammad wa 'ala ali Muhammad, kama barakta 'ala Ibrahim wa 'ala ali Ibrahim, innaka Hamidun Majid.",
    when: 'I sista tashahhud.',
  },
  {
    id: 'phrase_dua_before_salam',
    position: 'Sista sittningen',
    transliteration:
      "Allahumma inni a'udhu bika min 'adhabi Jahannam,\nwa min 'adhabil-qabr,\nwa min fitnatil-mahya wal-mamat,\nwa min sharri fitnatil-masihid-dajjal.",
    when: 'Före salam.',
  },
  {
    id: 'phrase_salam',
    position: 'Höger och vänster',
    transliteration: "As-salamu 'alaykum wa rahmatullah",
    meaning: 'Frid vare med er och Allahs barmhärtighet.',
    when: 'Först åt höger, sedan åt vänster.',
  },
];

// ── Antal rak'ah per bön ──────────────────────────────────────────────────────

export const rakahInfo: RakAhInfo[] = [
  { prayerName: 'Fajr',    rakahCount: 2 },
  { prayerName: 'Dhuhr',   rakahCount: 4 },
  { prayerName: 'Asr',     rakahCount: 4 },
  { prayerName: 'Maghrib', rakahCount: 3 },
  { prayerName: 'Isha',    rakahCount: 4 },
];

export const PRAYER_DISCLAIMER =
  'Guiden är en förenklad introduktion. Det kan finnas legitima skillnader i detaljer mellan lärda och rättsskolor.';

// ── Extra informationskort ────────────────────────────────────────────────────

export type PrayerInfoSection =
  | { type: 'text'; text: string }
  | { type: 'numbered'; items: string[] }
  | { type: 'bold_items'; items: Array<{ label: string; description: string }> }
  | { type: 'inline_mixed'; parts: Array<{ text: string; highlight: boolean }> }
  | { type: 'bullets'; items: string[] }
  | { type: 'bold_text'; text: string }
  | { type: 'italic_text'; text: string };

export type PrayerInfoItem = {
  id: string;
  title: string;
  sections: PrayerInfoSection[];
};

export const prayerInfoItems: PrayerInfoItem[] = [
  {
    id: 'prayer_info_conditions',
    title: 'Villkor för giltig bön',
    sections: [
      {
        type: 'text',
        text: 'För att bönen skall vara giltig måste följande villkor uppfyllas:',
      },
      {
        type: 'numbered',
        items: [
          'Att man är muslim.',
          'Att man är vid sina sinnens fulla bruk.',
          'Urskiljningsförmåga.',
          'Rituell renlighet.',
          'Att den bedjandes kropp, kläder och böneplats är fria från rituella orenheter.',
          "Att vara lämpligt klädd så att ens awrah täcks. [För kvinnan hela kroppen utom händer och ansikte. För mannen det som är mellan navel och knän samt axlarna. Kläderna skall inte vara genomskinliga och inte för åtsittande].",
          'Att bönetiden gått in.',
          'Att stå vänd mot Kaba, Mecka.',
          'Att ha avsikt för bön.',
        ],
      },
    ],
  },
  {
    id: 'prayer_info_five_prayers',
    title: 'De obligatoriska bönerna är fem till antalet',
    sections: [
      {
        type: 'bold_items',
        items: [
          { label: 'Fadjr',   description: "Morgonbönen som består av två rak'ah (enheter)." },
          { label: 'Duhur',   description: "Middagsbönen som består av fyra rak'ah (enheter)." },
          { label: "'Asr",    description: "Eftermiddagsbönen som består av fyra rak'ah (enheter)." },
          { label: 'Maghrib', description: "Som bes efter solnedgången och består av tre rak'ah (enheter)." },
          { label: "'Ishâ",   description: "Kvällsbönen som består av fyra rak'ah (enheter)." },
        ],
      },
    ],
  },
  {
    id: 'prayer_info_after_prayer',
    title: 'Efter bönen',
    sections: [
      { type: 'text', text: 'Det är rekommenderat att göra dhikr, åminnelser, efter bönen.' },
      { type: 'text', text: 'Profeten (ﷺ) brukade säga:' },
      {
        type: 'inline_mixed',
        parts: [
          { text: 'Astaghfirullâh', highlight: true },
          { text: ' (Jag ber Allah om förlåtelse)', highlight: false },
        ],
      },
      {
        type: 'inline_mixed',
        parts: [
          { text: '3 gånger, och sedan säga:', highlight: true },
        ],
      },
      {
        type: 'inline_mixed',
        parts: [
          { text: 'Allâhumma anta-salâm wa minka-salâm tabârakta yâ dhal djalâli wal-ikrâm', highlight: true },
        ],
      },
      { type: 'text', text: '(Allah! Du är as-Salâm (fri från brister) och från Dig kommer as-Salâm (Frid).\nDu har välsignat, Du som är Majestätisk och Givmild)' },
      { type: 'text', text: 'Sedan kan man säga:' },
      {
        type: 'inline_mixed',
        parts: [
          { text: 'Subhânallah', highlight: true },
          { text: ' (Glorifierad är Allah), ', highlight: false },
          { text: 'alhamdulillâh', highlight: true },
          { text: ' (all pris och tack tillkommer Allah), ', highlight: false },
          { text: 'Allahu Akbar', highlight: true },
          { text: ' (Allah är större), ', highlight: false },
          { text: '33 gånger vardera', highlight: true },
        ],
      },
      { type: 'text', text: 'och avsluta med att säga:' },
      {
        type: 'inline_mixed',
        parts: [
          { text: "Lâ ilâha ilallâh wahdahu lâ sharika lah, lahul mulk wa lahul hamd wa huwa 'ala kulli shay´in qadîr", highlight: true },
          { text: ' (Ingen har rätt att dyrkas förutom Allah, allena, ingen partner har Han vid Sin sida. Till Honom hör allt Herravälde och all pris. Han är kapabel till allting).', highlight: false },
        ],
      },
      { type: 'text', text: 'Det är också rekommenderat att läsa Ayatul kursî [Koranen 2: 255] efter varje bön.' },
    ],
  },
  {
    id: 'prayer_info_mosque',
    title: 'Moskén och att be i grupp',
    sections: [
      { type: 'text', text: 'Moskén (på arabiska: masdjid) är en plats där man dyrkar Allah och utför sina böner.' },
      { type: 'text', text: 'Profeten (ﷺ) sade:' },
      { type: 'italic_text', text: '"Att be i grupp är 27 gånger bättre än att be själv." [al-Bukhârî och Muslim]' },
      { type: 'bold_text', text: 'När du är i moskén så tänk på att:' },
      {
        type: 'bullets',
        items: [
          'Inte störa de bedjande.',
          'Stänga av mobilen eller sätta den på ljudlös.',
          "Be två enheter [rak'ah] innan du sätter dig ner.",
          'Ha på dig rena kläder.',
          'Inte äta sådant som ger en dålig andedräkt innan. Som lök eller vitlök.',
          'Passera inte framför någon som ber själv eller den som är imam.\nMen det är tillåtet att passera framför de som leds av en imam.',
        ],
      },
    ],
  },
  {
    id: 'prayer_info_invalidators',
    title: 'Handlingar som gör bönen ogiltig',
    sections: [
      { type: 'text', text: 'Bönen nollställs och är ogiltig om någon av följande handlingar begås:' },
      {
        type: 'bullets',
        items: [
          'Att avsiktligt tala.',
          "Att någon del av 'awrah syns (förutom om man råkar visa en del av ens 'awrah, som man sedan täcker).",
          'Att skratta.',
          'Att stå vänd alltför långt ifrån böneriktningen.',
          'Att äta.',
          'Att utan giltig orsak göra många rörelser andra än de rörelser som hör till bönen.',
          'Att dricka.',
          'Att förlora sin wudû.',
        ],
      },
    ],
  },
];
