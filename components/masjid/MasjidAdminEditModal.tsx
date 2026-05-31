/**
 * MasjidAdminEditModal — admin edit of an approved/pending masjid, or manual add
 * (saved directly as approved). All writes go through the RLS-gated admin
 * functions in services/mosques.ts (is_linked_admin()). Reuses MasjidLocationPicker
 * for coordinates and pickMosqueImage for the single image (replace/remove).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView, Alert,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, Switch, AppState,
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
import MasjidOpeningHoursPicker from './MasjidOpeningHoursPicker';
import { formatSwedishPostalCode } from './format';
import { reverseGeocode } from '../../services/nominatim';
import { masjidIconColor, masjidLabelColor } from './colors';

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

  // Bumped on every return-to-foreground so the modal body remounts and repaints
  // — fixes the iOS blank/black pageSheet body after switching to another app
  // (e.g. Google Maps) and back. Form data lives in state (not the remounted
  // subtree), so nothing typed is lost.
  const [contentKey, setContentKey] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && mountedRef.current) setContentKey((k) => k + 1);
    });
    return () => sub.remove();
  }, []);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [postal, setPostal] = useState('');
  const [city, setCity] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  // Editable text mirrors of the coordinate for manual lat/lng entry. Strings
  // (not derived from `coords`) so a half-typed value isn't clobbered per key.
  const [latText, setLatText] = useState('');
  const [lngText, setLngText] = useState('');
  const [hours, setHours] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [prayerTimesUrl, setPrayerTimesUrl] = useState('');
  const [parking, setParking] = useState<boolean | null>(null);
  const [wheelchair, setWheelchair] = useState<boolean | null>(null);
  const [accessInfo, setAccessInfo] = useState('');
  const [existingUrl, setExistingUrl] = useState<string | null>(null);
  const [existingPath, setExistingPath] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedMosqueImage | null>(null);
  const [removed, setRemoved] = useState(false);
  const [verified, setVerified] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [hoursPickerVisible, setHoursPickerVisible] = useState(false);
  const [fillingAddress, setFillingAddress] = useState(false);

  // Refs mirror latest text values so the awaited reverse-geocode below never
  // overwrites a field admin typed while the request was in flight
  // (CLAUDE.md async-safety rule).
  const addressRef = useRef(address); addressRef.current = address;
  const postalRef  = useRef(postal);  postalRef.current  = postal;
  const cityRef    = useRef(city);    cityRef.current    = city;
  const reverseAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { reverseAbortRef.current?.abort(); }, []);

  // Commit a coordinate from GPS / map picker and sync the editable text fields.
  const applyCoords = useCallback((lat: number, lng: number) => {
    setCoords({ lat, lng });
    setLatText(lat.toFixed(6));
    setLngText(lng.toFixed(6));
  }, []);

  // Manual lat/lng entry. Accepts comma or dot decimals; updates `coords` only
  // when BOTH values parse to a valid WGS84 range.
  const applyManual = useCallback((latStr: string, lngStr: string) => {
    const lat = parseFloat(latStr.replace(',', '.'));
    const lng = parseFloat(lngStr.replace(',', '.'));
    if (isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      setCoords({ lat, lng });
    }
  }, []);
  const onLatChange = useCallback((t: string) => { setLatText(t); applyManual(t, lngText); }, [applyManual, lngText]);
  const onLngChange = useCallback((t: string) => { setLngText(t); applyManual(latText, t); }, [applyManual, latText]);

  // (Re)seed the form whenever the modal opens.
  useEffect(() => {
    if (!visible) return;
    // Cancel any in-flight reverse geocode from a previous open and clear
    // its loading state so a freshly-reseeded form doesn't show a stale spinner.
    reverseAbortRef.current?.abort();
    setFillingAddress(false);
    if (mode === 'edit' && mosque) {
      setName(mosque.name ?? '');
      setAddress(mosque.address ?? '');
      setPostal(formatSwedishPostalCode(mosque.postal_code ?? ''));
      setCity(mosque.city ?? '');
      setCoords({ lat: mosque.latitude, lng: mosque.longitude });
      setLatText(mosque.latitude.toFixed(6));
      setLngText(mosque.longitude.toFixed(6));
      const oh = mosque.opening_hours;
      setHours(oh ? Object.values(oh).join(', ') : '');
      setPhone(mosque.phone ?? '');
      setWebsite(mosque.website ?? '');
      setPrayerTimesUrl(mosque.prayer_times_url ?? '');
      setParking(mosque.parking_available);
      setWheelchair(mosque.wheelchair_accessible);
      setAccessInfo(mosque.access_info ?? '');
      setExistingUrl(mosque.image_url ?? null);
      setExistingPath(mosque.image_storage_path ?? null);
      setVerified(!!mosque.address_verified);
    } else {
      setName(''); setAddress(''); setPostal(''); setCity('');
      setCoords(userLoc ?? null);
      setLatText(userLoc ? userLoc.lat.toFixed(6) : '');
      setLngText(userLoc ? userLoc.lng.toFixed(6) : '');
      setHours(''); setPhone(''); setWebsite(''); setPrayerTimesUrl('');
      setParking(null); setWheelchair(null); setAccessInfo('');
      setExistingUrl(null); setExistingPath(null); setVerified(true);
    }
    setPicked(null); setRemoved(false); setSaving(false); setPickerVisible(false);
    setHoursPickerVisible(false);
  }, [visible, mode, mosque, userLoc]);

  const previewUri = picked?.uri ?? (!removed ? existingUrl : null);

  const handlePick = useCallback(async () => {
    const r = await pickMosqueImage();
    if (r.kind === 'image') { if (mountedRef.current) { setPicked(r); setRemoved(false); } }
    else if (r.kind === 'too_big') Alert.alert('Bilden är för stor', 'Bilden behöver vara mindre än 5 MB. Välj en annan bild.');
    else if (r.kind === 'unavailable') Alert.alert('Bild ej tillgänglig', 'Det gick inte att öppna bildväljaren.');
  }, []);

  const removeImage = useCallback(() => { setPicked(null); setRemoved(true); }, []);

  /**
   * Reverse-geocode lat/lng and auto-fill empty address/postal/city fields via
   * Nominatim. Non-destructive: any field already typed (including pre-seeded
   * values from edit mode) is preserved. Shared by "Använd min plats" AND the
   * map picker's "Klar".
   */
  const fillAddressFromCoords = useCallback(async (lat: number, lng: number) => {
    // Skip the network round-trip entirely when every field is already filled.
    if (addressRef.current.trim() && postalRef.current.trim() && cityRef.current.trim()) return;

    reverseAbortRef.current?.abort();
    const controller = new AbortController();
    reverseAbortRef.current = controller;

    setFillingAddress(true);
    try {
      const geo = await reverseGeocode(lat, lng, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      if (geo) {
        if (geo.address    && !addressRef.current.trim()) setAddress(geo.address);
        if (geo.postalCode && !postalRef.current.trim())  setPostal(formatSwedishPostalCode(geo.postalCode));
        if (geo.city       && !cityRef.current.trim())    setCity(geo.city);
      }
    } catch {
      // Silent: empty fields stay empty, admin can type manually.
    } finally {
      if (mountedRef.current && reverseAbortRef.current === controller) setFillingAddress(false);
    }
  }, []);

  /** "Använd min plats" — set the coordinate and auto-fill empty address fields. */
  const handleUseMyLocation = useCallback(() => {
    if (!userLoc) return;
    applyCoords(userLoc.lat, userLoc.lng);
    fillAddressFromCoords(userLoc.lat, userLoc.lng);
  }, [userLoc, applyCoords, fillAddressFromCoords]);

  /** Map picker "Klar" — commit the picked coordinate and auto-fill empty address fields. */
  const handlePicked = useCallback((lat: number, lng: number) => {
    applyCoords(lat, lng);
    setPickerVisible(false);
    fillAddressFromCoords(lat, lng);
  }, [applyCoords, fillAddressFromCoords]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) { Alert.alert('Namn krävs', 'Ange moskéns namn.'); return; }
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
        wheelchair_accessible: wheelchair,
        access_info: accessInfo.trim() || null,
        phone: phone.trim() || null,
        website: website.trim() || null,
        prayer_times_url: prayerTimesUrl.trim() || null,
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
  }, [name, coords, existingUrl, existingPath, picked, removed, address, postal, city, hours, phone, website, prayerTimesUrl, parking, wheelchair, accessInfo, verified, mode, mosque, onSaved, onClose]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: T.bg }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: T.separator }]}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.headerBtn, { color: masjidLabelColor(T) }]}>Avbryt</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: T.text }]}>{mode === 'create' ? 'Ny moské' : 'Redigera moské'}</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            {saving ? <ActivityIndicator color={T.accent} /> : <Text style={[styles.headerSave, { color: T.accent }]}>Spara</Text>}
          </TouchableOpacity>
        </View>

        {/* key={contentKey} → fresh repaint on foreground; see contentKey above. */}
        <KeyboardAvoidingView key={contentKey} style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
            <Field label="Namn *" value={name} onChangeText={setName} placeholder="Moskéns namn" T={T} />
            <Field label="Adress" value={address} onChangeText={setAddress} placeholder="Gata och nummer" T={T} />
            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Postnummer"
                  value={postal}
                  onChangeText={t => setPostal(formatSwedishPostalCode(t))}
                  placeholder="123 45"
                  T={T}
                />
              </View>
              <View style={{ flex: 2 }}><Field label="Stad" value={city} onChangeText={setCity} placeholder="Stad" T={T} /></View>
            </View>

            <Text style={[styles.label, { color: masjidLabelColor(T) }]}>Plats *</Text>
            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.subLabel, { color: masjidLabelColor(T) }]}>Latitud</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: T.card, borderColor: T.border, color: T.text }]}
                  value={latText} onChangeText={onLatChange}
                  placeholder="59.32930" placeholderTextColor={masjidLabelColor(T)}
                  keyboardType="numbers-and-punctuation" autoCorrect={false}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.subLabel, { color: masjidLabelColor(T) }]}>Longitud</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: T.card, borderColor: T.border, color: T.text }]}
                  value={lngText} onChangeText={onLngChange}
                  placeholder="18.06860" placeholderTextColor={masjidLabelColor(T)}
                  keyboardType="numbers-and-punctuation" autoCorrect={false}
                />
              </View>
            </View>
            <View style={styles.posButtons}>
              <TouchableOpacity
                style={[styles.posBtn, { backgroundColor: T.card, borderColor: T.border, opacity: userLoc ? 1 : 0.5 }]}
                onPress={handleUseMyLocation}
                disabled={!userLoc || fillingAddress}
                activeOpacity={0.8}
              >
                {fillingAddress
                  ? <ActivityIndicator size="small" color={masjidIconColor(T)} />
                  : <Ionicons name="navigate" size={16} color={masjidIconColor(T)} />}
                <Text style={[styles.posBtnText, { color: T.text }]} numberOfLines={1}>Använd min plats</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.posBtn, { backgroundColor: T.card, borderColor: T.border }]} onPress={() => setPickerVisible(true)} activeOpacity={0.8}>
                <Ionicons name="map" size={16} color={masjidIconColor(T)} />
                <Text style={[styles.posBtnText, { color: T.text }]} numberOfLines={1}>Välj på kartan</Text>
              </TouchableOpacity>
            </View>

            {/* Öppettider — tryckbar rad öppnar scroll-pickern (Från / Till) */}
            <Text style={[styles.label, { color: masjidLabelColor(T) }]}>Öppettider</Text>
            <TouchableOpacity
              style={[styles.hoursRow, { backgroundColor: T.card, borderColor: T.border }]}
              onPress={() => setHoursPickerVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="time-outline" size={18} color={masjidIconColor(T)} />
              <Text style={[styles.hoursText, { color: hours ? T.text : masjidLabelColor(T) }]} numberOfLines={1}>
                {hours || 'Välj tid'}
              </Text>
              {!!hours && (
                <TouchableOpacity
                  onPress={() => setHours('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle" size={18} color={masjidLabelColor(T)} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>

            <View style={{ marginBottom: 14 }}>
              <Text style={[styles.label, { color: masjidLabelColor(T) }]}>Telefon</Text>
              <TextInput
                style={[styles.input, { backgroundColor: T.card, borderColor: T.border, color: T.text }]}
                value={phone} onChangeText={setPhone}
                placeholder="t.ex. 070-123 45 67" placeholderTextColor={masjidLabelColor(T)}
                keyboardType="phone-pad" autoCorrect={false}
              />
            </View>

            <View style={{ marginBottom: 14 }}>
              <Text style={[styles.label, { color: masjidLabelColor(T) }]}>Hemsida</Text>
              <TextInput
                style={[styles.input, { backgroundColor: T.card, borderColor: T.border, color: T.text }]}
                value={website} onChangeText={setWebsite}
                placeholder="t.ex. https://moskén.se" placeholderTextColor={masjidLabelColor(T)}
                keyboardType="url" autoCapitalize="none" autoCorrect={false}
              />
            </View>

            {/* Bönetider — länk till moskéns bönetidsida (visas i appen, ej Safari) */}
            <View style={{ marginBottom: 14 }}>
              <Text style={[styles.label, { color: masjidLabelColor(T) }]}>Bönetider (länk)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: T.card, borderColor: T.border, color: T.text }]}
                value={prayerTimesUrl} onChangeText={setPrayerTimesUrl}
                placeholder="t.ex. https://moskén.se/bonetider" placeholderTextColor={masjidLabelColor(T)}
                keyboardType="url" autoCapitalize="none" autoCorrect={false}
              />
            </View>

            <Text style={[styles.label, { color: masjidLabelColor(T) }]}>Parkering</Text>
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

            {/* Rullstolstillgänglig ingång — direkt efter Parkering */}
            <Text style={[styles.label, { color: masjidLabelColor(T) }]}>Rullstolstillgänglig ingång</Text>
            <View style={styles.segment}>
              {([['Ja', true], ['Nej', false]] as const).map(([lbl, val]) => {
                const active = wheelchair === val;
                return (
                  <TouchableOpacity key={lbl} style={[styles.segBtn, { backgroundColor: active ? T.accent : T.card, borderColor: T.border }]} onPress={() => setWheelchair(active ? null : val)} activeOpacity={0.8}>
                    <Text style={[styles.segText, { color: active ? '#fff' : T.text }]}>{lbl}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Field label="Tillgänglighet / övrig info" value={accessInfo} onChangeText={setAccessInfo} placeholder="T.ex. Fredagsbön kl. 13:00, separat böneplats för systrar, entré via baksidan eller andra viktiga upplysningar." multiline T={T} />

            {/* Image */}
            <Text style={[styles.label, { color: masjidLabelColor(T) }]}>Bild (max 1, ≤ 5 MB)</Text>
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
                <Ionicons name="image-outline" size={20} color={masjidIconColor(T)} />
                <Text style={[styles.posBtnText, { color: T.text }]}>Lägg till en bild (max 5 MB)</Text>
              </TouchableOpacity>
            )}

            {/* Address verified */}
            <View style={[styles.verifyRow, { borderColor: T.border, backgroundColor: T.card }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: T.text, fontSize: 15, fontWeight: '600' }}>Adress verifierad</Text>
                <Text style={{ color: masjidLabelColor(T), fontSize: 12, marginTop: 2 }}>Markerar address_source = admin</Text>
              </View>
              <Switch value={verified} onValueChange={setVerified} trackColor={{ true: T.accent }} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      <MasjidOpeningHoursPicker
        visible={hoursPickerVisible}
        initialValue={hours}
        onCancel={() => setHoursPickerVisible(false)}
        onConfirm={v => { setHours(v); setHoursPickerVisible(false); }}
      />

      <MasjidLocationPicker
        visible={pickerVisible}
        initialLat={coords?.lat ?? userLoc?.lat ?? null}
        initialLng={coords?.lng ?? userLoc?.lng ?? null}
        // Geocode the typed address only while no coords are committed (create
        // flow / address edit before re-pin). In edit mode the row already has
        // lat/lng → `coords` is non-null → we pass `null` so re-opening the
        // picker doesn't yank the crosshair away from the stored position.
        // Uses Nominatim's STRUCTURED query for precise house-level matching.
        addressQuery={coords ? null : { street: address, postalCode: postal, city }}
        onCancel={() => setPickerVisible(false)}
        onPicked={handlePicked}
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
      <Text style={[styles.label, { color: masjidLabelColor(T) }]}>{label}</Text>
      <TextInput
        style={[styles.input, { backgroundColor: T.card, borderColor: T.border, color: T.text }, multiline && { height: 80, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={masjidLabelColor(T)}
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
  subLabel: { fontSize: 12, fontWeight: '500', marginBottom: 6 },
  input: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  rowFields: { flexDirection: 'row', gap: 12 },
  hoursRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14,
  },
  hoursText: { fontSize: 15, flex: 1 },
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
