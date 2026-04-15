export type SurahInfo = {
  id: number;
  nameArabic: string;
  nameSimple: string;
  versesCount: number;
  firstPage: number;
  revelationPlace: 'Makkah' | 'Madinah';
};

export type JuzInfo = {
  id: number;
  surahId: number;
  verseNumber: number;
  firstPage: number;
};

/** Hizb boundary entry — 60 hizbs total (1 hizb = 2 pages of a 30-juz Quran, = 4 rub' el hizb). */
export type HizbInfo = {
  id: number;
  surahId: number;
  verseNumber: number;
  firstPage: number;
};

/** Rub' el hizb boundary entry — 240 quarters total (4 per hizb, 8 per juz). */
export type RubInfo = {
  id: number;
  surahId: number;
  verseNumber: number;
  firstPage: number;
};

export const SURAH_INDEX: SurahInfo[] = [
  { id: 1,   nameArabic: 'الفاتحة',     nameSimple: 'Al-Fatihah',     versesCount: 7,   firstPage: 1,   revelationPlace: 'Makkah'  },
  { id: 2,   nameArabic: 'البقرة',      nameSimple: 'Al-Baqarah',     versesCount: 286, firstPage: 2,   revelationPlace: 'Madinah' },
  { id: 3,   nameArabic: 'آل عمران',    nameSimple: "Ali 'Imran",     versesCount: 200, firstPage: 50,  revelationPlace: 'Madinah' },
  { id: 4,   nameArabic: 'النساء',      nameSimple: "An-Nisa'",       versesCount: 176, firstPage: 77,  revelationPlace: 'Madinah' },
  { id: 5,   nameArabic: 'المائدة',     nameSimple: "Al-Ma'idah",     versesCount: 120, firstPage: 106, revelationPlace: 'Madinah' },
  { id: 6,   nameArabic: 'الأنعام',     nameSimple: "Al-An'am",       versesCount: 165, firstPage: 128, revelationPlace: 'Makkah'  },
  { id: 7,   nameArabic: 'الأعراف',     nameSimple: "Al-A'raf",       versesCount: 206, firstPage: 151, revelationPlace: 'Makkah'  },
  { id: 8,   nameArabic: 'الأنفال',     nameSimple: 'Al-Anfal',       versesCount: 75,  firstPage: 177, revelationPlace: 'Madinah' },
  { id: 9,   nameArabic: 'التوبة',      nameSimple: 'At-Tawbah',      versesCount: 129, firstPage: 187, revelationPlace: 'Madinah' },
  { id: 10,  nameArabic: 'يونس',        nameSimple: 'Yunus',          versesCount: 109, firstPage: 208, revelationPlace: 'Makkah'  },
  { id: 11,  nameArabic: 'هود',         nameSimple: 'Hud',            versesCount: 123, firstPage: 221, revelationPlace: 'Makkah'  },
  { id: 12,  nameArabic: 'يوسف',        nameSimple: 'Yusuf',          versesCount: 111, firstPage: 235, revelationPlace: 'Makkah'  },
  { id: 13,  nameArabic: 'الرعد',       nameSimple: "Ar-Ra'd",        versesCount: 43,  firstPage: 249, revelationPlace: 'Madinah' },
  { id: 14,  nameArabic: 'إبراهيم',     nameSimple: 'Ibrahim',        versesCount: 52,  firstPage: 255, revelationPlace: 'Makkah'  },
  { id: 15,  nameArabic: 'الحجر',       nameSimple: 'Al-Hijr',        versesCount: 99,  firstPage: 262, revelationPlace: 'Makkah'  },
  { id: 16,  nameArabic: 'النحل',       nameSimple: 'An-Nahl',        versesCount: 128, firstPage: 267, revelationPlace: 'Makkah'  },
  { id: 17,  nameArabic: 'الإسراء',     nameSimple: "Al-Isra'",       versesCount: 111, firstPage: 282, revelationPlace: 'Makkah'  },
  { id: 18,  nameArabic: 'الكهف',       nameSimple: 'Al-Kahf',        versesCount: 110, firstPage: 293, revelationPlace: 'Makkah'  },
  { id: 19,  nameArabic: 'مريم',        nameSimple: 'Maryam',         versesCount: 98,  firstPage: 305, revelationPlace: 'Makkah'  },
  { id: 20,  nameArabic: 'طه',          nameSimple: 'Ta-Ha',          versesCount: 135, firstPage: 312, revelationPlace: 'Makkah'  },
  { id: 21,  nameArabic: 'الأنبياء',    nameSimple: "Al-Anbiya'",     versesCount: 112, firstPage: 322, revelationPlace: 'Makkah'  },
  { id: 22,  nameArabic: 'الحج',        nameSimple: 'Al-Hajj',        versesCount: 78,  firstPage: 332, revelationPlace: 'Madinah' },
  { id: 23,  nameArabic: 'المؤمنون',    nameSimple: "Al-Mu'minun",    versesCount: 118, firstPage: 342, revelationPlace: 'Makkah'  },
  { id: 24,  nameArabic: 'النور',       nameSimple: 'An-Nur',         versesCount: 64,  firstPage: 350, revelationPlace: 'Madinah' },
  { id: 25,  nameArabic: 'الفرقان',     nameSimple: 'Al-Furqan',      versesCount: 77,  firstPage: 359, revelationPlace: 'Makkah'  },
  { id: 26,  nameArabic: 'الشعراء',     nameSimple: "Ash-Shu'ara'",   versesCount: 227, firstPage: 367, revelationPlace: 'Makkah'  },
  { id: 27,  nameArabic: 'النمل',       nameSimple: 'An-Naml',        versesCount: 93,  firstPage: 377, revelationPlace: 'Makkah'  },
  { id: 28,  nameArabic: 'القصص',       nameSimple: 'Al-Qasas',       versesCount: 88,  firstPage: 385, revelationPlace: 'Makkah'  },
  { id: 29,  nameArabic: 'العنكبوت',    nameSimple: 'Al-Ankabut',     versesCount: 69,  firstPage: 396, revelationPlace: 'Makkah'  },
  { id: 30,  nameArabic: 'الروم',       nameSimple: 'Ar-Rum',         versesCount: 60,  firstPage: 404, revelationPlace: 'Makkah'  },
  { id: 31,  nameArabic: 'لقمان',       nameSimple: 'Luqman',         versesCount: 34,  firstPage: 411, revelationPlace: 'Makkah'  },
  { id: 32,  nameArabic: 'السجدة',      nameSimple: 'As-Sajdah',      versesCount: 30,  firstPage: 415, revelationPlace: 'Makkah'  },
  { id: 33,  nameArabic: 'الأحزاب',     nameSimple: 'Al-Ahzab',       versesCount: 73,  firstPage: 418, revelationPlace: 'Madinah' },
  { id: 34,  nameArabic: 'سبأ',         nameSimple: "Saba'",          versesCount: 54,  firstPage: 428, revelationPlace: 'Makkah'  },
  { id: 35,  nameArabic: 'فاطر',        nameSimple: 'Fatir',          versesCount: 45,  firstPage: 434, revelationPlace: 'Makkah'  },
  { id: 36,  nameArabic: 'يس',          nameSimple: 'Ya-Sin',         versesCount: 83,  firstPage: 440, revelationPlace: 'Makkah'  },
  { id: 37,  nameArabic: 'الصافات',     nameSimple: 'As-Saffat',      versesCount: 182, firstPage: 446, revelationPlace: 'Makkah'  },
  { id: 38,  nameArabic: 'ص',           nameSimple: 'Sad',            versesCount: 88,  firstPage: 453, revelationPlace: 'Makkah'  },
  { id: 39,  nameArabic: 'الزمر',       nameSimple: 'Az-Zumar',       versesCount: 75,  firstPage: 458, revelationPlace: 'Makkah'  },
  { id: 40,  nameArabic: 'غافر',        nameSimple: 'Ghafir',         versesCount: 85,  firstPage: 467, revelationPlace: 'Makkah'  },
  { id: 41,  nameArabic: 'فصلت',        nameSimple: 'Fussilat',       versesCount: 54,  firstPage: 477, revelationPlace: 'Makkah'  },
  { id: 42,  nameArabic: 'الشورى',      nameSimple: 'Ash-Shura',      versesCount: 53,  firstPage: 483, revelationPlace: 'Makkah'  },
  { id: 43,  nameArabic: 'الزخرف',      nameSimple: 'Az-Zukhruf',     versesCount: 89,  firstPage: 489, revelationPlace: 'Makkah'  },
  { id: 44,  nameArabic: 'الدخان',      nameSimple: 'Ad-Dukhan',      versesCount: 59,  firstPage: 496, revelationPlace: 'Makkah'  },
  { id: 45,  nameArabic: 'الجاثية',     nameSimple: 'Al-Jathiyah',    versesCount: 37,  firstPage: 499, revelationPlace: 'Makkah'  },
  { id: 46,  nameArabic: 'الأحقاف',     nameSimple: 'Al-Ahqaf',       versesCount: 35,  firstPage: 502, revelationPlace: 'Makkah'  },
  { id: 47,  nameArabic: 'محمد',        nameSimple: 'Muhammad',       versesCount: 38,  firstPage: 507, revelationPlace: 'Madinah' },
  { id: 48,  nameArabic: 'الفتح',       nameSimple: 'Al-Fath',        versesCount: 29,  firstPage: 511, revelationPlace: 'Madinah' },
  { id: 49,  nameArabic: 'الحجرات',     nameSimple: 'Al-Hujurat',     versesCount: 18,  firstPage: 515, revelationPlace: 'Madinah' },
  { id: 50,  nameArabic: 'ق',           nameSimple: 'Qaf',            versesCount: 45,  firstPage: 518, revelationPlace: 'Makkah'  },
  { id: 51,  nameArabic: 'الذاريات',    nameSimple: 'Adh-Dhariyat',   versesCount: 60,  firstPage: 520, revelationPlace: 'Makkah'  },
  { id: 52,  nameArabic: 'الطور',       nameSimple: 'At-Tur',         versesCount: 49,  firstPage: 523, revelationPlace: 'Makkah'  },
  { id: 53,  nameArabic: 'النجم',       nameSimple: 'An-Najm',        versesCount: 62,  firstPage: 526, revelationPlace: 'Makkah'  },
  { id: 54,  nameArabic: 'القمر',       nameSimple: 'Al-Qamar',       versesCount: 55,  firstPage: 528, revelationPlace: 'Makkah'  },
  { id: 55,  nameArabic: 'الرحمن',      nameSimple: 'Ar-Rahman',      versesCount: 78,  firstPage: 531, revelationPlace: 'Madinah' },
  { id: 56,  nameArabic: 'الواقعة',     nameSimple: "Al-Waqi'ah",     versesCount: 96,  firstPage: 534, revelationPlace: 'Makkah'  },
  { id: 57,  nameArabic: 'الحديد',      nameSimple: 'Al-Hadid',       versesCount: 29,  firstPage: 537, revelationPlace: 'Madinah' },
  { id: 58,  nameArabic: 'المجادلة',    nameSimple: 'Al-Mujadilah',   versesCount: 22,  firstPage: 542, revelationPlace: 'Madinah' },
  { id: 59,  nameArabic: 'الحشر',       nameSimple: 'Al-Hashr',       versesCount: 24,  firstPage: 545, revelationPlace: 'Madinah' },
  { id: 60,  nameArabic: 'الممتحنة',    nameSimple: 'Al-Mumtahanah',  versesCount: 13,  firstPage: 549, revelationPlace: 'Madinah' },
  { id: 61,  nameArabic: 'الصف',        nameSimple: 'As-Saf',         versesCount: 14,  firstPage: 551, revelationPlace: 'Madinah' },
  { id: 62,  nameArabic: 'الجمعة',      nameSimple: "Al-Jumu'ah",     versesCount: 11,  firstPage: 553, revelationPlace: 'Madinah' },
  { id: 63,  nameArabic: 'المنافقون',   nameSimple: 'Al-Munafiqun',   versesCount: 11,  firstPage: 554, revelationPlace: 'Madinah' },
  { id: 64,  nameArabic: 'التغابن',     nameSimple: 'At-Taghabun',    versesCount: 18,  firstPage: 556, revelationPlace: 'Madinah' },
  { id: 65,  nameArabic: 'الطلاق',      nameSimple: 'At-Talaq',       versesCount: 12,  firstPage: 558, revelationPlace: 'Madinah' },
  { id: 66,  nameArabic: 'التحريم',     nameSimple: 'At-Tahrim',      versesCount: 12,  firstPage: 560, revelationPlace: 'Madinah' },
  { id: 67,  nameArabic: 'الملك',       nameSimple: 'Al-Mulk',        versesCount: 30,  firstPage: 562, revelationPlace: 'Makkah'  },
  { id: 68,  nameArabic: 'القلم',       nameSimple: 'Al-Qalam',       versesCount: 52,  firstPage: 564, revelationPlace: 'Makkah'  },
  { id: 69,  nameArabic: 'الحاقة',      nameSimple: 'Al-Haqqah',      versesCount: 52,  firstPage: 566, revelationPlace: 'Makkah'  },
  { id: 70,  nameArabic: 'المعارج',     nameSimple: "Al-Ma'arij",     versesCount: 44,  firstPage: 568, revelationPlace: 'Makkah'  },
  { id: 71,  nameArabic: 'نوح',         nameSimple: 'Nuh',            versesCount: 28,  firstPage: 570, revelationPlace: 'Makkah'  },
  { id: 72,  nameArabic: 'الجن',        nameSimple: 'Al-Jinn',        versesCount: 28,  firstPage: 572, revelationPlace: 'Makkah'  },
  { id: 73,  nameArabic: 'المزمل',      nameSimple: 'Al-Muzzammil',   versesCount: 20,  firstPage: 574, revelationPlace: 'Makkah'  },
  { id: 74,  nameArabic: 'المدثر',      nameSimple: 'Al-Muddaththir', versesCount: 56,  firstPage: 575, revelationPlace: 'Makkah'  },
  { id: 75,  nameArabic: 'القيامة',     nameSimple: 'Al-Qiyamah',     versesCount: 40,  firstPage: 577, revelationPlace: 'Makkah'  },
  { id: 76,  nameArabic: 'الإنسان',     nameSimple: 'Al-Insan',       versesCount: 31,  firstPage: 578, revelationPlace: 'Madinah' },
  { id: 77,  nameArabic: 'المرسلات',    nameSimple: 'Al-Mursalat',    versesCount: 50,  firstPage: 580, revelationPlace: 'Makkah'  },
  { id: 78,  nameArabic: 'النبأ',       nameSimple: "An-Naba'",       versesCount: 40,  firstPage: 582, revelationPlace: 'Makkah'  },
  { id: 79,  nameArabic: 'النازعات',    nameSimple: "An-Nazi'at",     versesCount: 46,  firstPage: 583, revelationPlace: 'Makkah'  },
  { id: 80,  nameArabic: 'عبس',         nameSimple: "'Abasa",         versesCount: 42,  firstPage: 585, revelationPlace: 'Makkah'  },
  { id: 81,  nameArabic: 'التكوير',     nameSimple: 'At-Takwir',      versesCount: 29,  firstPage: 586, revelationPlace: 'Makkah'  },
  { id: 82,  nameArabic: 'الانفطار',    nameSimple: 'Al-Infitar',     versesCount: 19,  firstPage: 587, revelationPlace: 'Makkah'  },
  { id: 83,  nameArabic: 'المطففين',    nameSimple: 'Al-Mutaffifin',  versesCount: 36,  firstPage: 587, revelationPlace: 'Makkah'  },
  { id: 84,  nameArabic: 'الانشقاق',    nameSimple: 'Al-Inshiqaq',    versesCount: 25,  firstPage: 589, revelationPlace: 'Makkah'  },
  { id: 85,  nameArabic: 'البروج',      nameSimple: 'Al-Buruj',       versesCount: 22,  firstPage: 590, revelationPlace: 'Makkah'  },
  { id: 86,  nameArabic: 'الطارق',      nameSimple: 'At-Tariq',       versesCount: 17,  firstPage: 591, revelationPlace: 'Makkah'  },
  { id: 87,  nameArabic: 'الأعلى',      nameSimple: "Al-A'la",        versesCount: 19,  firstPage: 591, revelationPlace: 'Makkah'  },
  { id: 88,  nameArabic: 'الغاشية',     nameSimple: 'Al-Ghashiyah',   versesCount: 26,  firstPage: 592, revelationPlace: 'Makkah'  },
  { id: 89,  nameArabic: 'الفجر',       nameSimple: 'Al-Fajr',        versesCount: 30,  firstPage: 593, revelationPlace: 'Makkah'  },
  { id: 90,  nameArabic: 'البلد',       nameSimple: 'Al-Balad',       versesCount: 20,  firstPage: 594, revelationPlace: 'Makkah'  },
  { id: 91,  nameArabic: 'الشمس',       nameSimple: 'Ash-Shams',      versesCount: 15,  firstPage: 595, revelationPlace: 'Makkah'  },
  { id: 92,  nameArabic: 'الليل',       nameSimple: 'Al-Layl',        versesCount: 21,  firstPage: 595, revelationPlace: 'Makkah'  },
  { id: 93,  nameArabic: 'الضحى',       nameSimple: 'Ad-Duha',        versesCount: 11,  firstPage: 596, revelationPlace: 'Makkah'  },
  { id: 94,  nameArabic: 'الشرح',       nameSimple: 'Ash-Sharh',      versesCount: 8,   firstPage: 596, revelationPlace: 'Makkah'  },
  { id: 95,  nameArabic: 'التين',       nameSimple: 'At-Tin',         versesCount: 8,   firstPage: 597, revelationPlace: 'Makkah'  },
  { id: 96,  nameArabic: 'العلق',       nameSimple: "Al-'Alaq",       versesCount: 19,  firstPage: 597, revelationPlace: 'Makkah'  },
  { id: 97,  nameArabic: 'القدر',       nameSimple: 'Al-Qadr',        versesCount: 5,   firstPage: 598, revelationPlace: 'Makkah'  },
  { id: 98,  nameArabic: 'البينة',      nameSimple: 'Al-Bayyinah',    versesCount: 8,   firstPage: 598, revelationPlace: 'Madinah' },
  { id: 99,  nameArabic: 'الزلزلة',     nameSimple: 'Az-Zalzalah',    versesCount: 8,   firstPage: 599, revelationPlace: 'Madinah' },
  { id: 100, nameArabic: 'العاديات',    nameSimple: "Al-'Adiyat",     versesCount: 11,  firstPage: 599, revelationPlace: 'Makkah'  },
  { id: 101, nameArabic: 'القارعة',     nameSimple: "Al-Qari'ah",     versesCount: 11,  firstPage: 600, revelationPlace: 'Makkah'  },
  { id: 102, nameArabic: 'التكاثر',     nameSimple: 'At-Takathur',    versesCount: 8,   firstPage: 600, revelationPlace: 'Makkah'  },
  { id: 103, nameArabic: 'العصر',       nameSimple: "Al-'Asr",        versesCount: 3,   firstPage: 601, revelationPlace: 'Makkah'  },
  { id: 104, nameArabic: 'الهمزة',      nameSimple: 'Al-Humazah',     versesCount: 9,   firstPage: 601, revelationPlace: 'Makkah'  },
  { id: 105, nameArabic: 'الفيل',       nameSimple: 'Al-Fil',         versesCount: 5,   firstPage: 601, revelationPlace: 'Makkah'  },
  { id: 106, nameArabic: 'قريش',        nameSimple: 'Quraysh',        versesCount: 4,   firstPage: 602, revelationPlace: 'Makkah'  },
  { id: 107, nameArabic: 'الماعون',     nameSimple: "Al-Ma'un",       versesCount: 7,   firstPage: 602, revelationPlace: 'Makkah'  },
  { id: 108, nameArabic: 'الكوثر',      nameSimple: 'Al-Kawthar',     versesCount: 3,   firstPage: 602, revelationPlace: 'Makkah'  },
  { id: 109, nameArabic: 'الكافرون',    nameSimple: 'Al-Kafirun',     versesCount: 6,   firstPage: 603, revelationPlace: 'Makkah'  },
  { id: 110, nameArabic: 'النصر',       nameSimple: 'An-Nasr',        versesCount: 3,   firstPage: 603, revelationPlace: 'Madinah' },
  { id: 111, nameArabic: 'المسد',       nameSimple: 'Al-Masad',       versesCount: 5,   firstPage: 603, revelationPlace: 'Makkah'  },
  { id: 112, nameArabic: 'الإخلاص',     nameSimple: 'Al-Ikhlas',      versesCount: 4,   firstPage: 604, revelationPlace: 'Makkah'  },
  { id: 113, nameArabic: 'الفلق',       nameSimple: 'Al-Falaq',       versesCount: 5,   firstPage: 604, revelationPlace: 'Makkah'  },
  { id: 114, nameArabic: 'الناس',       nameSimple: 'An-Nas',         versesCount: 6,   firstPage: 604, revelationPlace: 'Makkah'  },
];

