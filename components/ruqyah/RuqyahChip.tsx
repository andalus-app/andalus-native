import React, { memo } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { RO, RO_TEXT_ON, RO_CHIP, RO_BORDER, RO_BORDER_FAINT, RO_TEXT } from './ruqyahColors';

type Props = {
  label: string;
  active: boolean;
  onPress: () => void;
};

function RuqyahChip({ label, active, onPress }: Props) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.chip,
        {
          backgroundColor: active ? RO : RO_CHIP,
          borderColor: active ? RO : RO_BORDER_FAINT,
        },
      ]}
    >
      <Text style={[styles.label, { color: active ? RO_TEXT_ON : RO_TEXT }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 22,
    borderWidth: 1,
    marginRight: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});

export default memo(RuqyahChip);
