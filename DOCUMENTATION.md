# Hidayah — Teknisk Dokumentation

**App:** Hidayah (islam.nu mobile)
**Bundle ID:** `com.anonymous.Hidayah`
**Version:** 1.3.1
**Plattform:** iOS + Android (Expo managed workflow)
**Språk:** All UI på svenska
**Datum för dokument:** 2026-05-01

---

## Innehållsförteckning

1. [Översikt](#1-översikt)
2. [Teknisk stack](#2-teknisk-stack)
3. [Projektstruktur](#3-projektstruktur)
4. [Provider-stack och initialisering](#4-provider-stack-och-initialisering)
5. [Navigationsmodell och routing](#5-navigationsmodell-och-routing)
6. [Funktioner i detalj](#6-funktioner-i-detalj)
   - 6.1 Bönetider
   - 6.2 Hem-skärm (dashboard)
   - 6.3 Qibla-kompass
   - 6.4 Koranen (Mushaf)
   - 6.5 Khatmah (läsplan)
   - 6.6 Quran-ljudspelare
   - 6.7 Dhikr (åkallelser)
   - 6.8 Allahs 99 Namn
   - 6.9 Hadith
   - 6.10 E-böcker
   - 6.11 Ruqyah
   - 6.12 Hajj-guide
   - 6.13 Umrah-guide
   - 6.14 Zakat-kalkylator
   - 6.15 Quiz
   - 6.16 Bokning av lokal
   - 6.17 YouTube-livesändning
   - 6.18 Notifikationer
   - 6.19 Annonser/banners
   - 6.20 Admin-funktioner
   - 6.21 iOS-widget
   - 6.22 Inställningar
7. [Datalagret (services)](#7-datalagret-services)
8. [Statiska data (data/)](#8-statiska-data-data)
9. [Kontexter och hooks](#9-kontexter-och-hooks)
10. [Tema och design](#10-tema-och-design)
11. [Lagring (AsyncStorage-nycklar)](#11-lagring-asyncstorage-nycklar)
12. [Backend (Supabase)](#12-backend-supabase)
13. [Native-byggen och Expo prebuild](#13-native-byggen-och-expo-prebuild)
14. [Kritiska designregler och fallgropar](#14-kritiska-designregler-och-fallgropar)

---

## 1. Översikt

Hidayah är en svensk islamisk mobilapp byggd i React Native + Expo. Appen samlar dagliga, andliga och praktiska funktioner för muslimer i Sverige under en modern, polerad iOS-26-inspirerad design.

**Huvudfunktioner:**

- Bönetider med automatisk plats, månadskalender och pushnotiser
- Komplett Mushaf-läsare (604 sidor) med ljudrecitation och Khatmah-läsplaner
- Dhikr-bibliotek på 269+ åkallelser med välmående-baserad sökning
- Allahs 99 Namn med ljud, bakgrund och tafsir
- Hadith-samling
- E-böcker med PDF-läsare, bokmärken och favoriter
- Ruqyah-kunskapsbas (58 artiklar, 4 kategorier) med inbäddade YouTube-föreläsningar
- Hajj- och Umrah-guider med stegvis progression och checklistor
- Zakat-kalkylator (Zakat al-Mal + Zakat al-Fitr) på svenska
- Islamisk kunskapsquiz
- Lokalbokning med offline-kö
- YouTube-livesändning från församlingen med push-notiser
- Adminpanel för annonser och bokningshantering
- iOS-hemskärm-widget med bönetider

**Designprinciper:**

- All UI på svenska
- iOS-26-inspirerade glassmorphism-effekter (BlurView-överlägg)
- Animerade övergångar via `Animated` API (React Native, ej Reanimated för de flesta skärmar)
- Floating tab bar (30 px från botten, ej SafeAreaView-baserad)
- Mörkt/ljust tema + system-läge med animerad övergångsoverlay

---

## 2. Teknisk stack

### Kärna
| Paket | Version | Användning |
|---|---|---|
| `expo` | ~54.0.33 | Managed workflow |
| `react` | 19.1.0 | UI |
| `react-native` | 0.81.5 | Native bridge |
| `expo-router` | ~6.0.23 | Filbaserad routing |
| `typescript` | ~5.9.2 | Strict mode, alias `@/*` → root |

### Routing & Navigation
- `expo-router` (filbaserad)
- `@react-navigation/bottom-tabs`, `@react-navigation/native` (under huven)
- `react-native-screens` (native screen-stack)

### Backend & Lagring
- `@supabase/supabase-js` ^2.100.0 (databas, real-time, edge functions)
- `@react-native-async-storage/async-storage` 2.2.0 (lokal persistens)

### Audio / Video / PDF
- `expo-audio` ~1.1.1 (Quran-recitation, lock-screen-kontroller)
- `expo-av` ~16.0.8 (legacy fallback)
- `react-native-webview` 13.15.0 (YouTube, PDF-cover-extraktion)
- `react-native-pdf` ^7.0.4 (PDF-rendering)
- `expo-print` ~15.0.8 (PDF-rendering, native)
- `react-native-blob-util` ^0.24.7 (filhantering)
- `airplay-route-picker` (custom Expo-modul, AirPlay-väljare på iOS)

### Bönetider & Sensorer
- `adhan` ^4.4.3 (lokal beräkningsbibliotek, fallback)
- `expo-location` ~19.0.8 (GPS, reverse-geocode)
- `expo-sensors` ~15.0.8 (magnetometer för Qibla)

### Notifikationer & Bakgrund
- `expo-notifications` ~0.32.16
- `expo-background-fetch` ~14.0.9
- `expo-task-manager` ~14.0.9

### UI & Animation
- `expo-blur` ~15.0.8 (BlurView för glassmorphism)
- `react-native-svg` 15.12.1 (Mushaf-glyfer, ikoner)
- `react-native-gesture-handler` ~2.28.0
- `react-native-reanimated` ~4.1.1 (några skärmar)
- `expo-haptics` ~15.0.8

### Typsnitt
- `@expo-google-fonts/inter` (400/500/600/700)
- `@expo-google-fonts/scheherazade-new` (arabiskt fallback-typsnitt)
- QCF V2 (King Fahd Complex Quran-font, 604 sidfiler — bundlade i `assets/fonts/qcf/`)
- `surah_names.ttf` (PostScript-namn `icomoon`)
- `QCF_BSML.TTF` (bismillah, U+FDFD)

### Utility
- `hijri-date` ^0.2.2 (Hijri ↔ gregoriansk konvertering)
- `expo-haptics`, `expo-sharing`, `expo-image`, `expo-image-picker`, `expo-linking`, `expo-web-browser`

### Custom native-moduler (`modules/`)
- `airplay-route-picker` — exponerar `showRoutePicker()` för iOS AirPlay
- `WidgetData` — exponerar `updateWidgetData()` för iOS-hemskärm-widget (delar data via app group `group.com.anonymous.Hidayah`)

---

## 3. Projektstruktur

```
/app                       Filbaserad routing (expo-router)
  _layout.tsx              Root-layout, provider-stack, fonts, splash, Stack-navigator
  (tabs)/
    _layout.tsx            Floating BlurView-tab bar, 6 synliga flikar
    home.tsx               Hem-dashboard
    index.tsx              Bönetider
    qibla.tsx              Qibla-kompass
    more.tsx               Övriga funktioner (sektionslista)
  quran.tsx                Mushaf-läsare (root-skärm, ej i tab)
  dhikr.tsx
  asmaul.tsx               99 Namn
  ebooks.tsx
  hadith/                  Stack-navigator (index + [id])
  ruqyah/                  Stack-navigator (index + [slug] + category/[slug])
  hajj.tsx
  hajj-transition.tsx      Bro mellan Hajj-dag-8 → Umrah
  umrah.tsx
  zakat.tsx
  quiz.tsx
  booking.tsx              (lokalbokning, åtkomlig via 3-tap "Mer")
  monthly.tsx              Månadskalender bönetider
  settings.tsx
  about.tsx
  support.tsx
  admin-announcements.tsx  Admin: hantera annonser

/components                60+ UI-komponenter
  SvgIcon.tsx              Ikonbibliotek (25+ typer)
  ThemeToggle.tsx
  HidayahLogo.tsx
  NextPrayerCard.tsx
  DagensKoranversCard.tsx  "Dagens vers" på hem
  DagensHadithCard.tsx
  AdminPinModal.tsx
  ...
  quran/                   ~20 Mushaf-komponenter (Pager, Renderer, AudioPlayer, ...)
  dhikr/                   DhikrWellbeingView
  ruqyah/                  Hero, sökfält, kategorikort, YouTube-spelare
  umrah/                   Hero, kort, accordions, räknare, checklistor
  hajj/                    Hero

/context                   6 React Contexts
  ThemeContext             Tema, animerad övergång
  AppContext               Bönetider, plats, inställningar
  QuranContext             Quran-navigation, ljud, modaler, bokmärken
  BannerContext            Annonser från Google Sheets / Supabase
  BookingNotifContext      Real-time bokningsstatus
  NotificationContext      In-app-toast-pill
  YoutubePlayerContext     Delad WebView för all YouTube i appen

/hooks
  useYoutubeLive.ts        Adaptiv polling av Supabase Edge Function
  useBooks.ts              E-bok-state
  usePdfCover.ts           PDF-omslag via WebView+canvas
  useOfflineBookingNative  Bokningskö med AsyncStorage
  useCurrentMinute.ts
  useZakatReminder.ts
  quran/
    useQuranSettings.ts
    useQuranBookmarks.ts
    useKhatmah.ts

/services                  ~30 services
  prayerApi.ts
  monthlyCache.ts
  notifications.ts
  geocoding.ts
  storage.ts
  hijriCalendarService.ts
  homeV2TimeEngine.ts
  announcementsApi.ts
  backgroundFetch.ts
  dailyReminder.ts
  zakatReminderService.ts
  wellbeingSearch.ts
  cryptoUtils.ts
  mushafApi.ts             Quran Foundation API
  mushafTimingService.ts   Quran.com timings
  mushafFontManager.ts     QCF font-hantering
  mushafPrefetchService.ts Pre-warm fonts/sidor
  arabicFontService.ts
  quranAudioService.ts     QuranCDN, nedladdning
  quranSearchService.ts
  quranTranslationService  Bernström svenska
  quranVerseService.ts
  quranOfflineManager.ts
  quranDownloadQueue.ts
  quranPageLRU.ts
  quranPageFileStore.ts
  quranLastPage.ts
  quranPerfLogger.ts

/data
  surahIndex.ts            114 surahs metadata
  dhikrRepository.ts       269+ dhikr, 9 grupper, 10 wellbeing-moods
  dhikrData.json           Källdata
  dhikrMessages.json
  dagensKoranvers.ts       Dagens vers-pool
  bernstromTranslation.ts  Svensk Quran-översättning
  asmaul_husna.json        99 Namn
  hadithData.json
  books.ts                 E-bokslista
  ruqyahData.ts            Auto-genererad från CMS-export
  hajjGuideData.ts + .json
  umrahGuideData.ts + .json
  quizData.ts + quizQuestions.json

/lib
  supabase.ts              Singleton-klient
  uuid.ts

/theme
  colors.ts                dark + light, ~20 tokens vardera

/modules                   Custom native-moduler
  airplay-route-picker/
  WidgetData/

/supabase
  functions/               Edge functions (youtube-streams, announcement-notification, ...)
  migrations/              SQL-migreringar
  config.toml

/scripts
  downloadQCFFonts.js
  generateFontRequires.js
  verify_quran.js

/assets
  fonts/qcf/p001.ttf … p604.ttf + surah_names.ttf + bismillah.ttf
  bilder, hero-bilder, logo, splash, ikoner

/ios, /android             Genereras av `expo prebuild` — ej incheckade
```

---

## 4. Provider-stack och initialisering

`app/_layout.tsx` är root-layout. Provider-ordningen är **inte utbytbar** — beroenden flödar uppifrån och ner.

```
GestureHandlerRootView
  └─ ThemeProvider                    (tema, animerad övergångsoverlay)
      └─ AppProvider                  (bönetider, plats, inställningar)
          └─ BannerProvider           (annonser)
              └─ BookingNotifProvider (Supabase real-time)
                  └─ NotificationProvider (toast-kö)
                      └─ Stack (expo-router) + animated overlay
```

**Initialiseringssekvens:**

1. SplashScreen visas
2. Inter + Scheherazade fonts laddas via `useFonts`
3. `initStorage()` kallas — preloadar AsyncStorage in-memory så `storage.getItem()` är synkron
4. QCF V2-fonts initieras via `mushafFontManager`
5. `requestNotificationPermissions()` på första start
6. Splash döljs → Stack-navigator monteras

---

## 5. Navigationsmodell och routing

### Tab-baserad navigation
6 synliga flikar i `app/(tabs)/_layout.tsx` (custom BlurView-tab bar):

| Tab | Route | Skärm |
|---|---|---|
| Hem | `/(tabs)/home` | `home.tsx` — dashboard |
| Bönetider | `/(tabs)/index` | `(tabs)/index.tsx` — countdown + plats |
| Qibla | `/(tabs)/qibla` | `qibla.tsx` — kompass |
| Koranen | `/quran` | Root-skärm (öppnas från tab-baren) |
| Dhikr | `/dhikr` | Root-skärm |
| Mer | `/(tabs)/more` | Sektionslista |

### Sub-navigatorer (Stack)
- `/ruqyah/_layout.tsx` — `index` + `[slug]` + `category/[slug]`
- `/hadith/_layout.tsx` — `index` + `[id]`

### Övriga root-skärmar
`asmaul.tsx`, `ebooks.tsx`, `hajj.tsx`, `umrah.tsx`, `zakat.tsx`, `quiz.tsx`, `monthly.tsx`, `settings.tsx`, `about.tsx`, `support.tsx`, `booking.tsx`, `admin-announcements.tsx`, `hajj-transition.tsx`.

### Deep links
- `/quran?verseKey=2:255` — öppnar Mushaf vid given vers (tvåfasig: omedelbar `approxPageForVerseKey()` + asynkron `goToVerse()` med exakt sida)
- Dagens Koranvers-kort på hem använder denna route

### Hemliga åtkomstpunkter
"Mer"-skärmen har dold tap-detektion:
- 3 snabba tap på rubriken → `/booking` (lokalbokning)
- 4 snabba tap → `/hajj` (Hajj-guide)

Admin-läge aktiveras via `AdminPinModal` på hem-skärmen (PIN lagrad krypterad i `services/cryptoUtils.ts`).

---

## 6. Funktioner i detalj

### 6.1 Bönetider

**Skärm:** `app/(tabs)/index.tsx`
**Service:** `services/prayerApi.ts`, `services/monthlyCache.ts`
**Context:** `AppContext`

**Datakälla:** Aladhan.com API (`https://api.aladhan.com/v1`)
**Fallback-bibliotek:** `adhan` npm-paket (lokal beräkning utan nät)

**13 beräkningsmetoder** (i `settings.tsx`): Default 3 = Muslim World League. Andra inkluderar ISNA, Egypt, Karachi, Umm al-Qura, Tehran, etc.

**Madhab/skola:** Hanafi (1) eller Shafi/Maliki/Hanbali (0). Påverkar Asr-tiden.

**Bönenamn (svenska):** Fajr, Soluppgång (Sunrise), Dhuhr, Asr, Maghrib, Isha.

**Cache-strategi:**
- Daglig cache per `{lat.toFixed(2)}_{lng.toFixed(2)}_{method}_{school}`
- Årscache: parallell hämtning av 13 månader (12 + januari nästa år) i bakgrunden, fire-and-forget
- Cache-nyckel: `{year}_{lat}_{lng}_{method}_{school}` i `services/monthlyCache.ts`

**Plats-flöde:**
1. På första start visas `LocationOnboardingModal`
2. `expo-location` → `requestForegroundPermissionsAsync()`
3. GPS → `geocoding.ts` → OpenStreetMap Nominatim → stad/land
4. Användaren kan byta plats manuellt via `CitySearchModal`

**Auto-uppdatering:** Background fetch via `expo-background-fetch` + `expo-task-manager` uppdaterar cache och widget-data när appen är i bakgrunden.

**Månadsvy:** `app/monthly.tsx` visar hela månaden med:
- ISO 8601-veckonummer i vänsterkolumn (28 px bred)
- Svenska dagnamn (Måndag, Tisdag, …) från `monthlyCache.ts`
- Hijri-datum bredvid gregorianskt datum
- Klickbara dagar → expanderar med alla 5 tider

### 6.2 Hem-skärm (dashboard)

**Skärm:** `app/(tabs)/home.tsx`
**Engine:** `services/homeV2TimeEngine.ts` (tidsmedveten innehållsväljare)

**Komposition (uppifrån-och-ned):**
1. **Hidayah-logo** + valbar admin-PIN-trigger
2. **NextPrayerCard** — countdown till nästa bön + plats + nuvarande bön highlight
3. **DagensKoranversCard** — daglig vers (deterministisk via dag-hash → `data/dagensKoranvers.ts`), tap → `/quran?verseKey=X:Y`
4. **DagensHadithCard** — daglig hadith ur `hadithData.json`
5. **YoutubeCard** — församlingens livesändning (delad WebView via `YoutubePlayerContext`)
6. **Annonser** (BannerContext) — swipe-to-dismiss-kort med PanResponder
7. **Bokningsnotifikationer** (BookingNotifContext) — visas om användaren har skickat in en bokning

**Animationer:**
- Pull-to-refresh (`RefreshControl`) → `refreshPrayers()` + `refreshLocation()` + banner-refresh
- LIVE-indikator pulserar i tab-baren när YouTube-stream är live
- Bokningsbadge visar antal olästa bokningsuppdateringar

### 6.3 Qibla-kompass

**Skärm:** `app/(tabs)/qibla.tsx`
**Sensorer:** `expo-sensors` magnetometer
**Backend-data:** `prayerApi.ts` → `fetchQiblaDirection(lat, lng)`

**Funktion:** Visar realtids-bäring till Mecka. Pilen roterar med telefonens orientering. Cirkel runt nålen indikerar exakt riktning (grön när rätt).

**Beräkning:**
- `qiblaBearing` (statisk) = bäring från användarens plats till Kaaba
- `magnetometer.heading` (live) = telefonens orientering
- Visad rotation = `qiblaBearing - heading`

### 6.4 Koranen (Mushaf)

**Skärm:** `app/quran.tsx`
**Context:** `QuranContext`
**Engine:** `components/quran/MushafRenderer.tsx`

**Datakällor:**
- **Quran Foundation API** (`api.qurancdn.com`) — vers-, ord- och sid-data via `services/mushafApi.ts`
- **Quran.com API** — verstimings via `services/mushafTimingService.ts`
- **QuranCDN** — ljudfiler via `services/quranAudioService.ts`

**Renderingsmotor (MushafRenderer):**
- 100% SVG via `react-native-svg` (Core Text på iOS)
- 604 unika sidtypsnitt (QCF V2: `p001.ttf` … `p604.ttf`), bundlade lokalt
- Encoding: Unicode Private Use Area, 1:1 cmap-uppslag, **ingen text-shaping**
- Layout: deterministisk aritmetik — `slotY[i] = padV + (i+1) * slotH`, 15 slots per sida

**Sluttyper per sida:**
- `verse_line` — verstext
- `surah_header` — surah-namn-banner (font: `surah_names`)
- `bismillah` — fristående bismillah (font: `QCF_BSML`, U+FDFD)
- `ornament` — SVG-geometri, ingen font
- `unknown` — blank

**Bismillah-regler:**
- Surah 1 (Al-Fatiha): vers 1:1 ÄR bismillah → ingen separat
- Surah 9 (At-Tawbah): ingen bismillah alls
- Surah 2–8, 10–114: fristående bismillah före vers 1
- Komposition: `composePage()` skapar antingen fristående `bismillah`-slot ELLER sätter `bismillahEmbedded: true` på `surah_header` när bara 1 gap finns

**Kända API-anomalier (hanteras i `mushafApi.ts`):**
- Backward overflow (N-1): ord med `page_number=N` returneras endast av `verses/by_page/{N-1}`
- Forward overflow (N+1): ord med `page_number=N` returneras endast av `verses/by_page/{N+1}`
- **Lösning:** Hämtar alltid sidor N-1, N och N+1 parallellt och filtrerar på `page_number===N`. Cache v4.

**Vers-sök** (`QuranSearchModal`): full-text via `services/quranSearchService.ts`. Indexerar verser per ord, surah, ayah.

**Long-press-meny** (`VerseActionsMenu`): kopiera, dela, bokmärke, anteckning, ordsökning.

**Bokmärken:** `useQuranBookmarks` hook + `andalus_quran_bookmarks` i AsyncStorage. Per-vers-anteckningar.

**Översättning:** Bernström svenska översättning (`data/bernstromTranslation.json`) — växlas i `QuranSettingsPanel`.

**Offline-läge:**
- `quranOfflineManager.ts` — bakgrundsnedladdning av sidor och fonts
- `quranDownloadQueue.ts` — kö-hantering med pause/resume
- `quranPageFileStore.ts` — persistent fil-cache
- `quranPageLRU.ts` — in-memory LRU-cache

**Pre-warming:** `mushafPrefetchService.ts` förladdar fonts för förmodade nästa-sidor + cachear exakt sida vid deep-link.

### 6.5 Khatmah (Quran-läsplan)

**Komponent:** `components/quran/KhatmahScreen.tsx` (renderas i `QuranContentsScreen`)
**Hook:** `hooks/quran/useKhatmah.ts`
**Persistens:** AsyncStorage `andalus_quran_khatmah_v1`

**Tillgängliga planer:**
- 30 dagar (ramadan-takt — 1 juz per dag)
- 40 dagar
- 50 dagar
- 1 år
- Egen anpassad plan

**Funktion:** Användaren väljer plan + startsurah/ayah. Appen pre-beräknar dagliga sid-intervall. Visar:
- Aktuell dag och dagens läsning
- Progress (% klart)
- Markörer i Mushaf-rendereringen:
  - Orange "slut"-markör (khatmah end)
  - Grön "start"-markör (khatmah start)
- "Markera klar"-knapp (`KhatmahQuickComplete`)
- Slutfest-animation (`KhatmahCompleteAnimation`) vid klar plan

**Renderings-detaljer:**
- `MushafRenderer` har separat pass-1 (vers-positionsmätning) + pass-2 (highlight-rect-mätning)
- Använder hidden `SvgText`-element + `getBBox()` för exakt positionering
- Minst 50 ms timeout för getBBox på nyligen lagda element (commit-fönster för native)
- Retry vid `Object.keys(bboxes).length < expectedSlots` (ej `===0`)

### 6.6 Quran-ljudspelare

**Komponent:** `components/quran/QuranAudioPlayer.tsx`
**Service:** `services/quranAudioService.ts`
**Underliggande:** `expo-audio`

**Funktioner:**
- Spela hela surah eller enskilda verser
- 8+ reciter att välja mellan (`QuranReciterSelector`)
- Hastighetskontroll: 0.5×, 0.75×, 1×, 1.25×, 1.5×, 1.75×, 2×
- Tre upprepnings-lägen (`RepeatSettingsModal`):
  - **Vers-upprepning** — upprepa enskild vers N gånger
  - **Intervall-upprepning** — upprepa verser X till Y med räknare
  - **Kontinuerlig** — fortsätt till nästa surah
- AirPlay-stöd via `airplay-route-picker` (custom modul)
- Lock-screen-kontroller (Now Playing) via `setActiveForLockScreen()`
- Bakgrundsuppspelning (background mode `audio` i app.json)

**Bismillah-pre-play:**
- QuranCDN-ljudfiler innehåller **inte** Bismillah — vers 1 börjar på 0 ms
- För surah 2–8, 10–114: spela Al-Fatihas vers 1:1 (som ÄR bismillah-recitationen) först, växla till surah-ljud när bismillah-portionen slutar
- Tid: `bsmTimerMs = bsmDurationMs / currentRate` (justeras för uppspelningshastighet)
- Använder `bismillahPendingRef`, `bismillahTimerRef`, `bismillahLockUntilMsRef`

**Vers-highlight under uppspelning:**
- `findCurrentVerse(positionMs, timings)` returnerar aktuell `verseKey`
- `MushafRenderer` ritar gul highlight-rect på aktiv vers
- Auto-sid-byte när vers spelas på ny sida
- För delade rader (flera verser per rad i RTL) används prefix-mätning: `rectX = lineRight - prefixWidth(v1…vk)`

**Player Generation Counter:**
- Varje `startPlayer()`-anrop ökar `playerGenerationRef`
- Subscribers fångar sin generation och kastar stale events
- Förhindrar att efterhängsna Al-Fatiha-events korrumperar surah-spelaren

**Verstimings:**
- Hämtas från Quran.com API: `verses/by_chapter/{N}?words=true&word_fields=code_v2,page_number`
- `code_v2` är **kritiskt** — utan detta returneras felaktiga vers-nivå-sidnummer (v3-cache)
- Sparas per reciter+surah: `andalus_mushaf_timing_v3_{r}_{s}`

**AsyncStorage-nycklar:**
- `andalus_quran_audio_settings` — reciter, hastighet, repeat-läge
- `andalus_quran_downloads_v1` — nedladdade surahs per reciter

### 6.7 Dhikr (åkallelser)

**Skärm:** `app/dhikr.tsx`
**Data:** `data/dhikrRepository.ts` (genererad från `dhikrData.json` + `dhikrMessages.json`)
**Söktjänst:** `services/wellbeingSearch.ts`
**Komponent:** `components/dhikr/DhikrWellbeingView.tsx`

**Innehåll:**
- 269+ dhikr-poster
- 9 super-grupper (GRUPPER): Morgon, Kväll, Före sömn, Efter bön, …
- 10 wellbeing-moods (WELLBEING_MOODS): Orolig, Ledsen, Tacksam, Hoppfull, Stressad, Rädd, Glad, Sjuk, Resa, Allmänt skydd
- Synonymindex (svenska) för intelligent sökning

**Funktioner:**
- Kategorivyer med slide-in/slide-out-animation + edge-swipe (PanResponder)
- Sökfält med live-filter (sökning över titel, arabisk text, transliteration, svenska, taggar, synonymer)
- Wellbeing-vy: välj mood → filtrerade dhikr för det tillståndet
- Räknare per dhikr (ihåg av antal recitationer)
- Favoriter (AsyncStorage)
- Justerbar typografi (7 storlekssteg per typ):
  - Arabiska textstorlek
  - Svensk översättningsstorlek
  - Uttal-/transliterationsstorlek

**5 huvud-flikar:**
1. Grupper (kategorier)
2. Favoriter
3. Sök
4. Välmående (wellbeing-vy)
5. Inställningar (typografistorlek)

**Synonymregel:** Synonymer måste uppdateras i **både** `wellbeing_metadata` och `flat_search_index` — sökmotorn läser bara från `flat_search_index`.

### 6.8 Allahs 99 Namn (Asma'ul-Husna)

**Skärm:** `app/asmaul.tsx`
**Data:** `data/asmaul_husna.json`

**Per namn visas:**
- Arabisk text (Scheherazade-typsnitt)
- Transliteration
- Svensk översättning + utförlig beskrivning
- Quran-referens (var det förekommer)
- Tap-att-spela-ljud (recitation)

**Funktioner:**
- Sökfält
- Favoriter
- Kategori-filter
- Detail-vy med utbyggd information

### 6.9 Hadith

**Stack:** `app/hadith/_layout.tsx`
- `index.tsx` — kategorier, sök, lista
- `[id].tsx` — detaljvy

**Data:** `data/hadithData.json`

**Per hadith:**
- Text (arabisk + svensk)
- Sanad (kedja av berättare)
- Källa (Sahih Bukhari, Muslim, etc.)
- Förklaring/tafsir
- Dela-funktion (`HadithShareCard`)

### 6.10 E-böcker

**Skärm:** `app/ebooks.tsx`
**Data:** `data/books.ts`
**Hooks:** `useBooks`, `usePdfCover`
**Renderare:** `components/NativePdf.tsx` (native via `expo-print`), `.web.tsx` (fallback)

**Funktioner:**
- Bibliotek med kategorier och favoriter
- PDF-läsare med:
  - Bokmärken per sida
  - Läs-progress (sparas)
  - Pinch-to-zoom
- Omslagsextraktion: hidden WebView renderar PDF → canvas → dataURL → cache
- Nedladdning och offline-läsning

**AsyncStorage:** `andalus_books_state`

### 6.11 Ruqyah

**Stack:** `app/ruqyah/_layout.tsx`
**Data:** `data/ruqyahData.ts` (auto-genererad från `ruqyah_app_import.json`)

**Innehåll:**
- 4 kategorier
- 58 artiklar
- Inbäddade YouTube-föreläsningar (via `RuqyahYouTubePlayer`)
- Chips/taggar för filtrering

**Funktioner:**
- Sök över titel, excerpt, landingPageText, kategorinamn, labels, chips
- Kategorifilter
- Föreläsnings-badge (`isLecture`)
- Relaterat innehåll på detail-vy
- Inline YouTube-spelare med `playsinline=1` + WebView-restriktion till YouTube-domän (öppnar ej Safari)

**Layout:** Mörk navy bakgrund (RO_BG-token) — egen visuell identitet i sub-stacken.

### 6.12 Hajj-guide

**Skärm:** `app/hajj.tsx` + `app/hajj-transition.tsx`
**Data:** `data/hajjGuideData.ts` (innehåll i `hajjGuideContent.json`)
**Persistens:** `andalus_hajj_progress_v1`

**Struktur:**
- 10+ dagar med stegvis progression
- Hero-bild per steg
- Återupptagningsbar (sparad progress)
- "Förenklat läge" toggle (visar/döljer fördjupande innehåll)

**Innehållskort (återanvänds från Umrah):**
- `SummaryCard`, `SpiritualIntroCard`, `DuaCard`, `ImportantCard`, `WarningCard`, `NoteCard`, `HadithCard`, `SplitInfoCard`, `QuranRefCard`, `CelebrationCard`, `ReflectionCard`, `UmrahAccordionCard`, `UmrahCounter`, `UmrahChecklist`

**Hajj→Umrah-bro:** `hajj-transition.tsx` triggas på "dag 8" där Hajj overlappar Umrah-ritualer. Ger context till Umrah-guiden så att den returnerar till Hajj vid avslut.

### 6.13 Umrah-guide

**Skärm:** `app/umrah.tsx`
**Data:** `data/umrahGuideData.ts`
**Persistens:** `andalus_umrah_progress_v1`

**Struktur:**
- 9-stegs flöde
- Återupptagningsbar progress
- **Egen mörk/ljus-toggle** (oberoende av app-tema)
- Checklists (`UmrahChecklist`) och räknare (`UmrahCounter`) för tawaf/sa'i

**FAQ:** `UmrahFAQAccordion` med vanliga frågor.

**Returflöde:** Om öppnad från `hajj-transition.tsx`, returnerar appen till Hajj-guidens nästa steg vid avslut.

### 6.14 Zakat-kalkylator

**Skärm:** `app/zakat.tsx`
**Persistens:** `andalus_zakat_state_v1`

**Två kalkylatorer:**

#### A) Zakat al-Mal (Årlig Zakat) — 6-stegs guide

**Steg 1 — Berättigad?** 4 ja/nej-frågor (alla måste vara JA):
1. Muslim?
2. Vuxen (Baligh)?
3. Fri (ej slav)?
4. Ägt rikedom över nisab i ett mån-år (hawl)?

Om något är NEJ → stoppa.

**Steg 2 — Nisab:** Ange guldpris (SEK/g) och silverpris (SEK/g).
- `nisabGold = 85g × goldPricePerGram`
- `nisabSilver = 595g × silverPricePerGram`
- `nisabApplied = min(nisabGold, nisabSilver)` (lägsta = skyddande för fattiga)

**Steg 3 — Tillgångar:**
- Kontanter + bankkonton
- Handelsgods × ägarandel%
- Guld/silver-smycken (med karat-stöd: 24k, 22k, 21k, 18k, 14k, 9k)
- Rena guldgrammet: `(totalGrams / 24) × karat`
- Fordringar (utlånade pengar man förväntar sig få tillbaka)

**Steg 4 — Missade år:** Heltal 0–50. Total = aktuellt år × (1 + missade år).

**Steg 5 — Resultat:**
- Nisab applicerad
- Total berättigad förmögenhet
- Zakat: 2.5% (`ZAKAT_RATE = 0.025`)
- Aktuellt år + missade år
- 8 mottagare (informationellt): Fuqara, Masakin, Amils, Muallafat al-Qulub, Riqab, Gharimun, Fi Sabilillah, Ibn al-Sabil

**Privata skulder dras INTE av** — enligt häftet detta är medvetet.

#### B) Zakat al-Fitr

- Antal personer × 3 kg × pris/kg = totalt
- Konstant: `FITR_KG_PER_PERSON = 3`
- Ingen nisab-tröskel

### 6.15 Quiz

**Skärm:** `app/quiz.tsx`
**Data:** `data/quizData.ts` (frågor i `quizQuestions.json`)
**Persistens:** quiz-statistik per kategori

**Funktioner:**
- Multipla kategorier (med svårighetsgrad easy/medium/hard för vissa)
- Timer-val: 10s, 20s, 30s, 60s, oändlig
- Multiple-choice frågor
- Score-spårning
- Sammanfattning per session: rätt/fel, tid, svårighet
- Statistik över tid (bästa resultat, totala försök)

### 6.16 Bokning av lokal

**Skärm:** `app/booking.tsx` (åtkomlig via 3-tap på "Mer"-rubriken)
**Hook:** `useOfflineBookingNative.ts`
**Backend:** Supabase (tabell + Edge Function `booking-notification`)

**Flöde:**
1. Användaren väljer datum, tid, lokal, antal personer
2. POST till Supabase
3. Edge Function bekräftar och skickar push-notis tillbaka
4. Admin granskar → status uppdateras → ny push-notis till användaren via `booking-status-notification`

**Offline-kö:**
- Vid nätverksfel (`TypeError` med mönster `network|fetch|connection|timeout|econnrefused|enotfound`) → kö i AsyncStorage `andalus_booking_queue`
- Validerings-/auth-/constraint-fel → **kasta** (kö ej tillämpligt)
- Synkning vid: mount + app-foreground-transition

**BookingNotifContext:**
- Real-time Supabase-prenumeration på `booking_notifications`-tabellen
- Olästa visas som badge på hem-tab i tab-baren

### 6.17 YouTube-livesändning

**Hook:** `hooks/useYoutubeLive.ts`
**Backend:** Supabase Edge Function `/functions/v1/youtube-streams`
**Channel ID:** `UCQhN1h0T-02TYWf-mD3-2hQ` (hårdkodad — får ej ändras)

**Backend-flöde:**
- Edge Function anropar YouTube Data API
- Cachear status server-side (hanterar quota + hot-mode-refresh)
- App anropar **aldrig** YouTube API direkt

**Adaptiv polling:**

| Tillstånd | Intervall |
|---|---|
| `live` | 1 minut |
| `upcoming`, < 30 min | 3 minuter |
| `upcoming`, < 6 h | 15 minuter |
| `upcoming`, ≥ 6 h | 1 timme |
| Ingen stream | 3 timmar |
| Fetch-fel (back-off) | 5 minuter |

**App-livscykel:**
- Background → clear timer omedelbart
- Foreground → kontrollera ålder; om stale → fetch nu, om fresh → schemalägg återstående tid (aldrig döda timer)
- Använd `streamRef.current` (ej React state) i AppState-listener — state är stale i long-lived listeners

**Live-notifikation:**
- En notis per unik `videoId` (dedup via `notifiedVideoIdRef`)
- Refen återställs vid app-omstart (ny session = ny notis OK)

**WebView:**
- Delas över hela appen via `YoutubePlayerContext`
- Hem-skärmen innehåller en (1) gömd WebView
- `setInlineFrame()` flyttar WebViewen till hem-kortets koordinater
- `null` → bakgrundsläge (audio fortsätter, ingen video)
- Module-level `pauseYoutubePlayer()` — Quran/Dhikr-ljud kan pausa YouTube

**Cache:**
- AsyncStorage `yt_stream_cache_v2` — UI-cache för instant render vid uppstart
- Supabase = riktig backend-cache

### 6.18 Notifikationer

**Service:** `services/notifications.ts`
**Underliggande:** `expo-notifications`

**Notifikationstyper:**

| Typ | Identifier-mönster | Trigger |
|---|---|---|
| Bönenotis | `andalus-prayer-{slot}-{name}` | Schemaläggs lokalt vid bönetid |
| Dhikr-påminnelse | `dhikr-reminder` | Daglig vid vald tid |
| Fredagsdua | `friday-dua-reminder` | Varje fredag vid vald tid |
| Live-stream | (Ingen identifier) | useYoutubeLive på `videoId`-byte |
| Annons | (Server-side) | Admin publicerar via Edge Function `announcement-notification` |
| Bokningsstatus | (Server-side) | Admin uppdaterar status → Edge Function `booking-status-notification` |

**Tillstånd:**
- `requestNotificationPermissions()` på första start
- Inställningar i `settings.tsx`:
  - Bönenotiser (per/på/av per bön)
  - Annonsnotiser (på/av)
  - Dhikr-påminnelse (tid + på/av)
  - Fredagsdua-påminnelse (tid + på/av)

### 6.19 Annonser/banners

**Context:** `BannerContext`
**Service:** `services/announcementsApi.ts`
**Datakälla:** Google Sheets CSV (publik feed)

**Format per annons:**
- Titel
- Body
- Bild-URL
- Action-länk (URL att öppna vid tap)
- Aktiv från-datum / till-datum

**Real-time push:**
- Admin publicerar via `admin-announcements.tsx`
- Insert i Supabase-tabell triggar Edge Function `announcement-notification`
- Edge Function skickar push till alla användare

**UI:**
- Visas som kort på hem-skärmen
- Swipe-to-dismiss via PanResponder + Animated
- Tap → öppna action-länk via `expo-web-browser`

### 6.20 Admin-funktioner

**Åtkomst:**
- AdminPinModal (gömd trigger på hem-skärmen)
- PIN krypterad lokalt via `services/cryptoUtils.ts`
- Admin-läge persists i AsyncStorage `islamnu_admin_mode`

**Skärmar:**
- `app/admin-announcements.tsx` — skapa/redigera/radera annonser
- Bokningsadministration — bokningsöversikt med statusbyte (visas i `booking.tsx` om admin-läge aktivt)

**Funktioner:**
- Bildupload via `expo-image-picker`
- Schemalagd publicering (start-/slut-datum)
- Förhandsvisning
- Action-länk till app-rutter eller externa URLs

### 6.21 iOS-widget

**Modul:** `modules/WidgetData/`
**Entitlement:** App group `group.com.anonymous.Hidayah`

**Funktion:**
- Hemskärm-widget visar nästa bön + countdown
- Native iOS-widget (Swift/SwiftUI under huven)
- Data delas via app group
- Uppdateras via `updateWidgetData()` när:
  - Appen startar
  - Bönetider laddas
  - Background fetch körs (`expo-background-fetch`)

### 6.22 Inställningar

**Skärm:** `app/settings.tsx`

**Sektioner:**

#### Bönetider
- Beräkningsmetod (13 alternativ; default 3 = Muslim World League)
- Madhab (0/1)
- Auto-plats på/av
- Manuell stadsökning

#### Notifikationer
- Bönenotiser (per bön)
- Annonser
- Dhikr-påminnelse (tid)
- Fredagsdua-påminnelse (tid)

#### Tema
- Ljust / Mörkt / System
- Animerad övergångsoverlay (Animated.Value-fade)

#### Övrigt
- Admin-läge toggle (om PIN angivits)
- App-version
- Kontakta support
- Om appen

---

## 7. Datalagret (services)

### Bönetider

| Fil | Funktion |
|---|---|
| `prayerApi.ts` | Aladhan API-klient + Nominatim reverse geocode |
| `monthlyCache.ts` | Parallell 12-månaders cache + svenska dag/månad-namn |
| `geocoding.ts` | Wrapper över expo-location + Nominatim med cache |
| `hijriCalendarService.ts` | Hijri ↔ gregoriansk konvertering |

### Quran

| Fil | Funktion |
|---|---|
| `mushafApi.ts` | Quran Foundation API (vers- och sid-data) — fetchar N-1, N, N+1 |
| `mushafTimingService.ts` | Quran.com timings — kräver `code_v2` i word_fields |
| `mushafFontManager.ts` | QCF V2 font-livscykel |
| `mushafPrefetchService.ts` | Pre-warm fonts + exakt-sida-cache vid deep-link |
| `quranAudioService.ts` | QuranCDN-nedladdning, reciter-lista, audio-URI-uppslag |
| `arabicFontService.ts` | QCF font-laddning |
| `quranSearchService.ts` | Full-text-sök över Quran |
| `quranTranslationService.ts` | Bernström svensk översättning |
| `quranVerseService.ts` | Vers-uppslagsfunktioner |
| `quranOfflineManager.ts` | Bakgrundsnedladdning av sidor |
| `quranDownloadQueue.ts` | Pause/resume-kö för fonts/sidor |
| `quranPageLRU.ts` | In-memory LRU-cache |
| `quranPageFileStore.ts` | Persistent fil-cache |
| `quranLastPage.ts` | Senast lästa sida |
| `quranPerfLogger.ts` | Performance-mätningar |

### Övrigt

| Fil | Funktion |
|---|---|
| `notifications.ts` | expo-notifications wrapper, alla schemaläggningar |
| `announcementsApi.ts` | Google Sheets CSV-feed |
| `storage.ts` | Synkron AsyncStorage-wrapper (preloads `islamnu_*` i minne) |
| `homeV2TimeEngine.ts` | Tidsmedveten innehållsväljare för hem |
| `wellbeingSearch.ts` | Sök över dhikr med wellbeing-taggar |
| `cryptoUtils.ts` | Lokal kryptering (admin-PIN) |
| `backgroundFetch.ts` | Background-task-schemaläggning |
| `dailyReminder.ts` | Daglig påminnelse-logik |
| `zakatReminderService.ts` | Zakat-specifik påminnelse |

---

## 8. Statiska data (data/)

| Fil | Innehåll |
|---|---|
| `surahIndex.ts` | 114 surahs metadata + `surahForPage(n)` lookup |
| `dhikrRepository.ts` | 269+ dhikr berikat med wellbeing-taggar; 9 grupper, 10 moods |
| `dhikrData.json` | Källdata för repository |
| `dhikrMessages.json` | Svenska meddelanden + sök-synonymer |
| `dagensKoranvers.ts` | Pool av rekommenderade verser för "Dagens vers" |
| `bernstromTranslation.ts` | Bernström svensk Quran-översättning |
| `asmaul_husna.json` | 99 namn med betydelser och Quran-referenser |
| `hadithData.json` | Hadith-samling |
| `books.ts` | E-bokslista |
| `ruqyahData.ts` | 58 artiklar i 4 kategorier (auto-genererad) |
| `hajjGuideData.ts` + `.json` | Hajj-stegen |
| `umrahGuideData.ts` + `.json` | Umrah-stegen |
| `quizData.ts` + `quizQuestions.json` | Quiz-frågor + sessionshanterare |

---

## 9. Kontexter och hooks

### Kontexter

| Provider | Tillstånd | Persistens |
|---|---|---|
| `ThemeContext` | mode, theme, isDark | `andalus_theme_mode` |
| `AppContext` | prayerTimes, location, hijriDate, settings | `andalus_app_state` |
| `QuranContext` | currentPage, activeVerseKey, modaler, bokmärken, audio-cmds | flera AsyncStorage-keys |
| `BannerContext` | annonser från Sheets/Supabase | minnescache |
| `BookingNotifContext` | bokningsnotis, pendingBookings, totalUnread | Supabase real-time |
| `NotificationContext` | toast-kö | minne (4.5s auto-dismiss) |
| `YoutubePlayerContext` | videoId, isPlaying, inlineFrame | minne (1 delad WebView) |

### Hooks

| Hook | Syfte |
|---|---|
| `useYoutubeLive` | Adaptiv polling av Supabase Edge Function |
| `useBooks` | E-boks-state, favoriter, bokmärken, progress |
| `usePdfCover` | PDF-omslag via WebView+canvas |
| `useOfflineBookingNative` | Offline-kö för bokningar |
| `useCurrentMinute` | Återrendrar varje minut för bön-countdown |
| `useZakatReminder` | Zakat-påminnelselogik |
| `useQuranSettings` | Quran display-inställningar |
| `useQuranBookmarks` | Bokmärken med anteckningar |
| `useKhatmah` | Läsplan-state och dag-uppslag |

---

## 10. Tema och design

**Fil:** `theme/colors.ts`

**Två objekt:** `dark` och `light`. Typ: `Theme = typeof dark`.

| Token | Dark | Light |
|---|---|---|
| `bg` | `#000000` | `#F2F2F7` |
| `card` | `#1C1C1E` | `#FFFFFF` |
| `text` | `#FFFFFF` | `#000000` |
| `textMuted` | `#8E8E93` | `#6D6D72` |
| `accent` | `#24645d` | `#24645d` |
| `accentGlow` | `rgba(36,100,93,0.2)` | `rgba(36,100,93,0.12)` |
| `accentRed` | `#FF3B30` | `#FF3B30` |
| `border` | `rgba(255,255,255,0.1)` | `rgba(0,0,0,0.08)` |

**Regler:**
- Använd alltid `useTheme()` → `theme.<token>`. Hårdkoda aldrig färger som ska adaptera.
- `isDark` används för BlurView-tint och -intensity (`60`/`80–82`).
- `T.border` måste passeras inline för komponenter som behöver tema-adaptiva borders.

**Typografi-skala:**

| Användning | Storlek | Vikt | Färg |
|---|---|---|---|
| Skärmtitel | 22–24 | 700 | `theme.text` |
| Sektionsrubrik | 16–18 | 600–700 | `theme.text` |
| Body | 13–14 | 400–500 | `theme.text` / `theme.textSecondary` |
| Label/caption | 11–12 | 500–600 | `theme.textMuted` |
| Accent/CTA | 13–14 | 600 | `theme.accent` |

**Card-mönster:**
```
backgroundColor: theme.card
borderWidth: 0.5
borderColor: theme.border
borderRadius: 14
padding: 14 (eller 16)
shadowColor: '#000'
shadowOffset: { width: 0, height: 6 }
shadowOpacity: 0.12 (upp till 0.45 för prominenta kort)
shadowRadius: 16 (upp till 24 för prominenta kort)
```

**Glassmorphism:**
```
<View style={StyleSheet.absoluteFill}>
  <BlurView intensity={isDark ? 60 : 82} tint={isDark ? 'dark' : 'light'} />
  <View style={[absoluteFill, { backgroundColor: isDark ? 'rgba(20,20,20,0.6)' : 'rgba(255,255,255,0.6)' }]} />
</View>
```

**Ikoner:** Endast `<SvgIcon name="..." size={...} color={...} />`. Inga externa ikon-bibliotek.

**Bokningskalender (iOS-26-stil):**
- Cirkulära dag-chips: `36×36, borderRadius: 18` (ej rektangulär)
- ISO 8601 vecka i 28 px vänsterkolumn (`getISOWeek()` med UTC-math)
- Bokningsprick alltid present i layout (4×4 px, transparent när tom)
- "Idag"-knapp synlig när `!isCurrentMonth || toISO(selectedDate) !== toISO(today)`

---

## 11. Lagring (AsyncStorage-nycklar)

| Nyckel | Ägare | Innehåll |
|---|---|---|
| `andalus_app_state` | AppContext | Bönetider, plats, settings |
| `andalus_theme_mode` | ThemeContext | 'system' / 'light' / 'dark' |
| `andalus_books_state` | useBooks | Favoriter, bokmärken, progress |
| `andalus_booking_queue` | useOfflineBookingNative | Offline-kö |
| `andalus_zakat_state_v1` | zakat.tsx | Zakat-input |
| `andalus_hajj_progress_v1` | hajj.tsx | Hajj-progress |
| `andalus_umrah_progress_v1` | umrah.tsx | Umrah-progress |
| `andalus_quran_khatmah_v1` | useKhatmah | Läsplaner |
| `andalus_quran_audio_settings` | QuranAudioPlayer | Reciter, hastighet, repeat |
| `andalus_quran_downloads_v1` | quranOfflineManager | Nedladdade surahs |
| `andalus_quran_bookmarks` | useQuranBookmarks | Bokmärken med anteckningar |
| `andalus_mushaf_cache_v1_{n}` | mushafApi | Sid-data per sida |
| `andalus_mushaf_chapter_v1_{n}` | mushafApi | Surah-metadata |
| `andalus_mushaf_timing_v3_{r}_{s}` | mushafTimingService | Verstimings per reciter+surah |
| `yt_stream_cache_v2` | useYoutubeLive | YouTube UI-cache |
| `islamnu_user_id` | storage.ts | Användar-ID |
| `islamnu_role` | storage.ts | Roll (admin / user) |
| `islamnu_phone` | storage.ts | Telefonnummer |
| `islamnu_admin_mode` | storage.ts | Admin-läge på/av |

---

## 12. Backend (Supabase)

**Klient:** `lib/supabase.ts` (singleton)
**URL:** `https://yqtnwgezqbznbpeooott.supabase.co`
**Anon key:** Hårdkodad, public — Row-Level Security (RLS) skyddar.

### Tabeller (relevanta)

| Tabell | Funktion |
|---|---|
| `booking_notifications` | Bokningar och statusuppdateringar |
| `announcements` | Annonser (insert triggar Edge Function) |
| `users` (auth) | Användarprofil och roller |

### Edge Functions

| Funktion | Trigger | Syfte |
|---|---|---|
| `youtube-streams` | App-polling (Hidayah) | Anropar YouTube Data API, cachar status server-side |
| `announcement-notification` | Insert i `announcements` | Skickar push till alla användare |
| `booking-notification` | Insert i `booking_notifications` | Bekräftelse-push till bokande användare |
| `booking-status-notification` | Update i `booking_notifications` | Statuspush till användaren |

### Migrations

`supabase/migrations/20260408_announcements.sql` — `announcements`-tabell + RLS-policies.

### Real-time

`BookingNotifContext` prenumererar på `postgres_changes` på `booking_notifications`-tabellen. Avprenumererar i cleanup (`channel.unsubscribe()`).

---

## 13. Native-byggen och Expo prebuild

**Modell:** Expo managed workflow. `ios/` och `android/` är **genererade** av `expo prebuild`, **ej** incheckade i git.

### Reparationssekvens

```bash
# 1. Generera native-projekt från app.json + Expo SDK
npx expo prebuild --clean

# 2. (valfritt — prebuild kör pod install, men upprepa om det fallerade)
cd ios && pod install && cd ..

# 3. Öppna .xcworkspace (ALDRIG .xcodeproj)
open ios/Hidayah.xcworkspace
```

Eller direkt via CLI:
```bash
npx expo run:ios
```

### Verifiering efter fix

- [ ] `ios/Podfile` finns
- [ ] `ios/Hidayah.xcworkspace` finns
- [ ] `ios/Pods/` är populerad
- [ ] `ios/Hidayah/AppDelegate.swift` innehåller `ExpoAppDelegate`
- [ ] Xcode → Product → Build lyckas
- [ ] Appen startar i simulator

### app.json highlights

```
name: Hidayah
slug: Hidayah
version: 1.3.1
orientation: portrait
ios:
  supportsTablet: true
  bundleIdentifier: com.anonymous.Hidayah
  infoPlist:
    NSMotionUsageDescription: ... (Qibla)
    NSLocationWhenInUseUsageDescription: ...
    UIBackgroundModes: [audio, location, fetch]
  entitlements:
    com.apple.security.application-groups: [group.com.anonymous.Hidayah]
android:
  edgeToEdgeEnabled: true
  predictiveBackGestureEnabled: false
  package: com.anonymous.Hidayah
plugins: [
  expo-router, expo-notifications, expo-splash-screen,
  expo-font, expo-audio, expo-location, expo-screen-orientation,
  expo-image-picker, expo-asset, airplay-route-picker, widget-data
]
experiments: { typedRoutes: true, reactCompiler: true }
```

---

## 14. Kritiska designregler och fallgropar

### Refs vs state i async-kod

**Regel:** I AppState-listeners, Supabase real-time-callbacks, setTimeout/setInterval och async-funktioner som överlever sin render — använd alltid en `ref` som speglar state.

```ts
const fooRef = useRef<Foo | null>(null);
// vid update:
fooRef.current = value;
setFoo(value);
// i callback:
const current = fooRef.current; // alltid fresh
```

### Polling-recovery

Alla hooks som pollar med `setTimeout` måste implementera följande i sin `'active'`-handler:

```ts
if (timerRef.current) clearTimeout(timerRef.current);
const age = Date.now() - lastFetchTs.current;
const interval = pollInterval(dataRef.current);
if (age >= interval) doFetch();
else timerRef.current = setTimeout(doFetch, interval - age);
```

### Notifikations-dedup

```ts
const notifiedIdRef = useRef<string | null>(null);
if (result.id !== notifiedIdRef.current) {
  notifiedIdRef.current = result.id;
  await sendNotification(...);
}
```

### Mushaf-rendering: viktiga fixar

1. **Tre-sidor-fetch** (mushafApi v4) — alltid hämta N-1, N, N+1.
2. **`code_v2` i timing-fetch** (v3) — utan detta får man fel sidnummer.
3. **getBBox 50ms-fördröjning** — på nyligen lagda element, ej `setTimeout(0)`.
4. **Retry vid `< expectedSlots`**, ej `=== 0`. Merga resultat: `{ ...prev, ...retry }`.
5. **Prefix-mätning för delade rader:** `rectX = lineRight - prefixWidth(v1…vk)`. Aldrig `lineLeft` som catch-all.
6. **Ingen full-line-fallback** för multi-vers-slot vid första getBBox-fel — retry istället.

### Audio-spelare

1. **Bismillah-timer:** dela `bsmDurationMs / currentRate` (justera för hastighet).
2. **Player generation counter:** öka räknare vid varje `startPlayer`; subscribers fångar sin gen och kastar stale events.
3. **`bismillahLockUntilMsRef`:** sätt till `max(BSMLLH_.timestampTo, 3000)` innan surah-spelaren startas.
4. **Interval-repeat seek-guard:** `intervalRepeatSeekingRef` förhindrar tick-multipla räkningar vid pending seek.

### Quran deep-link

1. **Två-fas:** `approxPageForVerseKey()` (omedelbar) + `goToVerse()` med exakt sida (asynkront).
2. **Module-level in-flight tracker:** `_inflightVerseKey`, `_inflightController` — re-tap för samma vers återanvänder fetch.
3. **AbortController:** 8s timeout, returnera **inte** abort från `useEffect` cleanup.
4. **Exakt-sida-cache:** delad mellan prefetch-service och deep-link-effekt.
5. **`pauseDownloads()` före programmatisk navigation,** `resumeDownloads()` 700 ms efter.
6. **Bredare scroll-retry:** 37×80 ms (3s) i `QuranVerseView`.

### Vad NIET får göras

- Ändra Supabase-URL eller anon-nyckel
- Lägg till AsyncStorage-nycklar som krockar med listan
- Bryt provider-nesting-ordning
- Lägg till engelsk text i UI
- Använd `any` i TypeScript
- Importera externa ikon-bibliotek
- Skapa andra Supabase-klient-instanser
- `useEffect` ensam för focus-refresh — använd `useFocusEffect`
- Hoppa över bottenpadding ≥ 100 px i ScrollView
- `StyleSheet.absoluteFillObject` för BlurView-overlay — använd `StyleSheet.absoluteFill`
- Ändra YouTube-channel-ID `UCQhN1h0T-02TYWf-mD3-2hQ`
- Använd fel page-font-CDN (`quran-font-files`-repot finns inte)
- System-font för Mushaf-innehåll (det finns ingen fallback — alltid QCF)

### App-livscykelregler

- AppState-listeners måste pausa polling i background och återskapa timer i foreground
- Alla timers/intervals måste rensas i cleanup
- Alla AbortControllers måste aborteras i cleanup
- Alla Supabase-channels måste avprenumereras i cleanup

### Bismillah-visning (sammanfattning)

| Surah | Bismillah-beteende |
|---|---|
| 1 (Al-Fatiha) | Vers 1:1 ÄR bismillah — ingen separat |
| 9 (At-Tawbah) | Ingen bismillah alls |
| 2–8, 10–114 | Fristående bismillah före vers 1 (eller embedded i surah-header om bara 1 gap finns) |

Komposition: `NO_STANDALONE_BISMILLAH = new Set([1, 9])`. Audio: QuranCDN-filer innehåller **ej** Bismillah — spela Al-Fatiha 1:1 separat först.

---

## Bilaga: Filstatistik

- **Root-skärmar:** 17
- **Tab-skärmar:** 6
- **Sub-navigatorer:** 2 (ruqyah, hadith)
- **Komponenter:** 60+
- **Kontexter:** 7
- **Hooks:** 9+
- **Services:** 30+
- **Statiska data-filer:** 15+
- **NPM-paket:** 50+
- **QCF-fonts (bundlade):** 606 filer (604 sidor + bismillah + surah_names)

---

*Genererad: 2026-05-01. Uppdatera denna fil när nya features eller arkitekturella förändringar införs.*
