import {
  View, Text, ScrollView, TouchableOpacity, Image,
  Linking, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Polyline, Line, Text as SvgText } from 'react-native-svg';
import BackButton from '../components/BackButton';
import { useTheme } from '../context/ThemeContext';

// ── External-link arrow icon ──────────────────────────────────────────────────
function ExternalLinkIcon({ color = '#fff', size = 14 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      <Polyline points="15 3 21 3 21 9" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      <Line x1="10" y1="14" x2="21" y2="3" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    </Svg>
  );
}

// ── Bitcoin inline logo ───────────────────────────────────────────────────────
function BitcoinLogo({ textColor }: { textColor: string }) {
  return (
    <Svg width={120} height={32} viewBox="0 0 120 32" fill="none">
      <Circle cx="16" cy="16" r="16" fill="#F7931A"/>
      <Path
        d="M22.5 13.8c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.6-.4-.6 2.6-1.3-.3.6-2.6-1.6-.4-.7 2.7-1.1-.3-2.2-.5-.4 1.7s1.2.3 1.1.3c.6.2.7.6.7.9l-1.7 6.8c-.1.2-.3.5-.8.4l-1.1-.3-.8 1.8 2.1.5 1.1.3-.7 2.7 1.6.4.7-2.7 1.3.3-.7 2.7 1.6.4.7-2.7c2.7.5 4.7.3 5.6-2.1.7-2-.0-3.1-1.5-3.9 1.1-.2 1.9-1 2.1-2.5zm-3.7 5.2c-.5 2-3.9.9-5 .6l.9-3.6c1.1.3 4.6.8 4.1 3zm.5-5.2c-.5 1.8-3.3.9-4.3.6l.8-3.3c.9.2 3.9.7 3.5 2.7z"
        fill="white"
      />
      <SvgText x="38" y="22" fontFamily="system-ui" fontSize="15" fontWeight="700" fill={textColor}>
        bitcoin
      </SvgText>
    </Svg>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────
function Divider({ color }: { color: string }) {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: color, marginHorizontal: 0 }} />;
}

// ── Payment block ─────────────────────────────────────────────────────────────
function PaymentBlock({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ padding: 24, alignItems: 'center', gap: 14 }}>
      {children}
    </View>
  );
}

export default function SupportScreen() {
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
        <Text style={[styles.headerTitle, { color: T.text }]}>Stöd oss</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Intro */}
        <View style={styles.intro}>
          <Text style={[styles.introTitle, { color: T.text }]}>Stöd oss</Text>
          <Text style={[styles.introText, { color: T.textMuted }]}>
            Var med och sprid gott genom att bli månadsgivare eller donera en gåva.
          </Text>
          <Text style={[styles.introSub, { color: T.textMuted }]}>
            Kom ihåg att du belönas för det arbete vi kan utföra tack vare ditt bidrag! Profeten (ﷺ) sade:{' '}
            <Text style={{ fontStyle: 'italic' }}>
              "Den som vägleder till gott får samma belöning som den som utför handlingen"
            </Text>
            . [Muslim]
          </Text>
        </View>

        {/* Payment card */}
        <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
          {/* Label */}
          <View style={{ paddingTop: 14, alignItems: 'center' }}>
            <Text style={[styles.cardLabel, { color: T.textMuted }]}>Ge en gåva</Text>
          </View>

          {/* Bitcoin */}
          <PaymentBlock>
            <BitcoinLogo textColor={isDark ? '#fff' : '#1a1a1a'} />
            <TouchableOpacity
              onPress={() => Linking.openURL('bitcoin:bc1qe62zvm59cltlkqjekz4vz9nueh7hq3ejxcsktk')}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <View style={{ width: 13 }} />
              <Text style={[styles.btcAddress, { color: T.accent, textAlign: 'center', flex: 1 }]}>
                bc1qe62zvm59cltlkqjekz4vz9nueh7hq3ejxcsktk
              </Text>
              <ExternalLinkIcon color={T.accent} size={13} />
            </TouchableOpacity>
          </PaymentBlock>

          <Divider color={T.border} />

          {/* Swish */}
          <PaymentBlock>
            <Image
              source={require('../assets/images/swish-logo.png')}
              style={styles.swishLogo}
              resizeMode="contain"
            />
            <TouchableOpacity
              onPress={() => Linking.openURL('https://app.swish.nu/1/p/sw/?sw=1236433940&msg=&src=qr')}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <View style={{ width: 15 }} />
              <Text style={[styles.paymentNumber, { color: T.accent, textDecorationLine: 'underline', textAlign: 'center', flex: 1 }]}>123 643 39 40</Text>
              <ExternalLinkIcon color={T.accent} size={15} />
            </TouchableOpacity>
          </PaymentBlock>

          <Divider color={T.border} />

          {/* Bankgiro */}
          <PaymentBlock>
            <Image
              source={require('../assets/images/bankgirot-logo.png')}
              style={styles.bgLogo}
              resizeMode="contain"
            />
            <Text style={[styles.paymentNumber, { color: T.text }]}>5323-2344</Text>
          </PaymentBlock>
        </View>

        {/* Månadsgivare CTA */}
        <View style={styles.ctaWrap}>
          <TouchableOpacity
            style={[styles.ctaBtn, { backgroundColor: T.accent }]}
            onPress={() => Linking.openURL('https://islam.nu/stod-oss/')}
            activeOpacity={0.8}
          >
            <Text style={styles.ctaBtnText}>Eller bli månadsgivare</Text>
            <ExternalLinkIcon color="#fff" size={16} />
          </TouchableOpacity>
          <Text style={[styles.ctaHint, { color: T.textMuted }]}>Öppnas i din webbläsare</Text>
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
  intro: {
    padding: 20,
    paddingBottom: 8,
    alignItems: 'center',
  },
  introTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  introText: {
    fontSize: 15,
    lineHeight: 25,
    textAlign: 'center',
    marginBottom: 10,
  },
  introSub: {
    fontSize: 14,
    lineHeight: 24,
    textAlign: 'center',
  },
  card: {
    borderRadius: 18,
    marginHorizontal: 16,
    marginTop: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  btcAddress: {
    fontSize: 12,
    textDecorationLine: 'underline',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  // swish-logo.png: 400×143 → aspect 2.797 → at height 34 → width 95
  swishLogo: {
    width: 95,
    height: 34,
  },
  // bankgirot-logo.png: 494×157 → aspect 3.146 → at height 32 → width 101
  bgLogo: {
    width: 101,
    height: 32,
  },
  paymentNumber: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 1,
  },
  ctaWrap: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 14,
  },
  ctaBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  ctaHint: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: 10,
  },
});
