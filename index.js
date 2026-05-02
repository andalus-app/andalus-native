/**
 * Root entry — must register the TrackPlayer playback service BEFORE the
 * Expo Router entry mounts the React tree.
 *
 * react-native-track-player requires registerPlaybackService() to be called
 * as early as possible in the JS bundle. On iOS this is what wires the
 * MPRemoteCommandCenter handlers (lock-screen play/pause/next/prev/seek)
 * to our service callback. If we register from inside a React component
 * (e.g. app/_layout.tsx), the lock-screen controls don't bind reliably on
 * the very first launch and remote events arrive before the listener is
 * attached.
 *
 * Order:
 *   1. import + register playback service (no React, no JSX, no native calls
 *      beyond TrackPlayer.registerPlaybackService).
 *   2. import 'expo-router/entry' — this is the original `main` from package.json.
 *      It bootstraps Expo's app initialisation and mounts app/_layout.tsx.
 */

import TrackPlayer from 'react-native-track-player';
import { PlaybackService } from './services/quranAudioPlaybackService';

TrackPlayer.registerPlaybackService(() => PlaybackService);

import 'expo-router/entry';
