/**
 * MasjidCard — compact card shown above the map when a masjid is selected
 * (via marker tap or list item). Shows only approved data; the data layer
 * already filters to approved mosques and approved images.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, useWindowDimensions, Linking } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SvgXml } from 'react-native-svg';
import { useTheme } from '../../context/ThemeContext';
import type { Mosque } from '../../services/mosques';
import { formatDistance, formatOpeningHours } from './format';
import MasjidWebModal from './MasjidWebModal';
import { masjidIconColor, masjidLabelColor, masjidSubColor } from './colors';
import { wheelchairIconXml, WHEELCHAIR_ICON_COLOR } from '../../constants/wheelchairIcon';

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
  const [prayerWebOpen, setPrayerWebOpen] = useState(false);
  const [accessTipOpen, setAccessTipOpen] = useState(false);
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

        {!!addressLine && <Text style={[styles.address, { color: masjidLabelColor(T) }]}>{addressLine}</Text>}

        <View style={styles.chipsWrap}>
          <View style={styles.chips}>
            {!!formatDistance(mosque.distance_meters) && (
              <View style={[styles.chip, { backgroundColor: T.cardElevated }]}>
                <Ionicons name="navigate" size={13} color={masjidIconColor(T)} />
                <Text style={[styles.chipText, { color: masjidSubColor(T) }]}>{formatDistance(mosque.distance_meters)}</Text>
              </View>
            )}
            {mosque.parking_available != null && (
              <View style={[styles.chip, { backgroundColor: T.cardElevated }]}>
                <Ionicons name="car" size={13} color={masjidLabelColor(T)} />
                <Text style={[styles.chipText, { color: masjidLabelColor(T) }]}>
                  Parkering: {mosque.parking_available ? 'Ja' : 'Nej'}
                </Text>
              </View>
            )}
            {/* Rullstolstillgänglig — bar ikon (ingen bakgrund) precis till höger
                om Parkering. Visas bara när masjiden är markerad som tillgänglig.
                Tryck visar en bubbla med förklaring. Samma ikonstorlek (13) som
                bil-ikonen. */}
            {mosque.wheelchair_accessible === true && (
              <TouchableOpacity
                style={styles.accessBtn}
                onPress={() => setAccessTipOpen(o => !o)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Rullstolstillgänglig ingång"
              >
                <SvgXml xml={wheelchairIconXml(WHEELCHAIR_ICON_COLOR)} width={13} height={13} />
              </TouchableOpacity>
            )}
          </View>

          {accessTipOpen && (
            <>
              <View style={[styles.accessTipCaret, { borderBottomColor: T.card }]} pointerEvents="none" />
              <TouchableOpacity
                style={[styles.accessTip, { backgroundColor: T.card, shadowOpacity: T.isDark ? 0.4 : 0.12 }]}
                onPress={() => setAccessTipOpen(false)}
                activeOpacity={0.9}
              >
                <Text style={[styles.accessTipText, { color: T.text }]} numberOfLines={1}>
                  Rullstolstillgänglig ingång
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Visa bönetider — secondary CTA. Placed directly under the chips so
            it reads as a quick action paired with the headline numbers, while
            the primary "Vägbeskrivning" stays anchored at the bottom. Surface
            tokens flip per theme: T.card on dark (matches MasjidSearchBar),
            T.cardSecondary on light (light grey against the T.cardElevated
            outer card, never stark white). Same height + radius as the primary
            CTA below; only the colour weight signals the hierarchy. */}
        {!!mosque.prayer_times_url && (
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { backgroundColor: T.isDark ? T.card : T.cardSecondary, borderColor: T.border },
            ]}
            onPress={() => setPrayerWebOpen(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Öppna bönetider"
          >
            <Ionicons name="time-outline" size={18} color={T.text} />
            <Text style={[styles.secondaryButtonText, { color: T.text }]}>Visa bönetider</Text>
            <Ionicons name="chevron-forward" size={18} color={T.text} />
          </TouchableOpacity>
        )}

        {hours.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: T.text }]}>Öppettider</Text>
            {hours.map((line, i) => (
              <Text key={i} style={[styles.sectionText, { color: masjidLabelColor(T) }]}>{line}</Text>
            ))}
          </View>
        )}

        {!!mosque.phone && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: T.text }]}>Telefon</Text>
            <TouchableOpacity onPress={() => Linking.openURL(`tel:${mosque.phone!.replace(/\s+/g, '')}`)} activeOpacity={0.7}>
              <Text style={[styles.sectionText, { color: masjidLabelColor(T) }]}>{mosque.phone}</Text>
            </TouchableOpacity>
          </View>
        )}

        {!!mosque.website && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: T.text }]}>Hemsida</Text>
            <TouchableOpacity
              onPress={() => {
                const w = mosque.website!.trim();
                const url = /^https?:\/\//i.test(w) ? w : `https://${w}`;
                Linking.openURL(url).catch(() => {});
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.sectionText, { color: masjidLabelColor(T) }]} numberOfLines={1}>{mosque.website}</Text>
            </TouchableOpacity>
          </View>
        )}

        {!!mosque.access_info && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: T.text }]}>Information</Text>
            <Text style={[styles.sectionText, { color: masjidLabelColor(T), flex: 1 }]}>{mosque.access_info}</Text>
          </View>
        )}
      </ScrollView>

      <TouchableOpacity style={[styles.button, { backgroundColor: T.accent }]} onPress={onDirections} activeOpacity={0.85}>
        <Ionicons name="navigate-outline" size={18} color="#fff" />
        <Text style={styles.buttonText}>Vägbeskrivning</Text>
      </TouchableOpacity>

      <MasjidWebModal
        visible={prayerWebOpen}
        url={mosque.prayer_times_url}
        title={`Bönetider · ${mosque.name}`}
        onClose={() => setPrayerWebOpen(false)}
      />
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
  chipsWrap: { marginTop: 12, position: 'relative' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10 },
  chipText: { fontSize: 13, fontWeight: '600' },
  // Bare wheelchair icon (no chip background) sized to match the car icon.
  accessBtn: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  // Tooltip anchored to the right edge of the chips row (can't overflow the
  // card) just below the chips. zIndex/elevation keep it above later content.
  accessTip: {
    position: 'absolute', top: 40, right: 0, zIndex: 50, elevation: 12,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, maxWidth: '100%',
    shadowColor: '#000', shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  accessTipText: { fontSize: 13, fontWeight: '500' },
  accessTipCaret: {
    position: 'absolute', top: 34, right: 8, zIndex: 51, elevation: 13,
    width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderBottomWidth: 6,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  sectionText: { fontSize: 14, lineHeight: 20 },
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 14, marginTop: 16,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  // Secondary CTA — same height (paddingVertical 14) + radius (14) as the
  // primary "Vägbeskrivning" button above, so the two buttons feel like a
  // matched pair. paddingHorizontal opens up room for the chevron at the
  // right edge (primary CTA centres icon+text, so it doesn't need this).
  secondaryButton: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
  },
  secondaryButtonText: { flex: 1, fontSize: 16, fontWeight: '600' },
});
