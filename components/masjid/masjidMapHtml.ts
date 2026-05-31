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
 *   { type:'init',  user, mosques, highlightId }
 *   { type:'setMarkers', mosques, highlightId }
 *   { type:'setUser', lat, lng }
 *   { type:'flyTo', lat, lng, zoom }
 *   { type:'focus', id }
 *   { type:'searchMarker', lat, lng } | { type:'clearSearchMarker' }
 *   { type:'zoomIn' } | { type:'zoomOut' }
 * Message types (map → RN):
 *   { type:'ready' } | { type:'markerTap', id }
 */

import { MOSQUE_PIN_PNG } from '../../constants/mosquePinImage';

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
<script
  src="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js"
  onerror="window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'maperror',stage:'script'}));"
></script>
<style>
  html, body, #map { margin:0; padding:0; height:100%; width:100%; background:${bg}; }
  .maplibregl-ctrl-attrib { font-size:9px; }
  /* Mosque pin (highlighted/nearest) — fixed-size box; the PNG tip sits at the
     box's bottom-centre and MapLibre owns positioning via anchor:'bottom'. NO
     transform on the marker element itself, so the anchor never shifts when
     zooming. The box is ~10% larger than the clustered symbol-layer pins
     (see PIN_DISPLAY) to make the selected masjid stand out. */
  .mpin { width:37px; height:37px; cursor:pointer; }
  .mpin img { display:block; width:100%; height:100%; position:relative; z-index:1; }
  /* Pulse ring: absolutely positioned child, pointer-events:none, OUT OF FLOW
     so it never changes the marker's bounding box / anchor. Only the ring
     scales — the marker element itself is never transformed. Centred behind
     the pin head. */
  .mpin .pulse {
    position:absolute; left:50%; top:42%; width:16px; height:16px;
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
  var stage = function (s) { post({ type: 'stage', stage: s }); };

  // Connectivity reporter — runs in the inline document (independent of the
  // unpkg MapLibre script), so it keeps reporting even when offline. Drives the
  // local "Ingen internetuppkoppling" banner via { type:'net', online }.
  var reportNet = function () { post({ type: 'net', online: navigator.onLine }); };
  window.addEventListener('online', reportNet);
  window.addEventListener('offline', reportNet);
  reportNet();

  // If the MapLibre script never loaded (CDN slow/blocked), report it so RN can
  // show the error/retry state instead of waiting on a 'load' that can't fire.
  if (typeof maplibregl === 'undefined') {
    post({ type: 'maperror', stage: 'script' });
    return;
  }

  var map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [18.0686, 59.3293],
    zoom: 11,
    attributionControl: true,
  });
  stage('styleLoadingStarted');
  // No built-in NavigationControl — the +/- controls are owned by React
  // Native (see app/masjid.tsx) and dispatch zoomIn/zoomOut messages here.

  // Mosque pins are a GPU-backed, CLUSTERED GeoJSON layer — NOT one DOM element
  // per pin. This stays smooth with the whole country's mosques (hundreds → low
  // thousands) visible at once, which a per-pin DOM approach can't. The only
  // exception is the *highlighted* mosque (the nearest on first load, then
  // whichever the user taps): kept as a single DOM marker so it can show the CSS
  // pulse ring + larger size (1 element → no perf cost) and is never swallowed
  // into a cluster bubble.
  var SRC = 'mosques';
  var highlightMarker = null; // single pulsing DOM marker for the highlighted mosque
  var userMarker = null;
  var searchMarker = null;
  var pointById = {};         // id -> [lng,lat] for focus() lookups (ALL mosques)
  var layersReady = false;
  var tapsBound = false;

  // Single PNG used for EVERY mosque marker (light + dark mode) — both the
  // clustered symbol-layer pins and the highlighted (nearest) DOM marker.
  var PIN_IMG = '${MOSQUE_PIN_PNG}';
  // Base on-screen size (CSS px) of a clustered pin. The PNG is 534x534; it is
  // registered at this CSS size (pixelRatio = natural / display) so icon-size
  // can stay 1 while the texture keeps full resolution → crisp on retina.
  var PIN_NATURAL = 534, PIN_DISPLAY = 34;

  // The highlighted mosque keeps its DOM pin + pulse ring (1 element, GPU-friendly).
  // Rendered ~10% larger than the clustered pins (CSS .mpin = 37px) to stand out.
  function makeHighlightEl() {
    var el = document.createElement('div');
    el.className = 'mpin highlight';
    var img = document.createElement('img');
    img.src = PIN_IMG;
    el.appendChild(img);
    var ring = document.createElement('div');
    ring.className = 'pulse';
    el.appendChild(ring);
    return el;
  }

  // Load the pin image once, then run cb. Concurrent callers are queued so the
  // image is created/added a single time. Registered with pixelRatio so the
  // 534px PNG renders at PIN_DISPLAY CSS px with icon-size:1.
  var pinLoading = false, pinCbs = [];
  function withPin(cb) {
    if (map.hasImage && map.hasImage('mosque-pin')) { cb(); return; }
    pinCbs.push(cb);
    if (pinLoading) return;
    pinLoading = true;
    var img = new Image();
    img.onload = function () {
      try { if (!map.hasImage('mosque-pin')) map.addImage('mosque-pin', img, { pixelRatio: PIN_NATURAL / PIN_DISPLAY }); } catch (e) {}
      pinLoading = false;
      var cbs = pinCbs; pinCbs = [];
      cbs.forEach(function (f) { try { f(); } catch (e) {} });
    };
    img.onerror = function () { pinLoading = false; pinCbs = []; };
    img.src = PIN_IMG;
  }

  // Bind cluster/pin tap handlers once.
  function bindLayerTaps() {
    if (tapsBound) return;
    tapsBound = true;
    // Tap a cluster → zoom to its expansion zoom so the bubble splits apart.
    map.on('click', 'clusters', function (e) {
      var f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
      if (!f) return;
      var coords = f.geometry.coordinates;
      var src = map.getSource(SRC);
      var ret = src.getClusterExpansionZoom(f.properties.cluster_id);
      if (ret && typeof ret.then === 'function') {
        // MapLibre 4.x (this app uses 4.7.1): Promise-based.
        ret.then(function (zoom) { map.easeTo({ center: coords, zoom: zoom, duration: 500 }); }).catch(function () {});
      } else {
        // Older callback form (defensive — not used on 4.x).
        src.getClusterExpansionZoom(f.properties.cluster_id, function (err, zoom) {
          if (!err) map.easeTo({ center: coords, zoom: zoom, duration: 500 });
        });
      }
    });
    // Tap an individual pin → open its card in RN.
    map.on('click', 'unclustered', function (e) {
      var f = e.features && e.features[0];
      if (f) post({ type: 'markerTap', id: f.properties.id });
    });
    map.on('mouseenter', 'clusters', function () { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'clusters', function () { map.getCanvas().style.cursor = ''; });
  }

  // Create the clustered source + its 3 layers once (cluster bubble, count,
  // unclustered pin). Idempotent via layersReady. The pin image must be added
  // before the symbol layer references it, so this runs inside withPin().
  function ensureLayers(cb) {
    if (layersReady) { cb(); return; }
    withPin(function () {
      if (!map.getSource(SRC)) {
        map.addSource(SRC, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterRadius: 50,
          clusterMaxZoom: 12,
        });
      }
      if (!map.getLayer('clusters')) {
        map.addLayer({
          id: 'clusters', type: 'circle', source: SRC, filter: ['has', 'point_count'],
          paint: {
            'circle-color': '${accent}',
            'circle-opacity': 0.92,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            // Bubble grows in steps with how many mosques it represents.
            'circle-radius': ['step', ['get', 'point_count'], 16, 25, 20, 100, 26],
          },
        });
      }
      if (!map.getLayer('cluster-count')) {
        map.addLayer({
          id: 'cluster-count', type: 'symbol', source: SRC, filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Bold'],
            'text-size': 13,
            'text-allow-overlap': true,
          },
          paint: { 'text-color': '#ffffff' },
        });
      }
      if (!map.getLayer('unclustered')) {
        map.addLayer({
          id: 'unclustered', type: 'symbol', source: SRC, filter: ['!', ['has', 'point_count']],
          layout: {
            'icon-image': 'mosque-pin',
            'icon-size': 1,
            'icon-anchor': 'bottom',
            'icon-allow-overlap': true,
          },
        });
      }
      bindLayerTaps();
      layersReady = true;
      cb();
    });
  }

  function setMarkers(mosques, highlightId) {
    mosques = mosques || [];
    pointById = {};
    var features = [];
    for (var i = 0; i < mosques.length; i++) {
      var m = mosques[i];
      pointById[m.id] = [m.lng, m.lat];
      // The highlighted mosque is drawn as its own pulsing DOM marker — keep it
      // OUT of the clustered source so it's never hidden inside a cluster bubble.
      if (m.id === highlightId) continue;
      features.push({ type: 'Feature', properties: { id: m.id }, geometry: { type: 'Point', coordinates: [m.lng, m.lat] } });
    }
    ensureLayers(function () {
      var src = map.getSource(SRC);
      if (src) src.setData({ type: 'FeatureCollection', features: features });
    });
    // (Re)place the highlighted pulsing DOM marker (follows the tapped mosque).
    if (highlightMarker) { highlightMarker.remove(); highlightMarker = null; }
    if (highlightId && pointById[highlightId]) {
      var el = makeHighlightEl();
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        post({ type: 'markerTap', id: highlightId });
      });
      highlightMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(pointById[highlightId]).addTo(map);
    }
  }

  function setUser(lat, lng) {
    if (userMarker) { userMarker.setLngLat([lng, lat]); return; }
    var el = document.createElement('div');
    el.className = 'userdot';
    userMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
  }

  function fitTo(user, mosques, highlightId) {
    var nearest = (mosques || []).filter(function (m) { return m.id === highlightId; })[0];
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
            setMarkers(msg.mosques, msg.highlightId);
            fitTo(msg.user, msg.mosques, msg.highlightId);
            break;
          case 'setMarkers':
            setMarkers(msg.mosques, msg.highlightId);
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
            // the point in the VISIBLE map area above the card (not the raw viewport);
            // padTop = header height so it never hugs the top edge. Coords come from
            // pointById (built in setMarkers for ALL mosques) — works for a clustered
            // pin too, since easeTo to zoom 15 reveals it out of its cluster.
            var fc = pointById[msg.id];
            if (fc) {
              map.easeTo({
                center: fc,
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

  // ── Lifecycle → RN ────────────────────────────────────────────────────────
  // 'ready' is the single signal RN waits on to reveal the map. Style + error
  // events are forwarded so RN can log progress and fall into the error/retry
  // state when the remote style/glyph/sprite chain fails.
  var ready = false;
  var styleReported = false;
  map.on('styledata', function () {
    if (!styleReported) { styleReported = true; stage('styleLoaded'); }
  });
  map.on('load', function () { ready = true; post({ type: 'ready' }); });
  map.on('error', function (e) {
    // After the map is up, a single failed tile must NOT blank the screen —
    // only pre-ready failures (style/glyphs/sprite/source bootstrap) are fatal.
    var message = (e && e.error && e.error.message) ? e.error.message : 'map error';
    if (!ready) post({ type: 'maperror', stage: 'source', message: message });
  });
})();
true;
</script>
</body>
</html>`;
}
