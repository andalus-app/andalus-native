import { Stack, useRouter } from 'expo-router';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import * as NativeSplash from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { Animated, View, StyleSheet, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAudioModeAsync } from 'expo-audio';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { AppProvider, useApp } from '../context/AppContext';
import { NotificationProvider } from '../context/NotificationContext';
import { BannerProvider } from '../context/BannerContext';
import { BookingNotifProvider } from '../context/BookingNotifContext';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initStorage } from '../services/storage';
import { syncKahfReminderOnStartup, savePushToken, syncAllahNamesReminderOnStartup } from '../services/notifications';
import { syncZakatRemindersOnStartup } from '../services/zakatReminderService';
import '../services/quranLastPage'; // side-effect: pre-warms last Quran page font + data at startup
import CustomSplashScreen from '../components/SplashScreen';
import { YoutubePlayerProvider } from '../context/YoutubePlayerContext';
import YoutubeBackgroundPlayer from '../components/YoutubeBackgroundPlayer';
import OnboardingFlow, { ONBOARDING_COMPLETED_KEY } from '../components/OnboardingFlow';
import { Asset } from 'expo-asset';

// Keep the native iOS launch screen visible until we explicitly call hideAsync()
// inside CustomSplashScreen (triggered by isReady=true).
NativeSplash.preventAutoHideAsync();

// Pre-warm the app icon asset at launch so QuranAudioPlayer's artworkUriRef is
// populated before the user ever opens the Quran screen. This is a fire-and-forget
// side-effect — the same module-level cache in QuranAudioPlayer is populated here.
// No await needed; QuranAudioPlayer's own useEffect enqueues itself on the same
// promise and picks up the result when it resolves.
Asset.fromModule(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../assets/images/icon.png'),
).downloadAsync().catch(() => {});

// ── Inner app content ─────────────────────────────────────────────────────────

