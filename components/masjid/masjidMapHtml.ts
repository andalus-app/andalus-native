/**
 * MapLibre GL JS map document rendered inside a react-native-webview.
 *
 * Why a WebView: it needs NO native module (no prebuild/Podfile changes) and,
 * crucially for the isolation rule, the entire map + its JS, timers, listeners
 * and CSS animations are torn down the instant the WebView unmounts.
 *
 * NO Google APIs. Tiles come from OpenStreetMap raster tiles via MapLibre.
 * Swap TILE_STYLE for a MapTiler key / self-hosted tiles for production scale
 * (OSM's tile policy discourages heavy in-app traffic). This is the single
 * place to change the basemap.
 *
 * Bridge:
 *   RN → map  : window.__masjid.handle(msg)  (called via injectJavaScript)
 *   map → RN  : window.ReactNativeWebView.postMessage(JSON.stringify(msg))
 *
 * Message types (RN → map):
 *   { type:'init',  user, mosques, nearestId }
 *   { type:'setMarkers', mosques, nearestId }
 *   { type:'setUser', lat, lng }
 *   { type:'flyTo', lat, lng, zoom }
 *   { type:'focus', id }
 *   { type:'searchMarker', lat, lng } | { type:'clearSearchMarker' }
 *   { type:'zoomIn' } | { type:'zoomOut' }
 * Message types (map → RN):
 *   { type:'ready' } | { type:'markerTap', id }
 */

const MAPLIBRE_VERSION = '4.7.1';

/** OpenStreetMap raster basemap — no API key required. */
const TILE_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 }],
};

/** Base map background — matches the WebView/cover background in MasjidMapView
 *  so there's no white flash before the first paint. Single source of truth. */
export function masjidMapBg(isDark: boolean): string {
  return isDark ? '#000000' : '#F2F2F7';
}

