import { View, Text, StyleSheet, useColorScheme, FlatList, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { useState } from 'react';
import asmaulData from '../asmaul_husna.json';

type Name = {
  nr: number;
  arabic: string;
  transliteration: string;
  swedish: string;
  forklaring: string;
  koranvers_arabiska: string;
  koranvers_svenska: string;
  sura_ayat: string;
  antal_i_koranen: number;
  hadith: string | null;
};

const names: Name[] = asmaulData as Name[];

export default function AsmaulHusnaScreen() {
  const isDark = useColorScheme() === 'dark';
  const s = styles(isDark);
  const [selected, setSelected] = useState<Name | null>(null);

  return (
    <View style={s.container}>
      <Text style={s.title}>Asmaul Husna</Text>
      <Text style={s.subtitle}>Allahs 99 namn</Text>

      <FlatList
        data={names}
        keyExtractor={item => item.nr.toString()}
        numColumns={2}
        contentContainerStyle={{ paddingBottom: 100 }}
        columnWrapperStyle={{ gap: 10, marginBottom: 10 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.card} onPress={() => setSelected(item)}>
            <Text style={s.nr}>{item.nr}</Text>
            <Text style={s.arabic}>{item.arabic}</Text>
            <Text style={s.translit}>{item.transliteration}</Text>
            <Text style={s.swedish}>{item.swedish}</Text>
          </TouchableOpacity>
        )}
      />

      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
        <ScrollView style={s.modal} contentContainerStyle={{ paddingBottom: 60 }}>
          <TouchableOpacity style={s.closeBtn} onPress={() => setSelected(null)}>
            <Text style={s.closeBtnText}>✕ Stäng</Text>
          </TouchableOpacity>
          {selected && <>
            <Text style={s.modalNr}>{selected.nr} / 99</Text>
            <Text style={s.modalArabic}>{selected.arabic}</Text>
            <Text style={s.modalTranslit}>{selected.transliteration}</Text>
            <Text style={s.modalSwedish}>{selected.swedish}</Text>

            <View style={s.divider} />

            <Text style={s.sectionLabel}>Förklaring</Text>
            <Text style={s.bodyText}>{selected.forklaring}</Text>

            {selected.koranvers_arabiska ? <>
              <View style={s.divider} />
              <Text style={s.sectionLabel}>Koranvers ({selected.sura_ayat})</Text>
              <Text style={s.koranArabic}>{selected.koranvers_arabiska}</Text>
              <Text style={s.bodyText}>{selected.koranvers_svenska}</Text>
            </> : null}

            {selected.hadith ? <>
              <View style={s.divider} />
              <Text style={s.sectionLabel}>Hadith</Text>
              <Text style={s.bodyText}>{selected.hadith}</Text>
            </> : null}

            {selected.antal_i_koranen ? (
              <Text style={s.count}>Förekommer {selected.antal_i_koranen} gånger i Koranen</Text>
            ) : null}
          </>}
        </ScrollView>
      </Modal>
    </View>
  );
}

function styles(isDark: boolean) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: isDark ? '#0d0d0d' : '#f0f0f0', paddingTop: 60, paddingHorizontal: 16 },
    title: { fontSize: 32, fontWeight: 'bold', color: isDark ? '#fff' : '#111', marginBottom: 4 },
    subtitle: { fontSize: 15, color: isDark ? '#888' : '#666', marginBottom: 20 },
    card: { flex: 1, backgroundColor: isDark ? '#1a1a1a' : '#fff', borderRadius: 14, padding: 14, alignItems: 'center' },
    nr: { fontSize: 11, color: '#4CAF50', fontWeight: '700', marginBottom: 6 },
    arabic: { fontSize: 22, color: isDark ? '#fff' : '#111', marginBottom: 4, textAlign: 'center' },
    translit: { fontSize: 12, color: '#4CAF50', fontStyle: 'italic', marginBottom: 2, textAlign: 'center' },
    swedish: { fontSize: 12, color: isDark ? '#888' : '#666', textAlign: 'center' },
    modal: { flex: 1, backgroundColor: isDark ? '#0d0d0d' : '#fff', padding: 24 },
    closeBtn: { paddingTop: 40, paddingBottom: 16 },
    closeBtnText: { color: '#4CAF50', fontSize: 16, fontWeight: '600' },
    modalNr: { fontSize: 13, color: '#4CAF50', fontWeight: '700', marginBottom: 8 },
    modalArabic: { fontSize: 42, color: isDark ? '#fff' : '#111', textAlign: 'center', marginBottom: 8, lineHeight: 60 },
    modalTranslit: { fontSize: 18, color: '#4CAF50', fontStyle: 'italic', textAlign: 'center', marginBottom: 4 },
    modalSwedish: { fontSize: 20, fontWeight: '600', color: isDark ? '#ddd' : '#333', textAlign: 'center', marginBottom: 20 },
    divider: { height: 1, backgroundColor: isDark ? '#222' : '#eee', marginVertical: 16 },
    sectionLabel: { fontSize: 11, fontWeight: '700', color: '#4CAF50', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' },
    bodyText: { fontSize: 15, color: isDark ? '#ccc' : '#444', lineHeight: 24 },
    koranArabic: { fontSize: 20, color: isDark ? '#fff' : '#111', textAlign: 'right', lineHeight: 36, marginBottom: 8 },
    count: { fontSize: 12, color: isDark ? '#555' : '#aaa', marginTop: 16, textAlign: 'center', fontStyle: 'italic' },
  });
}
