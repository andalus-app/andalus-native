import { View, Text, TouchableOpacity, SectionList, Animated, StyleSheet } from 'react-native';
import { useRef, useCallback } from 'react';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SvgIcon from '../../components/SvgIcon';
import { useTheme } from '../../context/ThemeContext';

// ── Data ──────────────────────────────────────────────────────────────────────

type IconName = 'allahs-namn' | 'ruqyah' | 'zakat' | 'calendar' | 'book' | 'heart' | 'info' | 'umrah' | 'quiz';

type Row = {
  key:   string;
  title: string;
  icon:  IconName;
  route: string;
};

type Section = {
  title: string;
  data:  Row[];
};

const SECTIONS: Section[] = [
  {
    title: 'Andligt',
    data: [
      { key: 'asmaul',  title: 'Allahs namn',      icon: 'allahs-namn', route: '/asmaul'  },
      { key: 'umrah',   title: 'Umrah Guide',       icon: 'umrah',       route: '/umrah'   },
      { key: 'ruqyah',  title: 'Ruqyah',           icon: 'ruqyah',      route: '/ruqyah'  },
    ],
  },
  {
    title: 'Verktyg',
    data: [
      { key: 'zakat',   title: 'Zakat kalkylator', icon: 'zakat',       route: '/zakat'   },
      { key: 'booking', title: 'Boka lokal',        icon: 'calendar',    route: '/booking' },
    ],
  },
  {
    title: 'Innehåll',
    data: [
      { key: 'ebooks',  title: 'E-böcker',           icon: 'book',        route: '/ebooks'  },
      { key: 'quiz',    title: 'Frågesport',          icon: 'quiz',        route: '/quiz'    },
    ],
  },
  {
    title: 'Övrigt',
    data: [
      { key: 'support', title: 'Stöd oss',          icon: 'heart',       route: '/support' },
      { key: 'about',   title: 'Om oss',            icon: 'info',        route: '/about'   },
    ],
  },
];

// ── Design tokens ─────────────────────────────────────────────────────────────

type Colors = {
  text:         string;
  icon:         string;
  sectionTitle: string;
  rowBg:        string;
  iconBg:       string;
  border:       string;
  chevron:      string;
  separator:    string;
};

function getColors(isDark: boolean): Colors {
  return isDark ? {
    text:         'rgba(255,255,255,0.92)',
    icon:         'rgba(255,255,255,0.84)',
    sectionTitle: 'rgba(255,255,255,0.55)',
    rowBg:        'rgba(255,255,255,0.03)',
    iconBg:       'rgba(255,255,255,0.06)',
    border:       'rgba(255,255,255,0.08)',
    chevron:      'rgba(255,255,255,0.30)',
    separator:    'rgba(255,255,255,0.06)',
  } : {
    text:         'rgba(0,0,0,0.88)',
    icon:         'rgba(0,0,0,0.70)',
    sectionTitle: 'rgba(0,0,0,0.45)',
    rowBg:        'rgba(255,255,255,1)',
    iconBg:       'rgba(0,0,0,0.05)',
    border:       'rgba(0,0,0,0.08)',
    chevron:      'rgba(0,0,0,0.25)',
    separator:    'rgba(0,0,0,0.06)',
  };
}

// ── Animated row ─────────────────────────────────────────────────────────────

function ListRow({
  item,
  isFirst,
  isLast,
  onPress,
  C,
}: {
  item:    Row;
  isFirst: boolean;
  isLast:  boolean;
  onPress: (route: string) => void;
  C:       Colors;
}) {
  const scale   = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.parallel([
      Animated.timing(scale,   { toValue: 0.97, duration: 120, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.60, duration: 120, useNativeDriver: true }),
    ]).start();
  }, [scale, opacity]);

  const handlePressOut = useCallback(() => {
    Animated.parallel([
      Animated.timing(scale,   { toValue: 1,    duration: 160, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1,    duration: 160, useNativeDriver: true }),
    ]).start();
  }, [scale, opacity]);

  const borderRadius = {
    borderTopLeftRadius:     isFirst ? 14 : 0,
    borderTopRightRadius:    isFirst ? 14 : 0,
    borderBottomLeftRadius:  isLast  ? 14 : 0,
    borderBottomRightRadius: isLast  ? 14 : 0,
  };

  return (
    <Animated.View style={{ transform: [{ scale }], opacity }}>
      <TouchableOpacity
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress(item.route);
        }}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        style={[
          styles.row,
          borderRadius,
          { backgroundColor: C.rowBg, borderColor: C.border },
        ]}
      >
        {/* Icon container */}
        <View style={[styles.iconWrap, { backgroundColor: C.iconBg }]}>
          <SvgIcon name={item.icon} size={20} color={C.icon} />
        </View>

        {/* Title */}
        <Text style={[styles.rowTitle, { color: C.text }]} numberOfLines={1}>
          {item.title}
        </Text>

        {/* Chevron */}
        <Text style={[styles.chevron, { color: C.chevron }]}>›</Text>
      </TouchableOpacity>

      {/* Inner separator — hide after last row */}
      {!isLast && (
        <View style={[styles.separator, { backgroundColor: C.separator }]} />
      )}
    </Animated.View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MoreScreen() {
  const { theme: T, isDark } = useTheme();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const C       = getColors(isDark);

  const handlePress = useCallback((route: string) => {
    router.push(route as any);
  }, [router]);

  return (
    <View style={[styles.root, { backgroundColor: T.bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[styles.headerTitle, { color: T.text }]}>Mer</Text>
        <TouchableOpacity
          onPress={() => router.push('/settings' as any)}
          style={[styles.settingsBtn, { backgroundColor: C.rowBg, borderColor: C.border }]}
          activeOpacity={0.7}
        >
          <SvgIcon name="settings" size={19} color={C.icon} />
        </TouchableOpacity>
      </View>

      {/* Section list */}
      <SectionList
        sections={SECTIONS}
        keyExtractor={item => item.key}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionTitle, { color: C.sectionTitle }]}>
            {section.title}
          </Text>
        )}
        renderSectionFooter={() => <View style={{ height: 24 }} />}
        renderItem={({ item, index, section }) => {
          const isFirst = index === 0;
          const isLast  = index === section.data.length - 1;
          return (
            <ListRow
              item={item}
              isFirst={isFirst}
              isLast={isLast}
              onPress={handlePress}
              C={C}
            />
          );
        }}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  settingsBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },

  // Section headers
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginLeft: 4,
  },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 0,
    paddingHorizontal: 14,
    height: 58,
    borderWidth: 0.5,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  chevron: {
    fontSize: 22,
    lineHeight: 26,
    marginLeft: 4,
  },

  // Row separator
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 60,
  },
});
