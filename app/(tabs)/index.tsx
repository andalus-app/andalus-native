import { View, Text, StyleSheet, useColorScheme, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useState, useEffect } from 'react';
import * as Location from 'expo-location';
import { Coordinates, CalculationMethod, PrayerTimes } from 'adhan';

const PRAYERS = [
  { key: 'fajr', name: 'Fajr' },
  { key: 'sunrise', name: 'Soluppgång' },
  { key: 'dhuhr', name: 'Dhuhr' },
  { key: 'asr', name: 'Asr' },
  { key: 'maghrib', name: 'Maghrib' },
  { key: 'isha', name: 'Isha' },
];

function formatTime(date: Date) {
  return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

export default function PrayerTimesScreen() {
  const isDark = useColorScheme() === 'dark';
  const s = styles(isDark);
  const [times, setTimes] = useState<any>(null);
  const [nextPrayer, setNextPrayer] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { loadPrayerTimes(); }, []);

  async function loadPrayerTimes() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setError('Platsbehörighet nekad'); setLoading(false); return; }
      const loc = await Location.getCurrentPositionAsync({});
      const coords = new Coordinates(loc.coords.latitude, loc.coords.longitude);
      const params = CalculationMethod.MuslimWorldLeague();
      const pt = new PrayerTimes(coords, new Date(), params);
      setTimes(pt);
      setNextPrayer(pt.nextPrayer());
    } catch (e) {
      setError('Kunde inte hämta bönetider');
    }
    setLoading(false);
  }

  if (loading) return <View style={s.container}><ActivityIndicator size="large" color="#4CAF50" /></View>;
  if (error) return <View style={s.container}><Text style={s.error}>{error}</Text></View>;

  const today = new Date().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <View style={s.container}>
      <Text style={s.date}>{today}</Text>
      <Text style={s.title}>Bönetider</Text>
      <View style={s.card}>
        {PRAYERS.map(p => {
          const isNext = p.key === nextPrayer;
          return (
            <View key={p.key} style={[s.row, isNext && s.rowActive]}>
              <Text style={[s.prayerName, isNext && s.activeText]}>{p.name}</Text>
              <Text style={[s.prayerTime, isNext && s.activeText]}>{formatTime(times[p.key])}</Text>
              {isNext && <View style={s.dot} />}
            </View>
          );
        })}
      </View>
      <TouchableOpacity style={s.refresh} onPress={loadPrayerTimes}>
        <Text style={s.refreshText}>Uppdatera</Text>
      </TouchableOpacity>
    </View>
  );
}

function styles(isDark: boolean) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: isDark ? '#0d0d0d' : '#f0f0f0', alignItems: 'center', justifyContent: 'center', padding: 20 },
    date: { fontSize: 14, color: isDark ? '#888' : '#666', marginBottom: 4, textTransform: 'capitalize' },
    title: { fontSize: 32, fontWeight: 'bold', color: isDark ? '#fff' : '#111', marginBottom: 24 },
    card: { width: '100%', backgroundColor: isDark ? '#1a1a1a' : '#fff', borderRadius: 16, padding: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10 },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 10 },
    rowActive: { backgroundColor: '#4CAF50' },
    prayerName: { flex: 1, fontSize: 17, color: isDark ? '#ddd' : '#333' },
    prayerTime: { fontSize: 17, fontWeight: '600', color: isDark ? '#fff' : '#111' },
    activeText: { color: '#fff', fontWeight: 'bold' },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff', marginLeft: 8 },
    error: { color: 'red', fontSize: 16 },
    refresh: { marginTop: 20, padding: 12, backgroundColor: '#4CAF50', borderRadius: 10 },
    refreshText: { color: '#fff', fontWeight: '600' },
  });
}
