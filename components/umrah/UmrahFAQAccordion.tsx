/**
 * UmrahFAQAccordion — expandable FAQ list.
 * Each item is independently expandable with smooth animation.
 */

import React, { memo, useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { UmrahTheme } from './umrahTheme';
import type { FaqItem } from '@/data/umrahGuideData';

type ItemProps = {
  T:      UmrahTheme;
  item:   FaqItem;
  isLast: boolean;
};

const FAQItem = memo(function FAQItem({ T, item, isLast }: ItemProps) {
  const [open, setOpen] = useState(false);
  const anim            = useRef(new Animated.Value(0)).current;
  const runningAnim     = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => () => { runningAnim.current?.stop(); }, []);

  const toggle = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const toValue = open ? 0 : 1;
    runningAnim.current?.stop();
    const a = Animated.timing(anim, { toValue, duration: 200, useNativeDriver: false });
    runningAnim.current = a;
    a.start(() => { runningAnim.current = null; });
    setOpen(v => !v);
  }, [open, anim]);

  const rotateZ = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });

  return (
    <View>
      <TouchableOpacity
        onPress={toggle}
        activeOpacity={0.7}
        style={styles.questionRow}
      >
        <Text style={[styles.question, { color: T.text, flex: 1, fontSize: Math.round(15 * T.fontScale), lineHeight: Math.round(22 * T.fontScale) }]}>
          {item.question}
        </Text>
        <Animated.Text style={[
          styles.chevron,
          { color: T.accent, transform: [{ rotateZ }] },
        ]}>
          ›
        </Animated.Text>
      </TouchableOpacity>

      {open && (
        <Animated.View style={{ opacity: anim, paddingBottom: 14 }}>
          <Text style={[styles.answer, { color: T.textSecondary, fontSize: Math.round(14 * T.fontScale), lineHeight: Math.round(22 * T.fontScale) }]}>
            {item.answer}
          </Text>
        </Animated.View>
      )}

      {!isLast && (
        <View style={[styles.divider, { backgroundColor: T.separator }]} />
      )}
    </View>
  );
});

type Props = {
  T:     UmrahTheme;
  items: FaqItem[];
};

function UmrahFAQAccordion({ T, items }: Props) {
  return (
    <View style={[
      styles.card,
      {
        backgroundColor: T.card,
        borderColor:     T.border,
        shadowColor:     T.shadow,
      },
    ]}>
      {items.map((item, i) => (
        <FAQItem
          key={i}
          T={T}
          item={item}
          isLast={i === items.length - 1}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius:   14,
    borderWidth:    0.5,
    paddingHorizontal: 16,
    paddingTop:     4,
    paddingBottom:  4,
    shadowOffset:   { width: 0, height: 4 },
    shadowOpacity:  0.08,
    shadowRadius:   10,
    marginBottom:   12,
  },
  questionRow: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingVertical: 14,
  },
  question: {
    fontSize:   15,
    fontWeight: '600',
    lineHeight: 22,
  },
  chevron: {
    fontSize:  22,
    lineHeight: 22,
    marginLeft: 8,
    transform:  [{ rotate: '90deg' }],
  },
  answer: {
    fontSize:   14,
    lineHeight: 22,
    paddingRight: 24,
    paddingBottom: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});

export default memo(UmrahFAQAccordion);
