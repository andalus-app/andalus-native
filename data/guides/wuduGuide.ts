import type { GuideStep } from './guideTypes';

export const wuduSteps: GuideStep[] = [
  {
    id: 'wudu_intention',
    stepNumber: 1,
    title: 'Avsikt',
    shortDescription: 'Ha avsikt i hjärtat att göra wudu.',
    detailedDescription: 'Avsikten görs i hjärtat och ska inte uttalas högt.',
    illustrationKey: 'wudu_intention',
  },
  {
    id: 'wudu_bismillah',
    stepNumber: 2,
    title: 'Säg Bismillah',
    shortDescription: 'Inled med att säga Bismillah.',
    detailedDescription: 'Säg Bismillah innan du börjar tvagningen.',
    say: {
      transliteration: 'Bismillah',
      meaning: 'I Allahs namn.',
    },
    illustrationKey: 'wudu_bismillah',
  },
  {
    id: 'wudu_hands',
    stepNumber: 3,
    title: 'Tvätta händerna',
    shortDescription: 'Tvätta händerna upp till handlederna.',
    detailedDescription: 'Tvätta båda händerna upp till handlederna.',
    say: {
      repeat: 'Tre gånger.',
    },
    illustrationKey: 'wudu_hands',
  },
  {
    id: 'wudu_mouth',
    stepNumber: 4,
    title: 'Skölj munnen',
    shortDescription: 'Ta in vatten i munnen och skölj.',
    detailedDescription:
      'Ta in vatten i munnen med höger hand, skölj runt och spotta sedan ut.',
    say: {
      repeat: 'Tre gånger.',
    },
    illustrationKey: 'wudu_mouth',
  },
  {
    id: 'wudu_nose',
    stepNumber: 5,
    title: 'Skölj näsan',
    shortDescription: 'För in vatten i näsan och fräs ut.',
    detailedDescription:
      'För in vatten i näsborrarna med höger hand och fräs ut med vänster hand.',
    say: {
      repeat: 'Tre gånger.',
    },
    illustrationKey: 'wudu_nose',
  },
  {
    id: 'wudu_face',
    stepNumber: 6,
    title: 'Tvätta ansiktet',
    shortDescription: 'Tvätta hela ansiktet.',
    detailedDescription:
      'Tvätta ansiktet från hårfästet till hakan och från öra till öra.',
    say: {
      repeat: 'Tre gånger.',
    },
    illustrationKey: 'wudu_face',
  },
  {
    id: 'wudu_arms',
    stepNumber: 7,
    title: 'Tvätta armarna',
    shortDescription: 'Tvätta höger och vänster arm.',
    detailedDescription:
      'Tvätta först höger hand och arm upp till och inklusive armbågen. Gör sedan samma sak med vänster arm.',
    say: {
      repeat: 'Tre gånger per arm.',
    },
    illustrationKey: 'wudu_arms',
  },
  {
    id: 'wudu_head',
    stepNumber: 8,
    title: 'Stryk över huvudet',
    shortDescription: 'Stryk våta händer över huvudet.',
    detailedDescription:
      'Stryk med våta händer från hårfästet till nacken och tillbaka till hårfästet.',
    say: {
      repeat: 'En gång.',
    },
    illustrationKey: 'wudu_head',
  },
  {
    id: 'wudu_ears',
    stepNumber: 9,
    title: 'Stryk över öronen',
    shortDescription: 'Stryk insidan och baksidan av öronen.',
    detailedDescription:
      'Använd pekfingrarna till insidan av öronen och tummarna till baksidan.',
    say: {
      repeat: 'En gång.',
    },
    notes: ['Det behövs inte nytt vatten om händerna fortfarande är fuktiga.'],
    illustrationKey: 'wudu_ears',
  },
  {
    id: 'wudu_feet',
    stepNumber: 10,
    title: 'Tvätta fötterna',
    shortDescription: 'Tvätta fötterna inklusive anklarna.',
    detailedDescription:
      'Tvätta fötterna inklusive anklarna. Börja med höger fot och se till att vatten når mellan tårna.',
    say: {
      repeat: 'Tre gånger per fot.',
    },
    illustrationKey: 'wudu_feet',
  },
  {
    id: 'wudu_after',
    stepNumber: 11,
    title: 'Efter wudu',
    shortDescription: 'Läs den rekommenderade åminnelsen.',
    detailedDescription:
      'Efter wudu är det rekommenderat att säga vittnesbördet och be Allah göra en bland de som renar sig.',
    say: {
      transliteration:
        'Ash-hadu an la ilaha illallah wahdahu la sharika lah,\nwa ash-hadu anna Muhammadan \'abduhu wa rasuluh.\nAllahumma-j\'alni minat-tawwabina waj\'alni minal-mutatahhirin.',
      meaning:
        'Jag vittnar om att ingen har rätt att dyrkas förutom Allah, Han har ingen vid Sin sida, och jag vittnar om att Muhammed är Hans tjänare och sändebud. Allah, gör mig bland de som ständigt vänder sig till Dig i förlåtelse och bland de som renar sig.',
    },
    illustrationKey: 'wudu_after',
  },
];

