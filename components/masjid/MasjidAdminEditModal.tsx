/**
 * MasjidAdminEditModal — admin edit of an approved/pending masjid, or manual add
 * (saved directly as approved). All writes go through the RLS-gated admin
 * functions in services/mosques.ts (is_linked_admin()). Reuses MasjidLocationPicker
 * for coordinates and pickMosqueImage for the single image (replace/remove).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView, Alert,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import {
  adminCreateApprovedMosque, adminUpdateMosque, uploadMosqueSubmissionImage,
  type AdminMosque, type AdminMosqueInput,
} from '../../services/mosques';
import { pickMosqueImage, type PickedMosqueImage } from './pickMosqueImage';
import MasjidLocationPicker from './MasjidLocationPicker';

export default function MasjidAdminEditModal({
  visible,
  mode,
  mosque,
  userLoc,
  onClose,
  onSaved,
}: {
  visible: boolean;
  mode: 'edit' | 'create';
  mosque: AdminMosque | null;
  userLoc: { lat: number; lng: number } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { theme: T } = useTheme();
  const insets = useSafeAreaInsets();
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [postal, setPostal] = useState('');
  const [city, setCity] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [hours, setHours] = useState('');
  const [parking, setParking] = useState<boolean | null>(null);
  const [accessInfo, setAccessInfo] = useState('');
  const [existingUrl, setExistingUrl] = useState<string | null>(null);
  const [existingPath, setExistingPath] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedMosqueImage | null>(null);
  const [removed, setRemoved] = useState(false);
  const [verified, setVerified] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);

  // (Re)seed the form whenever the modal opens.
  useEffect(() => {
    if (!visible) return;
    if (mode === 'edit' && mosque) {
      setName(mosque.name ?? '');
      setAddress(mosque.address ?? '');
      setPostal(mosque.postal_code ?? '');
      setCity(mosque.city ?? '');
      setCoords({ lat: mosque.latitude, lng: mosque.longitude });
      const oh = mosque.opening_hours;
      setHours(oh ? Object.values(oh).join(', ') : '');
      setParking(mosque.parking_available);
      setAccessInfo(mosque.access_info ?? '');
      setExistingUrl(mosque.image_url ?? null);
      setExistingPath(mosque.image_storage_path ?? null);
      setVerified(!!mosque.address_verified);
    } else {
      setName(''); setAddress(''); setPostal(''); setCity('');
      setCoords(userLoc ?? null); setHours(''); setParking(null); setAccessInfo('');
      setExistingUrl(null); setExistingPath(null); setVerified(true);
    }
    setPicked(null); setRemoved(false); setSaving(false); setPickerVisible(false);
  }, [visible, mode, mosque, userLoc]);

  const previewUri = picked?.uri ?? (!removed ? existingUrl : null);

  const handlePick = useCallback(async () => {
    const r = await pickMosqueImage();
    if (r.kind === 'image') { if (mountedRef.current) { setPicked(r); setRemoved(false); } }
    else if (r.kind === 'too_big') Alert.alert('Bilden är för stor', 'Bilden behöver vara mindre än 5 MB. Välj en annan bild.');
    else if (r.kind === 'unavailable') Alert.alert('Bild ej tillgänglig', 'Det gick inte att öppna bildväljaren.');
  }, []);

  const removeImage = useCallback(() => { setPicked(null); setRemoved(true); }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) { Alert.alert('Namn krävs', 'Ange masjidens namn.'); return; }
    if (!coords) { Alert.alert('Plats krävs', 'Välj en plats på kartan.'); return; }

    setSaving(true);
    try {
      // Resolve image: new pick → upload; removed → null; else keep existing.
      let image_url: string | null = existingUrl;
      let image_storage_path: string | null = existingPath;
      if (picked) {
        const up = await uploadMosqueSubmissionImage(picked.uri, picked.mime, picked.base64, 'approved');
        if (up.error || !up.url) {
          if (mountedRef.current) { setSaving(false); Alert.alert('Uppladdning misslyckades', up.error ? `(${up.error})` : 'Försök igen.'); }
          return;
        }
        image_url = up.url; image_storage_path = up.path ?? null;
      } else if (removed) {
        image_url = null; image_storage_path = null;
      }

      const input: AdminMosqueInput = {
        name: name.trim(),
        address: address.trim() || null,
        postal_code: postal.trim() || null,
        city: city.trim() || null,
        latitude: coords.lat,
        longitude: coords.lng,
        opening_hours: hours.trim() ? { alla: hours.trim() } : null,
        parking_available: parking,
        access_info: accessInfo.trim() || null,
        image_url,
        image_storage_path,
        address_verified: verified,
        address_source: verified ? 'admin' : (mosque?.address_source ?? null),
      };

      if (mode === 'edit' && mosque) await adminUpdateMosque(mosque.id, input);
      else await adminCreateApprovedMosque(input);

      if (!mountedRef.current) return;
      setSaving(false);
      onSaved();
      onClose();
    } catch (e) {
      if (mountedRef.current) { setSaving(false); Alert.alert('Kunde inte spara', String(e)); }
    }
  }, [name, coords, existingUrl, existingPath, picked, removed, address, postal, city, hours, parking, accessInfo, verified, mode, mosque, onSaved, onClose]);

  const coordLabel = coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : 'Ingen plats vald';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: T.bg }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: T.separator }]}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.headerBtn, { color: T.textMuted }]}>Avbryt</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: T.text }]}>{mode === 'create' ? 'Ny masjid' : 'Redigera masjid'}</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            {saving ? <ActivityIndicator color={T.accent} /> : <Text style={[styles.headerSave, { color: T.accent }]}>Spara</Text>}
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
            <Field label="Namn *" value={name} onChangeText={setName} placeholder="Masjidens namn" T={T} />
            <Field label="Adress" value={address} onChangeText={setAddress} placeholder="Gata och nummer" T={T} />
            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}><Field label="Postnummer" value={postal} onChangeText={setPostal} placeholder="123 45" T={T} /></View>
              <View style={{ flex: 2 }}><Field label="Stad" value={city} onChangeText={setCity} placeholder="Stad" T={T} /></View>
            </View>

            <Text style={[styles.label, { color: T.textMuted }]}>Plats *</Text>
            <View style={[styles.coordBox, { backgroundColor: T.card, borderColor: T.border }]}>
              <Ionicons name="location" size={18} color={coords ? T.accent : T.textMuted} />
              <Text style={[styles.coordText, { color: coords ? T.text : T.textMuted }]}>{coordLabel}</Text>
            </View>
            <View style={styles.posButtons}>
              {!!userLoc && (
                <TouchableOpacity style={[styles.posBtn, { backgroundColor: T.card, borderColor: T.border }]} onPress={() => setCoords(userLoc)} activeOpacity={0.8}>
                  <Ionicons name="navigate" size={16} color={T.accent} />
                  <Text style={[styles.posBtnText, { color: T.text }]}>Nuvarande plats</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.posBtn, { backgroundColor: T.card, borderColor: T.border }]} onPress={() => setPickerVisible(true)} activeOpacity={0.8}>
                <Ionicons name="map" size={16} color={T.accent} />
                <Text style={[styles.posBtnText, { color: T.text }]}>Välj på kartan</Text>
              </TouchableOpacity>
            </View>

            <Field label="Öppettider" value={hours} onChangeText={setHours} placeholder="t.ex. 05:00–23:00" T={T} />

            <Text style={[styles.label, { color: T.textMuted }]}>Parkering</Text>
            <View style={styles.segment}>
              {([['Ja', true], ['Nej', false]] as const).map(([lbl, val]) => {
                const active = parking === val;
                return (
                  <TouchableOpacity key={lbl} style={[styles.segBtn, { backgroundColor: active ? T.accent : T.card, borderColor: T.border }]} onPress={() => setParking(active ? null : val)} activeOpacity={0.8}>
                    <Text style={[styles.segText, { color: active ? '#fff' : T.text }]}>{lbl}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Field label="Tillgänglighet / övrig info" value={accessInfo} onChangeText={setAccessInfo} placeholder="t.ex. rullstolsanpassad entré" multiline T={T} />

            {/* Image */}
            <Text style={[styles.label, { color: T.textMuted }]}>Bild (max 1, ≤ 5 MB)</Text>
            {previewUri ? (
              <View style={[styles.imageWrap, { borderColor: T.border }]}>
                <Image source={{ uri: previewUri }} style={styles.image} contentFit="cover" />
                <View style={styles.imageActions}>
                  <TouchableOpacity style={[styles.imgBtn, { backgroundColor: T.card }]} onPress={handlePick}>
                    <Ionicons name="swap-horizontal" size={16} color={T.text} />
                    <Text style={[styles.imgBtnText, { color: T.text }]}>Byt</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.imgBtn, { backgroundColor: T.card }]} onPress={removeImage}>
                    <Ionicons name="trash-outline" size={16} color={T.error} />
                    <Text style={[styles.imgBtnText, { color: T.error }]}>Ta bort</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={[styles.imagePick, { backgroundColor: T.card, borderColor: T.border }]} onPress={handlePick} activeOpacity={0.8}>
                <Ionicons name="image-outline" size={20} color={T.accent} />
                <Text style={[styles.posBtnText, { color: T.text }]}>Lägg till en bild (max 5 MB)</Text>
              </TouchableOpacity>
            )}

            {/* Address verified */}
            <View style={[styles.verifyRow, { borderColor: T.border, backgroundColor: T.card }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: T.text, fontSize: 15, fontWeight: '600' }}>Adress verifierad</Text>
                <Text style={{ color: T.textMuted, fontSize: 12, marginTop: 2 }}>Markerar address_source = admin</Text>
              </View>
              <Switch value={verified} onValueChange={setVerified} trackColor={{ true: T.accent }} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      <MasjidLocationPicker
        visible={pickerVisible}
        initialLat={coords?.lat ?? userLoc?.lat ?? null}
        initialLng={coords?.lng ?? userLoc?.lng ?? null}
        onCancel={() => setPickerVisible(false)}
        onPicked={(lat, lng) => { setCoords({ lat, lng }); setPickerVisible(false); }}
      />
    </Modal>
  );
}

function Field({
  label, value, onChangeText, placeholder, multiline, T,
}: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder: string; multiline?: boolean; T: any;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[styles.label, { color: T.textMuted }]}>{label}</Text>
      <TextInput
        style={[styles.input, { backgroundColor: T.card, borderColor: T.border, color: T.text }, multiline && { height: 80, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={T.textMuted}
        multiline={multiline}
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  headerBtn: { fontSize: 16 },
  headerSave: { fontSize: 16, fontWeight: '700' },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  rowFields: { flexDirection: 'row', gap: 12 },
  coordBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 12 },
  coordText: { fontSize: 15 },
  posButtons: { flexDirection: 'row', gap: 12, marginTop: 10, marginBottom: 14 },
  posBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  posBtnText: { fontSize: 14, fontWeight: '600' },
  segment: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  segBtn: { flex: 1, alignItems: 'center', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  segText: { fontSize: 15, fontWeight: '600' },
  imageWrap: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', height: 180 },
  image: { width: '100%', height: '100%' },
  imageActions: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', gap: 8 },
  imgBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  imgBtnText: { fontSize: 13, fontWeight: '600' },
  imagePick: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 16 },
  verifyRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginTop: 16 },
});
