/**
 * UmrahChecklist — checkable list at the bottom of a step.
 * State is lifted to the parent (UmrahScreen) for persistence.
 */

import React, { memo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { UmrahTheme } from './umrahTheme';

type Props = {
  T:        UmrahTheme;
  items:    string[];
  checked:  boolean[];
  onChange: (index: number, value: boolean) => void;
};

function CheckRow({
  T, text, checked, onToggle,
}: {
  T:        UmrahTheme;
  text:     string;
  checked:  boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.7}
      style={styles.row}
    >
      <View style={[
        styles.checkbox,
        {
          borderColor:     checked ? T.checkActive : T.checkBorder,
          backgroundColor: checked ? T.checkActive : 'transparent',
        },
      ]}>
        {checked && <Text style={styles.checkMark}>✓</Text>}
      </View>
      <Text style={[
        styles.label,
        {
          color:              checked ? T.accent : T.textSecondary,
          textDecorationLine: checked ? 'line-through' : 'none',
          opacity:            checked ? 0.7 : 1,
          fontSize:           Math.round(15 * T.fontScale),
          lineHeight:         Math.round(22 * T.fontScale),
        },
      ]}>
        {text}
      </Text>
    </TouchableOpacity>
  );
}

function UmrahChecklist({ T, items, checked, onChange }: Props) {
  const allDone = checked.every(Boolean) && checked.length > 0;

  const handleToggle = useCallback((index: number) => {
    const next = !checked[index];
    Haptics.impactAsync(next
      ? Haptics.ImpactFeedbackStyle.Medium
      : Haptics.ImpactFeedbackStyle.Light,
    );
    onChange(index, next);
  }, [checked, onChange]);

  return (
    <View style={[
      styles.card,
      {
        backgroundColor: T.card,
        borderColor:     allDone ? T.accentBorder : T.border,
      },
    ]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: T.textMuted, fontSize: Math.round(11 * T.fontScale) }]}>
          Checklista
        </Text>
        {allDone && (
          <View style={[styles.allDoneBadge, { backgroundColor: T.accentSoft, paddingHorizontal: Math.round(8 * T.fontScale), paddingVertical: Math.round(3 * T.fontScale) }]}>
            <Text style={[styles.allDoneText, { color: T.accent, fontSize: Math.round(12 * T.fontScale) }]}>Klar ✓</Text>
          </View>
        )}
      </View>

      {items.map((item, i) => (
        <CheckRow
          key={i}
          T={T}
          text={item}
          checked={checked[i] ?? false}
          onToggle={() => handleToggle(i)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius:  14,
    borderWidth:   0.5,
    padding:       16,
    marginBottom:  12,
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius:  10,
  },
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   12,
  },
  title: {
    fontSize:     11,
    fontWeight:   '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  allDoneBadge: {
    borderRadius: 8,
    // padding set inline with T.fontScale
  },
  allDoneText: {
    fontWeight: '600',
    // fontSize set inline with T.fontScale
  },
  row: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    paddingVertical: 7,
  },
  checkbox: {
    width:          22,
    height:         22,
    borderRadius:   7,
    borderWidth:    1.5,
    alignItems:     'center',
    justifyContent: 'center',
    marginRight:    12,
    marginTop:      1,
    flexShrink:     0,
  },
  checkMark: {
    color:      '#FFFFFF',
    fontSize:   12,
    fontWeight: '700',
    lineHeight: 14,
  },
  label: {
    fontSize:   15,
    lineHeight: 22,
    flex:       1,
  },
});

export default memo(UmrahChecklist);
