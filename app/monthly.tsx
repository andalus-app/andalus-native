import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet, Alert, PanResponder, Animated, Dimensions } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import BackButton from '../components/BackButton';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { nativeReverseGeocode } from '../services/geocoding';
import { getMonthFromCache, buildYearlyCache, DayRow, SWEDISH_MONTHS as SM, SWEDISH_DAYS } from '../services/monthlyCache';

const PRAYER_COLS    = ['FAJR','SHURUQ','DHUHR','ASR','MAGHRIB','ISHA','HALVA NATTEN*'];
const SWEDISH_MONTHS = SM;
const SCREEN_W = Dimensions.get('window').width;

type LocationData = { lat: number; lng: number; city: string; suburb: string; country: string; };

async function fetchMonthData(
  year: number, month: number,
  lat: number, lng: number,
  method: number, school: number,
): Promise<DayRow[]> {
  // Try cache first
  const cached = await getMonthFromCache(year, month, lat, lng, method, school);
  if (cached) return cached;

  // Cache miss — fetch this month + next for midnight calc
  const nextM = month === 12 ? 1 : month + 1;
  const nextY = month === 12 ? year + 1 : year;
  const [r1, r2] = await Promise.all([
    fetch(`https://api.aladhan.com/v1/calendar/${year}/${month}?latitude=${lat}&longitude=${lng}&method=${method}&school=${school}`),
    fetch(`https://api.aladhan.com/v1/calendar/${nextY}/${nextM}?latitude=${lat}&longitude=${lng}&method=${method}&school=${school}`),
  ]);
  const [j1, j2] = await Promise.all([r1.json(), r2.json()]);
  if (!j1.data || !Array.isArray(j1.data)) throw new Error('Bad API response');
  const days: any[]     = j1.data;
  const nextDays: any[] = j2.data || [];

  function stripTz(t: string) { return t ? t.replace(/\s*\(.*\)/, '').trim() : ''; }
  function calcMid(maghrib: string, fajrNext: string) {
    if (!maghrib || !fajrNext) return '--:--';
    const [mh, mm] = maghrib.split(':').map(Number);
    const [fh, fm] = fajrNext.split(':').map(Number);
    const m1 = mh * 60 + mm, m2 = fh * 60 + fm + 24 * 60;
    const mid = (m1 + Math.ceil((m2 - m1) / 2)) % (24 * 60);
    return `${String(Math.floor(mid / 60)).padStart(2,'0')}:${String(mid % 60).padStart(2,'0')}`;
  }

  return days.map((d: any, i: number) => {
    const t       = d.timings || {};
    const dateObj = new Date(year, month - 1, i + 1);
    const nextFajr = i < days.length - 1
      ? stripTz(days[i+1]?.timings?.Fajr || '')
      : stripTz(nextDays[0]?.timings?.Fajr || '');
    return {
      date:    `${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`,
      dayName: SWEDISH_DAYS[dateObj.getDay()],
      dayNum:  i + 1,
      times: [
        stripTz(t.Fajr||''), stripTz(t.Sunrise||''), stripTz(t.Dhuhr||''),
        stripTz(t.Asr||''), stripTz(t.Maghrib||''), stripTz(t.Isha||''),
        calcMid(stripTz(t.Maghrib||''), nextFajr),
      ],
    };
  });
}