function AppContent({ onFontsReady }: { onFontsReady: () => void }) {
  const { overlayAnim } = useTheme();
  const { dispatch } = useApp();
  const router = useRouter();
  const [showOnboarding, setShowOnboarding] = useState(false);

  const [fontsLoaded] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
  });

  // Signal to RootLayout that fonts are loaded — the splash can now animate.
  // NativeSplash.hideAsync() is called inside CustomSplashScreen, not here.
  useEffect(() => {
    if (fontsLoaded) onFontsReady();
  }, [fontsLoaded, onFontsReady]);

  // Check whether to show onboarding — runs once after fonts are ready.
  // New users (key not set) → show OnboardingFlow.
  // Existing users (key set, or completed old location-only modal) → skip.
  useEffect(() => {
    if (!fontsLoaded) return;
    Promise.all([
      AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY),
      AsyncStorage.getItem('islamnu_location_onboarded'),
    ]).then(([onboarded, locationOnboarded]) => {
      if (onboarded || locationOnboarded) return;
      setShowOnboarding(true);
    }).catch(() => {});
  }, [fontsLoaded]);

  // Handle push notification tap — navigate to the correct screen.
  // Two cases:
  //   Warm/background: addNotificationResponseReceivedListener fires normally.
  //   Cold-start (app was killed): getLastNotificationResponseAsync picks up the
  //   tap that launched the app — the listener alone does NOT cover this case.
  useEffect(() => {
    // Wait until fonts are loaded and the Stack navigator is mounted.
    // On cold-start, router.push/navigate fired before fontsLoaded=true lands in
    // a blank navigator — the tabs group hasn't rendered yet, producing a black screen.
    if (!fontsLoaded) return;

    let N: typeof import('expo-notifications') | null = null;
    try { N = require('expo-notifications'); } catch { return; }
    if (!N) return;

    const handleResponse = (response: import('expo-notifications').NotificationResponse) => {
      const data = response.notification.request.content.data as Record<string, string> | undefined;
      if ((data?.screen === 'booking' || data?.screen === 'my-bookings') && data?.bookingId) {
        const params = [`bookingId=${data.bookingId}`];
        if (data.date)   params.push(`date=${data.date}`);
        if (data.screen === 'my-bookings') params.push('view=my-bookings');
        router.push(`/booking?${params.join('&')}` as any);
      } else if (data?.screen === 'quran') {
        // Al-Kahf-påminnelse — öppna Quran-läsaren direkt på rätt sida/vers.
        const params: string[] = [];
        if (data.page)     params.push(`page=${data.page}`);
        if (data.verseKey) params.push(`verseKey=${data.verseKey}`);
        router.push(`/quran${params.length ? '?' + params.join('&') : ''}` as any);
      } else if (data?.screen === 'quran_khatmah') {
        // Khatmah-påminnelse — öppna Quran-läsaren på dagens startsida.
        // Läser khatmah-state asynkront; vid fel öppnas senast lästa sidan.
        (async () => {
          try {
            const raw = await AsyncStorage.getItem('andalus_khatmah_v1');
            if (raw) {
              const kd = JSON.parse(raw) as {
                currentDay: number;
                dayRanges: {
                  dayNumber:   number;
                  startPage:   number;
                  startSurahId?: number;
                  startAyah?:    number;
                }[];
              };
              const range = kd.dayRanges.find(r => r.dayNumber === kd.currentDay);
              if (range?.startPage) {
                const params: string[] = [`page=${range.startPage}`];
                if (range.startSurahId && range.startAyah) {
                  params.push(`verseKey=${range.startSurahId}:${range.startAyah}`);
                }
                router.push(`/quran?${params.join('&')}` as any);
                return;
              }
            }
          } catch {}
          // Fallback: ingen khatmah-data — öppna senast lästa sidan
          router.push('/quran' as any);
        })();
      } else if (data?.screen === 'zakatResult') {
        // Zakat-påminnelse — navigera direkt till resultatsidan i Zakat-kalkylatorn.
        router.push('/zakat?step=result' as any);
      } else if (data?.screen === 'asmaul') {
        // Allahs namn-påminnelse — öppna Asmaul Husna-sidan med det aktuella namnet.
        const nameNr = data.nameNr ? `?nameNr=${data.nameNr}` : '';
        router.push(`/asmaul${nameNr}` as any);
      } else if (data?.screen === 'dhikr') {
        // Dhikr-påminnelse — öppna Dhikr-sidan direkt.
        router.push('/dhikr' as any);
      } else if (data?.screen === 'youtube_live') {
        // YouTube live notification — navigate to home and signal HomeScreen to scroll
        // to the YouTube card so the live badge is immediately visible.
        AsyncStorage.setItem('islamnu_live_notif_tap', 'true').catch(() => {});
        router.navigate('/(tabs)/home' as any);
      } else if (data?.announcementId) {
        // Store the tapped announcement ID so HomeScreen can react on focus.
        // Fire-and-forget — navigation happens immediately regardless of storage result.
        AsyncStorage.setItem('islamnu_notif_tap', data.announcementId).catch(() => {});
        router.navigate('/(tabs)/home' as any);
      }
    };

    // Cold-start: check if the app was launched by tapping a notification.
    // Guard against replaying stale responses from a previous session — only
    // handle responses where the notification arrived within the last 5 minutes.
    // 300 s covers lock-screen taps where the user sees the notification, puts
    // the phone down, and taps a minute or two later (60 s was too strict).
    N.getLastNotificationResponseAsync()
      .then(response => {
        if (!response) return;
        const ageSeconds = Date.now() / 1000 - response.notification.date;
        if (ageSeconds < 300) handleResponse(response);
      })
      .catch(() => {});

    // Warm/background: listener fires whenever the user taps a notification
    // while the app is running or resumed from background.
    const sub = N.addNotificationResponseReceivedListener(handleResponse);
    return () => sub.remove();
  }, [router, fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={({ route }) => ({
          headerShown: false,
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          // _dir param is injected by the custom tab bar to control slide direction.
          // 'left' → tab is to the left of the current one → slide in from left.
          // Anything else (or absent) → default slide from right.
          animation: (route.params as Record<string, string> | undefined)?._dir === 'left'
            ? 'slide_from_left'
            : 'slide_from_right',
          fullScreenGestureEnabled: true,
        })}
      >
        {/* Ruqyah sub-app: edge-only swipe back — full-screen swipe disabled */}
        <Stack.Screen name="ruqyah" options={{ fullScreenGestureEnabled: false }} />
        {/* Asmaul Husna: edge-only swipe back — prevents accidental dismiss while scrolling the grid */}
        <Stack.Screen name="asmaul" options={{ fullScreenGestureEnabled: false }} />
        {/* Dhikr: edge-only swipe back — internal PanResponder handles sub-view navigation */}
        <Stack.Screen name="dhikr" options={{ fullScreenGestureEnabled: false }} />
        {/* Umrah Guide: swipe back fully disabled — internal step navigation handles all back */}
        <Stack.Screen name="umrah" options={{ gestureEnabled: false }} />
      </Stack>

      {/* YouTube background audio player — always mounted outside the tab/stack
          navigator so iOS never suspends its JS when the user switches tabs. */}
      <YoutubeBackgroundPlayer />

      {/* Onboarding — visas en gång för nya användare */}
      {showOnboarding && (
        <OnboardingFlow
          onDone={() => {
            setShowOnboarding(false);
            // Schedule Kahf reminder immediately now that permission may have been granted.
            // syncKahfReminderOnStartup is a no-op if permission wasn't granted.
            syncKahfReminderOnStartup();
            // Register push token immediately after onboarding — the user may have
            // just granted notification permission for the first time.
            savePushToken();
          }}
          onNotificationsGranted={() => {
            // Activate dhikr reminder in live AppContext state so scheduling
            // kicks in immediately without waiting for next app restart.
            dispatch({ type: 'SET_SETTINGS', payload: { dhikrReminder: true } });
          }}
        />
      )}

      {/* Theme-transition overlay — dims to black and back on theme toggle */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: '#000000', opacity: overlayAnim }]}
      />
    </View>
  );
}

