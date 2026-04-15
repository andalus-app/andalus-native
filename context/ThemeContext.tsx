import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useColorScheme, Animated, Easing } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dark, light, Theme } from '../theme/colors';

const THEME_KEY = 'andalus_theme_mode';
type Mode = 'system' | 'light' | 'dark';

type ThemeContextType = {
  theme: Theme;
  isDark: boolean;
  mode: Mode;
  toggleTheme: () => void;
  setMode: (mode: Mode) => void;
  overlayAnim: Animated.Value;
};

const ThemeContext = createContext<ThemeContextType>({
  theme: dark, isDark: true, mode: 'system',
  toggleTheme: () => {},
  setMode: () => {},
  overlayAnim: new Animated.Value(0),
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<Mode>('system');
  const overlayAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then(v => {
      if (v === 'light' || v === 'dark' || v === 'system') setModeState(v);
    });
  }, []);

  const isDark = mode === 'system' ? systemScheme === 'dark' : mode === 'dark';
  const theme  = isDark ? dark : light;

  function applyModeWithFade(m: Mode) {
    // Phase 1: dim the screen to black (like a lamp dimming down)
    Animated.timing(overlayAnim, {
      toValue: 1,
      duration: 260,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      // Snap the theme while fully covered — completely invisible
      setModeState(m);
      AsyncStorage.setItem(THEME_KEY, m).catch(() => {});

      // Wait 2 frames so React commits the new theme to native before we reveal it
      setTimeout(() => {
        // Phase 2: brighten up to new theme (like a lamp dimming back up)
        Animated.timing(overlayAnim, {
          toValue: 0,
          duration: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      }, 32);
    });
  }

  const toggleTheme = () => applyModeWithFade(isDark ? 'light' : 'dark');
  const setMode     = (m: Mode) => applyModeWithFade(m);

  return (
    <ThemeContext.Provider value={{ theme, isDark, mode, toggleTheme, setMode, overlayAnim }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
