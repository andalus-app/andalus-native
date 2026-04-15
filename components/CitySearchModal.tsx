/**
 * CitySearchModal — shared city search component.
 *
 * Used by:
 *   - app/settings.tsx  (Nuvarande stad)
 *   - components/OnboardingFlow.tsx (step 3 – manual city selection)
 *
 * Props:
 *   visible     — controls Modal visibility
 *   onClose     — called when user taps "Avbryt" or closes the modal
 *   onSelect    — called with the chosen city result
 *   currentCity — displayed as "Nuvarande: …" hint (optional)
 *   T           — theme object (any shape with the tokens used below)
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Modal, View, Text, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import SvgIcon from './SvgIcon';
import { searchCity } from '../services/prayerApi';
import { nativeReverseGeocode } from '../services/geocoding';

export interface CityResult {
  latitude: number;
  longitude: number;
  city: string;
  country: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (result: CityResult) => void;
  currentCity?: string;
  T: {
    bg: string;
    card: string;
    border: string;
    text: string;
    textMuted: string;
    accent: string;
    accentGlow: string;
    separator?: string;
  };
}

export default function CitySearchModal({ visible, onClose, onSelect, currentCity, T }: Props) {
  const [query,         setQuery]         = useState('');
  const [results,       setResults]       = useState<CityResult[]>([]);
  const [searching,     setSearching]     = useState(false);
  const [locLoading,    setLocLoading]    = useState(false);
  const [gpsSuggestion, setGpsSuggestion] = useState<(CityResult & { label: string }) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    if (!visible) return;
    setQuery(''); setResults([]); setSearching(false); setGpsSuggestion(null);
    const t = setTimeout(() => {
      try { inputRef.current?.focus(); } catch {}
    }, 350);
    return () => clearTimeout(t);
  }, [visible]);

  function handleChangeText(text: string) {
    setQuery(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!text.trim()) { setResults([]); setSearching(false); return; }
    setSearching(true);
    timerRef.current = setTimeout(async () => {
      try { setResults(await searchCity(text)); }
      catch { setResults([]); }
      setSearching(false);
    }, 400);
  }

  async function handleDetectLocation() {
    setLocLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Plats', 'Platsåtkomst nekad'); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;
      const geo = await nativeReverseGeocode(latitude, longitude);
      const displayCity = geo.subLocality && geo.city && geo.subLocality !== geo.city
        ? `${geo.subLocality}, ${geo.city}`
        : geo.city || geo.subLocality || '';
      setGpsSuggestion({ label: displayCity, latitude, longitude, city: displayCity, country: geo.country });
    } catch { Alert.alert('Fel', 'Kunde inte hämta plats'); }
    setLocLoading(false);
  }

  function handleClose() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setQuery(''); setResults([]); setSearching(false); setGpsSuggestion(null);
    onClose();
  }

  const showEmpty = query.trim().length === 0 && !gpsSuggestion;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>

        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: T.border }}>
          <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: T.text }}>Välj stad</Text>
          <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: T.accent }}>Avbryt</Text>
          </TouchableOpacity>
        </View>

        {/* Sökfält + GPS-knapp */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
          {currentCity ? (
            <Text style={{ fontSize: 12, color: T.textMuted, marginBottom: 10 }}>
              Nuvarande: <Text style={{ color: T.accent, fontWeight: '600' }}>{currentCity}</Text>
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {/* Sökfält */}
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: T.card, borderRadius: 12, borderWidth: 0.5, borderColor: T.border, paddingHorizontal: 14, paddingVertical: 10, gap: 10 }}>
              <SvgIcon name="search" size={16} color={T.textMuted} />
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={handleChangeText}
                placeholder="Sök stad..."
                placeholderTextColor={T.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
                spellCheck={false}
                returnKeyType="search"
                clearButtonMode="while-editing"
                style={{ flex: 1, fontSize: 16, color: T.text, paddingVertical: 0, minHeight: 22 }}
              />
              {searching && <ActivityIndicator size="small" color={T.accent} />}
            </View>

            {/* GPS-ikon */}
            <TouchableOpacity
              onPress={handleDetectLocation}
              disabled={locLoading}
              style={{ width: 46, height: 46, borderRadius: 12, backgroundColor: T.card, borderWidth: 0.5, borderColor: T.border, alignItems: 'center', justifyContent: 'center' }}
              activeOpacity={0.7}
            >
              {locLoading
                ? <ActivityIndicator size="small" color={T.accent} />
                : <SvgIcon name="gps" size={20} color={T.accent} />
              }
            </TouchableOpacity>
          </View>
        </View>

        {/* Resultat */}
        <ScrollView keyboardShouldPersistTaps="always" keyboardDismissMode="none" style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }}>

          {/* GPS-förslag */}
          {gpsSuggestion && (
            <>
              <Text style={{ fontSize: 11, fontWeight: '700', color: T.textMuted, letterSpacing: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6 }}>
                DIN PLATS
              </Text>
              <TouchableOpacity
                onPress={() => onSelect(gpsSuggestion)}
                activeOpacity={0.6}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 0.5, borderBottomColor: T.border, gap: 14 }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: T.accentGlow, alignItems: 'center', justifyContent: 'center' }}>
                  <SvgIcon name="gps" size={18} color={T.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: T.text }}>{gpsSuggestion.label}</Text>
                  <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
                    {gpsSuggestion.latitude.toFixed(3)}, {gpsSuggestion.longitude.toFixed(3)}
                  </Text>
                </View>
                <Text style={{ fontSize: 20, color: T.textMuted }}>›</Text>
              </TouchableOpacity>
              {results.length > 0 && (
                <Text style={{ fontSize: 11, fontWeight: '700', color: T.textMuted, letterSpacing: 1, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 }}>
                  SÖKRESULTAT
                </Text>
              )}
            </>
          )}

          {/* Tomtillstånd */}
          {showEmpty && (
            <Text style={{ textAlign: 'center', color: T.textMuted, fontSize: 14, marginTop: 50, paddingHorizontal: 32 }}>
              Skriv ett stadsnamn eller tryck på GPS-ikonen
            </Text>
          )}
          {query.trim().length > 0 && !searching && results.length === 0 && (
            <Text style={{ textAlign: 'center', color: T.textMuted, fontSize: 14, marginTop: 50 }}>
              Inga träffar för "{query}"
            </Text>
          )}

          {/* Sökresultat */}
          {results.map((r, i) => (
            <TouchableOpacity key={i} onPress={() => onSelect(r)} activeOpacity={0.6}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 0.5, borderBottomColor: T.border, gap: 14 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: T.accentGlow, alignItems: 'center', justifyContent: 'center' }}>
                <SvgIcon name="map-point" size={18} color={T.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: T.text }}>
                  {r.city}{r.country ? ', ' + r.country : ''}
                </Text>
                <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
                  {r.latitude.toFixed(3)}, {r.longitude.toFixed(3)}
                </Text>
              </View>
              <Text style={{ fontSize: 20, color: T.textMuted }}>›</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