// ── Root layout ───────────────────────────────────────────────────────────────

export default function RootLayout() {
  const [storageReady, setStorageReady] = useState(false);
  const [fontsReady,   setFontsReady]   = useState(false);
  const [showSplash,   setShowSplash]   = useState(true);

  // Configure the global audio session at startup — before any screen mounts.
  // This ensures AudioModule.shouldPlayInBackground = true from the very first
  // render, so OnAppEntersBackground never calls pauseAllPlayers() even if the
  // QuranAudioPlayer component hasn't mounted yet.
  // Category: .playback (playsInSilentMode:true + allowsRecording:false)
  // → required for iOS background audio (UIBackgroundModes:audio in Info.plist).
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
      allowsRecording: false,
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    initStorage().then(async () => {
      setStorageReady(true);
      syncKahfReminderOnStartup();
      syncZakatRemindersOnStartup();
      syncAllahNamesReminderOnStartup();
      // Only attempt token registration if onboarding is already completed —
      // prevents the iOS notification permission dialog from appearing before
      // the onboarding flow has had a chance to ask for it properly.
      const onboarded = await AsyncStorage.getItem('islamnu_onboarding_completed');

      if (onboarded) {
        // iOS Keychain (required by expo-notifications) is only accessible when
        // the app is in the foreground and the device is unlocked. Calling
        // getExpoPushTokenAsync() while launched in the background (silent push,
        // background fetch) causes "Keychain access failed: User interaction is
        // not allowed" warnings from the native layer.
        // Fix: only call savePushToken() when the app is already active; otherwise
        // defer until the next time it comes to the foreground.
        if (AppState.currentState === 'active') {
          savePushToken();
        } else {
          const sub = AppState.addEventListener('change', (state) => {
            if (state === 'active') {
              sub.remove();

              savePushToken();
            }
          });
        }
      }
    });
  }, []);

  // Stable callback — avoids re-mounting AppContent on RootLayout re-renders
  const handleFontsReady = useCallback(() => setFontsReady(true), []);

  // isReady = both storage (required by providers) and fonts loaded
  const isReady = storageReady && fontsReady;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/*
        Provider tree — only mounts after storage is ready.
        Storage.getItem() calls inside providers are synchronous after initStorage().
      */}
      {storageReady && (
        <ThemeProvider>
          <AppProvider>
            <BannerProvider>
              <BookingNotifProvider>
                <NotificationProvider>
                  <YoutubePlayerProvider>
                    <AppContent onFontsReady={handleFontsReady} />
                  </YoutubePlayerProvider>
                </NotificationProvider>
              </BookingNotifProvider>
            </BannerProvider>
          </AppProvider>
        </ThemeProvider>
      )}

      {/*
        Splash overlay — rendered outside the provider tree so it shows
        even during the storageReady=false window (native splash is still
        covering the screen at that point, so visually there is no gap).

        isReady=true  → hides native splash + starts 500ms animation
        onDone        → unmounts this overlay, revealing the app beneath
      */}
      {showSplash && (
        <CustomSplashScreen
          isReady={isReady}
          onDone={() => setShowSplash(false)}
        />
      )}
    </GestureHandlerRootView>
  );
}
