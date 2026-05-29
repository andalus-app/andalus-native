/**
 * MasjidSearchBar — search at the top of the map. Two behaviours from one field:
 *   • Masjid text search in Supabase (approved name/city/address/postal_code),
 *     debounced, shown as a results dropdown. Tap → onSelectMosque.
 *   • Free-text place search → a "Sök plats" row (and keyboard submit) calls
 *     onSearchPlace, which the parent geocodes via Nominatim (no Google).
 *
 * Isolation: the in-flight Supabase search is aborted on the next keystroke, on
 * reset (resetSignal), and on unmount — nothing keeps running after close.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, TextInput, Text, TouchableOpacity, ScrollView, ActivityIndicator,
  Keyboard, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { searchApprovedMosques, type MosqueSearchResult } from '../../services/mosques';
import { masjidIconColor, masjidLabelColor, masjidSubColor } from './colors';

export default function MasjidSearchBar({
  onSelectMosque,
  onSearchPlace,
  resetSignal,
}: {
  onSelectMosque: (m: MosqueSearchResult) => void;
  onSearchPlace: (query: string) => void;
  resetSignal: number;
}) {
  const { theme: T } = useTheme();
  const [text, setText] = useState('');
  const [results, setResults] = useState<MosqueSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [focused, setFocused] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Debounced masjid search as the user types.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = text.trim();
    if (term.length < 2) { abortRef.current?.abort(); setResults([]); setSearching(false); return; }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const rows = await searchApprovedMosques(term, ctrl.signal);
        if (mountedRef.current) setResults(rows);
      } catch {
        /* abort or failure — leave previous results */
      } finally {
        if (mountedRef.current) setSearching(false);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [text]);

  // Parent reset (e.g. "Min position") → clear everything.
  useEffect(() => {
    if (resetSignal === 0) return;
    setText('');
    setResults([]);
    setFocused(false);
    abortRef.current?.abort();
    Keyboard.dismiss();
  }, [resetSignal]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const dismiss = () => { setFocused(false); Keyboard.dismiss(); };

  const handlePickMosque = (m: MosqueSearchResult) => { dismiss(); onSelectMosque(m); };
  const handlePickPlace = () => {
    const q = text.trim();
    if (!q) return;
    dismiss();
    onSearchPlace(q);
  };

  const showDropdown = focused && text.trim().length >= 1;

  return (
    <View style={styles.wrap}>
      <View style={[styles.bar, { backgroundColor: T.card, borderColor: T.border }]}>
        <Ionicons name="search" size={18} color={masjidIconColor(T)} />
        <TextInput
          style={[styles.input, { color: T.text }]}
          placeholder="Sök masjid, stad eller adress"
          placeholderTextColor={masjidLabelColor(T)}
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onSubmitEditing={handlePickPlace}
          returnKeyType="search"
          autoCorrect={false}
        />
        {searching && <ActivityIndicator size="small" color={masjidLabelColor(T)} />}
        {text.length > 0 && !searching && (
          <TouchableOpacity onPress={() => setText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={masjidLabelColor(T)} />
          </TouchableOpacity>
        )}
      </View>

      {showDropdown && (
        <View style={[styles.dropdown, { backgroundColor: T.card, borderColor: T.border }]}>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 280 }}>
            {results.map((m) => {
              const sub = [m.city, m.address].filter(Boolean).join(' · ');
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.row, { borderBottomColor: T.separator }]}
                  onPress={() => handlePickMosque(m)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="business-outline" size={18} color={masjidIconColor(T)} />
                  <View style={styles.rowMain}>
                    <Text style={[styles.rowName, { color: T.text }]} numberOfLines={1}>{m.name}</Text>
                    {!!sub && <Text style={[styles.rowSub, { color: masjidSubColor(T) }]} numberOfLines={1}>{sub}</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* Always offer a place/address search for the typed text */}
            <TouchableOpacity style={styles.row} onPress={handlePickPlace} activeOpacity={0.7}>
              <Ionicons name="location-outline" size={18} color={masjidLabelColor(T)} />
              <View style={styles.rowMain}>
                <Text style={[styles.rowName, { color: T.text }]} numberOfLines={1}>Sök plats: “{text.trim()}”</Text>
                <Text style={[styles.rowSub, { color: masjidSubColor(T) }]}>Visa närmaste masjid där</Text>
              </View>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 14,
    borderRadius: 14, borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: 0 },
  dropdown: {
    marginTop: 8, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  rowMain: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 13, marginTop: 2 },
});
