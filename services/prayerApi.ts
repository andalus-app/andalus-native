const BASE = 'https://api.aladhan.com/v1';
function stripTz(t) { return t ? t.replace(/\s*\(.*\)/, '').trim() : ''; }
export function calcMidnight(maghrib, fajrNext) {
  if (!maghrib || !fajrNext) return null;
  const [mh, mm] = maghrib.split(':').map(Number);
  const [fh, fm] = fajrNext.split(':').map(Number);
  const maghribMin = mh * 60 + mm;
  const fajrMin = fh * 60 + fm + 24 * 60;
  const midMin = (maghribMin + Math.ceil((fajrMin - maghribMin) / 2)) % (24 * 60);
  return String(Math.floor(midMin/60)).padStart(2,'0') + ':' + String(midMin%60).padStart(2,'0');
}
function mapTimings(t) {
  return { Fajr: stripTz(t.Fajr), Sunrise: stripTz(t.Sunrise), Dhuhr: stripTz(t.Dhuhr), Asr: stripTz(t.Asr), Maghrib: stripTz(t.Maghrib), Isha: stripTz(t.Isha), Midnight: null };
}
function fmtDate(d) {
  return String(d.getDate()).padStart(2,'0') + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + d.getFullYear();
}
export async function fetchPrayerTimes(lat, lng, dateStr, method, school) {
  if (method === undefined) method = 3;
  if (school === undefined) school = 0;
  const res = await fetch(BASE+'/timings/'+dateStr+'?latitude='+lat+'&longitude='+lng+'&method='+method+'&school='+school);
  if (!res.ok) throw new Error('Failed to fetch prayer times');
  const json = await res.json();
  return { timings: mapTimings(json.data.timings), hijri: json.data.date && json.data.date.hijri };
}
export async function fetchTomorrowPrayerTimes(lat, lng, method, school) {
  if (method === undefined) method = 3;
  if (school === undefined) school = 0;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const res = await fetch(BASE+'/timings/'+fmtDate(tomorrow)+'?latitude='+lat+'&longitude='+lng+'&method='+method+'&school='+school);
  if (!res.ok) throw new Error('Failed to fetch tomorrow');
  const json = await res.json();
  return mapTimings(json.data.timings);
}
export async function fetchMonthlyTimes(lat, lng, month, year, method, school) {
  if (method === undefined) method = 3;
  if (school === undefined) school = 0;
  const res = await fetch(BASE+'/calendar/'+year+'/'+month+'?latitude='+lat+'&longitude='+lng+'&method='+method+'&school='+school);
  if (!res.ok) throw new Error('Failed to fetch monthly times');
  const json = await res.json();
  return json.data.map(function(day) {
    return { gregorianDay: parseInt(day.date.gregorian.day), date: day.date.readable, timings: mapTimings(day.timings) };
  });
}
export async function fetchQiblaDirection(lat, lng) {
  const res = await fetch(BASE+'/qibla/'+lat+'/'+lng);
  if (!res.ok) throw new Error('Failed to fetch Qibla');
  const json = await res.json();
  if (json.code !== 200) throw new Error(json.status || 'API error');
  return json.data.direction;
}
export async function reverseGeocode(lat, lng) {
  const { nativeReverseGeocode } = require('./geocoding');
  const geo = await nativeReverseGeocode(lat, lng);
  // Combine subLocality + city for callers that only need a single display string
  const combined = geo.subLocality && geo.city && geo.subLocality !== geo.city
    ? geo.subLocality + ', ' + geo.city
    : geo.city || geo.subLocality || '';
  return { city: combined, country: geo.country };
}
export async function searchCity(query) {
  const res = await fetch('https://nominatim.openstreetmap.org/search?q='+encodeURIComponent(query)+'&format=json&limit=6&addressdetails=1', { headers: { 'Accept': 'application/json', 'User-Agent': 'AndalusApp/1.0' } });
  if (!res.ok) throw new Error('Search failed');
  const json = await res.json();
  return json.map(function(r) {
    return { latitude: parseFloat(r.lat), longitude: parseFloat(r.lon), city: (r.address && (r.address.city || r.address.town || r.address.village)) || r.display_name.split(',')[0], country: (r.address && r.address.country) || '' };
  });
}
