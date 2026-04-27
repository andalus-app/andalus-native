type PrayerTimesForEngine = {
  fajr:     Date | null;
  shuruq:   Date | null;
  dhuhr:    Date | null;
  maghrib:  Date | null;
  isha:     Date | null;
  midnight: Date | null;
};

export type HomeV2Item = { id: string; title: string };

export type HomeV2State = {
  greeting: string;
  subtitle: string;
  items:    HomeV2Item[];
};

export function getHomeV2State(
  now:         Date,
  prayerTimes: PrayerTimesForEngine,
  name:        string | null | undefined,
): HomeV2State {
  const { fajr, shuruq, dhuhr, maghrib, isha, midnight } = prayerTimes;

  const displayName = name?.trim() || null;

  let greeting: string;
  if (fajr && dhuhr && now >= fajr && now < dhuhr) {
    greeting = displayName ? `God morgon, ${displayName}` : 'God morgon';
  } else if (dhuhr && maghrib && now >= dhuhr && now < maghrib) {
    greeting = displayName ? `God dag, ${displayName}` : 'God dag';
  } else if (maghrib && isha && now >= maghrib && now < isha) {
    greeting = displayName ? `God kväll, ${displayName}` : 'God kväll';
  } else {
    greeting = displayName ? `God natt, ${displayName}` : 'God natt';
  }

  const subtitle = "As-salāmo ʿalaykom";

  const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);
  const subMin   = (d: Date, m: number) => new Date(d.getTime() - m * 60_000);

  const morningPrimaryEnd = shuruq   ? addHours(shuruq, 3)    : null;
  const preMaghribStart   = maghrib  ? subMin(maghrib, 60)     : null;

  const isMorningPrimary   = !!(fajr && morningPrimaryEnd  && now >= fajr            && now < morningPrimaryEnd);
  const isMorningSecondary = !!(morningPrimaryEnd && dhuhr  && now >= morningPrimaryEnd && now < dhuhr);
  const isPreMaghrib       = !!(preMaghribStart && maghrib  && now >= preMaghribStart && now < maghrib);
  const isAfterMaghrib     = !!(maghrib && midnight          && now >= maghrib         && now < midnight);

  if (isMorningPrimary) {
    return { greeting, subtitle, items: [
      { id: 'morning', title: 'Läs morgon adhkar'   },
      { id: 'quran',   title: 'Läs Koranen'         },
      { id: 'names',   title: 'Lär dig Allahs namn' },
    ]};
  }

  if (isMorningSecondary) {
    return { greeting, subtitle, items: [
      { id: 'quran',   title: 'Läs Koranen'         },
      { id: 'morning', title: 'Läs morgon adhkar'   },
      { id: 'names',   title: 'Lär dig Allahs namn' },
    ]};
  }

  if (isPreMaghrib) {
    return { greeting, subtitle, items: [
      { id: 'evening', title: 'Läs kvälls adhkar'    },
      { id: 'quran',   title: 'Läs Koranen'          },
      { id: 'names',   title: 'Lär dig Allahs namn'  },
    ]};
  }

  if (isAfterMaghrib) {
    return { greeting, subtitle, items: [
      { id: 'evening', title: 'Läs kvälls adhkar'    },
      { id: 'quran',   title: 'Läs Koranen'          },
      { id: 'names',   title: 'Lär dig Allahs namn'  },
    ]};
  }

  return { greeting, subtitle, items: [
    { id: 'quran', title: 'Läs Koranen'          },
    { id: 'rem',   title: 'Läs åminnelser'       },
    { id: 'names', title: 'Lär dig Allahs namn'  },
  ]};
}