export const JUZ_INDEX: JuzInfo[] = [
  { id: 1,  surahId: 1,   verseNumber: 1,   firstPage: 1   },
  { id: 2,  surahId: 2,   verseNumber: 142, firstPage: 22  },
  { id: 3,  surahId: 2,   verseNumber: 253, firstPage: 40  },
  { id: 4,  surahId: 3,   verseNumber: 93,  firstPage: 60  },
  { id: 5,  surahId: 4,   verseNumber: 24,  firstPage: 82  },
  { id: 6,  surahId: 4,   verseNumber: 148, firstPage: 99  },
  { id: 7,  surahId: 5,   verseNumber: 82,  firstPage: 121 },
  { id: 8,  surahId: 6,   verseNumber: 111, firstPage: 142 },
  { id: 9,  surahId: 7,   verseNumber: 88,  firstPage: 162 },
  { id: 10, surahId: 8,   verseNumber: 41,  firstPage: 182 },
  { id: 11, surahId: 9,   verseNumber: 93,  firstPage: 201 },
  { id: 12, surahId: 11,  verseNumber: 6,   firstPage: 221 },
  { id: 13, surahId: 12,  verseNumber: 53,  firstPage: 241 },
  { id: 14, surahId: 15,  verseNumber: 1,   firstPage: 262 },
  { id: 15, surahId: 17,  verseNumber: 1,   firstPage: 282 },
  { id: 16, surahId: 18,  verseNumber: 75,  firstPage: 302 },
  { id: 17, surahId: 21,  verseNumber: 1,   firstPage: 322 },
  { id: 18, surahId: 23,  verseNumber: 1,   firstPage: 342 },
  { id: 19, surahId: 25,  verseNumber: 21,  firstPage: 360 },
  { id: 20, surahId: 27,  verseNumber: 56,  firstPage: 382 },
  { id: 21, surahId: 29,  verseNumber: 46,  firstPage: 402 },
  { id: 22, surahId: 33,  verseNumber: 31,  firstPage: 422 },
  { id: 23, surahId: 36,  verseNumber: 28,  firstPage: 442 },
  { id: 24, surahId: 39,  verseNumber: 32,  firstPage: 462 },
  { id: 25, surahId: 41,  verseNumber: 47,  firstPage: 480 },
  { id: 26, surahId: 46,  verseNumber: 1,   firstPage: 502 },
  { id: 27, surahId: 51,  verseNumber: 31,  firstPage: 522 },
  { id: 28, surahId: 58,  verseNumber: 1,   firstPage: 542 },
  { id: 29, surahId: 67,  verseNumber: 1,   firstPage: 562 },
  { id: 30, surahId: 78,  verseNumber: 1,   firstPage: 582 },
];

