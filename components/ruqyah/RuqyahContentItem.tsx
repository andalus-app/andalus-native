import React, { memo } from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import SvgIcon from '../SvgIcon';
import type { RuqyahArticle } from '../../data/ruqyahData';
import {
  RO, RO_DIM, RO_SURFACE, RO_BORDER, RO_CHIP,
  RO_BORDER_FAINT, RO_TEXT, RO_TEXT_SEC, RO_TEXT_MUTED,
} from './ruqyahColors';

type Props = {
  article: RuqyahArticle;
  onPress: () => void;
};

function RuqyahContentItem({ article, onPress }: Props) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.78}
      style={styles.card}
    >
      {/* Top row: category + badges */}
      <View style={styles.topRow}>
        <Text style={styles.category} numberOfLines={1}>
          {article.categoryName}
        </Text>
        <View style={styles.badges}>
          {article.isLecture && (
            <View style={styles.badge}>
              <SvgIcon name="play" size={10} color={RO} />
              <Text style={styles.badgeText}>Föreläsning</Text>
            </View>
          )}
          {article.hasYoutube && !article.isLecture && (
            <View style={styles.badge}>
              <SvgIcon name="play" size={10} color={RO} />
              <Text style={styles.badgeText}>Video</Text>
            </View>
          )}
        </View>
      </View>

      {/* Title */}
      <Text style={styles.title} numberOfLines={2}>
        {article.title}
      </Text>

      {/* Excerpt */}
      {!!article.excerpt && (
        <Text style={styles.excerpt} numberOfLines={2}>
          {article.excerpt}
        </Text>
      )}

      {/* Chips */}
      {article.chips.length > 0 && (
        <View style={styles.chipRow}>
          {article.chips.slice(0, 2).map((c) => (
            <View key={c.slug} style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>{c.label}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: RO_SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: RO_BORDER,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  category: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: RO,
    flex: 1,
    marginRight: 8,
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
    backgroundColor: RO_DIM,
    borderWidth: 1,
    borderColor: RO_BORDER_FAINT,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: RO,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    marginBottom: 5,
    color: RO_TEXT,
  },
  excerpt: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 8,
    color: RO_TEXT_SEC,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  chip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: RO_CHIP,
    borderWidth: 1,
    borderColor: RO_BORDER_FAINT,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    color: RO_TEXT_MUTED,
  },
});

export default memo(RuqyahContentItem);
