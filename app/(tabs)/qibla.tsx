import { View, Text, StyleSheet, useColorScheme, ActivityIndicator } from 'react-native';
import { useState, useEffect } from 'react';
import * as Location from 'expo-location';
import { Coordinates, Qibla } from 'adhan';

export default function QiblaScreen() {
  const isDark = useColorScheme() === 'dark';
  const s = styles(isDark);
  const [heading, setHeading] = useState(0);
  const [qiblaAngle, setQiblaAngle] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let sub: any;
    async function setup() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { setError('Platsbehörighet nekad'); setLoading(false); return; }
        const loc = await Location.getCurrentPositionAsync({});
        const coords = new Coordinates(loc.coords.latitude, loc.coords.longitude);
        setQiblaAngle(Qibla(coords));
        sub = await Location.watchHeadingAsync(h => {
          setHeading(h.trueHeading ?? h.magHeading);
        });
        setLoading(false);
      } catch (e) {
        setError('Kunde inte beräkna Qibla');
        setLoading(false);
      }
    }
    setup();
    return () => { sub?.remove(); };
  }, []);

  if (loading) return <View style={s.container}><ActivityIndicator size="large" color="#4CAF50" /></View>;
  if (error) return <View style={s.container}><Text style={s.error}>{error}</Text></View>;

  const arrowRotation = qiblaAngle !== null ? qiblaAngle - heading : 0;
  const diff = Math.abs(((arrowRotation % 360) + 360) % 360);
  const isAligned = diff < 10 || diff > 350;

  return (
    <View style={s.container}>
      <Text style={s.title}>Qibla</Text>
      <Text style={s.subtitle}>Riktning mot Mecca</Text>

      <View style={[s.compassRing, isAligned && s.compassAligned]}>
        <View style={{ transform: [{ rotate: `${arrowRotation}deg` }], alignItems: 'center' }}>
          <View style={s.arrowUp} />
          <View style={s.arrowBody} />
        </View>
      </View>

      {isAligned && (
        <View style={s.alignedBadge}>
          <Text style={s.alignedText}>✓ Du är riktad mot Qibla</Text>
        </View>
      )}

      <View style={s.infoCard}>
        <Text style={s.infoLabel}>Qibla-vinkel från norr</Text>
        <Text style={s.infoValue}>{qiblaAngle?.toFixed(1)}°</Text>
        <Text style={s.infoLabel}>Din riktning</Text>
        <Text style={s.infoValue}>{heading.toFixed(1)}°</Text>
      </View>
    </View>
  );
}

function styles(isDark: boolean) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: isDark ? '#0d0d0d' : '#f0f0f0', alignItems: 'center', justifyContent: 'center', padding: 20 },
    title: { fontSize: 32, fontWeight: 'bold', color: isDark ? '#fff' : '#111', marginBottom: 4 },
    subtitle: { fontSize: 15, color: isDark ? '#888' : '#666', marginBottom: 40 },
    compassRing: { width: 220, height: 220, borderRadius: 110, backgroundColor: isDark ? '#1a1a1a' : '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 15, marginBottom: 24, borderWidth: 3, borderColor: isDark ? '#333' : '#ddd' },
    compassAligned: { borderColor: '#4CAF50', shadowColor: '#4CAF50' },
    arrowUp: { width: 0, height: 0, borderLeftWidth: 18, borderRightWidth: 18, borderBottomWidth: 55, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#4CAF50' },
    arrowBody: { width: 8, height: 70, backgroundColor: isDark ? '#444' : '#ccc', borderRadius: 4 },
    alignedBadge: { backgroundColor: '#4CAF50', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginBottom: 24 },
    alignedText: { color: '#fff', fontWeight: '600', fontSize: 14 },
    infoCard: { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderRadius: 16, padding: 20, alignItems: 'center', width: '100%', gap: 4 },
    infoLabel: { fontSize: 13, color: isDark ? '#888' : '#666' },
    infoValue: { fontSize: 28, fontWeight: 'bold', color: '#4CAF50', marginBottom: 8 },
    error: { color: 'red', fontSize: 16 },
  });
}