/**
 * 60 hizb boundaries — sourced from Quran.com API (hizb_number field, verse-level).
 * Each hizb = 4 rub' el hizb = ½ juz.
 */
export const HIZB_INDEX: HizbInfo[] = [
  { id:   1, surahId:   1, verseNumber:    1, firstPage:   1 },
  { id:   2, surahId:   2, verseNumber:   75, firstPage:  11 },
  { id:   3, surahId:   2, verseNumber:  142, firstPage:  22 },
  { id:   4, surahId:   2, verseNumber:  203, firstPage:  32 },
  { id:   5, surahId:   2, verseNumber:  253, firstPage:  42 },
  { id:   6, surahId:   3, verseNumber:   15, firstPage:  51 },
  { id:   7, surahId:   3, verseNumber:   93, firstPage:  62 },
  { id:   8, surahId:   3, verseNumber:  171, firstPage:  72 },
  { id:   9, surahId:   4, verseNumber:   24, firstPage:  82 },
  { id:  10, surahId:   4, verseNumber:   88, firstPage:  92 },
  { id:  11, surahId:   4, verseNumber:  148, firstPage: 102 },
  { id:  12, surahId:   5, verseNumber:   27, firstPage: 112 },
  { id:  13, surahId:   5, verseNumber:   82, firstPage: 121 },
  { id:  14, surahId:   6, verseNumber:   36, firstPage: 132 },
  { id:  15, surahId:   6, verseNumber:  111, firstPage: 142 },
  { id:  16, surahId:   7, verseNumber:    1, firstPage: 151 },
  { id:  17, surahId:   7, verseNumber:   88, firstPage: 162 },
  { id:  18, surahId:   7, verseNumber:  171, firstPage: 173 },
  { id:  19, surahId:   8, verseNumber:   41, firstPage: 182 },
  { id:  20, surahId:   9, verseNumber:   34, firstPage: 192 },
  { id:  21, surahId:   9, verseNumber:   93, firstPage: 201 },
  { id:  22, surahId:  10, verseNumber:   26, firstPage: 212 },
  { id:  23, surahId:  11, verseNumber:    6, firstPage: 222 },
  { id:  24, surahId:  11, verseNumber:   84, firstPage: 231 },
  { id:  25, surahId:  12, verseNumber:   53, firstPage: 242 },
  { id:  26, surahId:  13, verseNumber:   19, firstPage: 252 },
  { id:  27, surahId:  15, verseNumber:    1, firstPage: 262 },
  { id:  28, surahId:  16, verseNumber:   51, firstPage: 272 },
  { id:  29, surahId:  17, verseNumber:    1, firstPage: 282 },
  { id:  30, surahId:  17, verseNumber:   99, firstPage: 292 },
  { id:  31, surahId:  18, verseNumber:   75, firstPage: 302 },
  { id:  32, surahId:  20, verseNumber:    1, firstPage: 312 },
  { id:  33, surahId:  21, verseNumber:    1, firstPage: 322 },
  { id:  34, surahId:  22, verseNumber:    1, firstPage: 332 },
  { id:  35, surahId:  23, verseNumber:    1, firstPage: 342 },
  { id:  36, surahId:  24, verseNumber:   21, firstPage: 352 },
  { id:  37, surahId:  25, verseNumber:   21, firstPage: 362 },
  { id:  38, surahId:  26, verseNumber:  111, firstPage: 371 },
  { id:  39, surahId:  27, verseNumber:   56, firstPage: 382 },
  { id:  40, surahId:  28, verseNumber:   51, firstPage: 392 },
  { id:  41, surahId:  29, verseNumber:   46, firstPage: 402 },
  { id:  42, surahId:  31, verseNumber:   22, firstPage: 413 },
  { id:  43, surahId:  33, verseNumber:   31, firstPage: 422 },
  { id:  44, surahId:  34, verseNumber:   24, firstPage: 431 },
  { id:  45, surahId:  36, verseNumber:   28, firstPage: 442 },
  { id:  46, surahId:  37, verseNumber:  145, firstPage: 451 },
  { id:  47, surahId:  39, verseNumber:   32, firstPage: 462 },
  { id:  48, surahId:  40, verseNumber:   41, firstPage: 472 },
  { id:  49, surahId:  41, verseNumber:   47, firstPage: 482 },
  { id:  50, surahId:  43, verseNumber:   24, firstPage: 491 },
  { id:  51, surahId:  46, verseNumber:    1, firstPage: 502 },
  { id:  52, surahId:  48, verseNumber:   18, firstPage: 513 },
  { id:  53, surahId:  51, verseNumber:   31, firstPage: 522 },
  { id:  54, surahId:  55, verseNumber:    1, firstPage: 531 },
  { id:  55, surahId:  58, verseNumber:    1, firstPage: 542 },
  { id:  56, surahId:  62, verseNumber:    1, firstPage: 553 },
  { id:  57, surahId:  67, verseNumber:    1, firstPage: 562 },
  { id:  58, surahId:  72, verseNumber:    1, firstPage: 572 },
  { id:  59, surahId:  78, verseNumber:    1, firstPage: 582 },
  { id:  60, surahId:  87, verseNumber:    1, firstPage: 591 },
];

