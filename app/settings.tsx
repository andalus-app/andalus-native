import {
  View, Text, ScrollView, TouchableOpacity, Switch,
  Modal, Alert, ActivityIndicator, Platform, TextInput, Animated, Easing, Linking,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useState, useCallback, useRef, type ReactNode } from 'react';
import type { Theme } from '../theme/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { SvgXml } from 'react-native-svg';
import SvgIcon from '../components/SvgIcon';
import BackButton from '../components/BackButton';
import CitySearchModal from '../components/CitySearchModal';
import { useTheme } from '../context/ThemeContext';
import { useApp, CALC_METHODS } from '../context/AppContext';
import { reverseGeocode } from '../services/prayerApi';
import {
  requestNotificationPermission,
  cancelPrayerNotifications,
  enableKahfReminder,
  disableKahfReminder,
  enableAllahNamesReminder,
  disableAllahNamesReminder,
  LIVE_NOTIF_ENABLED_KEY,
  cancelPrePrayerReminders,
  refreshPrePrayerReminderNotifications,
  PRE_PRAYER_REMINDER_STORAGE_KEY,
  type PrayerReminderOffset,
} from '../services/notifications';
import {
  loadZakatReminderSettings,
  saveZakatReminderSettings,
  enableZakatReminder,
  disableZakatReminder,
  syncZakatReminders,
  ADVANCE_OPTIONS,
} from '../services/zakatReminderService';
import HijriDatePickerModal from '../components/HijriDatePickerModal';
import { supabase } from '../lib/supabase';
import { Storage } from '../services/storage';

// theme.svg — outlined (stroke only, no fill) for Utseende-sektionen
const THEME_SVG_TEMPLATE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M475.691,0.021c-14.656,0-27.776,8.725-33.451,22.251l-32.64,77.973c-9.728-9.152-22.421-14.933-36.267-14.933h-320C23.936,85.312,0,109.248,0,138.645v320c0,29.397,23.936,53.333,53.333,53.333h320c29.397,0,53.333-23.936,53.333-53.333V225.152l81.92-172.821c2.24-4.757,3.413-10.048,3.413-16.043C512,16.299,495.701,0.021,475.691,0.021zM405.333,458.645c0,17.643-14.357,32-32,32h-320c-17.643,0-32-14.357-32-32v-320c0-17.643,14.357-32,32-32h320c11.243,0,21.312,6.101,27.072,15.573l-37.739,90.197v-52.437c0-5.888-4.779-10.667-10.667-10.667H74.667c-5.888,0-10.667,4.779-10.667,10.667v85.333c0,5.888,4.779,10.667,10.667,10.667h269.76l-8.939,21.333h-90.155c-5.888,0-10.667,4.779-10.667,10.667v128c0,0.277,0.128,0.512,0.149,0.789c-8.768,7.787-14.144,10.389-14.528,10.539c-3.371,1.259-5.888,4.096-6.699,7.616c-0.811,3.584,0.256,7.339,2.859,9.941c15.445,15.445,36.757,21.333,57.6,21.333c26.645,0,52.48-9.643,64.128-21.333c16.768-16.768,29.056-50.005,19.776-74.773l47.381-99.925V458.645zM270.635,397.525c2.944-9.685,5.739-18.859,14.229-27.349c15.083-15.083,33.835-15.083,48.917,0c13.504,13.504,3.2,45.717-10.667,59.584c-11.563,11.541-52.672,22.677-80.256,8.256c3.669-2.859,7.893-6.549,12.672-11.328C264.448,417.749,267.605,407.467,270.635,397.525zM256,375.339v-76.672h70.571l-16.363,39.083c-14.251-0.256-28.565,5.483-40.448,17.387C263.125,361.771,259.008,368.661,256,375.339zM331.264,342.741l28.715-68.629l16.128,7.915l-32.555,68.651C339.605,347.477,335.531,344.747,331.264,342.741zM341.333,170.645v64h-256v-64H341.333zM489.28,43.243l-104.064,219.52l-17.003-8.341l54.08-129.237l39.616-94.677c2.325-5.568,7.744-9.152,13.803-9.152c8.235,0,14.933,6.699,14.933,15.659C490.645,39.147,490.176,41.344,489.28,43.243z" fill="none" stroke="__C__" stroke-width="20" stroke-linejoin="round" stroke-linecap="round"/><path d="M181.333,277.312H74.667c-5.888,0-10.667,4.779-10.667,10.667v149.333c0,5.888,4.779,10.667,10.667,10.667h106.667c5.888,0,10.667-4.779,10.667-10.667V287.979C192,282.091,187.221,277.312,181.333,277.312zM170.667,426.645H85.333v-128h85.333V426.645z" fill="none" stroke="__C__" stroke-width="20" stroke-linejoin="round" stroke-linecap="round"/></svg>';
const themeIconXml = (color: string) => THEME_SVG_TEMPLATE.replace(/__C__/g, color);


export const SETTINGS_KEY = 'andalus_settings';
const LOCATION_KEY = 'andalus_location';

const DEFAULT_SETTINGS = {
  autoLocation:              true,
  calculationMethod:         3,
  school:                    0,
  notifications:             true,
  announcementNotifications: true,
  dhikrReminder:             false,
  fridayDuaReminder:         true,
};

function SectionLabel({ label, T }: { label: string; T: Theme }) {
  return (
    <Text style={{fontSize:11,fontWeight:'700',color:T.textMuted,letterSpacing:1.2,marginBottom:8,marginTop:20,paddingHorizontal:4}}>
      {label.toUpperCase()}
    </Text>
  );
}

