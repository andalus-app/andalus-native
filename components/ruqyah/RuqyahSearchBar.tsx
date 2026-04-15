import React, { memo, useRef } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import SvgIcon from '../SvgIcon';
import { RO, RO_SURFACE, RO_BORDER, RO_BORDER_FAINT, RO_TEXT, RO_TEXT_MUTED, RO_TEXT_ON } from './ruqyahColors';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
  placeholder?: string;
};

function RuqyahSearchBar({ value, onChangeText, onClear, placeholder = 'Sök i Ruqyah…' }: Props) {
  const inputRef = useRef<TextInput>(null);
  const hasValue = value.length > 0;

  return (
    <View
      style={[
        styles.container,
        { borderColor: hasValue ? RO_BORDER : RO_BORDER_FAINT },
      ]}
    >
      <SvgIcon name="search" size={17} color={hasValue ? RO : RO_TEXT_MUTED} />
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={RO_TEXT_MUTED}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="never"
      />
      {hasValue && (
        <TouchableOpacity
          onPress={onClear}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
        >
          <View style={styles.clearBtn}>
            <SvgIcon name="close" size={10} color={RO_TEXT_ON} />
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: RO_SURFACE,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
    color: RO_TEXT,
  },
  clearBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: RO,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default memo(RuqyahSearchBar);
