export type PrayerPhrase = {
  arabic?: string;
  transliteration?: string;
  meaning?: string;
  repeat?: string;
};

export type GuideStep = {
  id: string;
  stepNumber: number;
  title: string;
  shortDescription: string;
  detailedDescription?: string;
  say?: PrayerPhrase;
  notes?: string[];
  illustrationKey: string;
};

export type PhraseGuideItem = {
  id: string;
  position: string;
  transliteration: string;
  meaning?: string;
  when: string;
  repeat?: string;
};

export type RakAhInfo = {
  prayerName: string;
  rakahCount: number;
};
