import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@/context/ThemeContext';
import GuideCategoryCard from '@/components/guides/GuideCategoryCard';

export default function PrayerGuideScreen() {
  const { theme: T, isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { backgroundColor: T.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Gå tillbaka"
        >
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path
              d="M15 18l-6-6 6-6"
              stroke={T.text}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </TouchableOpacity>

        <View style={styles.headerTextBlock}>
          <Text style={[styles.headerTitle, { color: T.text }]}>
            Bön &amp; Tvagning
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.sectionLabel, { color: T.textMuted }]}>
          Välj en guide
        </Text>

        <GuideCategoryCard
          title="Hur man tvagar sig"
          subtitle="Lär dig wudu steg för steg"
          icon="prayer"
          illustrationKey="wudu_hands"
          onPress={() => router.push('/wudu-guide' as any)}
          accessibilityLabel="Hur man tvagar sig – Lär dig wudu steg för steg"
        />

        <GuideCategoryCard
          title="Hur man ber"
          subtitle="Lär dig bönen steg för steg"
          icon="book"
          illustrationKey="prayer_second_sujud"
          onPress={() => router.push('/prayer-steps' as any)}
          accessibilityLabel="Hur man ber – Lär dig bönen steg för steg"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextBlock: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 2,
  },
});
