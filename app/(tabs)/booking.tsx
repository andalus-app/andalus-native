import { View, Text, StyleSheet, useColorScheme, FlatList, TouchableOpacity, Modal, TextInput, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { uid } from '../../lib/uuid';

const HOURS = Array.from({ length: 17 }, (_, i) => String(i + 8).padStart(2, '0'));
const MINUTES = ['00', '30'];

export default function BookingScreen() {
  const isDark = useColorScheme() === 'dark';
  const s = styles(isDark);
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [activity, setActivity] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startH, setStartH] = useState('08');
  const [startM, setStartM] = useState('00');
  const [endH, setEndH] = useState('09');
  const [endM, setEndM] = useState('00');
  const [notes, setNotes] = useState('');

  useEffect(() => { fetchBookings(); }, []);

  async function fetchBookings() {
    const { data } = await supabase.from('bookings').select('*').order('created_at', { ascending: false }).limit(20);
    if (data) setBookings(data);
    setLoading(false);
  }

  async function submitBooking() {
    if (!name || !phone || !startDate || !activity) {
      Alert.alert('Fel', 'Fyll i namn, telefon, datum och syfte');
      return;
    }
    const timeSlot = `${startH}:${startM}–${endH}:${endM}`;
    const startDecimal = parseInt(startH) + parseInt(startM) / 60;
    const endDecimal = parseInt(endH) + parseInt(endM) / 60;
    const duration = endDecimal - startDecimal;
    if (duration <= 0) { Alert.alert('Fel', 'Sluttid måste vara efter starttid'); return; }

    setSubmitting(true);
    const { error } = await supabase.from('bookings').insert({
      id: uid(),
      name, phone, activity,
      time_slot: timeSlot,
      duration_hours: duration,
      start_date: startDate,
      status: 'pending',
      notes,
      recurrence: 'none',
      created_at: Date.now(),
    });
    setSubmitting(false);
    if (error) { Alert.alert('Fel', error.message); return; }
    Alert.alert('✓ Bokningsförfrågan skickad!', 'Vi återkommer till dig.');
    setShowForm(false);
    setName(''); setPhone(''); setActivity(''); setStartDate(''); setNotes('');
    fetchBookings();
  }

  const statusColor = (s: string) => s === 'approved' ? '#4CAF50' : s === 'cancelled' ? '#f44336' : '#FF9800';
  const statusText = (s: string) => s === 'approved' ? 'Godkänd' : s === 'cancelled' ? 'Avbokad' : 'Väntar';

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>Lokalbokningar</Text>
        <TouchableOpacity style={s.addBtn} onPress={() => setShowForm(true)}>
          <Text style={s.addBtnText}>+ Boka</Text>
        </TouchableOpacity>
      </View>

      {loading ? <ActivityIndicator color="#4CAF50" style={{ marginTop: 40 }} /> : (
        <FlatList
          data={bookings}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingBottom: 20 }}
          renderItem={({ item }) => (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.cardName}>{item.name}</Text>
                <View style={[s.statusBadge, { backgroundColor: statusColor(item.status) + '22' }]}>
                  <Text style={[s.statusText, { color: statusColor(item.status) }]}>{statusText(item.status)}</Text>
                </View>
              </View>
              <Text style={s.cardDetail}>📍 {item.activity}</Text>
              <Text style={s.cardDetail}>📅 {item.start_date} kl {item.time_slot}</Text>
              {item.notes ? <Text style={s.cardDetail}>📝 {item.notes}</Text> : null}
            </View>
          )}
        />
      )}

      <Modal visible={showForm} animationType="slide" onRequestClose={() => setShowForm(false)}>
        <ScrollView style={s.modal} contentContainerStyle={{ paddingBottom: 60 }}>
          <Text style={s.modalTitle}>Ny bokning</Text>

          <Text style={s.label}>Namn *</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Ditt namn" placeholderTextColor={isDark ? '#555' : '#aaa'} />

          <Text style={s.label}>Telefon *</Text>
          <TextInput style={s.input} value={phone} onChangeText={setPhone} placeholder="07XXXXXXXX" placeholderTextColor={isDark ? '#555' : '#aaa'} keyboardType="phone-pad" />

          <Text style={s.label}>Syfte/Aktivitet *</Text>
          <TextInput style={s.input} value={activity} onChangeText={setActivity} placeholder="T.ex. Koranskola, Möte..." placeholderTextColor={isDark ? '#555' : '#aaa'} />

          <Text style={s.label}>Datum * (ÅÅÅÅ-MM-DD)</Text>
          <TextInput style={s.input} value={startDate} onChangeText={setStartDate} placeholder="2026-04-01" placeholderTextColor={isDark ? '#555' : '#aaa'} />

          <Text style={s.label}>Starttid</Text>
          <View style={s.timeRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.timePicker}>
              {HOURS.map(h => (
                <TouchableOpacity key={h} style={[s.timeChip, startH === h && s.timeChipActive]} onPress={() => setStartH(h)}>
                  <Text style={[s.timeChipText, startH === h && s.timeChipTextActive]}>{h}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={s.minutePicker}>
              {MINUTES.map(m => (
                <TouchableOpacity key={m} style={[s.timeChip, startM === m && s.timeChipActive]} onPress={() => setStartM(m)}>
                  <Text style={[s.timeChipText, startM === m && s.timeChipTextActive]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <Text style={s.label}>Sluttid</Text>
          <View style={s.timeRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.timePicker}>
              {HOURS.map(h => (
                <TouchableOpacity key={h} style={[s.timeChip, endH === h && s.timeChipActive]} onPress={() => setEndH(h)}>
                  <Text style={[s.timeChipText, endH === h && s.timeChipTextActive]}>{h}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={s.minutePicker}>
              {MINUTES.map(m => (
                <TouchableOpacity key={m} style={[s.timeChip, endM === m && s.timeChipActive]} onPress={() => setEndM(m)}>
                  <Text style={[s.timeChipText, endM === m && s.timeChipTextActive]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <Text style={s.timePreview}>Tid: {startH}:{startM}–{endH}:{endM}</Text>

          <Text style={s.label}>Anteckningar</Text>
          <TextInput style={[s.input, { height: 80 }]} value={notes} onChangeText={setNotes} placeholder="Valfritt..." placeholderTextColor={isDark ? '#555' : '#aaa'} multiline />

          <TouchableOpacity style={s.submitBtn} onPress={submitBooking} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>Skicka bokningsförfrågan</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={s.cancelBtn} onPress={() => setShowForm(false)}>
            <Text style={s.cancelBtnText}>Avbryt</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>
    </View>
  );
}

function styles(isDark: boolean) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: isDark ? '#0d0d0d' : '#f0f0f0', paddingTop: 60, paddingHorizontal: 16 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
    title: { fontSize: 28, fontWeight: 'bold', color: isDark ? '#fff' : '#111' },
    addBtn: { backgroundColor: '#4CAF50', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
    addBtnText: { color: '#fff', fontWeight: '600' },
    card: { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderRadius: 12, padding: 16, marginBottom: 10 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    cardName: { fontSize: 16, fontWeight: '600', color: isDark ? '#fff' : '#111' },
    statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    statusText: { fontSize: 12, fontWeight: '600' },
    cardDetail: { fontSize: 14, color: isDark ? '#888' : '#666', marginTop: 4 },
    modal: { flex: 1, backgroundColor: isDark ? '#0d0d0d' : '#fff', padding: 24, paddingTop: 60 },
    modalTitle: { fontSize: 28, fontWeight: 'bold', color: isDark ? '#fff' : '#111', marginBottom: 24 },
    label: { fontSize: 14, color: isDark ? '#888' : '#666', marginBottom: 6, marginTop: 16 },
    input: { backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5', borderRadius: 10, padding: 14, fontSize: 16, color: isDark ? '#fff' : '#111' },
    timeRow: { gap: 8 },
    timePicker: { flexDirection: 'row' },
    minutePicker: { flexDirection: 'row', gap: 8, marginTop: 8 },
    timeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: isDark ? '#1a1a1a' : '#f0f0f0', marginRight: 8 },
    timeChipActive: { backgroundColor: '#4CAF50' },
    timeChipText: { color: isDark ? '#aaa' : '#666', fontSize: 15 },
    timeChipTextActive: { color: '#fff', fontWeight: '600' },
    timePreview: { fontSize: 16, color: '#4CAF50', fontWeight: '600', marginTop: 10 },
    submitBtn: { backgroundColor: '#4CAF50', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
    submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    cancelBtn: { alignItems: 'center', marginTop: 12, padding: 16 },
    cancelBtnText: { color: isDark ? '#888' : '#666', fontSize: 16 },
  });
}