export function buildMasjidMapHtml(accent: string, isDark: boolean): string {
  const bg = masjidMapBg(isDark);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link href="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css" rel="stylesheet" />
<script src="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js"></script>
<style>
  html, body, #map { margin:0; padding:0; height:100%; width:100%; background:${bg}; }
  .maplibregl-ctrl-attrib { font-size:9px; }
  /* Mosque pin — fixed-size box; the SVG tip sits at the box's bottom-centre
     and MapLibre owns positioning via anchor:'bottom'. NO transform on the
     marker element itself, so the anchor never shifts when zooming. */
  .mpin { width:26px; height:34px; cursor:pointer; }
  .mpin svg { display:block; position:relative; z-index:1; }
  .mpin.subtle svg { opacity:0.9; }
  /* Pulse ring: absolutely positioned child, pointer-events:none, OUT OF FLOW
     so it never changes the marker's bounding box / anchor. Only the ring
     scales — the marker element itself is never transformed. */
  .mpin .pulse {
    position:absolute; left:13px; top:13px; width:16px; height:16px;
    margin:-8px 0 0 -8px; border-radius:50%; background:${accent};
    pointer-events:none; z-index:0; animation:masjidPulse 2s ease-out infinite;
  }
  @keyframes masjidPulse {
    0%   { transform:scale(1);   opacity:0.45; }
    100% { transform:scale(3.2); opacity:0; }
  }
  /* User location dot — Apple-standard blue. */
  .userdot { width:16px; height:16px; border-radius:50%; background:#0A84FF;
             border:3px solid #fff; box-shadow:0 0 0 2px rgba(10,132,255,0.3); }
  /* Searched-place marker — system orange dot, kept distinct from the green
     mosque pins so users never confuse a search pin with a result. */
  .searchpin { width:16px; height:16px; border-radius:50%; background:#FF9500;
               border:2px solid #fff; box-shadow:0 1px 3px rgba(0,0,0,0.4); }
</style>
</head>
<body>
<div id="map"></div>
<script>
(function () {
  var post = function (m) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m));
  };

  var map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [18.0686, 59.3293],
    zoom: 11,
    attributionControl: true,
  });
  // No built-in NavigationControl — the +/- controls are owned by React
  // Native (see app/masjid.tsx) and dispatch zoomIn/zoomOut messages here.

  var markers = {};        // id -> maplibregl.Marker (mosques)
  var userMarker = null;
  var searchMarker = null;

  // Teardrop pin in a 26x34 box; the point is at (13, 33) ≈ bottom-centre, so
  // anchor:'bottom' puts the tip exactly on the coordinate. No CSS rotate.
  // Fill = the app accent green (matches the "Vägbeskrivning" CTA so the map
  // pins read as part of the same visual family).
  var PIN_SVG =
    '<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M13 33 C13 33 24 21 24 12.5 C24 6.15 19.08 1 13 1 C6.92 1 2 6.15 2 12.5 C2 21 13 33 13 33 Z" ' +
        'fill="${accent}" stroke="#ffffff" stroke-width="2"/>' +
      '<circle cx="13" cy="12.5" r="4.5" fill="#ffffff"/>' +
    '</svg>';

  function makeMosqueEl(isNearest) {
    var el = document.createElement('div');
    el.className = 'mpin' + (isNearest ? ' nearest' : ' subtle');
    el.innerHTML = PIN_SVG;
    if (isNearest) {
      var ring = document.createElement('div');
      ring.className = 'pulse';
      el.appendChild(ring);   // absolute, pointer-events:none — never affects the box
    }
    return el;
  }

  function clearMosqueMarkers() {
    Object.keys(markers).forEach(function (id) { markers[id].remove(); });
    markers = {};
  }

  function setMarkers(mosques, nearestId) {
    clearMosqueMarkers();
    (mosques || []).forEach(function (m) {
      var el = makeMosqueEl(m.id === nearestId);
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        post({ type: 'markerTap', id: m.id });
      });
      var mk = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([m.lng, m.lat]).addTo(map);
      markers[m.id] = mk;
    });
  }

  function setUser(lat, lng) {
    if (userMarker) { userMarker.setLngLat([lng, lat]); return; }
    var el = document.createElement('div');
    el.className = 'userdot';
    userMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
  }

  function fitTo(user, mosques, nearestId) {
    var nearest = (mosques || []).filter(function (m) { return m.id === nearestId; })[0];
    if (user && nearest) {
      var b = new maplibregl.LngLatBounds([user.lng, user.lat], [user.lng, user.lat]);
      b.extend([nearest.lng, nearest.lat]);
      map.fitBounds(b, { padding: { top: 90, left: 60, right: 60, bottom: 280 }, maxZoom: 15, duration: 600 });
    } else if (user) {
      map.easeTo({ center: [user.lng, user.lat], zoom: 13, duration: 600 });
    }
  }

  window.__masjid = {
    handle: function (msg) {
      try {
        switch (msg.type) {
          case 'init':
            if (msg.user) setUser(msg.user.lat, msg.user.lng);
            setMarkers(msg.mosques, msg.nearestId);
            fitTo(msg.user, msg.mosques, msg.nearestId);
            break;
          case 'setMarkers':
            setMarkers(msg.mosques, msg.nearestId);
            break;
          case 'setUser':
            setUser(msg.lat, msg.lng);
            break;
          case 'flyTo':
            // padBottom/padTop = overlay heights from RN (list panel + header).
            // Centres within the free area; padding fully overrides leftover fitBounds padding.
            map.easeTo({
              center: [msg.lng, msg.lat],
              zoom: msg.zoom || 14,
              padding: { top: msg.padTop || 0, right: 0, bottom: msg.padBottom || 0, left: 0 },
              duration: 600,
            });
            break;
          case 'focus':
            // Centre EXACTLY on the selected masjid [lng, lat]. No fitBounds, no
            // horizontal padding. padBottom = bottom-card height so MapLibre centres
            // the marker in the VISIBLE map area above the card (not the raw viewport);
            // padTop = header height so it never hugs the top edge.
            var mk = markers[msg.id];
            if (mk) {
              var ll = mk.getLngLat();
              map.easeTo({
                center: [ll.lng, ll.lat],
                zoom: Math.max(map.getZoom(), 15),
                padding: { top: msg.padTop || 0, right: 0, bottom: msg.padBottom || 0, left: 0 },
                duration: 500,
              });
            }
            break;
          case 'searchMarker':
            if (searchMarker) searchMarker.remove();
            var sEl = document.createElement('div'); sEl.className = 'searchpin';
            searchMarker = new maplibregl.Marker({ element: sEl })  // default anchor 'center' for a dot
              .setLngLat([msg.lng, msg.lat]).addTo(map);
            break;
          case 'clearSearchMarker':
            if (searchMarker) { searchMarker.remove(); searchMarker = null; }
            break;
          // Native +/- controls — RN sends one message per tap; MapLibre's
          // built-in easeTo provides the same animation the old in-map control
          // used to.
          case 'zoomIn':  map.zoomIn();  break;
          case 'zoomOut': map.zoomOut(); break;
        }
      } catch (e) { /* ignore malformed message */ }
    },
  };

  map.on('load', function () { post({ type: 'ready' }); });
})();
true;
</script>
</body>
</html>`;
}
