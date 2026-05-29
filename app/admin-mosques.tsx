/**
 * Admin · Masjid — moderation & management for "Närmaste masjid".
 *
 * Reached from the existing admin area (Admin · Notiser → "Masjid-moderering"),
 * which is itself gated by the existing Supabase Auth + PIN flow. There is NO
 * separate login: every action here uses the already-established admin session
 * and is enforced server-side by is_linked_admin() RLS (see services/mosques.ts).
 *
 * No background polling, no realtime subscriptions — data loads on mount, on tab
 * change, on pull-to-refresh, and after an action. Clean unmount via mountedRef.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet,
  RefreshControl, Alert, Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import BackButton from '../components/BackButton';
import {
  adminListMosques, adminApproveMosque, adminRejectMosque, adminSetMosqueStatus,
  adminBlockSubmitter, adminDeleteMosque, adminDeleteAllHidden, type AdminMosque,
} from '../services/mosques';
import MasjidAdminEditModal from '../components/masjid/MasjidAdminEditModal';

type Tab = 'pending' | 'approved' | 'hidden';
const TABS: { key: Tab; label: string }[] = [
  { key: 'pending', label: 'Väntande' },
  { key: 'approved', label: 'Publicerade' },
  { key: 'hidden', label: 'Dolda' },
];

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

export default function AdminMosquesScreen() {
  const { theme: T } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('pending');
  const [items, setItems] = useState<AdminMosque[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const [editVisible, setEditVisible] = useState(false);
  const [editMode, setEditMode] = useState<'edit' | 'create'>('edit');
  const [editMosque, setEditMosque] = useState<AdminMosque | null>(null);

  const [rejectTarget, setRejectTarget] = useState<AdminMosque | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [blockTarget, setBlockTarget] = useState<AdminMosque | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [blockDays, setBlockDays] = useState<number | null>(null); // null = permanent

  const mountedRef = useRef(true);
  const loadIdRef = useRef(0);

  const load = useCallback(async (t: Tab, isRefresh = false) => {
    const myId = ++loadIdRef.current;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      let rows: AdminMosque[];
      if (t === 'hidden') {
        const [r, b] = await Promise.all([adminListMosques('rejected'), adminListMosques('blocked')]);
        rows = [...r, ...b].sort((a, b2) => (a.created_at < b2.created_at ? 1 : -1));
      } else {
        rows = await adminListMosques(t === 'pending' ? 'pending' : 'approved');
      }
      if (!mountedRef.current || myId !== loadIdRef.current) return;
      setItems(rows);
    } catch (e) {
      if (mountedRef.current && myId === loadIdRef.current) {
        setItems([]);
        Alert.alert('Kunde inte hämta', 'Är du inloggad som admin? ' + String(e));
      }
    } finally {
      if (mountedRef.current && myId === loadIdRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  const refreshCurrent = useCallback(() => load(tab, true), [tab, load]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((m) => {
      const hay = [m.name, m.address, m.city, m.postal_code, m.access_info]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [items, search]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const runAction = useCallback(async (fn: () => Promise<void>) => {
    try { await fn(); if (mountedRef.current) load(tab); }
    catch (e) { Alert.alert('Åtgärden misslyckades', String(e)); }
  }, [tab, load]);

  const approve = (m: AdminMosque) =>
    Alert.alert('Godkänn masjid', `Publicera “${m.name}”?`, [
      { text: 'Avbryt', style: 'cancel' },
      { text: 'Godkänn', onPress: () => runAction(() => adminApproveMosque(m.id)) },
    ]);

  const unpublish = (m: AdminMosque) =>
    Alert.alert('Avpublicera', `Dölj “${m.name}” från publika listan?`, [
      { text: 'Avbryt', style: 'cancel' },
      { text: 'Avpublicera', style: 'destructive', onPress: () => runAction(() => adminSetMosqueStatus(m.id, 'rejected')) },
    ]);

  const restore = (m: AdminMosque) =>
    Alert.alert('Återställ', `Publicera “${m.name}” igen?`, [
      { text: 'Avbryt', style: 'cancel' },
      { text: 'Återställ', onPress: () => runAction(() => adminSetMosqueStatus(m.id, 'approved')) },
    ]);

  // Permanent delete — removes the row (and its image) from Supabase entirely so
  // it never appears in any list, not even Dolda. Irreversible.
  const deleteMosque = (m: AdminMosque) =>
    Alert.alert('Radera masjid', `Radera “${m.name}” permanent? Detta går inte att ångra.`, [
      { text: 'Avbryt', style: 'cancel' },
      { text: 'Radera', style: 'destructive', onPress: () => runAction(() => adminDeleteMosque(m.id, m.image_storage_path)) },
    ]);

  const deleteAllHidden = () => {
    if (items.length === 0) return;
    Alert.alert(
      'Radera alla dolda',
      `Radera alla ${items.length} dolda masjider permanent från Supabase? Detta går inte att ångra.`,
      [
        { text: 'Avbryt', style: 'cancel' },
        { text: 'Radera alla', style: 'destructive', onPress: () => runAction(async () => { await adminDeleteAllHidden(); }) },
      ],
    );
  };

  const openEdit = (m: AdminMosque) => { setEditMode('edit'); setEditMosque(m); setEditVisible(true); };
  const openCreate = () => { setEditMode('create'); setEditMosque(null); setEditVisible(true); };

  const openReject = (m: AdminMosque) => { setRejectTarget(m); setRejectReason(''); };
  const confirmReject = () => {
    const m = rejectTarget; if (!m) return;
    setRejectTarget(null);
    runAction(() => adminRejectMosque(m.id, rejectReason.trim() || null));
  };

  const openBlock = (m: AdminMosque) => { setBlockTarget(m); setBlockReason(''); setBlockDays(null); };
  const confirmBlock = () => {
    const m = blockTarget; if (!m) return;
    setBlockTarget(null);
    const blocked_until = blockDays == null ? null : new Date(Date.now() + blockDays * 86400000).toISOString();
    runAction(async () => {
      await adminBlockSubmitter({
        user_id: m.submitted_by_user_id,
        device_id_hash: m.submitted_device_hash,
        reason: blockReason.trim() || null,
        blocked_until,
      });
      await adminSetMosqueStatus(m.id, 'blocked');
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────--
  const renderCard = (m: AdminMosque) => {
    const addr = [m.address, [m.postal_code, m.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const hours = m.opening_hours ? Object.entries(m.opening_hours).map(([k, v]) => `${k}: ${v}`).join(' · ') : null;
    const canBlock = !!(m.submitted_by_user_id || m.submitted_device_hash);
    return (
      <View key={m.id} style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <TouchableOpacity activeOpacity={0.8} onPress={() => openEdit(m)}>
          {!!m.image_url && <Image source={{ uri: m.image_url }} style={styles.cardImage} contentFit="cover" />}
          <View style={styles.cardHead}>
            <Text style={[styles.cardName, { color: T.text }]} numberOfLines={1}>{m.name}</Text>
            <Ionicons name="create-outline" size={18} color={T.textMuted} />
          </View>
          {!!addr && <Text style={[styles.cardLine, { color: T.textMuted }]}>{addr}</Text>}
          <Text style={[styles.cardLine, { color: T.textMuted }]}>{m.latitude.toFixed(5)}, {m.longitude.toFixed(5)}</Text>
          {!!hours && <Text style={[styles.cardLine, { color: T.textMuted }]} numberOfLines={1}>Öppettider: {hours}</Text>}
          <Text style={[styles.cardLine, { color: T.textMuted }]}>
            Parkering: {m.parking_available == null ? '–' : m.parking_available ? 'Ja' : 'Nej'}
            {'  ·  '}Rullstol: {m.wheelchair_accessible == null ? '–' : m.wheelchair_accessible ? 'Ja' : 'Nej'}
            {m.address_verified ? '  ·  ✓ verifierad' : ''}
          </Text>
          {!!m.access_info && <Text style={[styles.cardLine, { color: T.textMuted }]} numberOfLines={2}>{m.access_info}</Text>}
          {!!m.rejection_reason && <Text style={[styles.cardLine, { color: T.error }]}>Avvisad: {m.rejection_reason}</Text>}
          <Text style={[styles.cardMeta, { color: T.textTertiary }]}>Inskickad {fmtDate(m.created_at)}</Text>
        </TouchableOpacity>

        <View style={[styles.cardActions, { borderTopColor: T.separator }]}>
          {tab === 'pending' && (
            <>
              <ActionBtn icon="checkmark-circle" label="Godkänn" color={T.success} onPress={() => approve(m)} />
              <ActionBtn icon="close-circle" label="Avvisa" color={T.warning} onPress={() => openReject(m)} />
              {canBlock && <ActionBtn icon="ban" label="Blockera" color={T.error} onPress={() => openBlock(m)} />}
              <ActionBtn icon="trash" label="Radera" color={T.error} onPress={() => deleteMosque(m)} />
            </>
          )}
          {tab === 'approved' && (
            <>
              <ActionBtn icon="create" label="Redigera" color={T.accent} onPress={() => openEdit(m)} />
              <ActionBtn icon="eye-off" label="Avpublicera" color={T.warning} onPress={() => unpublish(m)} />
            </>
          )}
          {tab === 'hidden' && (
            <>
              <ActionBtn icon="refresh" label="Återställ" color={T.success} onPress={() => restore(m)} />
              <ActionBtn icon="create" label="Redigera" color={T.accent} onPress={() => openEdit(m)} />
              <ActionBtn icon="trash" label="Radera" color={T.error} onPress={() => deleteMosque(m)} />
            </>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: T.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderColor: T.border }]}>
        <BackButton onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: T.text }}>Admin · Masjid</Text>
          <Text style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>Moderering & hantering</Text>
        </View>
        <TouchableOpacity onPress={openCreate} style={[styles.addBtn, { backgroundColor: T.accent }]}>
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Segments */}
      <View style={[styles.segments, { backgroundColor: T.card, borderColor: T.border }]}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <TouchableOpacity key={t.key} style={[styles.segment, active && { backgroundColor: T.accent }]} onPress={() => setTab(t.key)} activeOpacity={0.8}>
              <Text style={[styles.segmentText, { color: active ? '#fff' : T.textMuted }]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Search */}
      <View style={[styles.searchWrap, { backgroundColor: T.card, borderColor: T.border }]}>
        <Ionicons name="search" size={16} color={T.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: T.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Sök masjid (namn, adress, stad)"
          placeholderTextColor={T.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {search.length > 0 && Platform.OS !== 'ios' && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={T.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={T.accent} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshCurrent} tintColor={T.accent} />}
          keyboardShouldPersistTaps="handled"
        >
          {tab === 'hidden' && items.length > 0 && (
            <TouchableOpacity
              style={[styles.deleteAllBtn, { borderColor: T.error }]}
              onPress={deleteAllHidden}
              activeOpacity={0.8}
            >
              <Ionicons name="trash" size={18} color={T.error} />
              <Text style={[styles.deleteAllText, { color: T.error }]}>Radera alla dolda ({items.length})</Text>
            </TouchableOpacity>
          )}
          {filteredItems.length === 0 ? (
            <Text style={[styles.empty, { color: T.textMuted }]}>
              {search.trim()
                ? `Inga träffar för “${search.trim()}”.`
                : tab === 'pending' ? 'Inga väntande förslag.'
                : tab === 'approved' ? 'Inga publicerade masjid.'
                : 'Inga dolda masjid.'}
            </Text>
          ) : filteredItems.map(renderCard)}
        </ScrollView>
      )}

      {/* Edit / create */}
      <MasjidAdminEditModal
        visible={editVisible}
        mode={editMode}
        mosque={editMosque}
        userLoc={null}
        onClose={() => setEditVisible(false)}
        onSaved={() => load(tab)}
      />

      {/* Reject reason */}
      <Modal visible={!!rejectTarget} transparent animationType="fade" onRequestClose={() => setRejectTarget(null)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.dialog, { backgroundColor: T.card }]}>
            <Text style={[styles.dialogTitle, { color: T.text }]}>Avvisa förslag</Text>
            <Text style={[styles.dialogSub, { color: T.textMuted }]}>Ange en valfri anledning (visas internt).</Text>
            <TextInput
              style={[styles.dialogInput, { backgroundColor: T.bg, borderColor: T.border, color: T.text }]}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="Anledning (valfritt)"
              placeholderTextColor={T.textMuted}
              multiline
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity style={styles.dialogBtn} onPress={() => setRejectTarget(null)}><Text style={{ color: T.textMuted, fontWeight: '600' }}>Avbryt</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.dialogBtn, { backgroundColor: T.warning, borderRadius: 10 }]} onPress={confirmReject}><Text style={{ color: '#fff', fontWeight: '700' }}>Avvisa</Text></TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Block submitter */}
      <Modal visible={!!blockTarget} transparent animationType="fade" onRequestClose={() => setBlockTarget(null)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.dialog, { backgroundColor: T.card }]}>
            <Text style={[styles.dialogTitle, { color: T.text }]}>Blockera inlämnare</Text>
            <Text style={[styles.dialogSub, { color: T.textMuted }]}>
              Blockerar {blockTarget?.submitted_by_user_id ? 'användar-ID' : ''}
              {blockTarget?.submitted_by_user_id && blockTarget?.submitted_device_hash ? ' + ' : ''}
              {blockTarget?.submitted_device_hash ? 'enhet (hash)' : ''} och döljer denna masjid.
            </Text>
            <View style={styles.durRow}>
              {([['Permanent', null], ['7 dagar', 7], ['30 dagar', 30]] as const).map(([lbl, d]) => {
                const active = blockDays === d;
                return (
                  <TouchableOpacity key={lbl} style={[styles.durBtn, { borderColor: T.border, backgroundColor: active ? T.error : T.bg }]} onPress={() => setBlockDays(d)}>
                    <Text style={{ color: active ? '#fff' : T.text, fontSize: 13, fontWeight: '600' }}>{lbl}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              style={[styles.dialogInput, { backgroundColor: T.bg, borderColor: T.border, color: T.text }]}
              value={blockReason}
              onChangeText={setBlockReason}
              placeholder="Anledning (valfritt)"
              placeholderTextColor={T.textMuted}
              multiline
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity style={styles.dialogBtn} onPress={() => setBlockTarget(null)}><Text style={{ color: T.textMuted, fontWeight: '600' }}>Avbryt</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.dialogBtn, { backgroundColor: T.error, borderRadius: 10 }]} onPress={confirmBlock}><Text style={{ color: '#fff', fontWeight: '700' }}>Blockera</Text></TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function ActionBtn({ icon, label, color, onPress }: { icon: any; label: string; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5 },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  segments: { flexDirection: 'row', margin: 16, marginBottom: 8, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 4, gap: 4 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  segmentText: { fontSize: 14, fontWeight: '600' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: Platform.OS === 'ios' ? 4 : 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontSize: 14, textAlign: 'center', paddingVertical: 40 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginBottom: 14, overflow: 'hidden' },
  cardImage: { width: '100%', height: 130, borderRadius: 10, marginBottom: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardName: { fontSize: 16, fontWeight: '700', flex: 1 },
  cardLine: { fontSize: 13, marginTop: 3, lineHeight: 18 },
  cardMeta: { fontSize: 11, marginTop: 8 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  deleteAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 14 },
  deleteAllText: { fontSize: 15, fontWeight: '700' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  actionLabel: { fontSize: 14, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  dialog: { borderRadius: 18, padding: 20 },
  dialogTitle: { fontSize: 18, fontWeight: '700' },
  dialogSub: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  dialogInput: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12, fontSize: 15, minHeight: 60, marginTop: 14, textAlignVertical: 'top' },
  durRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  durBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 16, marginTop: 18 },
  dialogBtn: { paddingVertical: 10, paddingHorizontal: 18 },
});
