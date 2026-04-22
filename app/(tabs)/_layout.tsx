import { Stack, usePathname, useRouter } from 'expo-router';
import { Animated, StyleSheet, View, ScrollView, TouchableOpacity, Text } from 'react-native';
import { useEffect, useRef, useState, useCallback } from 'react';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import SvgIcon from '../../components/SvgIcon';
import { useTheme } from '../../context/ThemeContext';
import { useYoutubeLive } from '../../hooks/useYoutubeLive';
import { useBanners } from '../../context/BannerContext';
import { useBookingNotif } from '../../context/BookingNotifContext';

const PEEK_AMOUNT = 60; // px scrolled right to reveal the 6th tab

const VISIBLE_TABS = [
  { name: 'home',   route: '/home',   title: 'Hem',       icon: 'home'    as const },
  { name: 'index',  route: '/',       title: 'Bönetider', icon: 'prayer'  as const },
  { name: 'qibla',  route: '/qibla',  title: 'Qibla',     icon: 'compass' as const },
  { name: 'quran',  route: '/quran',  title: 'Koranen',   icon: 'quran'   as const },
  { name: 'dhikr',  route: '/dhikr',  title: 'Dhikr',     icon: 'dhikr'   as const },
  { name: 'more',   route: '/more',   title: 'Visa mer',  icon: 'more'    as const },
];

function CustomTabBar() {
  const { theme: T, isDark } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const { isLive } = useYoutubeLive();
  const { hasUnread } = useBanners();
  const { totalUnread: bookingUnread } = useBookingNotif();
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isLive) { pulseAnim.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 2.2, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 1400, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => { loop.stop(); pulseAnim.setValue(1); };
  }, [isLive]);
  const scrollRef = useRef<ScrollView>(null);
  const userHasTouched = useRef(false);
  const lastNavTime = useRef(0);

  // Runs once per cold start — JS state resets every time the app is killed,
  // so no AsyncStorage needed. Shows peek every fresh launch.
  useEffect(() => {
    const t1 = setTimeout(() => {
      if (userHasTouched.current) return;
      scrollRef.current?.scrollTo({ x: PEEK_AMOUNT, animated: true });

      const t2 = setTimeout(() => {
        if (userHasTouched.current) return;
        scrollRef.current?.scrollTo({ x: 0, animated: true });
      }, 700);

      return () => clearTimeout(t2);
    }, 900);

    return () => clearTimeout(t1);
  }, []);

  function isActive(tabName: string): boolean {
    if (tabName === 'index') return pathname === '/' || pathname === '/index';
    return pathname === `/${tabName}`;
  }

  return (
    <View style={{
      position: 'absolute', bottom: 30, left: 16, right: 16,
      height: 85, borderRadius: 36, overflow: 'hidden',
      shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
      shadowOpacity: isDark ? 0.4 : 0.12, shadowRadius: 24,
    }}>
      <BlurView
        intensity={isDark ? 60 : 80}
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      <View style={{
        ...StyleSheet.absoluteFillObject,
        backgroundColor: isDark ? 'rgba(20,20,20,0.6)' : 'rgba(255,255,255,0.6)',
      }} />
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 4, alignItems: 'center', height: 85 }}
        style={{ flex: 1 }}
        decelerationRate="fast"
        // Markera att användaren har rört scrollen — avbryter nudge
        onScrollBeginDrag={() => { userHasTouched.current = true; }}
        onTouchStart={() => { userHasTouched.current = true; }}
      >
        {VISIBLE_TABS.map((tab) => {
          const active = isActive(tab.name);
          return (
            <TouchableOpacity
              key={tab.name}
              onPress={() => {
                if (active) return;
                const now = Date.now();
                if (now - lastNavTime.current < 600) return;
                lastNavTime.current = now;

                // Pass _dir as a route param so the inner Stack's screenOptions
                // can pick the correct animation per push. This is evaluated
                // per-route (each push gets a unique route key + params),
                // so it's reliable unlike a module-level variable.
                const fromIndex = VISIBLE_TABS.findIndex(t => isActive(t.name));
                const toIndex   = VISIBLE_TABS.indexOf(tab);
                const dir       = toIndex < fromIndex ? 'left' : 'right';

                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.navigate({ pathname: tab.route as any, params: { _dir: dir } });
              }}
              style={{
                width: 72, height: 85,
                alignItems: 'center', justifyContent: 'center',
                paddingTop: 10, paddingBottom: 10,
              }}
              activeOpacity={0.7}
            >
              {active && (
                <View style={{
                  position: 'absolute', top: 10, left: 6, right: 6, bottom: 10,
                  backgroundColor: T.accentGlow,
                  borderRadius: 18,
                }} />
              )}
              <View style={{ width: 24, height: 24 }}>
                <SvgIcon name={tab.icon} size={24} color={active ? T.accent : T.textMuted} />
                {tab.name === 'home' && isLive && (
                  <View style={{ position: 'absolute', top: -2, right: -2, width: 10, height: 10 }}>
                    <Animated.View style={{
                      position: 'absolute',
                      width: 10, height: 10, borderRadius: 5,
                      backgroundColor: '#FF3B30',
                      opacity: pulseAnim.interpolate({ inputRange: [1, 2.2], outputRange: [0.5, 0] }),
                      transform: [{ scale: pulseAnim }],
                    }} />
                    <View style={{
                      width: 10, height: 10, borderRadius: 5,
                      backgroundColor: '#FF3B30',
                      borderWidth: 1.5,
                      borderColor: isDark ? '#141414' : '#ffffff',
                    }} />
                  </View>
                )}
                {tab.name === 'home' && !isLive && (hasUnread || bookingUnread > 0) && (
                  <View style={{
                    position: 'absolute', top: -2, right: -2,
                    width: bookingUnread > 9 ? 16 : bookingUnread > 0 ? 14 : 8,
                    height: bookingUnread > 9 ? 16 : bookingUnread > 0 ? 14 : 8,
                    borderRadius: bookingUnread > 9 ? 8 : bookingUnread > 0 ? 7 : 4,
                    backgroundColor: '#FF3B30',
                    borderWidth: 1.5,
                    borderColor: isDark ? '#141414' : '#ffffff',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {bookingUnread > 0 && (
                      <Text style={{ color: '#fff', fontSize: 8, fontWeight: '700', lineHeight: 10 }}>
                        {bookingUnread > 99 ? '99' : String(bookingUnread)}
                      </Text>
                    )}
                  </View>
                )}
              </View>
              <Text style={{
                fontSize: 10, fontWeight: '500', marginTop: 3,
                color: active ? T.accent : T.textMuted,
              }} numberOfLines={1}>
                {tab.title}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function Layout() {
  return (
    <>
      {/*
        Using Stack (not Tabs) so that tab-to-tab navigation uses the same
        slide animation as Quran/Dhikr/Ruqyah: the old screen stays visible
        underneath while the new screen slides in on top.

        gestureEnabled: false — prevents swipe-back through tab history.
        The _dir param (set by CustomTabBar) picks slide_from_left or
        slide_from_right, matching the direction of the tab being tapped.
      */}
      <Stack
        screenOptions={({ route }) => ({
          headerShown: false,
          gestureEnabled: false,
          animation: (route.params as Record<string, string> | undefined)?._dir === 'left'
            ? 'slide_from_left'
            : 'slide_from_right',
        })}
      />
      <CustomTabBar />
    </>
  );
}