/**
 * 240 rub' el hizb boundaries — sourced from Quran.com API (rub_el_hizb_number field, verse-level).
 * Each rub' = ¼ hizb = ⅛ juz. Plans: 240 days (1/day), 120 (2/day), 80 (3/day),
 * 60 (4/day = 1 hizb), 40 (6/day), 20 (12/day = 3 hizb).
 */
export const RUB_INDEX: RubInfo[] = [
  { id:   1, surahId:   1, verseNumber:    1, firstPage:   1 },
  { id:   2, surahId:   2, verseNumber:   26, firstPage:   5 },
  { id:   3, surahId:   2, verseNumber:   44, firstPage:   7 },
  { id:   4, surahId:   2, verseNumber:   60, firstPage:   9 },
  { id:   5, surahId:   2, verseNumber:   75, firstPage:  11 },
  { id:   6, surahId:   2, verseNumber:   92, firstPage:  14 },
  { id:   7, surahId:   2, verseNumber:  106, firstPage:  17 },
  { id:   8, surahId:   2, verseNumber:  124, firstPage:  19 },
  { id:   9, surahId:   2, verseNumber:  142, firstPage:  22 },
  { id:  10, surahId:   2, verseNumber:  158, firstPage:  24 },
  { id:  11, surahId:   2, verseNumber:  177, firstPage:  27 },
  { id:  12, surahId:   2, verseNumber:  189, firstPage:  29 },
  { id:  13, surahId:   2, verseNumber:  203, firstPage:  32 },
  { id:  14, surahId:   2, verseNumber:  219, firstPage:  34 },
  { id:  15, surahId:   2, verseNumber:  233, firstPage:  37 },
  { id:  16, surahId:   2, verseNumber:  243, firstPage:  39 },
  { id:  17, surahId:   2, verseNumber:  253, firstPage:  42 },
  { id:  18, surahId:   2, verseNumber:  263, firstPage:  44 },
  { id:  19, surahId:   2, verseNumber:  272, firstPage:  46 },
  { id:  20, surahId:   2, verseNumber:  283, firstPage:  49 },
  { id:  21, surahId:   3, verseNumber:   15, firstPage:  51 },
  { id:  22, surahId:   3, verseNumber:   33, firstPage:  54 },
  { id:  23, surahId:   3, verseNumber:   52, firstPage:  56 },
  { id:  24, surahId:   3, verseNumber:   75, firstPage:  59 },
  { id:  25, surahId:   3, verseNumber:   93, firstPage:  62 },
  { id:  26, surahId:   3, verseNumber:  113, firstPage:  64 },
  { id:  27, surahId:   3, verseNumber:  133, firstPage:  67 },
  { id:  28, surahId:   3, verseNumber:  153, firstPage:  69 },
  { id:  29, surahId:   3, verseNumber:  171, firstPage:  72 },
  { id:  30, surahId:   3, verseNumber:  186, firstPage:  74 },
  { id:  31, surahId:   4, verseNumber:    1, firstPage:  77 },
  { id:  32, surahId:   4, verseNumber:   12, firstPage:  79 },
  { id:  33, surahId:   4, verseNumber:   24, firstPage:  82 },
  { id:  34, surahId:   4, verseNumber:   36, firstPage:  84 },
  { id:  35, surahId:   4, verseNumber:   58, firstPage:  87 },
  { id:  36, surahId:   4, verseNumber:   74, firstPage:  89 },
  { id:  37, surahId:   4, verseNumber:   88, firstPage:  92 },
  { id:  38, surahId:   4, verseNumber:  100, firstPage:  94 },
  { id:  39, surahId:   4, verseNumber:  114, firstPage:  97 },
  { id:  40, surahId:   4, verseNumber:  135, firstPage: 100 },
  { id:  41, surahId:   4, verseNumber:  148, firstPage: 102 },
  { id:  42, surahId:   4, verseNumber:  163, firstPage: 104 },
  { id:  43, surahId:   5, verseNumber:    1, firstPage: 106 },
  { id:  44, surahId:   5, verseNumber:   12, firstPage: 109 },
  { id:  45, surahId:   5, verseNumber:   27, firstPage: 112 },
  { id:  46, surahId:   5, verseNumber:   41, firstPage: 114 },
  { id:  47, surahId:   5, verseNumber:   51, firstPage: 117 },
  { id:  48, surahId:   5, verseNumber:   67, firstPage: 119 },
  { id:  49, surahId:   5, verseNumber:   82, firstPage: 121 },
  { id:  50, surahId:   5, verseNumber:   97, firstPage: 124 },
  { id:  51, surahId:   5, verseNumber:  109, firstPage: 126 },
  { id:  52, surahId:   6, verseNumber:   13, firstPage: 129 },
  { id:  53, surahId:   6, verseNumber:   36, firstPage: 132 },
  { id:  54, surahId:   6, verseNumber:   59, firstPage: 134 },
  { id:  55, surahId:   6, verseNumber:   74, firstPage: 137 },
  { id:  56, surahId:   6, verseNumber:   95, firstPage: 140 },
  { id:  57, surahId:   6, verseNumber:  111, firstPage: 142 },
  { id:  58, surahId:   6, verseNumber:  127, firstPage: 144 },
  { id:  59, surahId:   6, verseNumber:  141, firstPage: 146 },
  { id:  60, surahId:   6, verseNumber:  151, firstPage: 148 },
  { id:  61, surahId:   7, verseNumber:    1, firstPage: 151 },
  { id:  62, surahId:   7, verseNumber:   31, firstPage: 154 },
  { id:  63, surahId:   7, verseNumber:   47, firstPage: 156 },
  { id:  64, surahId:   7, verseNumber:   65, firstPage: 158 },
  { id:  65, surahId:   7, verseNumber:   88, firstPage: 162 },
  { id:  66, surahId:   7, verseNumber:  117, firstPage: 164 },
  { id:  67, surahId:   7, verseNumber:  142, firstPage: 167 },
  { id:  68, surahId:   7, verseNumber:  156, firstPage: 170 },
  { id:  69, surahId:   7, verseNumber:  171, firstPage: 173 },
  { id:  70, surahId:   7, verseNumber:  189, firstPage: 175 },
  { id:  71, surahId:   8, verseNumber:    1, firstPage: 177 },
  { id:  72, surahId:   8, verseNumber:   22, firstPage: 179 },
  { id:  73, surahId:   8, verseNumber:   41, firstPage: 182 },
  { id:  74, surahId:   8, verseNumber:   61, firstPage: 184 },
  { id:  75, surahId:   9, verseNumber:    1, firstPage: 187 },
  { id:  76, surahId:   9, verseNumber:   19, firstPage: 189 },
  { id:  77, surahId:   9, verseNumber:   34, firstPage: 192 },
  { id:  78, surahId:   9, verseNumber:   46, firstPage: 194 },
  { id:  79, surahId:   9, verseNumber:   60, firstPage: 196 },
  { id:  80, surahId:   9, verseNumber:   75, firstPage: 199 },
  { id:  81, surahId:   9, verseNumber:   93, firstPage: 201 },
  { id:  82, surahId:   9, verseNumber:  111, firstPage: 204 },
  { id:  83, surahId:   9, verseNumber:  122, firstPage: 206 },
  { id:  84, surahId:  10, verseNumber:   11, firstPage: 209 },
  { id:  85, surahId:  10, verseNumber:   26, firstPage: 212 },
  { id:  86, surahId:  10, verseNumber:   53, firstPage: 214 },
  { id:  87, surahId:  10, verseNumber:   71, firstPage: 217 },
  { id:  88, surahId:  10, verseNumber:   90, firstPage: 219 },
  { id:  89, surahId:  11, verseNumber:    6, firstPage: 222 },
  { id:  90, surahId:  11, verseNumber:   24, firstPage: 224 },
  { id:  91, surahId:  11, verseNumber:   41, firstPage: 226 },
  { id:  92, surahId:  11, verseNumber:   61, firstPage: 228 },
  { id:  93, surahId:  11, verseNumber:   84, firstPage: 231 },
  { id:  94, surahId:  11, verseNumber:  108, firstPage: 233 },
  { id:  95, surahId:  12, verseNumber:    7, firstPage: 236 },
  { id:  96, surahId:  12, verseNumber:   30, firstPage: 238 },
  { id:  97, surahId:  12, verseNumber:   53, firstPage: 242 },
  { id:  98, surahId:  12, verseNumber:   77, firstPage: 244 },
  { id:  99, surahId:  12, verseNumber:  101, firstPage: 247 },
  { id: 100, surahId:  13, verseNumber:    5, firstPage: 249 },
  { id: 101, surahId:  13, verseNumber:   19, firstPage: 252 },
  { id: 102, surahId:  13, verseNumber:   35, firstPage: 254 },
  { id: 103, surahId:  14, verseNumber:   10, firstPage: 256 },
  { id: 104, surahId:  14, verseNumber:   28, firstPage: 259 },
  { id: 105, surahId:  15, verseNumber:    1, firstPage: 262 },
  { id: 106, surahId:  15, verseNumber:   49, firstPage: 264 },
  { id: 107, surahId:  16, verseNumber:    1, firstPage: 267 },
  { id: 108, surahId:  16, verseNumber:   30, firstPage: 270 },
  { id: 109, surahId:  16, verseNumber:   51, firstPage: 272 },
  { id: 110, surahId:  16, verseNumber:   75, firstPage: 275 },
  { id: 111, surahId:  16, verseNumber:   90, firstPage: 277 },
  { id: 112, surahId:  16, verseNumber:  111, firstPage: 280 },
  { id: 113, surahId:  17, verseNumber:    1, firstPage: 282 },
  { id: 114, surahId:  17, verseNumber:   23, firstPage: 284 },
  { id: 115, surahId:  17, verseNumber:   50, firstPage: 287 },
  { id: 116, surahId:  17, verseNumber:   70, firstPage: 289 },
  { id: 117, surahId:  17, verseNumber:   99, firstPage: 292 },
  { id: 118, surahId:  18, verseNumber:   17, firstPage: 295 },
  { id: 119, surahId:  18, verseNumber:   32, firstPage: 297 },
  { id: 120, surahId:  18, verseNumber:   51, firstPage: 299 },
  { id: 121, surahId:  18, verseNumber:   75, firstPage: 302 },
  { id: 122, surahId:  18, verseNumber:   99, firstPage: 304 },
  { id: 123, surahId:  19, verseNumber:   22, firstPage: 306 },
  { id: 124, surahId:  19, verseNumber:   59, firstPage: 309 },
  { id: 125, surahId:  20, verseNumber:    1, firstPage: 312 },
  { id: 126, surahId:  20, verseNumber:   55, firstPage: 315 },
  { id: 127, surahId:  20, verseNumber:   83, firstPage: 317 },
  { id: 128, surahId:  20, verseNumber:  111, firstPage: 319 },
  { id: 129, surahId:  21, verseNumber:    1, firstPage: 322 },
  { id: 130, surahId:  21, verseNumber:   29, firstPage: 324 },
  { id: 131, surahId:  21, verseNumber:   51, firstPage: 326 },
  { id: 132, surahId:  21, verseNumber:   83, firstPage: 329 },
  { id: 133, surahId:  22, verseNumber:    1, firstPage: 332 },
  { id: 134, surahId:  22, verseNumber:   19, firstPage: 334 },
  { id: 135, surahId:  22, verseNumber:   38, firstPage: 336 },
  { id: 136, surahId:  22, verseNumber:   60, firstPage: 339 },
  { id: 137, surahId:  23, verseNumber:    1, firstPage: 342 },
  { id: 138, surahId:  23, verseNumber:   36, firstPage: 344 },
  { id: 139, surahId:  23, verseNumber:   75, firstPage: 347 },
  { id: 140, surahId:  24, verseNumber:    1, firstPage: 350 },
  { id: 141, surahId:  24, verseNumber:   21, firstPage: 352 },
  { id: 142, surahId:  24, verseNumber:   35, firstPage: 354 },
  { id: 143, surahId:  24, verseNumber:   53, firstPage: 356 },
  { id: 144, surahId:  25, verseNumber:    1, firstPage: 359 },
  { id: 145, surahId:  25, verseNumber:   21, firstPage: 362 },
  { id: 146, surahId:  25, verseNumber:   53, firstPage: 364 },
  { id: 147, surahId:  26, verseNumber:    1, firstPage: 367 },
  { id: 148, surahId:  26, verseNumber:   52, firstPage: 369 },
  { id: 149, surahId:  26, verseNumber:  111, firstPage: 371 },
  { id: 150, surahId:  26, verseNumber:  181, firstPage: 374 },
  { id: 151, surahId:  27, verseNumber:    1, firstPage: 377 },
  { id: 152, surahId:  27, verseNumber:   27, firstPage: 379 },
  { id: 153, surahId:  27, verseNumber:   56, firstPage: 382 },
  { id: 154, surahId:  27, verseNumber:   82, firstPage: 384 },
  { id: 155, surahId:  28, verseNumber:   12, firstPage: 386 },
  { id: 156, surahId:  28, verseNumber:   29, firstPage: 389 },
  { id: 157, surahId:  28, verseNumber:   51, firstPage: 392 },
  { id: 158, surahId:  28, verseNumber:   76, firstPage: 394 },
  { id: 159, surahId:  29, verseNumber:    1, firstPage: 396 },
  { id: 160, surahId:  29, verseNumber:   26, firstPage: 399 },
  { id: 161, surahId:  29, verseNumber:   46, firstPage: 402 },
  { id: 162, surahId:  30, verseNumber:    1, firstPage: 404 },
  { id: 163, surahId:  30, verseNumber:   31, firstPage: 407 },
  { id: 164, surahId:  30, verseNumber:   54, firstPage: 410 },
  { id: 165, surahId:  31, verseNumber:   22, firstPage: 413 },
  { id: 166, surahId:  32, verseNumber:   11, firstPage: 415 },
  { id: 167, surahId:  33, verseNumber:    1, firstPage: 418 },
  { id: 168, surahId:  33, verseNumber:   18, firstPage: 420 },
  { id: 169, surahId:  33, verseNumber:   31, firstPage: 422 },
  { id: 170, surahId:  33, verseNumber:   51, firstPage: 425 },
  { id: 171, surahId:  33, verseNumber:   60, firstPage: 426 },
  { id: 172, surahId:  34, verseNumber:   10, firstPage: 429 },
  { id: 173, surahId:  34, verseNumber:   24, firstPage: 431 },
  { id: 174, surahId:  34, verseNumber:   46, firstPage: 433 },
  { id: 175, surahId:  35, verseNumber:   15, firstPage: 436 },
  { id: 176, surahId:  35, verseNumber:   41, firstPage: 439 },
  { id: 177, surahId:  36, verseNumber:   28, firstPage: 442 },
  { id: 178, surahId:  36, verseNumber:   60, firstPage: 444 },
  { id: 179, surahId:  37, verseNumber:   22, firstPage: 446 },
  { id: 180, surahId:  37, verseNumber:   83, firstPage: 449 },
  { id: 181, surahId:  37, verseNumber:  145, firstPage: 451 },
  { id: 182, surahId:  38, verseNumber:   21, firstPage: 454 },
  { id: 183, surahId:  38, verseNumber:   52, firstPage: 456 },
  { id: 184, surahId:  39, verseNumber:    8, firstPage: 459 },
  { id: 185, surahId:  39, verseNumber:   32, firstPage: 462 },
  { id: 186, surahId:  39, verseNumber:   53, firstPage: 464 },
  { id: 187, surahId:  40, verseNumber:    1, firstPage: 467 },
  { id: 188, surahId:  40, verseNumber:   21, firstPage: 469 },
  { id: 189, surahId:  40, verseNumber:   41, firstPage: 472 },
  { id: 190, surahId:  40, verseNumber:   66, firstPage: 474 },
  { id: 191, surahId:  41, verseNumber:    9, firstPage: 477 },
  { id: 192, surahId:  41, verseNumber:   25, firstPage: 479 },
  { id: 193, surahId:  41, verseNumber:   47, firstPage: 482 },
  { id: 194, surahId:  42, verseNumber:   13, firstPage: 484 },
  { id: 195, surahId:  42, verseNumber:   27, firstPage: 486 },
  { id: 196, surahId:  42, verseNumber:   51, firstPage: 488 },
  { id: 197, surahId:  43, verseNumber:   24, firstPage: 491 },
  { id: 198, surahId:  43, verseNumber:   57, firstPage: 493 },
  { id: 199, surahId:  44, verseNumber:   17, firstPage: 496 },
  { id: 200, surahId:  45, verseNumber:   12, firstPage: 499 },
  { id: 201, surahId:  46, verseNumber:    1, firstPage: 502 },
  { id: 202, surahId:  46, verseNumber:   21, firstPage: 505 },
  { id: 203, surahId:  47, verseNumber:   10, firstPage: 507 },
  { id: 204, surahId:  47, verseNumber:   33, firstPage: 510 },
  { id: 205, surahId:  48, verseNumber:   18, firstPage: 513 },
  { id: 206, surahId:  49, verseNumber:    1, firstPage: 515 },
  { id: 207, surahId:  49, verseNumber:   14, firstPage: 517 },
  { id: 208, surahId:  50, verseNumber:   27, firstPage: 519 },
  { id: 209, surahId:  51, verseNumber:   31, firstPage: 522 },
  { id: 210, surahId:  52, verseNumber:   24, firstPage: 524 },
  { id: 211, surahId:  53, verseNumber:   26, firstPage: 526 },
  { id: 212, surahId:  54, verseNumber:    9, firstPage: 529 },
  { id: 213, surahId:  55, verseNumber:    1, firstPage: 531 },
  { id: 214, surahId:  56, verseNumber:    1, firstPage: 534 },
  { id: 215, surahId:  56, verseNumber:   75, firstPage: 536 },
  { id: 216, surahId:  57, verseNumber:   16, firstPage: 539 },
  { id: 217, surahId:  58, verseNumber:    1, firstPage: 542 },
  { id: 218, surahId:  58, verseNumber:   14, firstPage: 544 },
  { id: 219, surahId:  59, verseNumber:   11, firstPage: 547 },
  { id: 220, surahId:  60, verseNumber:    7, firstPage: 550 },
  { id: 221, surahId:  62, verseNumber:    1, firstPage: 553 },
  { id: 222, surahId:  63, verseNumber:    4, firstPage: 554 },
  { id: 223, surahId:  65, verseNumber:    1, firstPage: 558 },
  { id: 224, surahId:  66, verseNumber:    1, firstPage: 560 },
  { id: 225, surahId:  67, verseNumber:    1, firstPage: 562 },
  { id: 226, surahId:  68, verseNumber:    1, firstPage: 564 },
  { id: 227, surahId:  69, verseNumber:    1, firstPage: 566 },
  { id: 228, surahId:  70, verseNumber:   19, firstPage: 569 },
  { id: 229, surahId:  72, verseNumber:    1, firstPage: 572 },
  { id: 230, surahId:  73, verseNumber:   20, firstPage: 575 },
  { id: 231, surahId:  75, verseNumber:    1, firstPage: 577 },
  { id: 232, surahId:  76, verseNumber:   19, firstPage: 579 },
  { id: 233, surahId:  78, verseNumber:    1, firstPage: 582 },
  { id: 234, surahId:  80, verseNumber:    1, firstPage: 585 },
  { id: 235, surahId:  82, verseNumber:    1, firstPage: 587 },
  { id: 236, surahId:  84, verseNumber:    1, firstPage: 589 },
  { id: 237, surahId:  87, verseNumber:    1, firstPage: 591 },
  { id: 238, surahId:  90, verseNumber:    1, firstPage: 594 },
  { id: 239, surahId:  94, verseNumber:    1, firstPage: 596 },
  { id: 240, surahId: 100, verseNumber:    9, firstPage: 599 },
];

