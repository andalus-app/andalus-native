import { Stack, usePathname, useRouter } from 'expo-router';
import {
  Animated, StyleSheet, View, ScrollView,
  TouchableOpacity, Text,
} from 'react-native';
import { useEffect, useRef, useCallback, memo } from 'react';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import SvgIcon from '../../components/SvgIcon';
import { useTheme } from '../../context/ThemeContext';
import { useYoutubeLive } from '../../hooks/useYoutubeLive';
import { useBookingNotif } from '../../context/BookingNotifContext';

const PEEK_AMOUNT = 60;

const VISIBLE_TABS = [
  { name: 'home',  route: '/home',  title: 'Hem',       icon: 'home'    as const },
  { name: 'index', route: '/',      title: 'Bönetider', icon: 'prayer'  as const },
  { name: 'qibla', route: '/qibla', title: 'Qibla',     icon: 'compass' as const },
  { name: 'quran', route: '/quran', title: 'Koranen',   icon: 'quran'   as const },
  { name: 'dhikr', route: '/dhikr', title: 'Dhikr',     icon: 'dhikr'   as const },
  { name: 'more',  route: '/more',  title: 'Visa mer',  icon: 'more'    as const },
];

// ── Memoized tab item ────────────────────────────────────────────────────────
// Extracted so each item owns its own animation state and React.memo can
// short-circuit re-renders for tabs whose props haven't changed.

type TabDef = (typeof VISIBLE_TABS)[0];

type CustomTabItemProps = {
  tab: TabDef;
  active: boolean;
  onTabPress: (name: string, route: string) => void;
  isDark: boolean;
  accent: string;
  textMuted: string;
  accentGlow: string;
  borderStrong: string;
  isLive?: boolean;
  bookingUnread?: number;
};

const CustomTabItem = memo(function CustomTabItem({
  tab,
  active,
  onTabPress,
  isDark,
  accent,
  textMuted,
  accentGlow,
  borderStrong,
  isLive = false,
  bookingUnread = 0,
}: CustomTabItemProps) {

  // Stable press callback — tab and onTabPress are both stable references,
  // so this function is created once per tab item lifetime.
  const onPress = useCallback(() => {
    onTabPress(tab.name, tab.route);
  }, [onTabPress, tab.name, tab.route]);

  // Live dot pulse (only meaningful for the home tab)
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
  }, [isLive, pulseAnim]);

  // Icon scale: 1.04 when active, 1.0 otherwise.
  // useNativeDriver: true — runs entirely on the UI thread, zero JS overhead.
  const scaleAnim = useRef(new Animated.Value(active ? 1.04 : 1.0)).current;
  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: active ? 1.04 : 1.0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 200,
      mass: 0.8,
    }).start();
  }, [active, scaleAnim]);

  const dotBorderColor = isDark ? '#141414' : '#ffffff';
  const badgeDim    = bookingUnread > 9 ? 16 : 14;
  const badgeRadius = bookingUnread > 9 ? 8  : 7;

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.tabItem}
      activeOpacity={0.7}
    >
      {/* Static glass pill — no movement, no blur, no shadow */}
      {active && (
        <View style={[
          styles.activePill,
          { backgroundColor: accentGlow, borderColor: borderStrong },
        ]} />
      )}

      {/* Icon — scaled via native-driver transform only */}
      <Animated.View style={[styles.iconContainer, { transform: [{ scale: scaleAnim }] }]}>
        <SvgIcon name={tab.icon} size={24} color={active ? accent : textMuted} />

        {tab.name === 'home' && isLive && (
          <View style={styles.liveDotContainer}>
            <Animated.View style={[styles.liveDotRing, {
              opacity: pulseAnim.interpolate({ inputRange: [1, 2.2], outputRange: [0.5, 0] }),
              transform: [{ scale: pulseAnim }],
            }]} />
            <View style={[styles.liveDotCore, { borderColor: dotBorderColor }]} />
          </View>
        )}

        {tab.name === 'home' && !isLive && bookingUnread > 0 && (
          <View style={[
            styles.badgeContainer,
            { width: badgeDim, height: badgeDim, borderRadius: badgeRadius, borderColor: dotBorderColor },
          ]}>
            <Text style={styles.badgeText}>
              {bookingUnread > 99 ? '99' : String(bookingUnread)}
            </Text>
          </View>
        )}
      </Animated.View>

      <Text style={[styles.label, { color: active ? accent : textMuted }]} numberOfLines={1}>
        {tab.title}
      </Text>
    </TouchableOpacity>
  );
});

// ── Tab bar ──────────────────────────────────────────────────────────────────

