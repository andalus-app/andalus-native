import { View, Text, StyleSheet, useColorScheme, FlatList, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import Pdf from 'react-native-pdf';

const BASE_URL = 'https://andalus-app.github.io/andalus/books/';

const BOOKS = [
  { id: '1', title: 'Årsrapport 2024', file: 'Arsrapport_2024.pdf' },
  { id: '2', title: 'Årsrapport 2025', file: 'Arsrapport_2025_Final.pdf' },
  { id: '3', title: 'Islams och trons pelare', file: 'Bok_Islams_och_trons_pelare_webb.pdf' },
  { id: '4', title: 'Bönebok 2024', file: 'Bönebok_2024_webb1.pdf' },
  { id: '5', title: 'Bönetider i Sverige 2020', file: 'Bönetider_i_Sverige_-_E-bok_2020.pdf' },
  { id: '6', title: 'Gyllene uttalanden', file: 'gylleneuttalanden.pdf' },
  { id: '7', title: 'Hadjboken', file: 'Hadjboken.pdf' },
  { id: '8', title: 'Hisnul Muslim', file: 'Hisnul_Muslim_E-bok.pdf' },
  { id: '9', title: 'Hopp i mörka tider', file: 'hopp-i-morka-tider.pdf' },
  { id: '10', title: 'Islamiska frågor', file: 'hur_ska_man_forhalla_sig_till_menin...igheter_i_islamiska_fragor_Islam.pdf' },
  { id: '11', title: 'När börjar Ramadan?', file: 'Hur_vet_vi_när_Ramadan_börjar_och_slutar_E-bok_2020.pdf' },
  { id: '12', title: 'Ramadanboken 2022', file: 'ramadanboken-2022.pdf' },
  { id: '13', title: 'Zakat E-bok', file: 'zakat-ebok-klar.pdf' },
  { id: '14', title: 'Zakatboken 2024', file: 'Zakatboken_med_omslag_webb_2024.pdf' },
];

export default function EbooksScreen() {
  const isDark = useColorScheme() === 'dark';
  const s = styles(isDark);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);

  return (
    <View style={s.container}>
      <Text style={s.title}>E-böcker</Text>
      <FlatList
        data={BOOKS}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingBottom: 20 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.bookCard} onPress={() => setSelectedBook(BASE_URL + encodeURIComponent(item.file))}>
            <View style={s.bookIcon}>
              <Text style={s.bookIconText}>📖</Text>
            </View>
            <Text style={s.bookTitle}>{item.title}</Text>
            <Text style={s.bookArrow}>›</Text>
          </TouchableOpacity>
        )}
      />

      <Modal visible={!!selectedBook} animationType="slide" onRequestClose={() => setSelectedBook(null)}>
        <View style={s.modalContainer}>
          <TouchableOpacity style={s.closeBtn} onPress={() => setSelectedBook(null)}>
            <Text style={s.closeBtnText}>✕ Stäng</Text>
          </TouchableOpacity>
          {selectedBook && (
            <Pdf
              source={{ uri: selectedBook, cache: true }}
              style={s.pdf}
              onLoadComplete={(pages) => console.log(`${pages} sidor`)}
              renderActivityIndicator={() => <ActivityIndicator size="large" color="#4CAF50" />}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

function styles(isDark: boolean) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: isDark ? '#0d0d0d' : '#f0f0f0', paddingTop: 60, paddingHorizontal: 16 },
    title: { fontSize: 32, fontWeight: 'bold', color: isDark ? '#fff' : '#111', marginBottom: 20 },
    bookCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? '#1a1a1a' : '#fff', borderRadius: 12, padding: 16, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
    bookIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#4CAF5022', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    bookIconText: { fontSize: 20 },
    bookTitle: { flex: 1, fontSize: 15, color: isDark ? '#ddd' : '#333', fontWeight: '500' },
    bookArrow: { fontSize: 22, color: isDark ? '#555' : '#ccc' },
    modalContainer: { flex: 1, backgroundColor: isDark ? '#0d0d0d' : '#fff' },
    closeBtn: { padding: 16, paddingTop: 56, backgroundColor: isDark ? '#1a1a1a' : '#f5f5f5' },
    closeBtnText: { fontSize: 16, color: '#4CAF50', fontWeight: '600' },
    pdf: { flex: 1, width: '100%' },
  });
}
