/**
 * Minimal MapLibre map for picking a location (used by MasjidLocationPicker).
 * A fixed centre crosshair marks the chosen point; the map posts its centre
 * coordinate on every 'moveend'. NO Google APIs — OSM raster tiles only.
 * Lives in a WebView that mounts only while the picker modal is open.
 */
const PICKER_TILE_STYLE = {
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

const MAPLIBRE_VERSION = '4.7.1';

export function buildPickerHtml(accent: string, lat: number, lng: number): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link href="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css" rel="stylesheet" />
<script src="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js"></script>
<style>
  html, body, #map { margin:0; padding:0; height:100%; width:100%; }
  /* Fixed centre crosshair — the map moves under it; centre = chosen point. */
  #crosshair {
    position:absolute; left:50%; top:50%; width:28px; height:40px; margin:-40px 0 0 -14px;
    pointer-events:none; z-index:5;
  }
  #crosshair .pin {
    width:24px; height:24px; margin:0 auto; border-radius:50% 50% 50% 50%;
    background:${accent}; border:3px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,0.4);
  }
  #crosshair .stem { width:2px; height:14px; margin:0 auto; background:${accent}; }
  /* user's actual GPS position */
  .userdot { width:16px; height:16px; border-radius:50%; background:#0A84FF;
             border:3px solid #fff; box-shadow:0 0 0 2px rgba(10,132,255,0.3); }
</style>
</head>
<body>
<div id="map"></div>
<div id="crosshair"><div class="pin"></div><div class="stem"></div></div>
<script>
(function () {
  var post = function (m) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var map = new maplibregl.Map({
    container: 'map',
    style: ${JSON.stringify(PICKER_TILE_STYLE)},
    center: [${lng}, ${lat}],
    zoom: 15,
    attributionControl: true,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  function emit() { var c = map.getCenter(); post({ type: 'center', lat: c.lat, lng: c.lng }); }

  // User's actual position (blue dot). The crosshair stays fixed at the centre;
  // the selected coordinate is always the map centre (emitted on moveend).
  var userMarker = null;
  function setUser(lat, lng) {
    if (userMarker) { userMarker.setLngLat([lng, lat]); return; }
    var el = document.createElement('div'); el.className = 'userdot';
    userMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
  }

  // RN → picker bridge: recenter on a coordinate (moves the crosshair there) and
  // optionally show the user dot.
  window.__picker = {
    handle: function (msg) {
      try {
        if (msg.type === 'center') {
          map.flyTo({ center: [msg.lng, msg.lat], zoom: msg.zoom || 16, duration: 500 });
        } else if (msg.type === 'user') {
          setUser(msg.lat, msg.lng);
        }
      } catch (e) { /* ignore */ }
    },
  };

  map.on('load', function () { post({ type: 'ready' }); emit(); });
  map.on('moveend', emit);
})();
true;
</script>
</body>
</html>`;
}
