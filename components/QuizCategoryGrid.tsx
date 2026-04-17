import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type QuizCategoryGridItem = {
  id:    string;
  title: string;
  count: number;
};

type Props = {
  items:      QuizCategoryGridItem[];
  selectedId: string | null;
  onSelect:   (id: string) => void;
  T:          any;
  isDark:     boolean;
};

export default function QuizCategoryGrid({ items, selectedId, onSelect, T, isDark }: Props) {
  return (
    <View style={styles.grid}>
      {items.map((item) => {
        const isSelected = item.id === selectedId;
        return (
          <Pressable
            key={item.id}
            onPress={() => onSelect(item.id)}
            android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: isSelected
                  ? T.accent
                  : (isDark ? 'rgba(255,255,255,0.06)' : T.card),
                borderColor: isSelected ? T.accent : T.border,
              },
              isSelected && styles.cardSelected,
              pressed && styles.cardPressed,
            ]}
          >
            <Text
              style={[styles.title, { color: isSelected ? '#fff' : T.text }]}
              numberOfLines={2}
            >
              {item.title}
            </Text>
            <Text
              style={[styles.count, {
                color: isSelected ? 'rgba(255,255,255,0.80)' : T.textMuted,
              }]}
              numberOfLines={1}
            >
              {item.count} frågor
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  card: {
    width: '48.5%',
    minHeight: 82,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: 'center',
    borderWidth: 0.5,
  },
  cardSelected: {
    shadowColor: '#24645d',
    shadowOpacity: 0.30,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  cardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.982 }],
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 5,
    letterSpacing: -0.2,
  },
  count: {
    fontSize: 12,
    fontWeight: '600',
  },
});
