/**
 * RuqyahHeroHeader
 *
 * Hero-sektion längst upp på Ruqyah-startsidan.
 * Renderar bismillah-ligatur via King Fahd Complex QCF V2 (QCF_BSML) —
 * exakt samma font som Mushaf-renderaren — med Ruqyah-temats orangefärg.
 *
 * Font laddas asynkront (download-mode: cachad i DocumentDir efter första
 * laddning). Spinner visas tills fonten är klar.
 */

import React, { useEffect, useState, memo } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from 'react-native';
import Svg, { Text as SvgText } from 'react-native-svg';
import {
  loadBismillahFont,
  BISMILLAH_PS_NAME,
  BISMILLAH_GLYPH,
} from '../../services/mushafFontManager';
import {
  RO,
  RO_BG,
  RO_DIM,
  RO_BORDER_FAINT,
  RO_TEXT,
  RO_TEXT_SEC,
  RO_TEXT_MUTED,
} from './ruqyahColors';

// ── Layout ────────────────────────────────────────────────────────────────────

const SCREEN_W   = Dimensions.get('window').width;
const SVG_W      = SCREEN_W - 32; // matches screen paddingHorizontal: 16
const SVG_H      = 46;
const FONT_SIZE  = 27;
// Baseline at ~70 % of SVG height gives the glyph visual centering
const BASELINE_Y = Math.round(SVG_H * 0.70);

// ── Component ─────────────────────────────────────────────────────────────────

function RuqyahHeroHeader() {
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadBismillahFont()
      .then(() => { if (mounted) setFontReady(true); })
      .catch(() => { /* silent — fallback to placeholder */ });
    return () => { mounted = false; };
  }, []);

  return (
    <View style={styles.container}>
      {/* ── Bismillah ── */}
      <View style={styles.bismillahWrap}>
        {fontReady ? (
          <Svg width={SVG_W} height={SVG_H}>
            <SvgText
              x={SVG_W / 2}
              y={BASELINE_Y}
              textAnchor="middle"
              fontFamily={BISMILLAH_PS_NAME}
              fontSize={FONT_SIZE}
              fill={RO}
            >
              {BISMILLAH_GLYPH}
            </SvgText>
          </Svg>
        ) : (
          <View style={[styles.bismillahPlaceholder, { width: SVG_W, height: SVG_H }]}>
            <ActivityIndicator size="small" color={RO} />
          </View>
        )}
      </View>

      {/* ── Titel ── */}
      <Text style={styles.title}>Islamisk Ruqyah</Text>

      {/* ── Brödtext ── */}
      <Text style={styles.body}>
        Fördjupa din kunskap om ruqyah, jinn, magi och det onda ögat – genom autentiska islamiska källor.
      </Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 24,
    paddingHorizontal: 8,
  },
  bismillahWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  bismillahPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: RO_TEXT,
    textAlign: 'center',
    letterSpacing: 0.3,
    marginBottom: 10,
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
    color: RO_TEXT_SEC,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});

export default memo(RuqyahHeroHeader);
