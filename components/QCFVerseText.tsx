/**
 * QCFVerseText
 *
 * Renders Quran verse text using the QCF V2 per-page fonts — the same fonts
 * used by the Mushaf (Quran) viewer. Loads the page font and optional Bismillah
 * font on first mount; shows a spinner while loading; falls back to standard
 * ArabicText if font loading fails.
 *
 * Props:
 *   page          — Mushaf page number (determines which QCFpNNN font to load)
 *   glyphs        — space-separated code_v2 characters from the Quran API
 *   showBismillah — render the QCF Bismillah ligature above the verse (default false)
 *   fallbackText  — shown with ArabicText/Amiri if font download fails
 *   color         — text color, matches parent card theme
 *   fontSize      — verse glyph size (default 28)
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import {
  loadQCFPageFont,
  loadBismillahFont,
  BISMILLAH_GLYPH,
  BISMILLAH_PS_NAME,
  qcfPagePsName,
} from '../services/mushafFontManager';
import ArabicText from './ArabicText';

type Props = {
  page: number;
  glyphs: string;
  showBismillah?: boolean;
  fallbackText?: string;
  color: string;
  fontSize?: number;
};

type FontState = 'loading' | 'ready' | 'failed';

export default function QCFVerseText({
  page,
  glyphs,
  showBismillah = false,
  fallbackText,
  color,
  fontSize = 28,
}: Props) {
  const [fontState, setFontState] = useState<FontState>('loading');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setFontState('loading');

    const loads: Promise<string>[] = [loadQCFPageFont(page)];
    if (showBismillah) loads.push(loadBismillahFont());

    Promise.all(loads)
      .then(() => {
        if (mountedRef.current) setFontState('ready');
      })
      .catch(() => {
        if (mountedRef.current) setFontState('failed');
      });
  }, [page, showBismillah]);

  if (fontState === 'loading') {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 10 }}>
        <ActivityIndicator size="small" color={color} />
      </View>
    );
  }

  if (fontState === 'failed') {
    if (fallbackText) {
      return (
        <ArabicText style={{
          fontSize: 22,
          lineHeight: 46,
          color,
          textAlign: 'right',
          writingDirection: 'rtl',
        }}>
          {fallbackText}
        </ArabicText>
      );
    }
    return null;
  }

  const pagePsName = qcfPagePsName(page);
  const lineHeight = Math.round(fontSize * 1.85);

  return (
    <View>
      {showBismillah && (
        <Text style={{
          fontFamily: BISMILLAH_PS_NAME,
          fontSize: Math.round(fontSize * 1.15),
          textAlign: 'center',
          color,
          // Give the single Bismillah ligature room to breathe
          marginBottom: 4,
        }}>
          {BISMILLAH_GLYPH}
        </Text>
      )}
      <Text style={{
        fontFamily: pagePsName,
        fontSize,
        lineHeight,
        color,
        textAlign: 'right',
        writingDirection: 'rtl',
      }}>
        {glyphs}
      </Text>
    </View>
  );
}
