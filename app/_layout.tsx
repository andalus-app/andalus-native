import { Stack, useRouter } from 'expo-router';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import * as NativeSplash from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { AppProvider, useApp } from '../context/AppContext';
import { NotificationProvider } from '../context/NotificationContext';
import { BannerProvider } from '../context/BannerContext';
import { BookingNotifProvider } from '../context/BookingNotifContext';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initStorage } from '../services/storage';
import { syncKahfReminderOnStartup, savePushToken } from '../services/notifications';
import '../services/quranLastPage'; // side-effect: pre-warms last Quran page font + data at startup
import CustomSplashScreen from '../components/SplashScreen';
import { YoutubePlayerProvider } from '../context/YoutubePlayerContext';
import YoutubeBackgroundPlayer from '../components/YoutubeBackgroundPlayer';
import OnboardingFlow, { ONBOARDING_COMPLETED_KEY } from '../components/OnboardingFlow';

// Keep the native iOS launch screen visible until we explicitly call hideAsync()
// inside CustomSplashScreen (triggered by isReady=true).
NativeSplash.preventAutoHideAsync();

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
                dayRanges: { dayNumber: number; startPage: number }[];
              };
              const range = kd.dayRanges.find(r => r.dayNumber === kd.currentDay);
              if (range?.startPage) {
                router.push(`/quran?page=${range.startPage}` as any);
                return;
              }
            }
          } catch {}
          // Fallback: ingen khatmah-data — öppna senast lästa sidan
          router.push('/quran' as any);
        })();
      } else if (data?.screen === 'dhikr') {
        // Dhikr-påminnelse — öppna Dhikr-sidan direkt.
        router.push('/(tabs)/dhikr' as any);
      } else if (data?.screen === 'youtube_live') {
        // YouTube live notification — navigate to home tab where the stream is shown.
        router.push('/(tabs)/' as any);
      } else if (data?.announcementId) {
        // Store the tapped announcement ID so HomeScreen can react on focus.
        // Fire-and-forget — navigation happens immediately regardless of storage result.
        AsyncStorage.setItem('islamnu_notif_tap', data.announcementId).catch(() => {});
        router.push('/(tabs)/' as any);
      }
    };

    // Cold-start: check if the app was launched by tapping a notification.
    // Guard against replaying stale responses from a previous session — only
    // handle responses where the notification arrived within the last 60 seconds.
    N.getLastNotificationResponseAsync()
      .then(response => {
        if (!response) return;
        const ageSeconds = Date.now() / 1000 - response.notification.date;
        if (ageSeconds < 60) handleResponse(response);
      })
      .catch(() => {});

    // Warm/background: listener fires whenever the user taps a notification
    // while the app is running or resumed from background.
    const sub = N.addNotificationResponseReceivedListener(handleResponse);
    return () => sub.remove();
  }, [router]);

  if (!fontsLoaded) return null;

  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          animation: 'slide_from_right',
          fullScreenGestureEnabled: true,
        }}
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

  useEffect(() => {
    initStorage().then(async () => {
      setStorageReady(true);
      syncKahfReminderOnStartup();
      // Only attempt token registration if onboarding is already completed —
      // prevents the iOS notification permission dialog from appearing before
      // the onboarding flow has had a chance to ask for it properly.
      const onboarded = await AsyncStorage.getItem('islamnu_onboarding_completed');
      if (onboarded) savePushToken();
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
