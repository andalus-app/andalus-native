/**
 * MasjidWebModal — fullscreen in-app WebView for a masjid's external page
 * (used for the "Bönetider" link from MasjidCard). The user never leaves the
 * app: the modal opens edge-to-edge with an X close button in the top-right
 * (over the safe area) and a small title bar showing the masjid name.
 *
 * Isolation: the WebView mounts only while `visible` is true and unmounts on
 * close (all page JS, timers, listeners die with it). No background work.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, StatusBar,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';

/** Normalise a user-entered URL — accept "moskén.se/bonetider" etc. */
export function normaliseExternalUrl(raw: string): string | null {
  const v = (raw || '').trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

export default function MasjidWebModal({
  visible,
  url,
  title,
  onClose,
}: {
  visible: boolean;
  url: string | null;
  title?: string;
  onClose: () => void;
}) {
  const { theme: T, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);

  // Reset the spinner each time the modal opens with a new URL.
  useEffect(() => { if (visible) setLoading(true); }, [visible, url]);

  const normalised = useMemo(() => (url ? normaliseExternalUrl(url) : null), [url]);

  // Force a proper mobile viewport so external pages render at device width
  // and scroll naturally — otherwise WebView falls back to a ~980px "desktop"
  // layout and scales the whole page down to fit (the page appears shrunk
  // and unscrollable). Runs before content loads and again after, so the
  // override sticks even if the page tries to set its own viewport later.
  const viewportInjection = `
    (function() {
      function applyViewport() {
        try {
          var head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
          if (!head) return;
          var metas = document.querySelectorAll('meta[name="viewport"]');
          for (var i = 0; i < metas.length; i++) metas[i].parentNode.removeChild(metas[i]);
          var m = document.createElement('meta');
          m.setAttribute('name', 'viewport');
          m.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes');
          head.appendChild(m);
        } catch (e) {}
      }
      applyViewport();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyViewport);
      }
    })();
    true;
  `;

  return (
    <Modal
      visible={visible && !!normalised}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.root, { backgroundColor: T.bg }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

        {/* Header — safe-area aware, X on the right. */}
        <View
          style={[
            styles.header,
            {
              paddingTop: insets.top + 8,
              backgroundColor: T.bg,
              borderBottomColor: T.separator,
            },
          ]}
        >
          <View style={styles.headerTextWrap}>
            <Text style={[styles.headerTitle, { color: T.text }]} numberOfLines={1}>
              {title || 'Bönetider'}
            </Text>
            {!!normalised && (
              <Text style={[styles.headerUrl, { color: T.textMuted }]} numberOfLines={1}>
                {normalised.replace(/^https?:\/\//i, '')}
              </Text>
            )}
          </View>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.closeBtn, { backgroundColor: T.card }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Stäng"
          >
            <Ionicons name="close" size={22} color={T.text} />
          </TouchableOpacity>
        </View>

        {/* WebView — mounts only while the modal is open. */}
        {!!normalised && (
          <View style={styles.webWrap}>
            <WebView
              source={{ uri: normalised }}
              style={{ flex: 1, backgroundColor: T.bg }}
              originWhitelist={['*']}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              startInLoadingState={false}
              allowsBackForwardNavigationGestures
              setSupportMultipleWindows={false}
              injectedJavaScriptBeforeContentLoaded={viewportInjection}
              injectedJavaScript={viewportInjection}
              scalesPageToFit={false}
              automaticallyAdjustContentInsets={false}
              contentInsetAdjustmentBehavior="never"
            />
            {loading && (
              <View pointerEvents="none" style={styles.spinnerOverlay}>
                <ActivityIndicator size="large" color={T.accent} />
              </View>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  headerTextWrap: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  headerUrl: { fontSize: 12, marginTop: 2 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  webWrap: { flex: 1 },
  spinnerOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
});
