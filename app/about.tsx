import { View, Text, ScrollView, TouchableOpacity, Image, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BackButton from '../components/BackButton';
import { useTheme } from '../context/ThemeContext';

const SECTIONS = [
  {
    title: 'Om Hidayah',
    body: 'Hidayah är en app som har utvecklats för att underlätta det dagliga religiösa livet för muslimer i Sverige. Den samlar flera viktiga funktioner på ett och samma ställe, såsom bönetider, dhikr, Allahs 99 namn, Koranen på svenska (översatt av Knut Bernström), en vägledning för Umrah, ruqyah, zakatberäkning, e-böcker samt frågesport.\n\nSyftet med Hidayah är att göra det enklare att söka kunskap, stärka sin tro och praktisera islam i vardagen.\n\nMaterialet för Allahs namn, ruqyah och e-böcker har hämtats från islam.nu. Må Allah belöna islam.nu rikligt för det värdefulla arbete och den kunskap som gjorts tillgänglig.',
  },
];

export default function AboutScreen() {
  const { theme: T, isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      {/* Header */}
      <View style={[styles.header, {
        paddingTop: insets.top + 12,
        borderBottomColor: T.border,
        backgroundColor: T.bg,
      }]}>
        <BackButton onPress={() => router.back()} />
        <Text style={[styles.headerTitle, { color: T.text }]}>Om Hidayah</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Logo hero */}
        <View style={[styles.hero, {
          backgroundColor: isDark ? `${T.accent}18` : `${T.accent}12`,
          borderBottomColor: T.border,
        }]}>
          <Image
            source={require('../assets/images/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={[styles.heroTitle, { color: T.text }]}>Hidayah</Text>
        </View>

        {/* Sections */}
        <View style={styles.sections}>
          {SECTIONS.map((s, i) => (
            <View key={i} style={styles.section}>
              <Text style={[styles.sectionLabel, { color: T.text }]}>{s.title}</Text>
              {s.body.split('\n\n').map((para, j) => (
                <Text key={j} style={[styles.sectionBody, { color: T.textSecondary ?? T.textMuted, marginTop: j > 0 ? 12 : 0 }]}>
                  {para}
                </Text>
              ))}
            </View>
          ))}

          {/* Contact */}
          <View style={[styles.contactRow, { borderTopColor: T.border }]}>
            <Text style={[styles.contactLabel, { color: T.textMuted }]}>
              Vid buggar eller tekniska problem:
            </Text>
            <TouchableOpacity
              onPress={() => Linking.openURL('mailto:fatih.koker@outlook.com')}
              activeOpacity={0.7}
            >
              <Text style={[styles.contactEmail, { color: T.accent }]}>
                fatih.koker@outlook.com
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  hero: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 20,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 14,
    letterSpacing: -0.3,
  },
  heroSub: {
    fontSize: 13,
    marginTop: 4,
  },
  sections: {
    padding: 20,
    gap: 28,
  },
  section: {
    gap: 0,
  },
  sectionLabel: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 10,
  },
  sectionBody: {
    fontSize: 15,
    lineHeight: 26,
  },
  contactRow: {
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  contactLabel: {
    fontSize: 13,
    lineHeight: 20,
  },
  contactEmail: {
    fontSize: 15,
    fontWeight: '600',
  },
});
