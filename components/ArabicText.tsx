/**
 * ArabicText.tsx
 *
 * Drop-in replacement for <Text> for Arabic content in Dhikr/du'a screens.
 *
 * - Starts the font loader on first mount (no-op on subsequent mounts).
 * - Shows system Arabic font immediately, then switches to the downloaded
 *   font when it becomes available — no flash, no layout shift.
 * - Accepts all standard TextProps; fontFamily is injected automatically.
 * - Has zero effect on any other Text component or theme in the app.
 */

import React, { useState, useEffect } from 'react';
import { Text, type TextProps } from 'react-native';
import { init, getState, subscribe } from '../services/arabicFontService';

type ArabicTextProps = TextProps & {
  children?: React.ReactNode;
};

export default function ArabicText({ style, children, ...rest }: ArabicTextProps) {
  const [fontFamily, setFontFamily] = useState<string | null>(
    () => getState().family,
  );

  useEffect(() => {
    // Start the background loader (idempotent — safe to call from many instances).
    init();

    // Apply immediately if already resolved before this mount.
    const current = getState();
    if (current.family) setFontFamily(current.family);

    // Subscribe to future updates (font finished downloading).
    return subscribe((state) => {
      setFontFamily(state.family);
    });
  }, []);

  return (
    <Text
      {...rest}
      style={[style, fontFamily ? { fontFamily } : undefined]}
    >
      {children}
    </Text>
  );
}