export const WUDU_HADITH = {
  title: 'Belöningen för att tvaga sig',
  narrator: 'Profeten (ﷺ) sade:',
  text: 'Om en person utför tvagningen korrekt så som han beordrats så försvinner hans synder från hans hörsel, syn, händer och fötter.',
  reference: 'at-Tabarânî',
};

// ── Extra informationskort (räknas inte som wudu-steg) ────────────────────────

export type WuduInfoSection =
  | { type: 'text'; text: string }
  | { type: 'numbered'; items: string[] }
  | { type: 'bullets'; items: string[] };

export type WuduInfoItem = {
  id: string;
  title: string;
  sections: WuduInfoSection[];
};

export const wuduInfoItems: WuduInfoItem[] = [
  {
    id: 'wudu_info_when',
    title: 'När måste man tvaga sig?',
    sections: [
      {
        type: 'text',
        text: 'Tvagning inför bön måste göras när något inträffat som nollställt ens tvagning. Dessa saker är:',
      },
      {
        type: 'bullets',
        items: [
          'Utsöndringar från könsorgan och tarmkanal såsom urin, avföring, försats, sekret eller att man släpper vind.',
          'Att förlora medvetandet på grund av sömn, medvetslöshet eller annat.',
          'Att äta kamelkött.',
          'Att med handen direkt vidröra könsorganet.',
        ],
      },
      {
        type: 'text',
        text: 'Följande saker nollställer dock inte ens tvagning enligt det mest korrekta:',
      },
      {
        type: 'bullets',
        items: [
          'Kräkning.',
          'Att blöda från sår.',
          'Vidröra det motsatta könet.',
        ],
      },
      {
        type: 'text',
        text: 'Tvagning inför bön kallas den mindre rituella tvagningen och ovanstående nollställer denna. Det finns en "större rituell orenhet" som kräver en större tvagning [ghusl] och den orsakas av:',
      },
      {
        type: 'bullets',
        items: [
          'Samlag eller orgasm.',
          'Sädesavgång.',
          'Blödningar orsakade av menstruation eller efter barnafödsel. För att kunna bli ren från dessa blödningar måste de först upphöra, sedan måste man tvätta hela kroppen [ghusl].',
        ],
      },
    ],
  },
  {
    id: 'wudu_info_ghusl',
    title: 'Den större tvagningen (Ghusl)',
    sections: [
      {
        type: 'text',
        text: 'Ghusl eller "det rituella helkroppsbadet" måste utföras efter den större rituella orenheten. Ghusl innebär att hela kroppen sköljs med vatten och det utförs på följande sätt:',
      },
      {
        type: 'numbered',
        items: [
          'Att avse att bli av med den stora rituella orenheten genom att utföra ghusl. Detta sker med hjärtat utan att uttala sin avsikt med tungan.',
          'Säg Bismillâh.',
          'Tvätta händerna tre gånger.',
          'Tvätta könsorganet.',
          'Gör wudû enligt ovan.',
          'Låt vatten rinna över huvudet och gnugga hårbotten tills den blir blöt.\nHäll sedan vatten över huvudet tre gånger.',
          'Tvätta resten av kroppen så att vattnet når alla kroppens delar, även under armhålorna, naveln osv. Ända ner till fötterna och under fötterna.',
        ],
      },
    ],
  },
  {
    id: 'wudu_info_tayammum',
    title: 'När det inte finns något vatten',
    sections: [
      {
        type: 'text',
        text: 'När man inte har tillgång till vatten eller kan använda vatten på grund av sjukdom så får man rena sig med sand, grus och jord. Detta kallas tayammum.',
      },
      {
        type: 'text',
        text: 'Det går till så att man säger bismillâh, sedan slår man med sina händer på jorden en gång och stryker över sitt ansikte och sina händer upp till handleden. Innan man stryker över ansikte och händer slår man bort eventuella lösa delar från sina händer såsom småsten eller annat.',
      },
    ],
  },
];
