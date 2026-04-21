/**
 * Admin Announcements screen — hidden, accessible only via the triple-tap
 * logo gesture on the Home Screen after Supabase Auth + PIN verification.
 *
 * Admins can create/edit/delete popup and banner announcements with optional
 * images, date windows, and push notification mode.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  Modal, Image, ActivityIndicator, StyleSheet, Switch,
  KeyboardAvoidingView, Platform, Alert, RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
// Lazy-load expo-image-picker — the native module requires a rebuilt binary.
// Until the app is rebuilt, this degrades gracefully instead of crashing on import.
let ImagePicker: typeof import('expo-image-picker') | null = null;
try { ImagePicker = require('expo-image-picker'); } catch { ImagePicker = null; }
import Svg, { Path, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../context/ThemeContext';
import { Storage } from '../services/storage';
import {
  Announcement, AnnouncementInput, DisplayType, NotifMode,
  fetchAllAnnouncements, createAnnouncement, updateAnnouncement,
  deleteAnnouncement, uploadAnnouncementImage,
} from '../services/announcementsApi';
import BackButton from '../components/BackButton';

// ── Types ──────────────────────────────────────────────────────────────────────
type FormState = {
  title:             string;
  message:           string;
  image_url:         string;
  link_url:          string;
  link_text:         string;
  display_type:      DisplayType;
  notification_mode: NotifMode;
  is_active:         boolean;
  starts_at:         string;  // ISO string or empty
  ends_at:           string;  // ISO string or empty
};

const EMPTY_FORM: FormState = {
  title: '', message: '', image_url: '',
  link_url: '', link_text: '',
  display_type: 'banner', notification_mode: 'none',
  is_active: false, starts_at: '', ends_at: '',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const MONTHS_SV = ['Januari','Februari','Mars','April','Maj','Juni','Juli','Augusti','September','Oktober','November','December'];
const DAYS_SV   = ['Mån','Tis','Ons','Tor','Fre','Lör','Sön'];

function fmtDate(iso: string | null): string {
  if (!iso) return '–';
  try {
    return new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function fmtDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getDate()} ${MONTHS_SV[d.getMonth()].slice(0,3)} ${d.getFullYear()}  ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  } catch { return iso; }
}

function getMonthGrid(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);
  const pad   = (first.getDay() + 6) % 7; // Monday = 0
  const cells: (Date | null)[] = [];
  for (let i = 0; i < pad; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

function statusBadge(a: Announcement): { label: string; color: string } {
  if (!a.is_active) return { label: 'Inaktiv', color: '#8E8E93' };
  const now = new Date();
  if (a.starts_at && new Date(a.starts_at) > now) return { label: 'Schemalagd', color: '#FF9500' };
  if (a.ends_at && new Date(a.ends_at) < now)     return { label: 'Utgången',   color: '#FF3B30' };
  return { label: 'Aktiv', color: '#34C759' };
}

// ── Main Screen ────────────────────────────────────────────────────────────────
export default function AdminAnnouncementsScreen() {
  const { theme: T, isDark } = useTheme();
  const router               = useRouter();
  const insets               = useSafeAreaInsets();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [showForm,      setShowForm]      = useState(false);
  const [editing,       setEditing]       = useState<Announcement | null>(null);
  const [form,          setForm]          = useState<FormState>(EMPTY_FORM);
  const [saving,          setSaving]          = useState(false);
  const [imageLoading,    setImageLoading]    = useState(false);
  const [formError,       setFormError]       = useState('');
  const [datePickerTarget, setDatePickerTarget] = useState<'starts_at' | 'ends_at' | null>(null);

  // ── Hem-banner topp (local AsyncStorage, no Supabase) ─────────────────────
  const HT_KEY = 'andalus_home_top_banner_v1';
  const [htText,     setHtText]     = useState('');
  const [htUrl,      setHtUrl]      = useState('');
  const [htActive,   setHtActive]   = useState(false);
  const [htExpanded, setHtExpanded] = useState(false);
  const [htSaving,   setHtSaving]   = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(HT_KEY).then(raw => {
      if (!raw) return;
      try {
        const { text, url, active } = JSON.parse(raw);
        setHtText(text ?? '');
        setHtUrl(url ?? '');
        setHtActive(active ?? false);
      } catch {}
    });
  }, []);

  const saveHt = useCallback(async () => {
    setHtSaving(true);
    await AsyncStorage.setItem(HT_KEY, JSON.stringify({ text: htText.trim(), url: htUrl.trim(), active: htActive }));
    setHtSaving(false);
    setHtExpanded(false);
  }, [htText, htUrl, htActive]);

  const clearHt = useCallback(async () => {
    await AsyncStorage.removeItem(HT_KEY);
    setHtText(''); setHtUrl(''); setHtActive(false); setHtExpanded(false);
  }, []);

  const appUserId = Storage.getItem('islamnu_user_id') ?? '';

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true); else setLoading(true);
    const data = await fetchAllAnnouncements();
    setAnnouncements(data);
    if (showRefresh) setRefreshing(false); else setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Form helpers ───────────────────────────────────────────────────────────
  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowForm(true);
  }, []);

  const openEdit = useCallback((a: Announcement) => {
    setEditing(a);
    setForm({
      title:             a.title,
      message:           a.message ?? '',
      image_url:         a.image_url ?? '',
      link_url:          a.link_url  ?? '',
      link_text:         a.link_text ?? '',
      display_type:      a.display_type,
      notification_mode: a.notification_mode,
      is_active:         a.is_active,
      starts_at:         a.starts_at ? a.starts_at.slice(0, 16) : '',
      ends_at:           a.ends_at   ? a.ends_at.slice(0, 16)   : '',
    });
    setFormError('');
    setShowForm(true);
  }, []);

  const closeForm = useCallback(() => {
    setShowForm(false);
    setEditing(null);
  }, []);

  const setField = useCallback(<K extends keyof FormState>(key: K, val: FormState[K]) => {
    setForm(f => ({ ...f, [key]: val }));
    setFormError('');
  }, []);

  // ── Date picker ───────────────────────────────────────────────────────────
  const openDatePicker = useCallback((target: 'starts_at' | 'ends_at') => {
    setDatePickerTarget(target);
  }, []);

  const handleDateConfirm = useCallback((date: Date) => {
    if (datePickerTarget) setField(datePickerTarget, date.toISOString());
    setDatePickerTarget(null);
  }, [datePickerTarget, setField]);

  const handleDateClear = useCallback(() => {
    if (datePickerTarget) setField(datePickerTarget, '');
    setDatePickerTarget(null);
  }, [datePickerTarget, setField]);

  // ── Image picker ───────────────────────────────────────────────────────────
  const handlePickImage = useCallback(async () => {
    if (!ImagePicker) {
      Alert.alert('Kräver ombyggnad', 'expo-image-picker är installerat men kräver en ny native build (expo prebuild --clean). Ange en bild-URL manuellt tills dess.');
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Åtkomst nekad', 'Tillåt åtkomst till bildbiblioteket i Inställningar.');
      return;
    }
    // allowsEditing + aspect konfliktar med iOS Modal och låser UI — ta bort dem.
    // presentationStyle FULL_SCREEN krävs för att pickern ska presenteras korrekt
    // när den anropas inifrån en React Native Modal.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality:    0.85,
      allowsEditing: false,
      presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setImageLoading(true);
    const mime = asset.mimeType ?? 'image/jpeg';
    const { url, error } = await uploadAnnouncementImage(asset.uri, mime);
    setImageLoading(false);

    if (error || !url) {
      Alert.alert('Uppladdning misslyckades', error ?? 'Okänt fel.');
      return;
    }
    setField('image_url', url);
  }, [setField]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (form.display_type !== 'popup' && !form.title.trim()) { setFormError('Titel krävs.'); return; }

    setSaving(true); setFormError('');
    const payload: AnnouncementInput = {
      title:             form.title.trim(),
      message:           form.message.trim() || null,
      image_url:         form.display_type === 'notification_only' ? null : (form.image_url.trim() || null),
      link_url:          form.link_url.trim()  || null,
      link_text:         form.link_text.trim() || null,
      display_type:      form.display_type,
      // notification_only always forces push; banner uses form choice; popup: none
      notification_mode: form.display_type === 'notification_only' ? 'push'
                       : form.display_type === 'banner' ? form.notification_mode
                       : 'none',
      is_active:         form.is_active,
      starts_at:         form.starts_at || null,
      ends_at:           form.ends_at   || null,
      created_by_app_user_id: editing?.created_by_app_user_id ?? appUserId,
    };

    if (editing) {
      const { error } = await updateAnnouncement(editing.id, payload);
      if (error) { setSaving(false); setFormError(error); return; }
    } else {
      const { error } = await createAnnouncement(payload);
      if (error) { setSaving(false); setFormError(error); return; }
    }

    setSaving(false);
    closeForm();
    load();
  }, [form, editing, appUserId, closeForm, load]);

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(() => {
    if (!editing) return;
    Alert.alert(
      'Radera meddelande',
      `Vill du permanent radera "${editing.title}"?`,
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Radera', style: 'destructive',
          onPress: async () => {
            setSaving(true);
            const { error } = await deleteAnnouncement(editing.id);
            setSaving(false);
            if (error) { setFormError(error); return; }
            closeForm();
            load();
          },
        },
      ],
    );
  }, [editing, closeForm, load]);

  // ── Quick toggle active ────────────────────────────────────────────────────
  const handleToggleActive = useCallback(async (a: Announcement) => {
    await updateAnnouncement(a.id, { is_active: !a.is_active });
    load();
  }, [load]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={T.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      {/* Header */}
      <View style={{
        paddingTop: insets.top + 8, paddingBottom: 12,
        paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center',
        borderBottomWidth: 0.5, borderColor: T.border,
      }}>
        <BackButton onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: T.text }}>Admin · Notiser</Text>
          <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>Hantera meddelanden</Text>
        </View>
        {/* New button */}
        <TouchableOpacity
          onPress={openCreate}
          style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24">
            <Path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
          </Svg>
        </TouchableOpacity>
      </View>

      {/* List */}
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={T.accent} />}
      >
        {/* ── Hem-banner topp ─────────────────────────────────────────────── */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setHtExpanded(e => !e)}
          style={[styles.card, { backgroundColor: T.card, borderColor: T.border, marginBottom: 20 }]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: T.accent + '22', alignItems: 'center', justifyContent: 'center' }}>
                <Svg width={18} height={18} viewBox="0 0 24 24">
                  <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke={T.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                  <Path d="M9 22V12h6v10" stroke={T.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </Svg>
              </View>
              <View>
                <Text style={{ fontSize: 15, fontWeight: '600', color: T.text }}>Hem-banner topp</Text>
                <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 1 }}>
                  {htActive && htText ? 'Aktiv · ' + htText.slice(0, 30) + (htText.length > 30 ? '…' : '') : 'Inaktiv'}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {htActive && (
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#34C759' + '22' }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#34C759' }}>AKTIV</Text>
                </View>
              )}
              <Svg width={16} height={16} viewBox="0 0 24 24">
                <Path d={htExpanded ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} stroke={T.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </Svg>
            </View>
          </View>

          {htExpanded && (
            <View style={{ marginTop: 16, gap: 12 }}>
              <View style={{ backgroundColor: T.accent + '15', borderRadius: 10, padding: 12 }}>
                <Text style={{ color: T.accent, fontSize: 12, lineHeight: 18 }}>
                  Texten visas på hemskärmen och tonas om med hälsningen var 5:e sekund. Sparas lokalt på enheten.
                </Text>
              </View>

              <View>
                <Text style={{ fontSize: 12, fontWeight: '600', color: T.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>Bannertext</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: T.bg, borderColor: T.border, color: T.text, marginBottom: 0 }]}
                  value={htText}
                  onChangeText={setHtText}
                  placeholder="T.ex. Fredag 14:00 — Fredagsbön"
                  placeholderTextColor={T.textMuted}
                  selectionColor={T.accent}
                  multiline
                  numberOfLines={2}
                />
              </View>

              <View>
                <Text style={{ fontSize: 12, fontWeight: '600', color: T.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>URL (valfritt)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: T.bg, borderColor: T.border, color: T.text, marginBottom: 0 }]}
                  value={htUrl}
                  onChangeText={setHtUrl}
                  placeholder="https://..."
                  placeholderTextColor={T.textMuted}
                  selectionColor={T.accent}
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={[styles.row, { backgroundColor: T.bg, borderColor: T.border }]}>
                <View>
                  <Text style={{ fontSize: 14, fontWeight: '500', color: T.text }}>Aktivera banner</Text>
                  <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 1 }}>Visa på hemskärmen</Text>
                </View>
                <Switch
                  value={htActive}
                  onValueChange={setHtActive}
                  trackColor={{ false: T.border, true: T.accent }}
                  thumbColor="#fff"
                />
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={clearHt}
                  style={{ flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#FF3B30' + '66' }}
                >
                  <Text style={{ color: '#FF3B30', fontSize: 14, fontWeight: '600' }}>Rensa</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={saveHt}
                  disabled={htSaving}
                  style={{ flex: 2, paddingVertical: 11, borderRadius: 10, alignItems: 'center', backgroundColor: T.accent, opacity: htSaving ? 0.6 : 1 }}
                >
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{htSaving ? 'Sparar…' : 'Spara'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </TouchableOpacity>

        {/* ── Announcement divider ─────────────────────────────────────────── */}
        <Text style={{ fontSize: 12, fontWeight: '600', color: T.textMuted, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Meddelanden
        </Text>

        {announcements.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: 48, gap: 12 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: T.card, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={28} height={28} viewBox="0 0 24 24">
                <Path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z" fill={T.textMuted} />
              </Svg>
            </View>
            <Text style={{ fontSize: 15, color: T.textMuted }}>Inga meddelanden ännu</Text>
            <TouchableOpacity
              onPress={openCreate}
              style={{ paddingHorizontal: 20, paddingVertical: 10, backgroundColor: T.accent, borderRadius: 20 }}
            >
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Skapa ett meddelande</Text>
            </TouchableOpacity>
          </View>
        ) : (
          announcements.map(a => {
            const badge = statusBadge(a);
            return (
              <TouchableOpacity
                key={a.id}
                activeOpacity={0.75}
                onPress={() => openEdit(a)}
                style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}
              >
                {/* Image thumbnail */}
                {a.image_url ? (
                  <Image
                    source={{ uri: a.image_url }}
                    style={{ width: '100%', height: 140, borderRadius: 10, marginBottom: 10 }}
                    resizeMode="cover"
                  />
                ) : null}

                {/* Header row */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  {/* Display type badge */}
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: T.accent + '22' }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: T.accent, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {a.display_type === 'popup' ? 'Popup' : a.display_type === 'notification_only' ? 'Notis' : 'Banner'}
                    </Text>
                  </View>
                  {/* Notification mode badge */}
                  {a.notification_mode === 'push' && (
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#FF9500' + '22' }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: '#FF9500', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Push
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }} />
                  {/* Status badge */}
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: badge.color + '22' }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: badge.color }}>
                      {badge.label}
                    </Text>
                  </View>
                </View>

                <Text style={{ fontSize: 15, fontWeight: '600', color: T.text, marginBottom: 4 }} numberOfLines={2}>
                  {a.title}
                </Text>
                {a.message ? (
                  <Text style={{ fontSize: 13, color: T.textMuted, marginBottom: 8 }} numberOfLines={2}>
                    {a.message}
                  </Text>
                ) : null}

                {/* Date window */}
                {(a.starts_at || a.ends_at) ? (
                  <Text style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>
                    {a.starts_at ? 'Från ' + fmtDate(a.starts_at) : ''}
                    {a.starts_at && a.ends_at ? ' · ' : ''}
                    {a.ends_at ? 'Till ' + fmtDate(a.ends_at) : ''}
                  </Text>
                ) : null}

                {/* Active toggle inline */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: T.textMuted }}>
                    Senast ändrad {fmtDate(a.updated_at)}
                  </Text>
                  <Switch
                    value={a.is_active}
                    onValueChange={() => handleToggleActive(a)}
                    trackColor={{ false: T.border, true: T.accent }}
                    thumbColor="#fff"
                  />
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* ── Create / Edit Modal ── */}
      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeForm}>
        <View style={{ flex: 1, backgroundColor: T.bg }}>
          {/* Form header */}
          <View style={{
            paddingTop: 20, paddingBottom: 12, paddingHorizontal: 20,
            flexDirection: 'row', alignItems: 'center',
            borderBottomWidth: 0.5, borderColor: T.border,
          }}>
            <TouchableOpacity onPress={closeForm} style={{ padding: 4 }}>
              <Text style={{ fontSize: 15, color: T.accent }}>Avbryt</Text>
            </TouchableOpacity>
            <Text style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: T.text }}>
              {editing ? 'Redigera' : 'Nytt meddelande'}
            </Text>
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={{ padding: 4 }}
            >
              <Text style={{ fontSize: 15, color: T.accent, fontWeight: '600', opacity: saving ? 0.5 : 1 }}>
                {saving ? 'Sparar...' : 'Spara'}
              </Text>
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">

              {/* Error */}
              {!!formError && (
                <View style={{ backgroundColor: '#FF3B30' + '18', borderRadius: 10, padding: 12, marginBottom: 14 }}>
                  <Text style={{ color: '#FF3B30', fontSize: 13 }}>{formError}</Text>
                </View>
              )}

              {/* Image */}
              <Label T={T}>Bild (valfritt)</Label>
              <TouchableOpacity
                onPress={handlePickImage}
                disabled={imageLoading}
                style={[styles.imagePicker, { backgroundColor: T.card, borderColor: T.border }]}
              >
                {imageLoading ? (
                  <ActivityIndicator color={T.accent} />
                ) : form.image_url ? (
                  <Image source={{ uri: form.image_url }} style={{ width: '100%', height: '100%', borderRadius: 10 }} resizeMode="cover" />
                ) : (
                  <View style={{ alignItems: 'center', gap: 6 }}>
                    <Svg width={28} height={28} viewBox="0 0 24 24">
                      <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke={T.textMuted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </Svg>
                    <Text style={{ color: T.textMuted, fontSize: 13 }}>Välj bild från bibliotek</Text>
                  </View>
                )}
              </TouchableOpacity>
              {form.image_url ? (
                <TouchableOpacity onPress={() => setField('image_url', '')} style={{ alignSelf: 'center', marginTop: 6 }}>
                  <Text style={{ color: '#FF3B30', fontSize: 13 }}>Ta bort bild</Text>
                </TouchableOpacity>
              ) : null}

              {/* Title */}
              <Label T={T}>Titel *</Label>
              <TextInput
                style={[styles.input, { backgroundColor: T.card, borderColor: T.border, color: T.text }]}
                value={form.title}
                onChangeText={v => setField('title', v)}
                placeholder="Meddelandets titel"
                placeholderTextColor={T.textMuted}
                selectionColor={T.accent}
                returnKeyType="next"
              />

              {/* Message */}
              <Label T={T}>Meddelande (valfritt)</Label>
              <TextInput
                style={[styles.input, styles.multiline, { backgroundColor: T.card, borderColor: T.border, color: T.text }]}
                value={form.message}
                onChangeText={v => setField('message', v)}
                placeholder="Brödtext..."
                placeholderTextColor={T.textMuted}
                selectionColor={T.accent}
                multiline
                numberOfLines={4}
              />

              {/* Link */}
              <Label T={T}>Länk-URL (valfritt)</Label>
              <TextInput
                style={[styles.input, { backgroundColor: T.card, borderColor: T.border, color: T.text }]}
                value={form.link_url}
                onChangeText={v => setField('link_url', v)}
                placeholder="https://..."
                placeholderTextColor={T.textMuted}
                selectionColor={T.accent}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />

              <Label T={T}>Länktext (valfritt)</Label>
              <TextInput
                style={[styles.input, { backgroundColor: T.card, borderColor: T.border, color: T.text }]}
                value={form.link_text}
                onChangeText={v => setField('link_text', v)}
                placeholder="Läs mer"
                placeholderTextColor={T.textMuted}
                selectionColor={T.accent}
                returnKeyType="next"
              />

              {/* Display type */}
              <Label T={T}>Visningstyp</Label>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                {([
                  ['banner', 'Hem-banner', 'Visas i flödet'],
                  ['popup',  'Popup',      'Visas vid öppning'],
                ] as [DisplayType, string, string][]).map(([dt, label, sub]) => (
                  <TouchableOpacity
                    key={dt}
                    onPress={() => setField('display_type', dt)}
                    style={{
                      flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center',
                      backgroundColor: form.display_type === dt ? T.accent : T.card,
                      borderWidth: 1, borderColor: form.display_type === dt ? T.accent : T.border,
                    }}
                  >
                    <Text style={{ fontWeight: '600', fontSize: 14, color: form.display_type === dt ? '#fff' : T.textMuted }}>{label}</Text>
                    <Text style={{ fontSize: 11, color: form.display_type === dt ? 'rgba(255,255,255,0.75)' : T.textMuted, marginTop: 2 }}>{sub}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                onPress={() => setField('display_type', 'notification_only')}
                style={{
                  paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginBottom: 16,
                  backgroundColor: form.display_type === 'notification_only' ? T.accent : T.card,
                  borderWidth: 1, borderColor: form.display_type === 'notification_only' ? T.accent : T.border,
                }}
              >
                <Text style={{ fontWeight: '600', fontSize: 14, color: form.display_type === 'notification_only' ? '#fff' : T.textMuted }}>
                  Notifikation
                </Text>
                <Text style={{ fontSize: 11, color: form.display_type === 'notification_only' ? 'rgba(255,255,255,0.75)' : T.textMuted, marginTop: 2 }}>
                  Bara push-notis, inget visas i appen
                </Text>
              </TouchableOpacity>

              {form.display_type === 'notification_only' && (
                <View style={{ backgroundColor: T.accent + '18', borderRadius: 10, padding: 12, marginBottom: 16 }}>
                  <Text style={{ color: T.accent, fontSize: 13, lineHeight: 19 }}>
                    Skickar en push-notifikation till alla användare. Inget visas i appen — vid klick öppnas hemskärmen.
                  </Text>
                </View>
              )}

              {/* Notification mode — only for banners */}
              {form.display_type === 'banner' && (
                <>
                  <Label T={T}>Push-avisering</Label>
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                    {([
                      { val: 'none', label: 'Ingen', sub: 'Bara i appen' },
                      { val: 'push', label: 'Push + banner', sub: 'Skickar avisering' },
                    ] as { val: NotifMode; label: string; sub: string }[]).map(({ val, label, sub }) => (
                      <TouchableOpacity
                        key={val}
                        onPress={() => setField('notification_mode', val)}
                        style={{
                          flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center',
                          backgroundColor: form.notification_mode === val ? T.accent : T.card,
                          borderWidth: 1, borderColor: form.notification_mode === val ? T.accent : T.border,
                        }}
                      >
                        <Text style={{ fontWeight: '600', fontSize: 14, color: form.notification_mode === val ? '#fff' : T.textMuted }}>
                          {label}
                        </Text>
                        <Text style={{ fontSize: 11, color: form.notification_mode === val ? 'rgba(255,255,255,0.75)' : T.textMuted, marginTop: 2 }}>
                          {sub}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {/* Active */}
              <View style={[styles.row, { backgroundColor: T.card, borderColor: T.border }]}>
                <View>
                  <Text style={{ fontSize: 15, fontWeight: '500', color: T.text }}>Aktivt</Text>
                  <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 1 }}>Visas för användare</Text>
                </View>
                <Switch
                  value={form.is_active}
                  onValueChange={v => setField('is_active', v)}
                  trackColor={{ false: T.border, true: T.accent }}
                  thumbColor="#fff"
                />
              </View>

              {/* Start date */}
              <Label T={T}>Startdatum (valfritt)</Label>
              <DatePickerRow
                value={form.starts_at}
                placeholder="Välj startdatum"
                onPress={() => openDatePicker('starts_at')}
                T={T}
              />

              {/* End date */}
              <Label T={T}>Slutdatum (valfritt)</Label>
              <DatePickerRow
                value={form.ends_at}
                placeholder="Välj slutdatum"
                onPress={() => openDatePicker('ends_at')}
                T={T}
              />

              {/* Delete button (edit only) */}
              {editing && (
                <TouchableOpacity
                  onPress={handleDelete}
                  disabled={saving}
                  style={[styles.deleteBtn, { borderColor: '#FF3B30' + '66' }]}
                >
                  <Text style={{ color: '#FF3B30', fontSize: 15, fontWeight: '600' }}>
                    Radera meddelande
                  </Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>

        {/* Date picker floats above the form modal */}
        <DatePickerModal
          visible={datePickerTarget !== null}
          initialValue={
            datePickerTarget && form[datePickerTarget]
              ? new Date(form[datePickerTarget])
              : new Date()
          }
          onConfirm={handleDateConfirm}
          onClear={handleDateClear}
          onCancel={() => setDatePickerTarget(null)}
          T={T}
          isDark={isDark}
        />
      </Modal>
    </View>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function Label({ T, children }: { T: any; children: string }) {
  return (
    <Text style={{ fontSize: 13, fontWeight: '600', color: T.textMuted, marginBottom: 6, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {children}
    </Text>
  );
}

function DatePickerRow({ value, placeholder, onPress, T }: {
  value: string; placeholder: string; onPress: () => void; T: any;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.dateRow, { backgroundColor: T.card, borderColor: T.border }]}
      activeOpacity={0.7}
    >
      <Text style={{ fontSize: 15, color: value ? T.text : T.textMuted, flex: 1 }}>
        {value ? fmtDateShort(value) : placeholder}
      </Text>
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
        <Rect x="3" y="4" width="18" height="18" rx="2" stroke={T.textMuted} strokeWidth="1.8"/>
        <Path d="M16 2v4M8 2v4M3 10h18" stroke={T.textMuted} strokeWidth="1.8" strokeLinecap="round"/>
      </Svg>
    </TouchableOpacity>
  );
}

// ── Date Picker Modal ──────────────────────────────────────────────────────────
function DatePickerModal({ visible, initialValue, onConfirm, onClear, onCancel, T, isDark }: {
  visible:      boolean;
  initialValue: Date;
  onConfirm:    (date: Date) => void;
  onClear:      () => void;
  onCancel:     () => void;
  T:            any;
  isDark:       boolean;
}) {
  const today = new Date();

  const [year,   setYear]   = useState(initialValue.getFullYear());
  const [month,  setMonth]  = useState(initialValue.getMonth());
  const [day,    setDay]    = useState(initialValue.getDate());
  const [hour,   setHour]   = useState(initialValue.getHours());
  const [minute, setMinute] = useState(Math.round(initialValue.getMinutes() / 15) * 15 % 60);

  // Sync to initialValue when picker opens
  useEffect(() => {
    if (!visible) return;
    setYear(initialValue.getFullYear());
    setMonth(initialValue.getMonth());
    setDay(initialValue.getDate());
    setHour(initialValue.getHours());
    setMinute(Math.round(initialValue.getMinutes() / 15) * 15 % 60);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const prevMonth = useCallback(() => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
    setDay(1);
  }, [month]);

  const nextMonth = useCallback(() => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
    setDay(1);
  }, [month]);

  const rows = getMonthGrid(year, month);

  const isToday = (d: Date) =>
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();

  const handleConfirm = useCallback(() => {
    onConfirm(new Date(year, month, day, hour, minute, 0, 0));
  }, [year, month, day, hour, minute, onConfirm]);

  // Clamp day when month changes
  const maxDay = new Date(year, month + 1, 0).getDate();
  const safeDay = Math.min(day, maxDay);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* Backdrop */}
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} />
        </TouchableOpacity>

        {/* Sheet */}
        <View style={[dpStyles.sheet, { backgroundColor: T.card }]}>

          {/* Header */}
          <View style={dpStyles.header}>
            <TouchableOpacity onPress={onCancel} style={{ padding: 4 }}>
              <Text style={{ fontSize: 15, color: T.textMuted }}>Avbryt</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: '700', color: T.text }}>
              {MONTHS_SV[month]} {year}
            </Text>
            <TouchableOpacity onPress={handleConfirm} style={{ padding: 4 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: T.accent }}>Klar</Text>
            </TouchableOpacity>
          </View>

          {/* Month navigation */}
          <View style={dpStyles.monthNav}>
            <TouchableOpacity onPress={prevMonth} style={[dpStyles.navBtn, { borderColor: T.border }]}>
              <Svg width={16} height={16} viewBox="0 0 24 24">
                <Path d="M15 18l-6-6 6-6" stroke={T.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </Svg>
            </TouchableOpacity>
            <Text style={{ fontSize: 15, fontWeight: '600', color: T.text }}>
              {MONTHS_SV[month]} {year}
            </Text>
            <TouchableOpacity onPress={nextMonth} style={[dpStyles.navBtn, { borderColor: T.border }]}>
              <Svg width={16} height={16} viewBox="0 0 24 24">
                <Path d="M9 18l6-6-6-6" stroke={T.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </Svg>
            </TouchableOpacity>
          </View>

          {/* Day initials */}
          <View style={dpStyles.dayRow}>
            {DAYS_SV.map(d => (
              <Text key={d} style={[dpStyles.dayLabel, { color: T.textMuted }]}>{d}</Text>
            ))}
          </View>

          {/* Calendar grid */}
          {rows.map((row, ri) => (
            <View key={ri} style={dpStyles.dayRow}>
              {row.map((cell, ci) => {
                if (!cell) return <View key={ci} style={dpStyles.dayCell} />;
                const isSelected = cell.getDate() === safeDay && cell.getMonth() === month && cell.getFullYear() === year;
                const isTod      = isToday(cell);
                return (
                  <TouchableOpacity
                    key={ci}
                    onPress={() => setDay(cell.getDate())}
                    style={[
                      dpStyles.dayCell,
                      isSelected && { backgroundColor: T.accent, borderRadius: 18 },
                      !isSelected && isTod && { borderRadius: 18, borderWidth: 1.5, borderColor: '#FF3B30' },
                    ]}
                  >
                    <Text style={{
                      fontSize: 14, fontWeight: isSelected || isTod ? '700' : '400',
                      color: isSelected ? '#fff' : isTod ? '#FF3B30' : T.text,
                    }}>
                      {cell.getDate()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          {/* Divider */}
          <View style={{ height: 0.5, backgroundColor: T.border, marginVertical: 14 }} />

          {/* Time picker */}
          <View style={dpStyles.timeRow}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: T.textMuted, marginRight: 'auto' as any }}>Tid</Text>

            {/* Hour */}
            <View style={dpStyles.timeStepper}>
              <TouchableOpacity onPress={() => setHour(h => (h + 23) % 24)} style={[dpStyles.stepBtn, { borderColor: T.border }]}>
                <Text style={{ fontSize: 16, color: T.text }}>−</Text>
              </TouchableOpacity>
              <Text style={[dpStyles.timeValue, { color: T.text }]}>
                {String(hour).padStart(2, '0')}
              </Text>
              <TouchableOpacity onPress={() => setHour(h => (h + 1) % 24)} style={[dpStyles.stepBtn, { borderColor: T.border }]}>
                <Text style={{ fontSize: 16, color: T.text }}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 18, fontWeight: '700', color: T.text, marginHorizontal: 4 }}>:</Text>

            {/* Minute (0 / 15 / 30 / 45) */}
            <View style={dpStyles.timeStepper}>
              <TouchableOpacity onPress={() => setMinute(m => (m + 45) % 60)} style={[dpStyles.stepBtn, { borderColor: T.border }]}>
                <Text style={{ fontSize: 16, color: T.text }}>−</Text>
              </TouchableOpacity>
              <Text style={[dpStyles.timeValue, { color: T.text }]}>
                {String(minute).padStart(2, '0')}
              </Text>
              <TouchableOpacity onPress={() => setMinute(m => (m + 15) % 60)} style={[dpStyles.stepBtn, { borderColor: T.border }]}>
                <Text style={{ fontSize: 16, color: T.text }}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Clear */}
          <TouchableOpacity onPress={onClear} style={{ alignItems: 'center', paddingVertical: 12 }}>
            <Text style={{ fontSize: 14, color: '#FF3B30' }}>Rensa datum</Text>
          </TouchableOpacity>

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14, borderWidth: 0.5,
    padding: 14, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 3,
  },
  imagePicker: {
    height: 160, borderRadius: 12, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4, overflow: 'hidden',
  },
  input: {
    borderWidth: 1, borderRadius: 12,
    padding: 14, fontSize: 15, marginBottom: 16,
  },
  multiline: {
    minHeight: 100, textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 16,
  },
  dateRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 16,
  },
  deleteBtn: {
    marginTop: 24, padding: 16, borderRadius: 12,
    borderWidth: 1, alignItems: 'center',
  },
});

const DAY_SIZE = 36;

const dpStyles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 16, paddingBottom: 36, paddingTop: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 16, elevation: 12,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 0,
  },
  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  navBtn: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 0.5,
    alignItems: 'center', justifyContent: 'center',
  },
  dayRow: {
    flexDirection: 'row', justifyContent: 'space-around', marginBottom: 2,
  },
  dayLabel: {
    width: DAY_SIZE, textAlign: 'center',
    fontSize: 11, fontWeight: '600',
  },
  dayCell: {
    width: DAY_SIZE, height: DAY_SIZE,
    alignItems: 'center', justifyContent: 'center',
  },
  timeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    marginBottom: 8, gap: 4,
  },
  timeStepper: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  stepBtn: {
    width: 34, height: 34, borderRadius: 10, borderWidth: 0.5,
    alignItems: 'center', justifyContent: 'center',
  },
  timeValue: {
    width: 34, textAlign: 'center',
    fontSize: 17, fontWeight: '700',
  },
});
