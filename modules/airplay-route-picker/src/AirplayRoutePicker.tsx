/**
 * AirplayRoutePicker — wraps iOS AVRoutePickerView as an Expo Module.
 *
 * Two approaches:
 * 1. Native View: renders AVRoutePickerView directly (shows its own AirPlay icon,
 *    tapping opens the route picker natively).
 * 2. Function: showRoutePicker() programmatically triggers the picker from any button.
 *
 * Both require a dev build (`expo prebuild --clean` + `expo run:ios`).
 * In Expo Go neither is available — falls back gracefully.
 */

import React from 'react';
import { Platform, View, NativeModules, type ViewStyle } from 'react-native';

type Props = {
  tintColor?: string;
  activeTintColor?: string;
  style?: ViewStyle;
};

// ── Check if native module is compiled ──────────────────────────────────────

const isModuleAvailable =
  Platform.OS === 'ios' &&
  !!NativeModules.NativeUnimoduleProxy?.viewManagersMetadata?.AirplayRoutePicker;

// ── Native view (for inline rendering) ──────────────────────────────────────

let NativeView: React.ComponentType<{
  tintColor?: string;
  activeTintColor?: string;
  style?: ViewStyle;
}> | null = null;

if (isModuleAvailable) {
  try {
    const { requireNativeViewManager } = require('expo-modules-core');
    NativeView = requireNativeViewManager('AirplayRoutePicker');
  } catch {
    NativeView = null;
  }
}

// ── showRoutePicker function (programmatic trigger) ─────────────────────────

let _nativeModule: { showRoutePicker: () => Promise<void> } | null = null;

if (Platform.OS === 'ios') {
  try {
    const { requireNativeModule } = require('expo-modules-core');
    _nativeModule = requireNativeModule('AirplayRoutePicker');
  } catch {
    _nativeModule = null;
  }
}

/**
 * Programmatically opens the iOS audio route picker.
 * Includes haptic feedback. No-op if native module is unavailable.
 */
export async function showRoutePicker(): Promise<void> {
  if (_nativeModule?.showRoutePicker) {
    await _nativeModule.showRoutePicker();
  }
}

/** Whether the native AirPlay route picker is available in this build. */
export const isAirplayAvailable = NativeView !== null || _nativeModule !== null;

/**
 * Renders the native AVRoutePickerView (iOS dev build only).
 * Tapping opens the real iOS audio output device picker.
 */
export default function AirplayRoutePicker({ tintColor, activeTintColor, style }: Props) {
  if (!NativeView) return <View style={style} />;
  return <NativeView tintColor={tintColor} activeTintColor={activeTintColor} style={style} />;
}
