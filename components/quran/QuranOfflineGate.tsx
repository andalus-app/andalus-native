/**
 * QuranOfflineGate.tsx
 *
 * Per-page gate component that blocks rendering of a Quran page until it is
 * verified offline (page data + font on disk).
 *
 * Shows a loading spinner while the page is being downloaded.
 * Used inside QuranPageView to ensure MushafRenderer never renders unverified pages.
 */

import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { usePageVerified } from '../../hooks/useOfflineStats';
import { prioritize } from '../../services/quranOfflineManager';
import { useTheme } from '../../context/ThemeContext';

type Props = {
  pageNumber: number;
  children: React.ReactNode;
};

/**
 * Gate component that blocks rendering if page is not verified offline.
 * Automatically triggers download of the page (boost to p0) and shows spinner.
 * Once verified, renders children immediately.
 */
export function QuranOfflineGate({ pageNumber, children }: Props) {
  const verified = usePageVerified(pageNumber);
  const { theme: T } = useTheme();

  // If page not verified, trigger high-priority download
  useEffect(() => {
    if (!verified) {
      prioritize(pageNumber);
    }
  }, [pageNumber, verified]);

  if (!verified) {
    return (
      <View style={[styles.container, { backgroundColor: T.bg }]}>
        <ActivityIndicator size="large" color={T.accent} />
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
