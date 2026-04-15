/**
 * WebView-based PDF viewer — replaces react-native-pdf for Expo Go compatibility.
 * iOS WKWebView renders PDFs natively. Page navigation uses injected JS via PDF.js.
 * When running a proper development build, swap this back to react-native-pdf.
 */
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

interface Source {
  uri: string;
  cache?: boolean;
}

interface PdfProps {
  source: Source;
  page?: number;
  style?: object;
  horizontal?: boolean;
  enablePaging?: boolean;
  fitPolicy?: number;
  onLoadComplete?: (numberOfPages: number, path?: string) => void;
  onPageChanged?: (currentPage: number, numberOfPages: number) => void;
  onPageSingleTap?: (page: number) => void;
  onScaleChanged?: (scale: number) => void;
  onError?: (error: unknown) => void;
  renderActivityIndicator?: () => React.ReactElement;
}

// Minimal PDF.js viewer injected into the WebView.
// Two-canvas crossfade: new page renders on the hidden canvas, then the pair swap
// opacity so there is never a flash or blank frame between pages.
// Pinch-to-zoom enabled; minimum zoom is always fit-to-screen.
// Navigating to a new page resets zoom back to fit-to-screen.
function buildHtml(uri: string, initialPage: number): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=5,user-scalable=yes">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#111}
  body{display:flex;align-items:center;justify-content:center}
  #loader{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#111;z-index:9}
  /* Two canvases stacked on top of each other inside a sized container */
  #stage{position:relative}
  #stage canvas{position:absolute;top:0;left:0;display:block;transition:opacity 220ms ease}
  #c1{opacity:0}
</style>
</head>
<body>
<div id="loader"><svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="none" stroke="#668468" stroke-width="4" stroke-dasharray="80" stroke-dashoffset="60"><animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="1s" repeatCount="indefinite"/></circle></svg></div>
<div id="stage"><canvas id="c0"></canvas><canvas id="c1"></canvas></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
var lib, pdfDoc, currentPage = ${initialPage}, totalPages = 0;
var touchStartX = 0, touchStartY = 0, touchStartTime = 0, touchIsMulti = false;
// front = index of the currently visible canvas (0 or 1)
var front = 0;
var canvases = [document.getElementById('c0'), document.getElementById('c1')];
var stage = document.getElementById('stage');

window.onload = function() {
  lib = window['pdfjs-dist/build/pdf'];
  lib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  lib.getDocument({ url: ${JSON.stringify(uri)}, withCredentials: false }).promise
    .then(function(pdf) {
      pdfDoc = pdf;
      totalPages = pdf.numPages;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'load', total: totalPages }));
      renderPage(currentPage);
    })
    .catch(function(e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', msg: String(e) }));
    });
};

function resetZoom() {
  // Toggling user-scalable forces WKWebView to snap back to minimum-scale (1 = fit).
  var meta = document.querySelector('meta[name=viewport]');
  meta.content = 'width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=5,user-scalable=no';
  meta.content = 'width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=5,user-scalable=yes';
}

function getViewportScale() {
  return window.visualViewport ? window.visualViewport.scale : 1;
}

function renderPage(n) {
  resetZoom();
  pdfDoc.getPage(n).then(function(page) {
    var vp0 = page.getViewport({ scale: 1 });
    // Fit page to screen — constrain by both width and height so nothing is cropped.
    var dpr = window.devicePixelRatio || 1;
    var scaleW = window.innerWidth / vp0.width;
    var scaleH = window.innerHeight / vp0.height;
    var fitScale = Math.min(scaleW, scaleH);
    var cssW = Math.round(vp0.width * fitScale);
    var cssH = Math.round(vp0.height * fitScale);
    var renderScale = fitScale * dpr;
    var vp = page.getViewport({ scale: renderScale });

    // Render into the BACK canvas (the one that is currently invisible)
    var back = 1 - front;
    var canvas = canvases[back];
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
      .then(function() {
        document.getElementById('loader').style.display = 'none';
        // Size the stage so the flex layout stays correct
        stage.style.width = cssW + 'px';
        stage.style.height = cssH + 'px';
        // Crossfade: reveal back, hide front
        canvases[back].style.opacity = '1';
        canvases[front].style.opacity = '0';
        front = back;
        currentPage = n;
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'page', page: n, total: totalPages }));
      });
  });
}

window._goTo = function(n) {
  if (!pdfDoc || n < 1 || n > totalPages) return;
  renderPage(n);
};

// Swipe left/right to navigate pages; tap to toggle controls.
// Swipe is suppressed when the user is zoomed in (they are panning instead).
document.addEventListener('touchstart', function(e) {
  touchIsMulti = e.touches.length > 1;
  if (touchIsMulti) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchStartTime = Date.now();
}, { passive: true });

document.addEventListener('touchmove', function(e) {
  if (e.touches.length > 1) touchIsMulti = true; // pinch started mid-gesture
}, { passive: true });

document.addEventListener('touchend', function(e) {
  if (touchIsMulti) return; // was a pinch — ignore
  if (getViewportScale() > 1.05) return; // zoomed in — user is panning, not navigating
  var dx = e.changedTouches[0].clientX - touchStartX;
  var dy = e.changedTouches[0].clientY - touchStartY;
  var dt = Date.now() - touchStartTime;
  var absDx = Math.abs(dx), absDy = Math.abs(dy);
  if (absDx > 40 && absDx > absDy * 1.5 && dt < 500) {
    // Horizontal swipe: left = next page, right = prev page
    if (dx < 0) window._goTo(currentPage + 1);
    else window._goTo(currentPage - 1);
  } else if (absDx < 10 && absDy < 10 && dt < 300) {
    // Tap: signal React Native to toggle controls
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'tap', page: currentPage }));
  }
}, { passive: true });
</script>
</body>
</html>`;
}

const NativePdf = forwardRef<{ setPage: (n: number) => void }, PdfProps>(
  (props, ref) => {
    const {
      source,
      page = 1,
      style,
      onLoadComplete,
      onPageChanged,
      onPageSingleTap,
      onError,
      renderActivityIndicator,
    } = props;

    const wvRef = useRef<WebView>(null);
    const [loading, setLoading] = useState(true);

    useImperativeHandle(ref, () => ({
      setPage: (n: number) => {
        wvRef.current?.injectJavaScript(`window._goTo(${n}); true;`);
      },
    }));

    const onMessage = (e: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(e.nativeEvent.data);
        if (msg.type === 'load') {
          setLoading(false);
          onLoadComplete?.(msg.total);
        } else if (msg.type === 'page') {
          onPageChanged?.(msg.page, msg.total);
        } else if (msg.type === 'tap') {
          onPageSingleTap?.(msg.page);
        } else if (msg.type === 'error') {
          setLoading(false);
          onError?.(msg.msg);
        }
      } catch {}
    };

    return (
      <View style={[{ flex: 1 }, style]}>
        <WebView
          ref={wvRef}
          originWhitelist={['*']}
          source={{ html: buildHtml(source.uri, page) }}
          javaScriptEnabled
          allowFileAccess
          allowUniversalAccessFromFileURLs
          onMessage={onMessage}
          onError={() => { setLoading(false); onError?.('WebView load failed'); }}
          style={{ flex: 1, backgroundColor: '#111' }}
        />
        {loading && (
          <View style={{
            ...StyleSheet.absoluteFillObject,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#111',
          }}>
            {renderActivityIndicator?.() ?? <ActivityIndicator size="large" color="#668468" />}
          </View>
        )}
      </View>
    );
  }
);

import { StyleSheet } from 'react-native';
export default NativePdf;
