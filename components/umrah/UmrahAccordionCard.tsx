/**
 * UmrahAccordionCard — expandable accordion for supplementary info.
 * Multiple items per card, each independently expandable.
 */

import React, { memo, useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { UmrahTheme } from './umrahTheme';
import type { AccordionSection } from '@/data/umrahGuideData';

type ItemProps = {
  T:        UmrahTheme;
  title:    string;
  body:     string;
  extra?:   string;
  arabic?:  string;
  isLast:   boolean;
};

const AccordionItem = memo(function AccordionItem({ T, title, body, extra, arabic, isLast }: ItemProps) {
  const [open, setOpen]     = useState(false);
  const anim                = useRef(new Animated.Value(0)).current;
  const runningAnim         = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => () => { runningAnim.current?.stop(); }, []);

  const toggle = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const toValue = open ? 0 : 1;
    runningAnim.current?.stop();
    const a = Animated.timing(anim, { toValue, duration: 220, useNativeDriver: false });
    runningAnim.current = a;
    a.start(() => { runningAnim.current = null; });
    setOpen(v => !v);
  }, [open, anim]);

  const bodyOpacity = anim;
  const rotateZ     = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <View>
      <TouchableOpacity
        onPress={toggle}
        activeOpacity={0.7}
        style={styles.header}
      >
        <Text style={[styles.itemTitle, { color: T.text, flex: 1, fontSize: Math.round(15 * T.fontScale), lineHeight: Math.round(21 * T.fontScale) }]}>
          {title}
        </Text>
        <Animated.Text style={[styles.chevron, { color: T.accent, transform: [{ rotateZ }] }]}>
          ›
        </Animated.Text>
      </TouchableOpacity>

      {open && (
        <Animated.View style={{ opacity: bodyOpacity, paddingBottom: 12 }}>
          {arabic ? (
            <Text style={[styles.itemArabic, { color: T.text, fontSize: Math.round(17 * T.fontScale), lineHeight: Math.round(30 * T.fontScale) }]}>
              {arabic}
            </Text>
          ) : null}
          <Text style={[styles.itemBody, arabic ? styles.itemBodyTranslit : null, { color: arabic ? T.dua : T.textSecondary, fontSize: Math.round(14 * T.fontScale), lineHeight: Math.round(22 * T.fontScale) }]}>
            {body}
          </Text>
          {extra ? (
            <Text style={[styles.itemExtra, { color: T.textMuted, fontSize: Math.round(13 * T.fontScale), lineHeight: Math.round(20 * T.fontScale) }]}>
              {extra}
            </Text>
          ) : null}
        </Animated.View>
      )}

      {!isLast && (
        <View style={[styles.divider, { backgroundColor: T.separator }]} />
      )}
    </View>
  );
});

type Props = {
  T:       UmrahTheme;
  section: AccordionSection;
};

function UmrahAccordionCard({ T, section }: Props) {
  return (
    <View style={[
      styles.card,
      {
        backgroundColor: T.card,
        borderColor:     T.border,
        shadowColor:     T.shadow,
      },
    ]}>
      <Text style={[styles.cardTitle, { color: T.textMuted, fontSize: Math.round(11 * T.fontScale) }]}>
        {section.title}
      </Text>
      {section.items.map((item, i) => (
        <AccordionItem
          key={i}
          T={T}
          title={item.title}
          body={item.body}
          extra={item.extra}
          arabic={item.arabic}
          isLast={i === section.items.length - 1}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius:  14,
    borderWidth:   0.5,
    paddingHorizontal: 16,
    paddingTop:    12,
    paddingBottom: 4,
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius:  10,
    marginBottom:  12,
  },
  cardTitle: {
    fontSize:     11,
    fontWeight:   '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingVertical: 12,
  },
  itemTitle: {
    fontSize:   15,
    fontWeight: '500',
    lineHeight: 21,
  },
  chevron: {
    fontSize:  22,
    lineHeight: 22,
    marginLeft: 8,
    transform:  [{ rotate: '90deg' }],
  },
  itemArabic: {
    fontSize:         17,
    textAlign:        'right',
    lineHeight:       26,
    marginBottom:     6,
    writingDirection: 'rtl',
  },
  itemBody: {
    fontSize:   14,
    lineHeight: 22,
    paddingRight: 8,
  },
  itemBodyTranslit: {
    fontStyle:  'italic',
    fontWeight: '500',
    marginBottom: 4,
  },
  itemExtra: {
    fontSize:   14,
    lineHeight: 22,
    marginTop:  6,
  },
  divider: {
    height:      StyleSheet.hairlineWidth,
    marginLeft:  0,
  },
});

export default memo(UmrahAccordionCard);