function CustomTabBar() {
  const { theme: T, isDark } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const { isLive } = useYoutubeLive();
  const { totalUnread: bookingUnread } = useBookingNotif();

  // Ref mirrors pathname so handleTabPress can read the current value
  // without closing over it — keeps the callback stable across navigations.
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  const scrollRef    = useRef<ScrollView>(null);
  const userHasTouched = useRef(false);
  const lastNavTime  = useRef(0);

  // Peek nudge on cold start (JS state resets every kill, no AsyncStorage needed)
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

  // Stable press handler — reads pathname from ref, depends only on router
  // (which is a stable reference from expo-router). Never recreated.
  const handleTabPress = useCallback((tabName: string, tabRoute: string) => {
    const currentPath = pathnameRef.current;

    const isTabActive = tabName === 'index'
      ? currentPath === '/' || currentPath === '/index'
      : currentPath === `/${tabName}`;
    if (isTabActive) return;

    const now = Date.now();
    if (now - lastNavTime.current < 600) return;
    lastNavTime.current = now;

    const fromIndex = VISIBLE_TABS.findIndex(t => {
      if (t.name === 'index') return currentPath === '/' || currentPath === '/index';
      return currentPath === `/${t.name}`;
    });
    const toIndex = VISIBLE_TABS.findIndex(t => t.name === tabName);
    const dir = toIndex < fromIndex ? 'left' : 'right';

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.navigate({ pathname: tabRoute as any, params: { _dir: dir } });
  }, [router]);

  function isActive(tabName: string): boolean {
    if (tabName === 'index') return pathname === '/' || pathname === '/index';
    return pathname === `/${tabName}`;
  }

  // Pull only the primitive tokens CustomTabItem needs. Primitives are compared
  // by value in React.memo's shallow check, so stable theme = no re-render.
  const { accent, textMuted, accentGlow, borderStrong } = T;

  // Theme-dependent values that only change on theme toggle, not navigation
  const shadowOpacity = isDark ? 0.4 : 0.12;
  const overlayBg     = isDark ? 'rgba(20,20,20,0.6)' : 'rgba(255,255,255,0.6)';

  return (
    <View style={[styles.tabBarContainer, { shadowOpacity }]}>
      <BlurView
        intensity={isDark ? 60 : 80}
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.tabBarOverlay, { backgroundColor: overlayBg }]} />
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        style={styles.scroll}
        decelerationRate="fast"
        onScrollBeginDrag={() => { userHasTouched.current = true; }}
        onTouchStart={() => { userHasTouched.current = true; }}
      >
        {VISIBLE_TABS.map((tab) => (
          <CustomTabItem
            key={tab.name}
            tab={tab}
            active={isActive(tab.name)}
            onTabPress={handleTabPress}
            isDark={isDark}
            accent={accent}
            textMuted={textMuted}
            accentGlow={accentGlow}
            borderStrong={borderStrong}
            isLive={tab.name === 'home' ? isLive : undefined}
            bookingUnread={tab.name === 'home' ? bookingUnread : undefined}
          />
        ))}
      </ScrollView>
    </View>
  );
}

// ── Static styles ─────────────────────────────────────────────────────────────
// All values that don't depend on runtime theme are extracted here so they
// are registered once with the native style system and never recreated.

const styles = StyleSheet.create({
  // Tab bar wrapper
  tabBarContainer: {
    position: 'absolute', bottom: 30, left: 16, right: 16,
    height: 85, borderRadius: 36, overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
  },
  tabBarOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 4, alignItems: 'center', height: 85,
  },
  // Tab item
  tabItem: {
    width: 72, height: 85,
    alignItems: 'center', justifyContent: 'center',
    paddingTop: 10, paddingBottom: 10,
  },
  activePill: {
    position: 'absolute', top: 10, left: 6, right: 6, bottom: 10,
    borderRadius: 18, borderWidth: 1,
  },
  iconContainer: {
    width: 24, height: 24,
  },
  label: {
    fontSize: 10, fontWeight: '500', marginTop: 3,
  },
  // Live dot
  liveDotContainer: {
    position: 'absolute', top: -2, right: -2, width: 10, height: 10,
  },
  liveDotRing: {
    position: 'absolute',
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#FF3B30',
  },
  liveDotCore: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#FF3B30', borderWidth: 1.5,
  },
  // Booking badge
  badgeContainer: {
    position: 'absolute', top: -2, right: -2,
    backgroundColor: '#FF3B30', borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: {
    color: '#fff', fontSize: 8, fontWeight: '700', lineHeight: 10,
  },
});

// ── Layout ────────────────────────────────────────────────────────────────────

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
