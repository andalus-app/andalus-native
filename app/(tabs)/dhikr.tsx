import { View, Text, StyleSheet, useColorScheme, FlatList, TouchableOpacity, TextInput, Modal, ScrollView } from 'react-native';
import { useState, useMemo } from 'react';
import dhikrData from '../dhikr.json';

type DhikrPost = {
  titel: string;
  arabisk_text: string;
  translitteration: string;
  svensk_text: string;
  kallhanvisning: string;
  mp3_url: string;
};

type Undersida = { titel: string; dhikr_poster: DhikrPost[] };
type Kategori = { kategori: string; undersidor: Undersida[] };

const allDhikr: (DhikrPost & { kategori: string; undersida: string })[] = [];
(dhikrData as { kategorier: Kategori[] }).kategorier.forEach(k => {
  k.undersidor.forEach(u => {
    u.dhikr_poster.forEach(d => {
      allDhikr.push({ ...d, kategori: k.kategori, undersida: u.titel });
    });
  });
});

const kategorier = (dhikrData as { kategorier: Kategori[] }).kategorier.map(k => k.kategori);

export default function DhikrScreen() {
  const isDark = useColorScheme() === 'dark';
  const s = styles(isDark);
  const [search, setSearch] = useState('');
  const [selectedKat, setSelectedKat] = useState<string | null>(null);
  const [selected, setSelected] = useState<typeof allDhikr[0] | null>(null);

  const filtered = useMemo(() => {
    return allDhikr.filter(d => {
      const matchKat = !selectedKat || d.kategori === selectedKat;
      const matchSearch = !search ||
        d.titel.toLowerCase().includes(search.toLowerCase()) ||
        d.svensk_text.toLowerCase().includes(search.toLowerCase()) ||
        d.translitteration.toLowerCase().includes(search.toLowerCase());
      return matchKat && matchSearch;
    });
  }, [search, selectedKat]);

  return (
    <View style={s.container}>
      <Text style={s.title}>Dhikr</Text>

      <TextInput
        style={s.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Sök dhikr..."
        placeholderTextColor={isDark ? '#555' : '#aaa'}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.katRow} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
        <TouchableOpacity style={[s.katChip, !selectedKat && s.katChipActive]} onPress={() => setSelectedKat(null)}>
          <Text style={[s.katChipText, !selectedKat && s.katChipTextActive]}>Alla</Text>
        </TouchableOpacity>
        {kategorier.map(k => (
          <TouchableOpacity key={k} style={[s.katChip, selectedKat === k && s.katChipActive]} onPress={() => setSelectedKat(k === selectedKat ? null : k)}>
            <Text style={[s.katChipText, selectedKat === k && s.katChipTextActive]}>{k}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={s.count}>{filtered.length} dhikr</Text>

      <FlatList
        data={filtered}
        keyExtractor={(_, i) => i.toString()}
        contentContainerStyle={{ paddingBottom: 100 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.card} onPress={() => setSelected(item)}>
            <Text style={s.cardKat}>{item.kategori}</Text>
            <Text style={s.cardTitel}>{item.titel}</Text>
            {item.arabisk_text ? <Text style={s.cardArabic} numberOfLines={1}>{item.arabisk_text}</Text> : null}
          </TouchableOpacity>
        )}
      />

      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
        <ScrollView style={s.modal} contentContainerStyle={{ paddingBottom: 60 }}>
          <TouchableOpacity style={s.closeBtn} onPress={() => setSelected(null)}>
            <Text style={s.closeBtnText}>✕ Stäng</Text>
          </TouchableOpacity>
          {selected && <>
            <Text style={s.modalKat}>{selected.kategori} • {selected.undersida}</Text>
            <Text style={s.modalTitel}>{selected.titel}</Text>
            {selected.arabisk_text ? <Text style={s.modalArabic}>{selected.arabisk_text}</Text> : null}
            {selected.translitteration ? <Text style={s.modalTranslit}>{selected.translitteration}</Text> : null}
            <Text style={s.modalSwedish}>{selected.svensk_text}</Text>
            {selected.kallhanvisning ? <Text style={s.modalKalla}>Källa: {selected.kallhanvisning}</Text> : null}
          </>}
        </ScrollView>
      </Modal>
    </View>
  );
}

function styles(isDark: boolean) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: isDark ? '#0d0d0d' : '#f0f0f0', paddingTop: 60, paddingHorizontal: 16 },
    title: { fontSize: 32, fontWeight: 'bold', color: isDark ? '#fff' : '#111', marginBottom: 16 },
    search: { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderRadius: 12, padding: 12, fontSize: 16, color: isDark ? '#fff' : '#111', marginBottom: 12 },
    katRow: { marginBottom: 12, flexGrow: 0 },
    katChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: isDark ? '#1a1a1a' : '#fff' },
    katChipActive: { backgroundColor: '#4CAF50' },
    katChipText: { color: isDark ? '#aaa' : '#666', fontSize: 13 },
    katChipTextActive: { color: '#fff', fontWeight: '600' },
    count: { fontSize: 13, color: isDark ? '#555' : '#aaa', marginBottom: 8 },
    card: { backgroundColor: isDark ? '#1a1a1a' : '#fff', borderRadius: 12, padding: 16, marginBottom: 8 },
    cardKat: { fontSize: 11, color: '#4CAF50', fontWeight: '600', marginBottom: 4, textTransform: 'uppercase' },
    cardTitel: { fontSize: 15, color: isDark ? '#fff' : '#111', fontWeight: '500', marginBottom: 4 },
    cardArabic: { fontSize: 16, color: isDark ? '#888' : '#666', textAlign: 'right' },
    modal: { flex: 1, backgroundColor: isDark ? '#0d0d0d' : '#fff', padding: 24 },
    closeBtn: { paddingTop: 40, paddingBottom: 16 },
    closeBtnText: { color: '#4CAF50', fontSize: 16, fontWeight: '600' },
    modalKat: { fontSize: 12, color: '#4CAF50', fontWeight: '600', marginBottom: 8, textTransform: 'uppercase' },
    modalTitel: { fontSize: 22, fontWeight: 'bold', color: isDark ? '#fff' : '#111', marginBottom: 20 },
    modalArabic: { fontSize: 26, color: isDark ? '#fff' : '#111', textAlign: 'right', lineHeight: 44, marginBottom: 16 },
    modalTranslit: { fontSize: 16, color: '#4CAF50', fontStyle: 'italic', marginBottom: 16, lineHeight: 24 },
    modalSwedish: { fontSize: 15, color: isDark ? '#ccc' : '#444', lineHeight: 24, marginBottom: 16 },
    modalKalla: { fontSize: 12, color: isDark ? '#555' : '#aaa', fontStyle: 'italic' },
  });
}