function Row({ iconName, customIcon, label, value, onPress, right, T }: {
  iconName?: string; customIcon?: string; label: string; value?: string;
  onPress?: () => void; right?: ReactNode; T: Theme;
}) {
  // When both onPress and right (e.g. Switch) are present, only the label/value
  // area is tappable — the right control handles its own interaction.
  const hasRightControl = right !== undefined;
  return (
    <View style={{flexDirection:'row',alignItems:'center',backgroundColor:T.card,borderRadius:14,borderWidth:0.5,borderColor:T.border,padding:14,marginBottom:8,gap:12}}>
      <View style={{width:32,height:32,borderRadius:8,backgroundColor:T.accentGlow,alignItems:'center',justifyContent:'center'}}>
        {customIcon ? <SvgXml xml={customIcon} width={18} height={18}/> : <SvgIcon name={iconName as any} size={18} color={T.accent}/>}
      </View>
      <TouchableOpacity style={{flex:1}} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}>
        <Text style={{fontSize:15,fontWeight:'600',color:T.text}}>{label}</Text>
        {value ? <Text style={{fontSize:12,color:T.textMuted,marginTop:1}}>{value}</Text> : null}
      </TouchableOpacity>
      {hasRightControl
        ? <View style={{alignSelf:'center'}}>{right}</View>
        : (onPress ? <Text style={{fontSize:18,color:T.textMuted}}>›</Text> : null)}
    </View>
  );
}