/**
 * Returns all surahs present on the given Mushaf page.
 *
 * When one or more surahs start on pageNumber, those are the only surahs on
 * the page (the previous surah ended on pageNumber-1 by definition of firstPage).
 * When no new surah starts, the page is a continuation of a single surah.
 */
export function surahsOnPage(pageNumber: number): SurahInfo[] {
  const startsHere = SURAH_INDEX.filter((s) => s.firstPage === pageNumber);
  if (startsHere.length > 0) return startsHere;
  return [surahForPage(pageNumber)];
}

/** Returns the surah active at the given page (last surah whose firstPage ≤ pageNumber). */
export function surahForPage(pageNumber: number): SurahInfo {
  let result = SURAH_INDEX[0];
  for (const s of SURAH_INDEX) {
    if (s.firstPage <= pageNumber) result = s;
    else break;
  }
  return result;
}

/**
 * Direct surah → juz lookup (index 0 unused; indices 1–114 match surah IDs).
 * Surahs that span a juz boundary are placed in the juz where they primarily begin,
 * following the standard mushaf convention provided by the user.
 */
export const SURAH_JUZ_MAP: number[] = [
  0,   // [0] unused — 1-based indexing below
  1,   // 1  Al-Fatihah
  1,   // 2  Al-Baqarah
  3,   // 3  Ali 'Imran
  4,   // 4  An-Nisa'
  6,   // 5  Al-Ma'idah
  7,   // 6  Al-An'am
  8,   // 7  Al-A'raf
  9,   // 8  Al-Anfal
  10,  // 9  At-Tawbah
  11,  // 10 Yunus
  11,  // 11 Hud
  12,  // 12 Yusuf
  13,  // 13 Ar-Ra'd
  13,  // 14 Ibrahim
  13,  // 15 Al-Hijr
  14,  // 16 An-Nahl
  15,  // 17 Al-Isra'
  15,  // 18 Al-Kahf
  16,  // 19 Maryam
  16,  // 20 Ta-Ha
  17,  // 21 Al-Anbiya'
  17,  // 22 Al-Hajj
  18,  // 23 Al-Mu'minun
  18,  // 24 An-Nur
  18,  // 25 Al-Furqan
  19,  // 26 Ash-Shu'ara'
  19,  // 27 An-Naml
  20,  // 28 Al-Qasas
  20,  // 29 Al-Ankabut
  21,  // 30 Ar-Rum
  21,  // 31 Luqman
  21,  // 32 As-Sajdah
  21,  // 33 Al-Ahzab
  22,  // 34 Saba'
  22,  // 35 Fatir
  22,  // 36 Ya-Sin
  23,  // 37 As-Saffat
  23,  // 38 Sad
  23,  // 39 Az-Zumar
  24,  // 40 Ghafir
  24,  // 41 Fussilat
  25,  // 42 Ash-Shura
  25,  // 43 Az-Zukhruf
  25,  // 44 Ad-Dukhan
  25,  // 45 Al-Jathiyah
  26,  // 46 Al-Ahqaf
  26,  // 47 Muhammad
  26,  // 48 Al-Fath
  26,  // 49 Al-Hujurat
  26,  // 50 Qaf
  26,  // 51 Adh-Dhariyat
  27,  // 52 At-Tur
  27,  // 53 An-Najm
  27,  // 54 Al-Qamar
  27,  // 55 Ar-Rahman
  27,  // 56 Al-Waqi'ah
  27,  // 57 Al-Hadid
  28,  // 58 Al-Mujadila
  28,  // 59 Al-Hashr
  28,  // 60 Al-Mumtahanah
  28,  // 61 As-Saff
  28,  // 62 Al-Jumu'ah
  28,  // 63 Al-Munafiqun
  28,  // 64 At-Taghabun
  28,  // 65 At-Talaq
  28,  // 66 At-Tahrim
  29,  // 67 Al-Mulk
  29,  // 68 Al-Qalam
  29,  // 69 Al-Haqqah
  29,  // 70 Al-Ma'arij
  29,  // 71 Nuh
  29,  // 72 Al-Jinn
  29,  // 73 Al-Muzzammil
  29,  // 74 Al-Muddathir
  29,  // 75 Al-Qiyamah
  29,  // 76 Al-Insan
  29,  // 77 Al-Mursalat
  30,  // 78 An-Naba'
  30,  // 79 An-Nazi'at
  30,  // 80 Abasa
  30,  // 81 At-Takwir
  30,  // 82 Al-Infitar
  30,  // 83 Al-Mutaffifin
  30,  // 84 Al-Inshiqaq
  30,  // 85 Al-Buruj
  30,  // 86 At-Tariq
  30,  // 87 Al-A'la
  30,  // 88 Al-Ghashiyah
  30,  // 89 Al-Fajr
  30,  // 90 Al-Balad
  30,  // 91 Ash-Shams
  30,  // 92 Al-Layl
  30,  // 93 Ad-Duha
  30,  // 94 Ash-Sharh
  30,  // 95 At-Tin
  30,  // 96 Al-Alaq
  30,  // 97 Al-Qadr
  30,  // 98 Al-Bayyinah
  30,  // 99 Az-Zalzalah
  30,  // 100 Al-Adiyat
  30,  // 101 Al-Qari'ah
  30,  // 102 At-Takathur
  30,  // 103 Al-Asr
  30,  // 104 Al-Humazah
  30,  // 105 Al-Fil
  30,  // 106 Quraysh
  30,  // 107 Al-Ma'un
  30,  // 108 Al-Kawthar
  30,  // 109 Al-Kafirun
  30,  // 110 An-Nasr
  30,  // 111 Al-Masad
  30,  // 112 Al-Ikhlas
  30,  // 113 Al-Falaq
  30,  // 114 An-Nas
];

/** Returns the juz active at the given page. */
export function juzForPage(pageNumber: number): JuzInfo {
  let result = JUZ_INDEX[0];
  for (const j of JUZ_INDEX) {
    if (j.firstPage <= pageNumber) result = j;
    else break;
  }
  return result;
}

/** Returns the hizb active at the given page. */
export function hizbForPage(pageNumber: number): HizbInfo {
  let result = HIZB_INDEX[0];
  for (const h of HIZB_INDEX) {
    if (h.firstPage <= pageNumber) result = h;
    else break;
  }
  return result;
}

/** Returns the rub' el hizb active at the given page. */
export function rubForPage(pageNumber: number): RubInfo {
  let result = RUB_INDEX[0];
  for (const r of RUB_INDEX) {
    if (r.firstPage <= pageNumber) result = r;
    else break;
  }
  return result;
}
