/**
 * DirectionsSheet — choose an external maps app for directions.
 *
 * NO Google API calls. We only hand a destination lat/lng to an external app
 * via Linking.openURL:
 *   • Apple Kartor (iOS)        → http://maps.apple.com/?daddr=<lat>,<lng>
 *   • Google Maps               → comgooglemaps:// if installed, else https maps URL
 *   • Systemstandard (Android)  → geo:<lat>,<lng>
 * MapLibre is for display only; turn-by-turn happens in the external app.
 */
import React, { useCallback } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform, Linking } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

export type DirectionsTarget = { lat: number; lng: number; name: string };

export default function DirectionsSheet({
  visible,
  target,
  onClose,
}: {
  visible: boolean;
  target: DirectionsTarget | null;
  onClose: () => void;
}) {
  const { theme: T } = useTheme();

  const openApple = useCallback(() => {
    if (!target) return;
    Linking.openURL(`http://maps.apple.com/?daddr=${target.lat},${target.lng}&dirflg=d`);
    onClose();
  }, [target, onClose]);

  const openGoogle = useCallback(async () => {
    if (!target) return;
    const appUrl = `comgooglemaps://?daddr=${target.lat},${target.lng}&directionsmode=driving`;
    const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`;
    try {
      const canApp = await Linking.canOpenURL(appUrl);
      await Linking.openURL(canApp ? appUrl : webUrl);
    } catch {
      Linking.openURL(webUrl).catch(() => {});
    }
    onClose();
  }, [target, onClose]);

  const openSystem = useCallback(() => {
    if (!target) return;
    const label = encodeURIComponent(target.name || 'Masjid');
    Linking.openURL(`geo:${target.lat},${target.lng}?q=${target.lat},${target.lng}(${label})`);
    onClose();
  }, [target, onClose]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[styles.sheet, { backgroundColor: T.card }]}>
          <Text style={[styles.title, { color: T.text }]}>Vägbeskrivning</Text>

          {Platform.OS === 'ios' && (
            <Row label="Apple Kartor" color={T.text} border={T.separator} onPress={openApple} />
          )}
          <Row label="Google Maps" color={T.text} border={T.separator} onPress={openGoogle} />
          {Platform.OS === 'android' && (
            <Row label="Systemstandard" color={T.text} border={T.separator} onPress={openSystem} />
          )}

          <TouchableOpacity style={[styles.cancel, { backgroundColor: T.cardElevated }]} onPress={onClose}>
            <Text style={[styles.cancelText, { color: T.textMuted }]}>Avbryt</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function Row({ label, color, border, onPress }: { label: string; color: string; border: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.row, { borderBottomColor: border }]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.rowText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end', padding: 16 },
  sheet: { borderRadius: 16, paddingTop: 8, paddingBottom: 8, overflow: 'hidden' },
  title: { fontSize: 14, fontWeight: '600', textAlign: 'center', paddingVertical: 12 },
  row: { paddingVertical: 16, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  rowText: { fontSize: 16, fontWeight: '500' },
  cancel: { marginTop: 8, marginHorizontal: 8, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 16, fontWeight: '600' },
});
