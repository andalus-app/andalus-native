import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { Animated, View, Text, TouchableOpacity, PanResponder } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HidayahLogo from '../components/HidayahLogo';
import { useTheme } from './ThemeContext';

type NotifItem = { id: string; title: string; body: string };
type ContextValue = { show: (title: string, body: string) => void };

export const NotificationContext = createContext<ContextValue>({ show: () => {} });
export const useNotification = () => useContext(NotificationContext);


function NotificationPill({ item, onDismiss }: { item: NotifItem; onDismiss: () => void }) {
  const { theme: T, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-160)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 280,
      mass: 0.85,
    }).start();
    timerRef.current = setTimeout(dismiss, 4500);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  function dismiss() {
    if (timerRef.current) clearTimeout(timerRef.current);
    Animated.spring(translateY, {
      toValue: -160,
      useNativeDriver: true,
      damping: 18,
      stiffness: 300,
    }).start(() => onDismiss());
  }

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gs) =>
      gs.dy < 0 && Math.abs(gs.dy) > 6 && Math.abs(gs.dy) > Math.abs(gs.dx),
    onPanResponderGrant: () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      (translateY as any).stopAnimation();
    },
    onPanResponderMove: (_, gs) => {
      if (gs.dy < 0) translateY.setValue(gs.dy);
    },
    onPanResponderRelease: (_, gs) => {
      if (gs.dy < -36 || gs.vy < -0.7) {
        dismiss();
      } else {
        Animated.spring(translateY, {
          toValue: 0, useNativeDriver: true, damping: 18, stiffness: 280,
        }).start();
        timerRef.current = setTimeout(dismiss, 4500);
      }
    },
  })).current;

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={{
        position: 'absolute',
        left: 12, right: 12,
        top: insets.top + 10,
        zIndex: 9999,
        transform: [{ translateY }],
        borderRadius: 22,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: isDark ? 0.45 : 0.14,
        shadowRadius: 16,
        elevation: 12,
      }}
    >
      <BlurView
        intensity={isDark ? 65 : 82}
        tint={isDark ? 'dark' : 'light'}
        style={{ borderRadius: 22, overflow: 'hidden' }}
      >
        <View style={{
          backgroundColor: isDark ? 'rgba(28,28,30,0.70)' : 'rgba(255,255,255,0.70)',
          borderRadius: 22,
          borderWidth: 0.5,
          borderColor: isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.08)',
          padding: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}>
          {/* App icon */}
          <View style={{
            width: 40, height: 40, borderRadius: 10,
            backgroundColor: T.accentGlow,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <HidayahLogo size={22} />
          </View>

          {/* Text */}
          <View style={{ flex: 1 }}>
            <Text style={{
              fontSize: 11, fontWeight: '600', color: T.textMuted,
              letterSpacing: 0.3, marginBottom: 3,
            }}>
              HIDAYAH
            </Text>
            <Text style={{
              fontSize: 13, fontWeight: '600', color: T.text, lineHeight: 18,
            }} numberOfLines={1}>
              {item.title}
            </Text>
            {item.body ? (
              <Text style={{
                fontSize: 12, color: T.textSecondary as string,
                lineHeight: 16, marginTop: 1,
              }} numberOfLines={1}>
                {item.body}
              </Text>
            ) : null}
          </View>

          {/* Dismiss button */}
          <TouchableOpacity
            onPress={dismiss}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{
              width: 22, height: 22, borderRadius: 11,
              backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.07)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 11, color: T.textMuted, lineHeight: 22, textAlign: 'center' }}>✕</Text>
          </TouchableOpacity>
        </View>
      </BlurView>
    </Animated.View>
  );
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<NotifItem | null>(null);
  const queueRef = useRef<NotifItem[]>([]);

  const show = useCallback((title: string, body: string) => {
    const item: NotifItem = { id: String(Date.now()), title, body };
    setCurrent(prev => {
      if (prev === null) return item;
      queueRef.current.push(item);
      return prev;
    });
  }, []);

  function onDismiss() {
    const next = queueRef.current.shift() ?? null;
    setCurrent(next);
  }

  return (
    <NotificationContext.Provider value={{ show }}>
      <View style={{ flex: 1 }}>
        {children}
        {current && (
          <NotificationPill key={current.id} item={current} onDismiss={onDismiss} />
        )}
      </View>
    </NotificationContext.Provider>
  );
}
