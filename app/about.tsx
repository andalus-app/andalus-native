import { View, Text, ScrollView, TouchableOpacity, Image, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BackButton from '../components/BackButton';
import { useTheme } from '../context/ThemeContext';

const SECTIONS = [
  {
    title: 'Om oss',
    body: 'Islam.nu har varit verksamma snart två årtionden med att sprida kunskap inom islam baserat på klassiskt sunnitisk troslära och de fyra erkända rättskolorna. Islam.nu drivs av sakkunniga experter med högskoleutbildning inom islamisk teologi och rättslära. En mycket stor del i vårt arbete är hemsidan www.islam.nu och dess tillhörande sociala medier.',
  },
  {
    title: 'Vårt arbete',
    body: 'Vi arbetar främst med att informera om och lära ut islam på olika plattformar till muslimer och icke-muslimer över hela Sverige. Vi arbetar med sociala insatser och arbetar mot utanförskap, kriminalitet och all form av extremism.\n\nVi arbetar främst i Stockholmsområdet men reser även regelbundet till många andra städer för att undervisa, ge råd och stötta olika lokala moskéer. Även lokalpoliser, fältassistenter, kommuner, fritidsgårdar, gymnasier och högskolor har bjudit in oss att föreläsa eller ta del av vår expertis och erfarenhet i dessa frågor.',
  },
  {
    title: 'Helt fristående och oberoende',
    body: 'Vi har valt att arbeta helt ideellt av många anledningar. Vi tar inte stöd från varken den svenska staten eller någon annan stat och har aldrig gjort det. Inte för att det är fel i sig, utan för att vi värnar om vår integritet, självständighet och absoluta oberoende. Vill någon inom ramen för dessa premisser stödja oss är de mer än varmt välkomna. Vi är helt politiskt obundna och kommer alltid vara det.',
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
        <Text style={[styles.headerTitle, { color: T.text }]}>Om oss</Text>
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

          {/* Website button */}
          <TouchableOpacity
            style={[styles.websiteBtn, { backgroundColor: T.accent }]}
            onPress={() => Linking.openURL('https://www.islam.nu')}
            activeOpacity={0.8}
          >
            <Text style={styles.websiteBtnText}>Besök islam.nu</Text>
          </TouchableOpacity>
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
  websiteBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    borderRadius: 14,
    marginTop: 4,
  },
  websiteBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
