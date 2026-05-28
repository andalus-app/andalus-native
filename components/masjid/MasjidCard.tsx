/**
 * MasjidCard — compact card shown above the map when a masjid is selected
 * (via marker tap or list item). Shows only approved data; the data layer
 * already filters to approved mosques and approved images.
 */
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import type { Mosque } from '../../services/mosques';
import { formatDistance, formatOpeningHours } from './format';

export default function MasjidCard({
  mosque,
  onClose,
  onDirections,
}: {
  mosque: Mosque;
  onClose: () => void;
  onDirections: () => void;
}) {
  const { theme: T } = useTheme();
  const { height } = useWindowDimensions();
  const hours = formatOpeningHours(mosque.opening_hours);
  const addressLine = [mosque.address, [mosque.postal_code, mosque.city].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');

  // Cap height so the card fits on small screens without covering everything.
  const maxCardHeight = Math.min(440, Math.round(height * 0.58));

  return (
    <View style={[styles.card, { backgroundColor: T.cardElevated, borderColor: T.border, maxHeight: maxCardHeight }]}>
      <TouchableOpacity
        style={[styles.close, { backgroundColor: T.card }]}
        onPress={onClose}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Ionicons name="close" size={20} color={T.text} />
      </TouchableOpacity>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 4 }}>
        {!!mosque.image_url && (
          <Image
            source={{ uri: mosque.image_url }}
            style={styles.image}
            contentFit="cover"
            transition={150}
          />
        )}

        <Text style={[styles.name, { color: T.text }]}>{mosque.name}</Text>

        {!!addressLine && <Text style={[styles.address, { color: T.textMuted }]}>{addressLine}</Text>}

        <View style={styles.chips}>
          <View style={[styles.chip, { backgroundColor: T.accentGlow }]}>
            <Ionicons name="navigate" size={13} color={T.accent} />
            <Text style={[styles.chipText, { color: T.accent }]}>{formatDistance(mosque.distance_meters)}</Text>
          </View>
          {mosque.parking_available != null && (
            <View style={[styles.chip, { backgroundColor: T.cardElevated }]}>
              <Ionicons name="car" size={13} color={T.textMuted} />
              <Text style={[styles.chipText, { color: T.textMuted }]}>
                Parkering: {mosque.parking_available ? 'Ja' : 'Nej'}
              </Text>
            </View>
          )}
        </View>

        {hours.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: T.text }]}>Öppettider</Text>
            {hours.map((line, i) => (
              <Text key={i} style={[styles.sectionText, { color: T.textMuted }]}>{line}</Text>
            ))}
          </View>
        )}

        {!!mosque.access_info && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: T.text }]}>Information</Text>
            <Text style={[styles.sectionText, { color: T.textMuted, flex: 1 }]}>{mosque.access_info}</Text>
          </View>
        )}
      </ScrollView>

      <TouchableOpacity style={[styles.button, { backgroundColor: T.accent }]} onPress={onDirections} activeOpacity={0.85}>
        <Ionicons name="navigate-outline" size={18} color="#fff" />
        <Text style={styles.buttonText}>Vägbeskrivning</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24, padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOpacity: 0.32, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 16,
  },
  close: {
    position: 'absolute', top: 10, right: 10, zIndex: 2,
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  image: { width: '100%', height: 140, borderRadius: 12, marginBottom: 12 },
  name: { fontSize: 18, fontWeight: '700', paddingRight: 28 },
  address: { fontSize: 14, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10 },
  chipText: { fontSize: 13, fontWeight: '600' },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  sectionText: { fontSize: 14, lineHeight: 20 },
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 14, marginTop: 16,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
