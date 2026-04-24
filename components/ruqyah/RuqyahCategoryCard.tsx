import React, { memo } from 'react';
import {
  TouchableOpacity,
  View,
  Text,
  StyleSheet,
  Image,
  Dimensions,
} from 'react-native';
import type { RuqyahCategory } from '../../data/ruqyahData';
import { RO, RO_SURFACE, RO_BORDER, RO_TEXT, RO_TEXT_SEC } from './ruqyahColors';

// ── Static metadata ───────────────────────────────────────────────────────────

const CATEGORY_IMAGES: Record<string, ReturnType<typeof require>> = {
  ruqyah: require('../../assets/images/ruqyah/ruqyah_banner.png'),
  jinn:   require('../../assets/images/ruqyah/jinn_banner.png'),
  sihr:   require('../../assets/images/ruqyah/sihr_banner.png'),
  ayn:    require('../../assets/images/ruqyah/ayn_banner.png'),
};

const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  ruqyah: 'Ruqyah',
  ayn:    "'Ayn (Onda Ögat)",
  jinn:   'Jinn',
  sihr:   'Sihr (Magi)',
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  ruqyah:
    "Lär dig om den islamiska metoden för andlig helning genom Koranen och autentiska du'a.",
  ayn:
    'Förstå det onda ögats verkan enligt islamisk tradition. Lär dig att känna igen symtom och skydda dig.',
  jinn:
    'Förstå den islamiska läran om jinn, deras natur och påverkan på människor. Lär dig skyddsmetoder.',
  sihr:
    'Lär dig om islams syn på magi. Upptäck tecken på magi och islamiska metoder för skydd och befrielse.',
};

// ── Layout ────────────────────────────────────────────────────────────────────

const GAP        = 10;
const H_PADDING  = 16; // matches screen paddingHorizontal
const CARD_W     = (Dimensions.get('window').width - H_PADDING * 2 - GAP) / 2;
const IMAGE_H    = Math.round(CARD_W * 0.75); // 3:4 landscape-ish

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  category: RuqyahCategory;
  onPress: () => void;
};

function RuqyahCategoryCard({ category, onPress }: Props) {
  const image       = CATEGORY_IMAGES[category.slug];
  const title       = CATEGORY_DISPLAY_NAMES[category.slug] ?? category.name;
  const description = CATEGORY_DESCRIPTIONS[category.slug] ?? '';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.80}
      style={styles.card}
    >
      {/* Image — top half of card, no overlay */}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Image source={image as any} style={styles.image} resizeMode="cover" />

      {/* Text area */}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.description} numberOfLines={2}>{description}</Text>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.explore}>Utforska</Text>
          <Text style={styles.arrow}>→</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    backgroundColor: RO_SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: RO_BORDER,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 5,
  },
  image: {
    width: CARD_W,
    height: IMAGE_H,
  },
  body: {
    padding: 12,
    paddingBottom: 10,
    gap: 6,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: RO,
    letterSpacing: 0.1,
  },
  description: {
    fontSize: 12,
    lineHeight: 18,
    color: RO_TEXT_SEC,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  explore: {
    fontSize: 13,
    fontWeight: '700',
    color: RO,
  },
  arrow: {
    fontSize: 15,
    color: RO,
    fontWeight: '600',
  },
});

export default memo(RuqyahCategoryCard);
