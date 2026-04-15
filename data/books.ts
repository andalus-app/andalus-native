export type BookData = {
  id: string;
  title: string;
  file: string;
  author: string;
  category: string;
  coverColor: string;
  shortDescription: string;
  longDescription: string;
  pageCount: number | null;
  publishedYear: number | null;
  available: boolean;
  tags?: string[];
};

export const CATEGORIES = [
  { id: 'all',       label: 'Alla e-böcker' },
  { id: 'tazkiyah',  label: 'Islamisk livsvägledning' },
  { id: 'fiqh',      label: 'Rättsbestämmelser (Fiqh)' },
  { id: 'hadith',    label: 'Hadithsamlingar' },
  { id: 'rapporter', label: 'Rapporter' },
  { id: 'aqidah',    label: 'Troslära (Aqidah)' },
];

export const BASE_URL = 'https://andalus-app.github.io/andalus/books/';

export const BOOKS_DATA: BookData[] = [
  {
    id: '9', title: 'Hopp i mörka tider',
    file: 'hopp-i-morka-tider.pdf',
    author: 'Sh. Yosuf Abdul-Hamid', category: 'tazkiyah', coverColor: '#1a2a4a',
    shortDescription: 'Hur den troende odlar tillit och motståndskraft i en värld av prövningar.',
    longDescription: 'Livet går upp och ner, och prövningar är en del av resan. Hopp i mörka tider är en bok för alla som vill hitta mer lugn, tillit och inre styrka när livet känns tungt eller oklart.',
    pageCount: 28, publishedYear: 2026, available: true,
    tags: ['hopp', 'tålamod', 'tawhid', 'bön', 'prövningar'],
  },
  {
    id: '1', title: 'Årsrapport 2024',
    file: 'Arsrapport_2024.pdf',
    author: 'Islam.nu', category: 'rapporter', coverColor: '#1e3a2f',
    shortDescription: 'Islam.nu:s årsrapport för verksamhetsåret 2024.',
    longDescription: 'En sammanfattning av Islam.nu:s arbete, projekt och verksamhet under 2024.',
    pageCount: 11, publishedYear: 2024, available: true,
    tags: ['rapport', 'verksamhet', '2024'],
  },
  {
    id: '2', title: 'Årsrapport 2025',
    file: 'Arsrapport_2025_Final.pdf',
    author: 'Islam.nu', category: 'rapporter', coverColor: '#162e22',
    shortDescription: 'Islam.nu:s årsrapport för verksamhetsåret 2025.',
    longDescription: 'En sammanfattning av Islam.nu:s arbete, projekt och verksamhet under 2025.',
    pageCount: 15, publishedYear: 2025, available: true,
    tags: ['rapport', 'verksamhet', '2025'],
  },
  {
    id: '3', title: 'Islams och trons pelare',
    file: 'Bok_Islams_och_trons_pelare_webb.pdf',
    author: 'Islam.nu', category: 'aqidah', coverColor: '#2a1a3a',
    shortDescription: 'En grundläggande genomgång av islams fem pelare och trons sex pelare.',
    longDescription: 'En tydlig och tillgänglig presentation av de grundläggande pelarna i islam och iman, lämplig för alla nivåer.',
    pageCount: 52, publishedYear: null, available: true,
    tags: ['aqidah', 'pelare', 'iman', 'grundläggande'],
  },
  {
    id: '4', title: 'Böneboken',
    file: 'Bönebok_2024_webb1.pdf',
    author: 'Islam.nu', category: 'fiqh', coverColor: '#1a3040',
    shortDescription: 'En komplett guide till bönen med steg-för-steg-instruktioner.',
    longDescription: 'Böneboken innehåller detaljerade instruktioner för hur man utför de dagliga bönerna korrekt, med arabisk text, translitteration och svensk översättning.',
    pageCount: 44, publishedYear: 2024, available: true,
    tags: ['bön', 'salah', 'fiqh', 'guide'],
  },
  {
    id: '5', title: 'Bönetider i Sverige',
    file: 'Bönetider_i_Sverige_-_E-bok_2020.pdf',
    author: 'Islam.nu', category: 'fiqh', coverColor: '#1c2c3c',
    shortDescription: 'Om beräkning och tillämpning av bönetider i svenska förhållanden.',
    longDescription: 'En genomgång av hur bönetider beräknas och tillämpas i Sverige, med fokus på de utmaningar som uppstår vid extrema latituder.',
    pageCount: 6, publishedYear: 2020, available: true,
    tags: ['bönetider', 'sverige', 'beräkning', 'fiqh'],
  },
  {
    id: '6', title: 'Gyllene uttalanden',
    file: 'gylleneuttalanden.pdf',
    author: 'Islam.nu', category: 'hadith', coverColor: '#3a2a0a',
    shortDescription: 'En samling av profetens ﷺ visdomsord och hadither.',
    longDescription: 'En sammanställning av utvalda hadither och profetiska uttalanden med svensk översättning och kommentar.',
    pageCount: 129, publishedYear: null, available: true,
    tags: ['hadith', 'profeten', 'visdom', 'sunnah'],
  },
  {
    id: '7', title: 'Hadjboken',
    file: 'Hadjboken.pdf',
    author: 'Islam.nu', category: 'fiqh', coverColor: '#2a1a10',
    shortDescription: 'En komplett vägledning för den som planerar att utföra Hajj.',
    longDescription: 'Hadjboken ger en detaljerad genomgång av Hajjets ritualer, förberedelser och andliga dimensioner.',
    pageCount: 28, publishedYear: null, available: true,
    tags: ['hajj', 'pilgrimsfärd', 'fiqh', 'mekka'],
  },
  {
    id: '8', title: 'Hisnul Muslim',
    file: 'Hisnul_Muslim_E-bok.pdf',
    author: 'Said ibn Ali al-Qahtani', category: 'hadith', coverColor: '#0a2a1a',
    shortDescription: 'Muslimens fästning — en samling dhikr och duaer från Koranen och Sunnah.',
    longDescription: 'Hisnul Muslim är en av de mest använda samlingarna av autentiska duaer och dhikr för alla livets situationer, baserade på Koranen och profetens ﷺ Sunnah.',
    pageCount: 217, publishedYear: null, available: true,
    tags: ['dua', 'dhikr', 'hadith', 'hisnul muslim'],
  },
  {
    id: '10', title: 'Hur förhåller vi oss till meningsskiljaktigheter?',
    file: 'hur_ska_man_forhalla_sig_till_meningsskiljaktigheter_i_islamiska_fragor_Islam.pdf',
    author: 'Imran Sheikh', category: 'fiqh', coverColor: '#1a2a3a',
    shortDescription: 'Hur den troende förhåller sig till olika åsikter bland lärde.',
    longDescription: 'En vägledning i hur muslimer kan förhålla sig till meningsskiljaktigheter inom islamisk rättslära med visdom och förståelse.',
    pageCount: 12, publishedYear: null, available: true,
    tags: ['fiqh', 'ikhtilaf', 'meningsskiljaktigheter', 'lärde'],
  },
  {
    id: '11', title: 'När börjar och slutar Ramadan?',
    file: 'Hur_vet_vi_när_Ramadan_börjar_och_slutar_E-bok_2020.pdf',
    author: 'Islam.nu', category: 'fiqh', coverColor: '#1a0a2a',
    shortDescription: 'En genomgång av metoderna för att fastställa Ramadans start och slut.',
    longDescription: 'Boken utreder de olika metoderna och åsikterna om hur Ramadans start och slut fastställs, med fokus på måndbeskådning och astronomiska beräkningar.',
    pageCount: 8, publishedYear: 2020, available: true,
    tags: ['ramadan', 'måndbeskådning', 'fiqh'],
  },
  {
    id: '12', title: 'Ramadanboken',
    file: 'ramadanboken-2022.pdf',
    author: 'Islam.nu', category: 'fiqh', coverColor: '#2a1a0a',
    shortDescription: 'En introduktion till fastan i månaden Ramadan.',
    longDescription: 'Ramadanboken är en grundläggande förklaring av den fjärde pelaren i islam — fastan i Ramadan. Boken täcker allt från fastans regler och vad som bryter den, till profetens sunnah, Laylat-ul-Qadr, Eid och frivillig fasta.',
    pageCount: 36, publishedYear: 2022, available: true,
    tags: ['ramadan', 'fasta', 'fiqh', 'tarawih', 'eid'],
  },
  {
    id: '13', title: 'Zakat — E-bok',
    file: 'zakat-ebok-klar.pdf',
    author: 'Islam.nu', category: 'fiqh', coverColor: '#123a10',
    shortDescription: 'En kortfattad guide till zakat och dess regler.',
    longDescription: 'En tillgänglig och kortfattad genomgång av zakatens regler, beräkning och fördelning.',
    pageCount: 32, publishedYear: null, available: true,
    tags: ['zakat', 'fiqh', 'guide'],
  },
  {
    id: '14', title: 'Zakatboken',
    file: 'Zakatboken_med_omslag_webb_2024.pdf',
    author: 'Islam.nu', category: 'fiqh', coverColor: '#1a3a10',
    shortDescription: 'En komplett guide till zakat — beräkning, mottagare och regler.',
    longDescription: 'Zakatboken ger en grundlig genomgång av zakat inklusive beräkningsmetoder och vilka som är berättigade att ta emot.',
    pageCount: 7, publishedYear: 2024, available: true,
    tags: ['zakat', 'fiqh', 'välgörenhet'],
  },
];
