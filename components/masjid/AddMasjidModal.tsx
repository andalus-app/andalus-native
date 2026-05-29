/**
 * AddMasjidModal — user submission form for "Lägg till masjid".
 *
 * Submits through the submit_mosque RPC (status forced to 'pending' server-side;
 * regular users can NEVER create an approved row). The raw device id is never
 * sent — only its hash (handled in services/mosques.ts). Image is optional,
 * ≤5 MB, compressed on pick (expo-image-picker quality), uploaded to
 * mosque-images/submissions/. NO Google APIs.
 *
 * Isolation: this is a modal inside the masjid screen; it unmounts on close. The
 * on-map picker WebView mounts only while picking. No background JS, no timers.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView, Alert,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import {
  submitMosque, uploadMosqueSubmissionImage, MOSQUE_IMAGE_MAX_BYTES,
  type SubmitErrorCode,
} from '../../services/mosques';
import MasjidLocationPicker from './MasjidLocationPicker';
import MasjidOpeningHoursPicker from './MasjidOpeningHoursPicker';
import { formatSwedishPostalCode } from './format';
import { reverseGeocode } from '../../services/nominatim';
import { masjidIconColor, masjidLabelColor } from './colors';

function errorMessage(code?: SubmitErrorCode): string {
  switch (code) {
    case 'rate_limit_hour': return 'Du har skickat för många förslag den senaste timmen. Försök igen om en stund.';
    case 'rate_limit_day':  return 'Du har nått dagsgränsen för förslag. Försök igen imorgon.';
    case 'submitter_blocked': return 'Du kan inte skicka förslag just nu.';
    case 'mosque_name_required': return 'Ange masjidens namn.';
    case 'mosque_coords_required': return 'Välj en plats på kartan.';
    default: return 'Något gick fel. Kontrollera din anslutning och försök igen.';
  }
}

export default function AddMasjidModal({
  visible,
  onClose,
  userLoc,
}: {
  visible: boolean;
  onClose: () => void;
  userLoc: { lat: number; lng: number } | null;
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
  // Editable text mirrors of the coordinate so the user can type lat/lng by
  // hand. Kept as strings (not derived from `coords`) so a half-typed value
  // like "59." isn't clobbered on every keystroke.
  const [latText, setLatText] = useState('');
  const [lngText, setLngText] = useState('');
  const [hours, setHours] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [prayerTimesUrl, setPrayerTimesUrl] = useState('');
  const [parking, setParking] = useState<boolean | null>(null);
  const [accessInfo, setAccessInfo] = useState('');
  const [image, setImage] = useState<{ uri: string; mime: string; size: number; base64: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [hoursPickerVisible, setHoursPickerVisible] = useState(false);
  const [fillingAddress, setFillingAddress] = useState(false);

  // Refs mirror the latest values so the awaited reverse-geocode callback below
  // never overwrites a field the user typed while the request was in flight
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
  // when BOTH values parse to a valid WGS84 range, otherwise leaves the last
  // good coordinate in place (the text still reflects what was typed).
  const applyManual = useCallback((latStr: string, lngStr: string) => {
    const lat = parseFloat(latStr.replace(',', '.'));
    const lng = parseFloat(lngStr.replace(',', '.'));
    if (isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      setCoords({ lat, lng });
    }
  }, []);
  const onLatChange = useCallback((t: string) => { setLatText(t); applyManual(t, lngText); }, [applyManual, lngText]);
  const onLngChange = useCallback((t: string) => { setLngText(t); applyManual(latText, t); }, [applyManual, latText]);

  const reset = useCallback(() => {
    reverseAbortRef.current?.abort();
    setName(''); setAddress(''); setPostal(''); setCity('');
    setCoords(null); setLatText(''); setLngText(''); setHours(''); setPhone(''); setWebsite(''); setPrayerTimesUrl('');
    setParking(null); setAccessInfo('');
    setImage(null); setSubmitting(false); setPickerVisible(false);
    setHoursPickerVisible(false);
    setFillingAddress(false);
  }, []);

  const closeReset = useCallback(() => { reset(); onClose(); }, [reset, onClose]);

  /**
   * "Använd min plats" — set the coordinate AND auto-fill empty address/postal/
   * city fields via Nominatim reverse geocoding. Non-destructive: any field the
   * user has already typed is preserved (re-checked at fill-time via refs).
   */
  const handleUseMyLocation = useCallback(async () => {
    if (!userLoc) return;
    applyCoords(userLoc.lat, userLoc.lng);

    // Skip the network round-trip entirely when every field is already filled.
    if (addressRef.current.trim() && postalRef.current.trim() && cityRef.current.trim()) return;

    reverseAbortRef.current?.abort();
    const controller = new AbortController();
    reverseAbortRef.current = controller;

    setFillingAddress(true);
    try {
      const geo = await reverseGeocode(userLoc.lat, userLoc.lng, controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      if (geo) {
        if (geo.address    && !addressRef.current.trim()) setAddress(geo.address);
        if (geo.postalCode && !postalRef.current.trim())  setPostal(formatSwedishPostalCode(geo.postalCode));
        if (geo.city       && !cityRef.current.trim())    setCity(geo.city);
      }
    } catch {
      // Silent: empty fields stay empty, user can type manually. No alert —
      // they still got the coordinate, which is what the button promises.
    } finally {
      if (mountedRef.current && reverseAbortRef.current === controller) setFillingAddress(false);
    }
  }, [userLoc, applyCoords]);

  const pickImage = useCallback(async () => {
    let ImagePicker: typeof import('expo-image-picker') | null = null;
    try { ImagePicker = require('expo-image-picker'); } catch { ImagePicker = null; }
    if (!ImagePicker) {
      Alert.alert('Bild ej tillgänglig', 'Det gick inte att öppna bildväljaren. Du kan skicka förslaget utan bild.');
      return;
    }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Åtkomst nekad', 'Tillåt åtkomst till bildbiblioteket i Inställningar.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.5, // compress on pick (no expo-image-manipulator needed)
        allowsEditing: false,
        presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];

      // Read the exact bytes we'd upload and measure the REAL size from the
      // base64 length. This is the ground truth (it's literally the upload
      // payload), unlike asset.fileSize / getInfoAsync which can be unreliable
      // for picked HEIC→JPEG assets. base64 length × 3/4 ≈ byte count.
      let base64: string;
      try {
        base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      } catch {
        Alert.alert('Bild ej tillgänglig', 'Det gick inte att läsa bilden. Du kan skicka förslaget utan bild.');
        return;
      }
      const size = Math.floor((base64.length * 3) / 4);

      if (size > MOSQUE_IMAGE_MAX_BYTES) {
        // Too big even after compression → do NOT keep it; submit stays imageless.
        Alert.alert('Bilden är för stor', 'Bilden behöver vara mindre än 5 MB. Välj en annan bild eller skicka förslaget utan bild.');
        return;
      }
      if (mountedRef.current) setImage({ uri: asset.uri, mime: asset.mimeType ?? 'image/jpeg', size, base64 });
    } catch {
      Alert.alert('Bild ej tillgänglig', 'Det gick inte att läsa bilden. Du kan skicka förslaget utan bild.');
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) { Alert.alert('Namn krävs', 'Ange masjidens namn.'); return; }
    if (!coords) { Alert.alert('Plats krävs', "Välj plats med “Använd min plats” eller “Välj på kartan”."); return; }

    setSubmitting(true);
    try {
      let image_url: string | null = null;
      let image_storage_path: string | null = null;
      if (image) {
        // Safety net: never start an upload for an oversize file.
        if (image.size > MOSQUE_IMAGE_MAX_BYTES) {
          setSubmitting(false);
          Alert.alert('Bilden är för stor', 'Bilden behöver vara mindre än 5 MB. Välj en annan bild eller skicka förslaget utan bild.');
          return;
        }
        const up = await uploadMosqueSubmissionImage(image.uri, image.mime, image.base64);
        if (up.error || !up.url) {
          if (mountedRef.current) {
            setSubmitting(false);
            Alert.alert(
              'Uppladdning misslyckades',
              up.error
                ? `Det gick inte att ladda upp bilden.\n\n(${up.error})`
                : 'Det gick inte att ladda upp bilden. Försök igen eller skicka utan bild.',
            );
          }
          return;
        }
        image_url = up.url;
        image_storage_path = up.path ?? null;
      }

      const res = await submitMosque({
        name: name.trim(),
        address: address.trim() || null,
        postal_code: postal.trim() || null,
        city: city.trim() || null,
        latitude: coords.lat,
        longitude: coords.lng,
        opening_hours: hours.trim() ? { alla: hours.trim() } : null,
        parking_available: parking,
        access_info: accessInfo.trim() || null,
        phone: phone.trim() || null,
        website: website.trim() || null,
        prayer_times_url: prayerTimesUrl.trim() || null,
        image_url,
        image_storage_path,
      });

      if (!mountedRef.current) return;
      setSubmitting(false);
      if (res.id) {
        Alert.alert('Tack!', 'Ditt förslag har skickats och granskas innan det publiceras.', [
          { text: 'OK', onPress: closeReset },
        ]);
      } else {
        Alert.alert('Kunde inte skicka', errorMessage(res.errorCode));
      }
    } catch {
      if (mountedRef.current) {
        setSubmitting(false);
        Alert.alert('Något gick fel', 'Kontrollera din anslutning och försök igen.');
      }
    }
  }, [name, coords, image, address, postal, city, hours, phone, website, prayerTimesUrl, parking, accessInfo, closeReset]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeReset}>
      <View style={[styles.root, { backgroundColor: T.bg }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: T.separator }]}>
          <TouchableOpacity onPress={closeReset} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.headerBtn, { color: masjidLabelColor(T) }]}>Avbryt</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: T.text }]}>Lägg till masjid</Text>
          <View style={{ width: 54 }} />
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
            <Field label="Namn *" value={name} onChangeText={setName} placeholder="Masjidens namn" T={T} />
            <Field label="Adress" value={address} onChangeText={setAddress} placeholder="Gata och nummer" T={T} />
            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Postnummer"
                  value={postal}
                  onChangeText={t => setPostal(formatSwedishPostalCode(t))}
                  placeholder="123 45"
                  keyboardType="numbers-and-punctuation"
                  T={T}
                />
              </View>
              <View style={{ flex: 2 }}>
                <Field label="Stad" value={city} onChangeText={setCity} placeholder="Stad" T={T} />
              </View>
            </View>

            {/* Position */}
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
              <TouchableOpacity
                style={[styles.posBtn, { backgroundColor: T.card, borderColor: T.border }]}
                onPress={() => setPickerVisible(true)}
                activeOpacity={0.8}
              >
                <Ionicons name="map" size={16} color={masjidIconColor(T)} />
                <Text style={[styles.posBtnText, { color: T.text }]}>Välj på kartan</Text>
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

            {/* Telefon */}
            <View style={{ marginBottom: 14 }}>
              <Text style={[styles.label, { color: masjidLabelColor(T) }]}>Telefon</Text>
              <TextInput
                style={[styles.input, { backgroundColor: T.card, borderColor: T.border, color: T.text }]}
                value={phone} onChangeText={setPhone}
                placeholder="t.ex. 070-123 45 67" placeholderTextColor={masjidLabelColor(T)}
                keyboardType="phone-pad" autoCorrect={false}
              />
            </View>

            {/* Hemsida */}
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

            {/* Parking */}
            <Text style={[styles.label, { color: masjidLabelColor(T) }]}>Parkering</Text>
            <View style={styles.segment}>
              {([['Ja', true], ['Nej', false]] as const).map(([lbl, val]) => {
                const active = parking === val;
                return (
                  <TouchableOpacity
                    key={lbl}
                    style={[styles.segBtn, { backgroundColor: active ? T.accent : T.card, borderColor: T.border }]}
                    onPress={() => setParking(active ? null : val)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.segText, { color: active ? '#fff' : T.text }]}>{lbl}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Field label="Tillgänglighet / övrig info" value={accessInfo} onChangeText={setAccessInfo} placeholder="t.ex. rullstolsanpassad entré" multiline T={T} />

            {/* Image */}
            <Text style={[styles.label, { color: masjidLabelColor(T) }]}>Bild (valfri)</Text>
            {image ? (
              <View style={[styles.imageWrap, { borderColor: T.border }]}>
                <Image source={{ uri: image.uri }} style={styles.image} contentFit="cover" />
                <TouchableOpacity style={[styles.imageRemove, { backgroundColor: T.card }]} onPress={() => setImage(null)}>
                  <Ionicons name="close" size={18} color={T.text} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={[styles.imagePick, { backgroundColor: T.card, borderColor: T.border }]} onPress={pickImage} activeOpacity={0.8}>
                <Ionicons name="image-outline" size={20} color={masjidIconColor(T)} />
                <Text style={[styles.posBtnText, { color: T.text }]}>Lägg till en bild (max 5 MB)</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.submit, { backgroundColor: T.accent, opacity: submitting ? 0.7 : 1 }]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Skicka för granskning</Text>}
            </TouchableOpacity>
            <Text style={[styles.note, { color: masjidLabelColor(T) }]}>
              Ditt förslag granskas av en administratör innan det publiceras.
            </Text>
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
        // Auto-geocode the typed address on first open via Nominatim's
        // STRUCTURED search (each field hits the right index → precise hit
        // even for "Fornbyvägen 29, 163 70 Stockholm"). Once the user has
        // confirmed a coordinate we pass `null` so re-opening the picker
        // doesn't yank the crosshair back to the address and overwrite their
        // manual pan.
        addressQuery={coords ? null : { street: address, postalCode: postal, city }}
        onCancel={() => setPickerVisible(false)}
        onPicked={(lat, lng) => { applyCoords(lat, lng); setPickerVisible(false); }}
      />
    </Modal>
  );
}

function Field({
  label, value, onChangeText, placeholder, multiline, keyboardType, T,
}: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder: string;
  multiline?: boolean; keyboardType?: 'default' | 'numbers-and-punctuation'; T: any;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[styles.label, { color: masjidLabelColor(T) }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: T.card, borderColor: T.border, color: T.text },
          multiline && { height: 80, textAlignVertical: 'top' },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={masjidLabelColor(T)}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { fontSize: 16 },
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
  imageWrap: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', height: 160 },
  image: { width: '100%', height: '100%' },
  imageRemove: { position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  imagePick: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 16 },
  submit: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 22 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  note: { fontSize: 12, textAlign: 'center', marginTop: 10 },
});
