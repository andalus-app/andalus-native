/**
 * MasjidPermissionGate — shown when location access is not granted.
 *
 * No map and no GPS run behind this view. The button either shows the system
 * location prompt (first time) or opens the app's Settings (if previously
 * denied); the screen re-checks permission on return and mounts the map once
 * access is granted. See hooks/useMasjidLocation.ts.
 */
import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useTheme } from '../../context/ThemeContext';
import { masjidIconXml } from '../../constants/masjidIcon';

export default function MasjidPermissionGate({
  requesting,
  onRequest,
}: {
  requesting: boolean;
  onRequest: () => void;
}) {
  const { theme: T } = useTheme();

  return (
    <View style={[styles.wrap, { backgroundColor: T.bg }]}>
      <View style={[styles.iconCircle, { backgroundColor: T.accentGlow }]}>
        <SvgXml xml={masjidIconXml(T.accent)} width={44} height={44} />
      </View>

      <Text style={[styles.title, { color: T.text }]}>Platsåtkomst krävs</Text>

      <Text style={[styles.body, { color: T.textMuted }]}>
        För att kunna visa närmaste moské behöver Hidayah åtkomst till din plats.
      </Text>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: T.accent }]}
        onPress={onRequest}
        disabled={requesting}
        activeOpacity={0.85}
      >
        {requesting
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.buttonText}>Tillåt åtkomst till platsinfo</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  iconCircle: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 32 },
  button: { borderRadius: 14, paddingVertical: 16, paddingHorizontal: 28, minWidth: 240, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