function buildPDFHtml(rows: DayRow[], year: number, month: number, loc: LocationData, todayStr: string, logoB64: string): string {
  const monthName    = SWEDISH_MONTHS[month - 1];
  const cityName     = loc.city;
  const suburbName   = loc.suburb;
  const countryName  = loc.country;
  const locationLabel = suburbName ? `${suburbName}, ${cityName}` : cityName;

  const tableRows = rows.map(row => {
    const isToday  = row.date === todayStr;
    const isFriday = row.dayName === 'Fre';

    // Exakt samma färger som PWA:n
    const rowBg    = isFriday ? '#f0f9f7' : row.dayNum % 2 === 0 ? '#f8fafA' : '#ffffff';
    const textCol  = '#111111';
    const dayCol   = isFriday && !isToday ? '#668468' : textCol;
    const fw       = isToday ? '600' : '400';
    const dayFw    = isFriday || isToday ? '600' : '400';

    return `<tr style="background:${rowBg}">
      <td class="day" style="color:${dayCol};font-weight:${dayFw}">${row.dayName}</td>
      <td class="date" style="color:#666">${row.date}</td>
      ${row.times.map(t => `<td class="time" style="color:${textCol};font-weight:${fw}">${t}</td>`).join('')}
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
  body{font-family:'Inter',Arial,sans-serif;padding:28px 24px;color:#111;font-size:11px;background:#fff}

  /* Header */
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
  .header-left{}
  h1{font-size:20px;font-weight:900;line-height:1.2;color:#111;margin-bottom:2px}
  h2{font-size:14px;font-weight:700;color:#668468;margin-bottom:6px}
  .meta{font-size:10px;color:#666;margin-bottom:2px}
  .logo-wrap{text-align:right;display:flex;flex-direction:column;align-items:flex-end}
  .logo-wrap img{width:56px;height:56px;border-radius:12px;display:block;margin-bottom:5px}
  .hidayah-text{font-size:13px;font-weight:700;color:#668468;text-align:right;letter-spacing:0.5px}

  hr{border:none;border-top:2px solid #668468;margin:10px 0 12px}

  /* Tabell */
  table{width:100%;border-collapse:collapse;font-family:'Inter',monospace}
  thead tr{background:#668468 !important;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}
  th{
    background:#668468 !important;color:#fff !important;
    padding:7px 5px;text-align:center;
    font-size:9px;font-weight:700;letter-spacing:.5px;
    font-family:'Inter',Arial,sans-serif;
    -webkit-print-color-adjust:exact !important;
    print-color-adjust:exact !important;
  }
  th:nth-child(1),th:nth-child(2){text-align:left;padding-left:8px}
  td{border-bottom:1px solid #eef0f0;vertical-align:middle}
  td.day{padding:4px 4px 4px 8px;font-size:11px}
  td.date{padding:4px;font-size:10px}
  td.time{padding:4px 5px;text-align:center;font-size:11px;font-family:'Inter',monospace;letter-spacing:.2px}

  /* Fredag-rad subtle bakgrund */
  .friday-row td{background:#f0f9f7 !important}

  /* Footer */
  .footer{margin-top:10px;font-size:8.5px;color:#999;text-align:right;line-height:1.6}
  .footer-note{color:#666;margin-top:3px}
</style>
</head><body>

<div class="header">
  <div class="header-left">
    <h1>Bönetider för ${suburbName ? suburbName + ', ' : ''}${cityName}</h1>
    <h2>(${monthName} ${year})</h2>
    <div class="meta">📍 ${locationLabel}, ${countryName}</div>
    <div class="meta">📅 ${monthName} ${year}</div>
  </div>
  <div class="logo-wrap">
    <img src="data:image/png;base64,${logoB64}" alt="Hidayah"/>
    <div class="hidayah-text">Hidayah</div>
  </div>
</div>

<hr/>

<table>
  <thead>
    <tr>
      <th>DAG</th><th>DATUM</th>
      <th>FAJR</th><th>SHURUQ</th><th>DHUHR</th><th>ASR</th><th>MAGHRIB</th><th>ISHA</th><th>HALVA NATTEN*</th>
    </tr>
  </thead>
  <tbody>${tableRows}</tbody>
</table>

<div class="footer">
  <div class="footer-note">* Halva natten = mittpunkten mellan Maghrib och nästa dags Fajr</div>

</div>

</body></html>`;
}

export default function MonthlyScreen() {
  const { theme: T, isDark } = useTheme();
  const router = useRouter();
  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [rows,  setRows]  = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [location, setLocation] = useState<LocationData | null>(null);
  const [locLoading, setLocLoading] = useState(true);
  const [method, setMethod] = useState(3);
  const [school, setSchool] = useState(0);
  const swipeX = useRef(new Animated.Value(0)).current;
  const isAnimating = useRef(false);

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 30 && Math.abs(gs.dy) < 60,
    onPanResponderMove: (_, gs) => { swipeX.setValue(gs.dx); },
    onPanResponderRelease: (_, gs) => {
      if (isAnimating.current) return;
      if (gs.dx < -60) {
        isAnimating.current = true;
        Animated.timing(swipeX, { toValue: -SCREEN_W, duration: 200, useNativeDriver: true }).start(() => {
          swipeX.setValue(0); isAnimating.current = false;
          setMonth(m => { if (m === 12) { setYear(y => y + 1); return 1; } return m + 1; });
        });
      } else if (gs.dx > 60) {
        isAnimating.current = true;
        Animated.timing(swipeX, { toValue: SCREEN_W, duration: 200, useNativeDriver: true }).start(() => {
          swipeX.setValue(0); isAnimating.current = false;
          setMonth(m => { if (m === 1) { setYear(y => y - 1); return 12; } return m - 1; });
        });
      } else {
        Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  })).current;

  useEffect(() => {
    (async () => {
      try {
        const [settingsRaw, locationRaw] = await Promise.all([
          AsyncStorage.getItem('andalus_settings'),
          AsyncStorage.getItem('andalus_location'),
        ]);
        const saved       = settingsRaw ? JSON.parse(settingsRaw) : {};
        const savedMethod = saved.calculationMethod ?? 3;
        const savedSchool = saved.school ?? 0;
        setMethod(savedMethod);
        setSchool(savedSchool);

        if (locationRaw) {
          // Prefer the location already resolved and persisted by the prayer
          // screen — guarantees the same coordinates (and thus same cache key)
          // as the yearly cache that AppContext already built.
          const loc = JSON.parse(locationRaw);
          setLocation({
            lat:     loc.lat,
            lng:     loc.lng,
            city:    loc.city        || '',
            suburb:  loc.subLocality || '',
            country: loc.country     || '',
          });
        } else {
          // No saved location yet (first launch before prayer screen ran).
          // Fall back to a live GPS read.
          const autoLocation = saved.autoLocation ?? true;
          if (!autoLocation) { setLocLoading(false); return; }
          const Location = await import('expo-location');
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status !== 'granted') { setLocLoading(false); return; }
          const loc = await Location.getCurrentPositionAsync({});
          const { latitude: lat, longitude: lng } = loc.coords;
          const geo = await nativeReverseGeocode(lat, lng);
          setLocation({ lat, lng, city: geo.city, suburb: geo.subLocality, country: geo.country });
        }
      } catch {}
      setLocLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!location) return;
    let cancelled = false;

    // Check cache synchronously-ish — show instantly if available
    getMonthFromCache(year, month, location.lat, location.lng, method, school).then(cached => {
      if (cancelled) return;
      if (cached) {
        setRows(cached);
        setLoading(false);
      } else {
        setLoading(true);
        setRows([]);
        fetchMonthData(year, month, location.lat, location.lng, method, school)
          .then(data => { if (!cancelled) { setRows(data); setLoading(false); } })
          .catch(() => { if (!cancelled) setLoading(false); });
      }
    });

    return () => { cancelled = true; };
  }, [year, month, location, method, school]);

  function prevMonth() { setMonth(m => { if (m === 1) { setYear(y => y - 1); return 12; } return m - 1; }); }
  function nextMonth() { setMonth(m => { if (m === 12) { setYear(y => y + 1); return 1; } return m + 1; }); }

  async function exportPDF() {
    if (!rows.length || exporting || !location) return;
    setExporting(true);
    try {
      // Load icon.png as base64 for embedding in the PDF header
      const asset = Asset.fromModule(require('../assets/images/icon.png'));
      await asset.downloadAsync();
      const logoB64 = asset.localUri
        ? await FileSystem.readAsStringAsync(asset.localUri, { encoding: 'base64' as any })
        : '';

      const todayStr  = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const html      = buildPDFHtml(rows, year, month, location, todayStr, logoB64);
      const result    = await Print.printToFileAsync({ html, base64: false });
      const monthName = SWEDISH_MONTHS[month - 1];
      const locLabel  = location.suburb ? `${location.suburb}, ${location.city}` : location.city;
      const safeName  = `Bönetider för ${locLabel} ${monthName} ${year}.pdf`.replace(/[/\\:*?"<>|]/g, '-');
      const destUri   = `${FileSystem.cacheDirectory}${safeName}`;
      await FileSystem.copyAsync({ from: result.uri, to: destUri });
      await Sharing.shareAsync(destUri, {
        mimeType: 'application/pdf',
        dialogTitle: safeName,
        UTI: 'com.adobe.pdf',
      });
    } catch (e: any) {
      Alert.alert('Fel', `PDF misslyckades: ${e?.message || 'okänt fel'}`);
    }
    setExporting(false);
  }

  const s = makeStyles(T, isDark);
  const todayDate  = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const PADDING    = 24;
  const DAY_W      = 32;
  const DATE_W     = 66;
  const COL_W      = Math.floor((SCREEN_W - PADDING - DAY_W - DATE_W) / 7);
  const isLoadingAny = locLoading || loading;

  return (
    <View style={{ flex:1, backgroundColor: T.bg }} {...panResponder.panHandlers}>
      <View style={s.header}>
        <BackButton onPress={() => router.back()} />
        <Text style={s.title}>Månadsöversikt</Text>
        <TouchableOpacity onPress={exportPDF} style={[s.pdfBtn,(exporting||isLoadingAny)&&{opacity:.5}]} disabled={exporting||isLoadingAny}>
          {exporting ? <ActivityIndicator size="small" color="#fff"/> : <Text style={s.pdfText}>↓  PDF</Text>}
        </TouchableOpacity>
      </View>

      <View style={s.monthNav}>
        <TouchableOpacity onPress={prevMonth} style={s.navBtn} disabled={isLoadingAny}>
          <Text style={[s.navArrow,isLoadingAny&&{opacity:.3}]}>‹</Text>
        </TouchableOpacity>
        <Text style={s.monthTitle}>{SWEDISH_MONTHS[month-1]} {year}</Text>
        <TouchableOpacity onPress={nextMonth} style={s.navBtn} disabled={isLoadingAny}>
          <Text style={[s.navArrow,isLoadingAny&&{opacity:.3}]}>›</Text>
        </TouchableOpacity>
      </View>

      {isLoadingAny ? (
        <View style={{flex:1,alignItems:'center',justifyContent:'center'}}>
          <ActivityIndicator size="large" color={T.accent}/>
          <Text style={{color:T.textMuted,marginTop:12,fontSize:14}}>
            {locLoading ? 'Hämtar position...' : 'Hämtar bönetider...'}
          </Text>
        </View>
      ) : (
        <Animated.View style={{flex:1,transform:[{translateX:swipeX}]}}>
          <View style={[s.headerRow,{paddingHorizontal:12}]}>
            <Text style={[s.colHdr,{width:DAY_W,textAlign:'left'}]}>DAG</Text>
            <Text style={[s.colHdr,{width:DATE_W,textAlign:'left'}]}>DATUM</Text>
            {PRAYER_COLS.map(col => (
              <Text key={col} style={[s.colHdr,{width:COL_W,fontSize:8}]} numberOfLines={1}>{col}</Text>
            ))}
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom:120}}>
            {rows.map((row,i) => {
              const isToday  = row.date === todayDate;
              const isFriday = row.dayName === 'Fre';
              return (
                <View key={row.date} style={[
                  s.row,{paddingHorizontal:12},
                  i%2===1 && s.rowAlt,
                  isFriday && !isToday && s.rowFriday,
                  isToday && s.rowToday,
                ]}>
                  <Text style={[s.cell,{width:DAY_W,textAlign:'left',fontWeight:'700'},
                    isToday&&s.cellToday, isFriday&&!isToday&&s.cellFriday]}>
                    {row.dayName}
                  </Text>
                  <Text style={[s.cell,{width:DATE_W,textAlign:'left',fontSize:10,
                    color:isToday?'#fff':T.textMuted}]}>
                    {row.date}
                  </Text>
                  {row.times.map((time,ti) => (
                    <Text key={ti} style={[s.cell,{width:COL_W,fontSize:11},isToday&&s.cellToday]}>
                      {time}
                    </Text>
                  ))}
                </View>
              );
            })}
            <Text style={s.footnote}>* Halva natten = mittpunkten mellan Maghrib och nästa dags Fajr</Text>
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
}

function makeStyles(T: any, isDark: boolean) {
  return StyleSheet.create({
    header:{paddingTop:52,paddingHorizontal:16,paddingBottom:10,flexDirection:'row',alignItems:'center',gap:8,backgroundColor:T.bg},
    title:{flex:1,fontSize:18,fontWeight:'700',color:T.text},
    pdfBtn:{backgroundColor:T.accent,paddingHorizontal:14,paddingVertical:8,borderRadius:20},
    pdfText:{color:'#fff',fontSize:13,fontWeight:'600'},
    monthNav:{flexDirection:'row',alignItems:'center',justifyContent:'center',paddingVertical:8,gap:16},
    navBtn:{width:36,height:36,borderRadius:18,borderWidth:1,borderColor:T.border,alignItems:'center',justifyContent:'center'},
    navArrow:{fontSize:20,color:T.text},
    monthTitle:{fontSize:17,fontWeight:'700',color:T.text,minWidth:170,textAlign:'center'},
    headerRow:{flexDirection:'row',backgroundColor:T.accent,paddingVertical:7},
    colHdr:{fontSize:9,fontWeight:'700',color:'#fff',letterSpacing:.3,textAlign:'center'},
    row:{flexDirection:'row',paddingVertical:8,backgroundColor:T.card,borderBottomWidth:.5,borderBottomColor:T.separator},
    rowAlt:{backgroundColor:isDark?'#111':'#f8f9fa'},
    rowFriday:{backgroundColor:isDark?'rgba(45,139,120,0.1)':'rgba(45,139,120,0.06)'},
    rowToday:{backgroundColor:T.accent},
    cell:{fontSize:11,color:T.text,textAlign:'center',lineHeight:16},
    cellToday:{color:'#ffffff',fontWeight:'600'},
    cellFriday:{color:T.accent,fontWeight:'500'},
    footnote:{fontSize:10,color:T.textMuted,textAlign:'center',paddingHorizontal:16,paddingTop:10,paddingBottom:6},
  });
}