function Sheet({ visible, title, subtitle, onClose, children, T }: {
  visible: boolean; title: string; subtitle?: string; onClose: () => void; children: ReactNode; T: Theme;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={{flex:1,backgroundColor:'transparent'}} activeOpacity={1} onPress={onClose}/>
      <View style={{backgroundColor:T.card,borderTopLeftRadius:22,borderTopRightRadius:22,maxHeight:'85%',paddingBottom:Platform.OS==='ios'?34:20,borderWidth:0.5,borderBottomWidth:0,borderColor:T.border}}>
        <View style={{width:36,height:4,borderRadius:2,backgroundColor:T.border,alignSelf:'center',marginTop:10,marginBottom:14}}/>
        <View style={{paddingHorizontal:20,marginBottom:4,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
          <View style={{flex:1}}>
            <Text style={{fontSize:18,fontWeight:'700',color:T.text}}>{title}</Text>
            {subtitle ? <Text style={{fontSize:12,color:T.textMuted,marginTop:3}}>{subtitle}</Text> : null}
          </View>
          <TouchableOpacity onPress={onClose} style={{width:28,height:28,borderRadius:14,backgroundColor:T.accentGlow,alignItems:'center',justifyContent:'center',marginLeft:12}}>
            <Text style={{fontSize:16,color:T.textMuted,lineHeight:20,marginTop:-1}}>×</Text>
          </TouchableOpacity>
        </View>
        <View style={{height:0.5,backgroundColor:T.border,marginTop:10,marginBottom:4}}/>
        <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

function OptionRow({ label, sub, active, onPress, T, isLast }: {
  label: string; sub?: string; active: boolean; onPress: () => void; T: Theme; isLast: boolean;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.6}
      style={{paddingVertical:14,paddingHorizontal:20,flexDirection:'row',alignItems:'center',backgroundColor:active?T.accent+'12':'transparent',borderBottomWidth:isLast?0:0.5,borderBottomColor:T.separator||T.border}}>
      <View style={{flex:1}}>
        <Text style={{fontSize:15,fontWeight:active?'600':'400',color:T.text}}>{label}</Text>
        {sub ? <Text style={{fontSize:12,color:T.textMuted,marginTop:2}}>{sub}</Text> : null}
      </View>
      <View style={{width:22,height:22,borderRadius:11,backgroundColor:active?T.accent:'transparent',borderWidth:active?0:1.5,borderColor:T.border,alignItems:'center',justifyContent:'center'}}>
        {active && <Text style={{color:'#fff',fontSize:12,fontWeight:'700'}}>✓</Text>}
      </View>
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const { theme: T, setMode, mode } = useTheme();
  const { dispatch } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [settings,      setSettings]      = useState(DEFAULT_SETTINGS);
  const [locationLabel, setLocationLabel] = useState('Hämtar...');
  const [detecting,     setDetecting]     = useState(false);
  const [methodModal,   setMethodModal]   = useState(false);
  const [schoolModal,   setSchoolModal]   = useState(false);
  const [cityModal,     setCityModal]     = useState(false);
  const [kahfEnabled,            setKahfEnabled]            = useState(true);
  const [zakatEnabled,           setZakatEnabled]           = useState(false);
  const [zakatSavedDate,         setZakatSavedDate]         = useState<string | null>(null);
  const [zakatPickerVisible,     setZakatPickerVisible]     = useState(false);
  const [zakatPickerDefaults,    setZakatPickerDefaults]    = useState({ day: 1, month: 1, hour: 10, minute: 0 });
  const [zakatAdvanceDays,       setZakatAdvanceDays]       = useState(7);
  const zakatSettingsRef = useRef<Awaited<ReturnType<typeof loadZakatReminderSettings>>>(null);
  const [allahNamesEnabled,      setAllahNamesEnabled]      = useState(true);
  const [liveNotifEnabled,       setLiveNotifEnabled]       = useState(false);
  const [prayerReminderOffset,        setPrayerReminderOffset]        = useState<PrayerReminderOffset>('off');
  const [pendingPrayerReminderOffset, setPendingPrayerReminderOffset] = useState<PrayerReminderOffset>('off');
  const [prayerReminderModal,         setPrayerReminderModal]         = useState(false);
  const [prayerReminderSaved,         setPrayerReminderSaved]         = useState(false);
  const prCheckScale   = useRef(new Animated.Value(0)).current;
  const prCheckOpacity = useRef(new Animated.Value(0)).current;
  const prTextOpacity  = useRef(new Animated.Value(0)).current;
  const [bgPermissionGranted, setBgPermissionGranted] = useState<boolean | null>(null);
  const [bgBannerDismissed,   setBgBannerDismissed]   = useState(false);
  const [preferredName,    setPreferredName]    = useState<string | null>(null);
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const nameSlideAnim = useRef(new Animated.Value(-400)).current;
  const [nameInput,        setNameInput]        = useState('');

  useFocusEffect(useCallback(() => { loadAll(); }, []));

  async function loadAll() {
    try {
      const s = await AsyncStorage.getItem(SETTINGS_KEY);
      setSettings({ ...DEFAULT_SETTINGS, ...(s ? JSON.parse(s) : {}) });
      const l = await AsyncStorage.getItem(LOCATION_KEY);
      if (l) {
        const loc = JSON.parse(l);
        const label = loc.subLocality && loc.city && loc.subLocality !== loc.city
          ? `${loc.subLocality}, ${loc.city}`
          : loc.city || loc.subLocality || 'Okänd';
        setLocationLabel(label);
      }
      else setLocationLabel('Ej angiven');
      const kahf = await AsyncStorage.getItem('kahfReminderEnabled');
      setKahfEnabled(kahf !== 'false'); // null (never set) = default on
      const allahNames = await AsyncStorage.getItem('allahNamesNotificationEnabled');
      setAllahNamesEnabled(allahNames !== 'false'); // null (never set) = default on
      const liveNotif = await AsyncStorage.getItem(LIVE_NOTIF_ENABLED_KEY);
      setLiveNotifEnabled(liveNotif === 'true'); // null (never set) = default off
      const prRaw = await AsyncStorage.getItem(PRE_PRAYER_REMINDER_STORAGE_KEY);
      const prNum = prRaw ? parseInt(prRaw, 10) : NaN;
      const VALID_OFFSETS = [15, 30, 45, 60] as const;
      setPrayerReminderOffset((VALID_OFFSETS as readonly number[]).includes(prNum) ? prNum as PrayerReminderOffset : 'off');
      const zakat = await loadZakatReminderSettings();
      zakatSettingsRef.current = zakat;
      setZakatEnabled(zakat?.enabled ?? false);
      setZakatAdvanceDays(zakat?.advanceDays ?? 7);
      if (zakat?.hijriDay && zakat?.hijriMonthName) {
        const h = String(zakat.reminderTimeHour ?? 8).padStart(2, '0');
        const m = String(zakat.reminderTimeMinute ?? 0).padStart(2, '0');
        setZakatSavedDate(`${zakat.hijriDay} ${zakat.hijriMonthName} · ${h}:${m}`);
      } else {
        setZakatSavedDate(null);
      }
      const name = await AsyncStorage.getItem('andalus_preferred_name');
      setPreferredName(name ?? null);
      if (Platform.OS === 'ios') {
        const [{ status: bgStatus }, dismissed] = await Promise.all([
          Location.getBackgroundPermissionsAsync(),
          AsyncStorage.getItem('hidayah_bg_banner_dismissed'),
        ]);
        setBgPermissionGranted(bgStatus === 'granted');
        setBgBannerDismissed(dismissed === 'true');
      }
    } catch {}
  }

  function saveSettings(partial: Partial<typeof DEFAULT_SETTINGS>) {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated)).catch(() => {});
    AsyncStorage.setItem('andalus_settings_updated', Date.now().toString()).catch(() => {});
    dispatch({ type: 'SET_SETTINGS', payload: partial });
  }

  // ── Zakat picker confirm (first-time setup from Settings) ────────────────
  const handleZakatPickerConfirm = useCallback(async (
    day: number, month: number, monthName: string, hour: number, minute: number,
    meta?: { inputMode?: 'hijri' | 'gregorian'; originalGregorianMonth?: number; originalGregorianDay?: number },
  ) => {
    const now = new Date().toISOString();
    const existing = zakatSettingsRef.current;
    const newSettings = {
      enabled: true,
      hijriDay: day,
      hijriMonth: month,
      hijriMonthName: monthName,
      advanceDays: existing?.advanceDays ?? 7,
      reminderTimeHour: hour,
      reminderTimeMinute: minute,
      source: (existing?.source ?? 'aladhan') as 'aladhan',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(meta?.inputMode !== undefined && { inputMode: meta.inputMode }),
      ...(meta?.originalGregorianMonth !== undefined && { originalGregorianMonth: meta.originalGregorianMonth }),
      ...(meta?.originalGregorianDay !== undefined && { originalGregorianDay: meta.originalGregorianDay }),
    };
    await saveZakatReminderSettings(newSettings);
    await syncZakatReminders();
    zakatSettingsRef.current = newSettings;
    setZakatEnabled(true);
    const h = String(hour).padStart(2, '0');
    const m = String(minute).padStart(2, '0');
    setZakatSavedDate(`${day} ${monthName} · ${h}:${m}`);
  }, []);

  const handleZakatAdvanceDaysChange = useCallback(async (days: number) => {
    setZakatAdvanceDays(days);
    const existing = zakatSettingsRef.current;
    if (!existing) return;
    const updated = { ...existing, advanceDays: days };
    zakatSettingsRef.current = updated;
    await saveZakatReminderSettings(updated);
    if (updated.enabled) await syncZakatReminders();
  }, []);

  async function handleSaveName() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    await AsyncStorage.setItem('andalus_preferred_name', trimmed);
    setPreferredName(trimmed);
    closeNameModal();
  }

  function openNameModal() {
    setNameInput(preferredName ?? '');
    nameSlideAnim.setValue(-400);
    setNameModalVisible(true);
    Animated.spring(nameSlideAnim, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
  }

  function closeNameModal() {
    Animated.timing(nameSlideAnim, { toValue: -400, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => setNameModalVisible(false));
  }

  function animatePrayerReminderAndClose() {
    prCheckScale.setValue(0);
    prCheckOpacity.setValue(0);
    prTextOpacity.setValue(0);
    setPrayerReminderSaved(true);
    Animated.parallel([
      Animated.timing(prCheckOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(prCheckScale,   { toValue: 1, bounciness: 10, useNativeDriver: true }),
    ]).start(() => {
      Animated.timing(prTextOpacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });
    setTimeout(() => {
      setPrayerReminderModal(false);
      setPrayerReminderSaved(false);
    }, 1600);
  }

  async function detectLocation() {
    setDetecting(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Plats', 'Platsåtkomst nekad'); return; }
      const loc = await Location.getCurrentPositionAsync({});
      const geo = await reverseGeocode(loc.coords.latitude, loc.coords.longitude);
      const locData = { lat: loc.coords.latitude, lng: loc.coords.longitude, city: geo.city, country: geo.country };
      await AsyncStorage.setItem(LOCATION_KEY, JSON.stringify(locData));
      await AsyncStorage.setItem('andalus_settings_updated', Date.now().toString());
      setLocationLabel(geo.city);
    } catch { Alert.alert('Fel', 'Kunde inte hämta plats'); }
    setDetecting(false);
  }

  async function handleSelectCity(r: { latitude: number; longitude: number; city: string; country: string }) {
    const locData = { lat: r.latitude, lng: r.longitude, city: r.city, country: r.country };
    await AsyncStorage.setItem(LOCATION_KEY, JSON.stringify(locData));
    // Viktigt: triggar bönetider att ladda om med ny plats
    await AsyncStorage.setItem('andalus_settings_updated', Date.now().toString());
    setLocationLabel(r.city);
    setCityModal(false);
  }

  type Mode = 'dark' | 'light' | 'system';
  type IconName = 'moon' | 'sun' | 'smartphone';
  const themeOptions: { label: string; icon: IconName; value: Mode }[] = [
    { label:'Mörkt',  icon:'moon',       value:'dark'   },
    { label:'Ljust',  icon:'sun',        value:'light'  },
    { label:'System', icon:'smartphone', value:'system' },
  ];

  return (
    <View style={{flex:1,backgroundColor:T.bg}}>
      <View style={{paddingTop:56,paddingHorizontal:16,paddingBottom:8,flexDirection:'row',alignItems:'center',gap:12}}>
        <BackButton onPress={() => router.back()} />
        <Text style={{flex:1,fontSize:26,fontWeight:'700',color:T.text}}>Inställningar</Text>
      </View>

      <ScrollView contentContainerStyle={{paddingHorizontal:16,paddingBottom:120}}>
        <SectionLabel label="Utseende" T={T}/>
        <View style={{backgroundColor:T.card,borderRadius:14,borderWidth:0.5,borderColor:T.border,padding:14,marginBottom:8}}>
          <View style={{flexDirection:'row',alignItems:'center',gap:10,marginBottom:12}}>
            <SvgXml xml={themeIconXml(T.accent)} width={18} height={18}/>
            <Text style={{fontSize:15,fontWeight:'600',color:T.text}}>Tema</Text>
          </View>
          <View style={{flexDirection:'row',gap:8}}>
            {themeOptions.map(({label,icon,value}) => {
              const active = mode===value;
              return (
                <TouchableOpacity key={value} onPress={() => setMode(value)} activeOpacity={0.8}
                  style={{flex:1,paddingVertical:12,borderRadius:10,backgroundColor:active?T.accent:T.bg,borderWidth:1,borderColor:active?T.accent:T.border,alignItems:'center',gap:6}}>
                  <SvgIcon name={icon} size={18} color={active?'#fff':T.text}/>
                  <Text style={{fontSize:12,fontWeight:'600',color:active?'#fff':T.text}}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <SectionLabel label="Personalisering" T={T}/>
        <Row T={T} iconName="star" label="Vad vill du att vi ska kalla dig?"
          value={preferredName || 'Ej angivet'}
          onPress={openNameModal}/>

        <SectionLabel label="Plats" T={T}/>
        <Row T={T} iconName="map-arrow" label="Automatisk plats"
          value={settings.autoLocation?'Uppdateras automatiskt via GPS':'Manuell'}
          right={<Switch value={settings.autoLocation}
            onValueChange={v => { saveSettings({autoLocation:v}); if(v) detectLocation(); }}
            trackColor={{false:T.border,true:T.accent}} thumbColor="#fff" ios_backgroundColor={T.border}/>}/>
        {settings.autoLocation && bgPermissionGranted === false && Platform.OS === 'ios' && !bgBannerDismissed && (
          <View style={{backgroundColor:T.card,borderRadius:14,borderWidth:0.5,borderColor:'#d97706',padding:14,marginBottom:8}}>
            <View style={{flexDirection:'row',alignItems:'flex-start',gap:10}}>
              <Text style={{flex:1,fontSize:13,color:T.text,lineHeight:18}}>
                {'För automatisk uppdatering av bönetider och widget behöver platsåtkomst vara satt till Alltid.'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setBgBannerDismissed(true);
                  AsyncStorage.setItem('hidayah_bg_banner_dismissed', 'true').catch(() => {});
                }}
                hitSlop={{top:8,right:8,bottom:8,left:8}}
                activeOpacity={0.6}>
                <Text style={{fontSize:18,color:T.textMuted,lineHeight:20,marginTop:-1}}>×</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={() => Linking.openSettings()}
              style={{alignSelf:'flex-start',backgroundColor:'#d97706',borderRadius:8,paddingVertical:7,paddingHorizontal:14,marginTop:10}}
              activeOpacity={0.8}>
              <Text style={{fontSize:13,fontWeight:'600',color:'#fff'}}>Öppna inställningar</Text>
            </TouchableOpacity>
          </View>
        )}
        {settings.autoLocation && bgPermissionGranted === false && Platform.OS === 'ios' && bgBannerDismissed && (
          <View style={{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:4,marginBottom:8}}>
            <Text style={{fontSize:11,color:'#d97706'}}>⚠</Text>
            <Text style={{fontSize:11,color:T.textMuted,flex:1}}>{'Widgeten kräver platsåtkomst "Alltid" — ändra i inställningar.'}</Text>
          </View>
        )}
        <Row T={T} iconName="map-point" label="Nuvarande stad" value={locationLabel}
          onPress={() => setCityModal(true)}
          right={detecting
            ? <ActivityIndicator size="small" color={T.accent}/>
            : <Text style={{fontSize:18,color:T.textMuted}}>›</Text>}/>

        <SectionLabel label="Bönetider" T={T}/>
        <Row T={T} iconName="ruler" label="Beräkningsmetod"
          value={(CALC_METHODS as Record<number, string>)[settings.calculationMethod]||'Muslim World League'}
          onPress={() => setMethodModal(true)}/>
        <Row T={T} iconName="book" label="Rättsskola"
          value={settings.school===0?"Standard (Shafi'i, Maliki, Hanbali)":'Hanafi'}
          onPress={() => setSchoolModal(true)}/>

        <SectionLabel label="Aviseringar" T={T}/>
        <Row T={T} iconName="bell" label="Böne-påminnelser" value="Fajr, Dhuhr, Asr, Maghrib, Isha"
          right={<Switch value={settings.notifications}
            onValueChange={async (v) => {
              if (v) {
                const granted = await requestNotificationPermission();
                if (!granted) {
                  Alert.alert(
                    'Notiser nekade',
                    'Aktivera notiser för Hidayah i iOS-inställningar för att få böne-påminnelser.',
                    [{ text: 'OK' }],
                  );
                  return;
                }
              } else {
                cancelPrayerNotifications().catch(() => {});
              }
              saveSettings({ notifications: v });
            }}
            trackColor={{false:T.border,true:T.accent}} thumbColor="#fff" ios_backgroundColor={T.border}/>}/>

        <Row T={T} iconName="bell" label="Påminnelse före bön"
          value={prayerReminderOffset === 'off'
            ? 'Av'
            : `${prayerReminderOffset} minuter före bönetiden`}
          onPress={prayerReminderOffset !== 'off'
            ? () => { setPendingPrayerReminderOffset(prayerReminderOffset); setPrayerReminderModal(true); }
            : undefined}
          right={
            <Switch
              value={prayerReminderOffset !== 'off' || prayerReminderModal}
              onValueChange={async (v) => {
                if (v) {
                  setPendingPrayerReminderOffset(prayerReminderOffset === 'off' ? 15 : prayerReminderOffset);
                  setPrayerReminderModal(true);
                } else {
                  setPrayerReminderOffset('off');
                  await AsyncStorage.setItem(PRE_PRAYER_REMINDER_STORAGE_KEY, 'off');
                  cancelPrePrayerReminders().catch(() => {});
                  if (prayerReminderModal) setPrayerReminderModal(false);
                }
              }}
              trackColor={{ false: T.border, true: T.accent }}
              thumbColor="#fff"
              ios_backgroundColor={T.border}
            />
          }
        />

        <Row T={T} iconName="bell" label="Surah Al-Kahf påminnelse" value="Få en påminnelse varje fredag kl. 13:00"
          right={<Switch value={kahfEnabled}
            onValueChange={async (v) => {
              if (v) {
                const granted = await requestNotificationPermission();
                if (!granted) {
                  Alert.alert(
                    'Notiser nekade',
                    'Aktivera notiser för Hidayah i iOS-inställningar.',
                    [{ text: 'OK' }],
                  );
                  return;
                }
                await enableKahfReminder();
              } else {
                await disableKahfReminder();
              }
              setKahfEnabled(v);
            }}
            trackColor={{false:T.border,true:T.accent}} thumbColor="#fff" ios_backgroundColor={T.border}/>}/>

        <Row T={T} iconName="bell" label="Allahs namn" value="Få en daglig påminnelse med ett av Allahs namn och dess betydelse"
          right={<Switch value={allahNamesEnabled}
            onValueChange={async (v) => {
              if (v) {
                const granted = await requestNotificationPermission();
                if (!granted) {
                  Alert.alert(
                    'Notiser nekade',
                    'Aktivera notiser för Hidayah i iOS-inställningar.',
                    [{ text: 'OK' }],
                  );
                  return;
                }
                await enableAllahNamesReminder();
              } else {
                await disableAllahNamesReminder();
              }
              setAllahNamesEnabled(v);
            }}
            trackColor={{false:T.border,true:T.accent}} thumbColor="#fff" ios_backgroundColor={T.border}/>}/>

        <Row T={T} iconName="bell" label="Dhikr-påminnelse" value="1 timme innan Maghrib varje dag"
          right={<Switch value={settings.dhikrReminder ?? false}
            onValueChange={async (v) => {
              if (v) {
                const granted = await requestNotificationPermission();
                if (!granted) {
                  Alert.alert(
                    'Notiser nekade',
                    'Aktivera notiser för Hidayah i iOS-inställningar.',
                    [{ text: 'OK' }],
                  );
                  return;
                }
              }
              saveSettings({ dhikrReminder: v });
            }}
            trackColor={{false:T.border,true:T.accent}} thumbColor="#fff" ios_backgroundColor={T.border}/>}/>

        <Row T={T} iconName="bell" label="Fredagens sista timme (dua)" value="Få en påminnelse 30 minuter innan Maghrib på fredag."
          right={<Switch value={settings.fridayDuaReminder ?? true}
            onValueChange={async (v) => {
              if (v) {
                const granted = await requestNotificationPermission();
                if (!granted) {
                  Alert.alert(
                    'Notiser nekade',
                    'Aktivera notiser för Hidayah i iOS-inställningar.',
                    [{ text: 'OK' }],
                  );
                  return;
                }
              }
              saveSettings({ fridayDuaReminder: v });
            }}
            trackColor={{false:T.border,true:T.accent}} thumbColor="#fff" ios_backgroundColor={T.border}/>}/>

        <Row T={T} iconName="bell" label="Direktsändning" value="Notis när en sändning är live"
          right={<Switch value={liveNotifEnabled}
            onValueChange={async (v) => {
              if (v) {
                const granted = await requestNotificationPermission();
                if (!granted) {
                  Alert.alert(
                    'Notiser nekade',
                    'Aktivera notiser för Hidayah i iOS-inställningar.',
                    [{ text: 'OK' }],
                  );
                  return;
                }
              }
              await AsyncStorage.setItem(LIVE_NOTIF_ENABLED_KEY, v ? 'true' : 'false');
              setLiveNotifEnabled(v);
              // Sync preference to push_tokens so the Edge Function respects this choice
              const liveUserId = Storage.getItem('islamnu_user_id') ?? Storage.getItem('islamnu_device_id');
              if (liveUserId) {
                supabase.from('push_tokens')
                  .update({ live_notif: v })
                  .eq('user_id', liveUserId)
                  .then(() => {});
              }
            }}
            trackColor={{false:T.border,true:T.accent}} thumbColor="#fff" ios_backgroundColor={T.border}/>}/>

        <Row T={T} iconName="bell" label="Meddelanden" value="Aviseringar från Hidayah"
          right={<Switch value={settings.announcementNotifications ?? true}
            onValueChange={async (v) => {
              if (v) {
                const granted = await requestNotificationPermission();
                if (!granted) {
                  Alert.alert(
                    'Notiser nekade',
                    'Aktivera notiser för Hidayah i iOS-inställningar.',
                    [{ text: 'OK' }],
                  );
                  return;
                }
              }
              saveSettings({ announcementNotifications: v });
              // Sync preference to push_tokens so the server respects this choice.
              // Fall back to device ID for anonymous users whose token was registered
              // before they logged in — without this they always receive announcements.
              const userId = Storage.getItem('islamnu_user_id') ?? Storage.getItem('islamnu_device_id');
              if (userId) {
                supabase.from('push_tokens')
                  .update({ announcement_notif: v })
                  .eq('user_id', userId)
                  .then(() => {});
              }
            }}
            trackColor={{false:T.border,true:T.accent}} thumbColor="#fff" ios_backgroundColor={T.border}/>}/>

        {/* Zakat reminder */}
        <View style={{ backgroundColor: T.card, borderRadius: 14, borderWidth: 0.5, borderColor: T.border, padding: 14, marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: T.accentGlow, alignItems: 'center', justifyContent: 'center' }}>
              <SvgIcon name="bell" size={18} color={T.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: T.text }}>Zakat-påminnelse</Text>
              <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 1 }}>Årlig Hijri-baserad påminnelse</Text>
            </View>
            <Switch
              value={zakatEnabled}
              onValueChange={async (v) => {
                if (v) {
                  const granted = await requestNotificationPermission();
                  if (!granted) {
                    Alert.alert('Notiser nekade', 'Aktivera notiser för Hidayah i iOS-inställningar.', [{ text: 'OK' }]);
                    return;
                  }
                  const existing = await loadZakatReminderSettings();
                  if (existing?.hijriDay && existing?.hijriMonth) {
                    await enableZakatReminder({ ...existing, enabled: true });
                    setZakatEnabled(true);
                  } else {
                    setZakatPickerDefaults({ day: 1, month: 1, hour: 10, minute: 0 });
                    setZakatPickerVisible(true);
                  }
                } else {
                  await disableZakatReminder();
                  setZakatEnabled(false);
                }
              }}
              trackColor={{ false: T.border, true: T.accent }}
              thumbColor="#fff"
              ios_backgroundColor={T.border}
            />
          </View>

          {zakatEnabled && zakatSavedDate && (
            <>
              <View style={{ height: 0.5, backgroundColor: T.border, marginVertical: 12 }} />
              <TouchableOpacity
                onPress={() => {
                  const z = zakatSettingsRef.current;
                  setZakatPickerDefaults({
                    day: z?.hijriDay ?? 1,
                    month: z?.hijriMonth ?? 1,
                    hour: z?.reminderTimeHour ?? 10,
                    minute: z?.reminderTimeMinute ?? 0,
                  });
                  setZakatPickerVisible(true);
                }}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: T.bg, borderRadius: 10,
                  borderWidth: 0.5, borderColor: T.border,
                  paddingVertical: 10, paddingHorizontal: 14,
                  marginBottom: 14,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, color: T.textMuted, marginBottom: 2 }}>Datum &amp; tid</Text>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: T.text }}>{zakatSavedDate}</Text>
                </View>
                <Text style={{ fontSize: 18, color: T.textMuted }}>›</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 13, color: T.textMuted, fontWeight: '500', marginBottom: 10 }}>Påminn mig</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                {ADVANCE_OPTIONS.map(opt => {
                  const active = zakatAdvanceDays === opt.days;
                  return (
                    <TouchableOpacity
                      key={opt.days}
                      onPress={() => handleZakatAdvanceDaysChange(opt.days)}
                      activeOpacity={0.7}
                      style={{
                        paddingHorizontal: 11, paddingVertical: 7,
                        borderRadius: 9, borderWidth: 0.5,
                        borderColor: active ? T.accent : T.border,
                        backgroundColor: active ? T.accentGlow : 'transparent',
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: active ? '700' : '500', color: active ? T.accent : T.textMuted }}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </View>

        <SectionLabel label="Om appen" T={T}/>
        <View style={{backgroundColor:T.card,borderRadius:14,borderWidth:0.5,borderColor:T.border,padding:16}}>
          <Text style={{fontSize:15,fontWeight:'700',color:T.text}}>Hidayah</Text>
          <Text style={{fontSize:13,color:T.textMuted,marginTop:2}}>Bönetider och Qibla-kompass</Text>
          <Text style={{fontSize:12,color:T.textMuted,marginTop:6,opacity:0.7}}>Version 1.3.9</Text>
          <Text style={{fontSize:11,color:T.textMuted,marginTop:2,opacity:0.55}}>
            © {new Date().getFullYear()} Fatih Köker. Alla rättigheter förbehållna.
          </Text>
        </View>
      </ScrollView>

      <CitySearchModal
        visible={cityModal}
        onClose={() => setCityModal(false)}
        onSelect={handleSelectCity}
        currentCity={locationLabel !== 'Ej angiven' ? locationLabel : undefined}
        T={T}/>

      <Sheet visible={methodModal} T={T}
        title="Beräkningsmetod"
        subtitle={'Vald: '+((CALC_METHODS as Record<number, string>)[settings.calculationMethod]||'Muslim World League')}
        onClose={() => setMethodModal(false)}>
        {Object.entries(CALC_METHODS).map(([key,name],idx,arr) => (
          <OptionRow key={key} label={name}
            active={settings.calculationMethod===parseInt(key)}
            isLast={idx===arr.length-1} T={T}
            onPress={() => { saveSettings({calculationMethod:parseInt(key)}); setMethodModal(false); }}/>
        ))}
        <View style={{height:8}}/>
      </Sheet>

      <Sheet visible={schoolModal} T={T}
        title="Rättsskola"
        subtitle="Påverkar beräkningen av Asr-bönen"
        onClose={() => setSchoolModal(false)}>
        <View style={{paddingHorizontal:20,paddingVertical:10}}>
          <Text style={{fontSize:13,color:T.textMuted,lineHeight:20}}>
            Standard (Shafi'i) räknar skugga lika lång som föremålet. Hanafi räknar dubbel skugglängd.
          </Text>
        </View>
        <View style={{height:0.5,backgroundColor:T.border,marginBottom:4}}/>
        {[
          {v:0,label:'Standard',sub:"Shafi'i, Maliki, Hanbali"},
          {v:1,label:'Hanafi',sub:'Asr när skuggan är dubbelt så lång'},
        ].map(({v,label,sub},idx,arr) => (
          <OptionRow key={v} label={label} sub={sub}
            active={settings.school===v}
            isLast={idx===arr.length-1} T={T}
            onPress={() => { saveSettings({school:v}); setSchoolModal(false); }}/>
        ))}
        <View style={{height:8}}/>
      </Sheet>

      {/* ── Preferred name modal ── */}
      <Modal
        visible={nameModalVisible}
        transparent
        animationType="none"
        onRequestClose={closeNameModal}
      >
        <View style={{ flex: 1 }}>
          <Animated.View style={{
            transform: [{ translateY: nameSlideAnim }],
            backgroundColor: T.card,
            borderBottomLeftRadius: 22, borderBottomRightRadius: 22,
            paddingTop: insets.top + 12,
            paddingBottom: 20,
            borderWidth: 0.5, borderTopWidth: 0, borderColor: T.border,
          }}>
            <View style={{paddingHorizontal:20,marginBottom:4,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
              <Text style={{flex:1,fontSize:18,fontWeight:'700',color:T.text}}>
                Vad vill du att vi ska kalla dig?
              </Text>
              <TouchableOpacity
                onPress={closeNameModal}
                hitSlop={{top:8,bottom:8,left:8,right:8}}
                style={{width:28,height:28,borderRadius:14,backgroundColor:T.accentGlow,alignItems:'center',justifyContent:'center',marginLeft:12}}
              >
                <Text style={{fontSize:16,color:T.textMuted,lineHeight:20,marginTop:-1}}>×</Text>
              </TouchableOpacity>
            </View>
            <View style={{height:0.5,backgroundColor:T.border,marginTop:10,marginBottom:16}}/>
            <View style={{paddingHorizontal:20,gap:12}}>
              <TextInput
                value={nameInput}
                onChangeText={setNameInput}
                placeholder="Skriv ditt namn"
                placeholderTextColor={T.textMuted}
                autoFocus
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={handleSaveName}
                style={{
                  backgroundColor:T.bg,
                  borderRadius:12,
                  borderWidth:0.5,
                  borderColor:T.border,
                  paddingHorizontal:14,
                  paddingVertical:13,
                  fontSize:16,
                  color:T.text,
                }}
              />
              <TouchableOpacity
                onPress={handleSaveName}
                activeOpacity={0.8}
                style={{
                  backgroundColor:nameInput.trim()?T.accent:T.border,
                  borderRadius:12,
                  paddingVertical:14,
                  alignItems:'center',
                }}
              >
                <Text style={{fontSize:15,fontWeight:'700',color:'#fff'}}>Spara</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  await AsyncStorage.setItem('andalus_preferred_name', '');
                  setPreferredName('');
                  closeNameModal();
                }}
                activeOpacity={0.7}
                style={{alignItems:'center',paddingVertical:10}}
              >
                <Text style={{fontSize:13,fontWeight:'500',color:T.textMuted}}>Visa hälsning utan namn</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeNameModal} />
        </View>
      </Modal>

      {/* ── Pre-prayer reminder picker ── */}
      <Modal visible={prayerReminderModal} transparent animationType="slide" onRequestClose={() => { if (!prayerReminderSaved) setPrayerReminderModal(false); }}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'transparent' }} activeOpacity={1} onPress={() => { if (!prayerReminderSaved) setPrayerReminderModal(false); }} />
        <View style={{ backgroundColor: T.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: Platform.OS === 'ios' ? 34 : 20, borderWidth: 0.5, borderBottomWidth: 0, borderColor: T.border }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: T.border, alignSelf: 'center', marginTop: 10, marginBottom: 14 }} />
          <View style={{ paddingHorizontal: 20, marginBottom: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: T.text }}>Påminnelse före bön</Text>
              <Text style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>Få en påminnelse innan bönetiden så du hinner förbereda dig</Text>
            </View>
            {!prayerReminderSaved && (
              <TouchableOpacity onPress={() => setPrayerReminderModal(false)} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: T.accentGlow, alignItems: 'center', justifyContent: 'center', marginLeft: 12 }}>
                <Text style={{ fontSize: 16, color: T.textMuted, lineHeight: 20, marginTop: -1 }}>×</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={{ height: 0.5, backgroundColor: T.border, marginTop: 10, marginBottom: 4 }} />

          {prayerReminderSaved ? (
            <Animated.View style={{ opacity: prCheckOpacity, alignItems: 'center', justifyContent: 'center', paddingVertical: 52 }}>
              <Animated.View style={{
                transform: [{ scale: prCheckScale }],
                width: 72, height: 72, borderRadius: 36,
                backgroundColor: T.accent,
                alignItems: 'center', justifyContent: 'center',
                marginBottom: 16,
                shadowColor: T.accent,
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.4,
                shadowRadius: 14,
              }}>
                <Text style={{ fontSize: 34, color: '#fff', lineHeight: 40, marginTop: 2 }}>✓</Text>
              </Animated.View>
              <Animated.Text style={{ opacity: prTextOpacity, fontSize: 16, fontWeight: '600', color: T.text }}>
                Påminnelse aktiverad
              </Animated.Text>
            </Animated.View>
          ) : (
            <View style={{ padding: 20 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {(['off', 15, 30, 45, 60] as PrayerReminderOffset[]).map(opt => {
                  const isActive = pendingPrayerReminderOffset === opt;
                  const label    = opt === 'off' ? 'Av' : `${opt} min`;
                  return (
                    <TouchableOpacity
                      key={String(opt)}
                      activeOpacity={0.7}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        setPendingPrayerReminderOffset(opt);
                      }}
                      style={{
                        paddingHorizontal: 18,
                        paddingVertical: 10,
                        borderRadius: 20,
                        backgroundColor: isActive ? T.accent : 'transparent',
                        borderWidth: 1,
                        borderColor: isActive ? T.accent : T.border,
                      }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '600', color: isActive ? '#fff' : T.text }}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {pendingPrayerReminderOffset !== prayerReminderOffset && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={async () => {
                    const opt = pendingPrayerReminderOffset;
                    setPrayerReminderOffset(opt);
                    await AsyncStorage.setItem(PRE_PRAYER_REMINDER_STORAGE_KEY, opt === 'off' ? 'off' : String(opt));
                    if (opt === 'off') {
                      cancelPrePrayerReminders().catch(() => {});
                      setPrayerReminderModal(false);
                      return;
                    }
                    const granted = await requestNotificationPermission();
                    if (!granted) {
                      Alert.alert('Notiser nekade', 'Aktivera notiser för Hidayah i iOS-inställningar.', [{ text: 'OK' }]);
                      setPrayerReminderModal(false);
                      return;
                    }
                    refreshPrePrayerReminderNotifications().catch(() => {});
                    animatePrayerReminderAndClose();
                  }}
                  style={{
                    marginTop: 16,
                    backgroundColor: T.accent,
                    borderRadius: 12,
                    paddingVertical: 14,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>Spara</Text>
                </TouchableOpacity>
              )}
              <View style={{ height: 8 }} />
            </View>
          )}
        </View>
      </Modal>

      {/* Zakat first-time date picker — shown when enabling without saved config */}
      <HijriDatePickerModal
        visible={zakatPickerVisible}
        currentDay={zakatPickerDefaults.day}
        currentMonth={zakatPickerDefaults.month}
        currentHour={zakatPickerDefaults.hour}
        currentMinute={zakatPickerDefaults.minute}
        onConfirm={handleZakatPickerConfirm}
        onClose={() => setZakatPickerVisible(false)}
      />
    </View>
  );
}
