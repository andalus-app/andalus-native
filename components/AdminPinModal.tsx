/**
 * AdminPinModal — hidden admin access gate used by HomeScreen.
 *
 * Access flow:
 *   1. If no active Supabase Auth session → show email + password step.
 *      supabase.auth.signInWithPassword() establishes the session that RLS
 *      requires for INSERT/UPDATE/DELETE on announcements.
 *      The JS client persists the session in AsyncStorage and auto-refreshes it,
 *      so subsequent visits skip straight to step 2.
 *   2. PIN verification — same sha256(phone:pin) formula as booking.tsx.
 *      On success → onSuccess() is called and the admin screen opens.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
  StyleSheet, Animated,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Path, Circle } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { sha256, normalizePhone } from '../services/cryptoUtils';

export type EligibleAdminUser = {
  id:           string;
  name:         string;
  phone:        string;
  pin_hash:     string;
  auth_user_id: string;
};

type Props = {
  visible:   boolean;
  user:      EligibleAdminUser;
  onSuccess: () => void;
  onCancel:  () => void;
  isDark:    boolean;
  T:         any;
};

type Step = 'checking' | 'auth' | 'pin';

export default function AdminPinModal({ visible, user, onSuccess, onCancel, isDark, T }: Props) {
  const [step,     setStep]     = useState<Step>('checking');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [pin,      setPin]      = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const pinInputRef = useRef<TextInput>(null);
  const norm        = normalizePhone(user.phone);
  const dotAnims    = useRef(Array.from({ length: 6 }, () => new Animated.Value(0))).current;

  // Animate pin dots: new dot springs in, cleared dots reset instantly.
  useEffect(() => {
    const len = pin.length;
    // Reset all slots beyond current length
    for (let i = len; i < 6; i++) dotAnims[i].setValue(0);
    // Animate the newly added dot
    if (len > 0) {
      Animated.spring(dotAnims[len - 1], {
        toValue: 1,
        useNativeDriver: true,
        bounciness: 10,
        speed: 20,
      }).start();
    }
  }, [pin.length]);

  // Reset dot anims when modal closes
  useEffect(() => {
    if (!visible) dotAnims.forEach(a => a.setValue(0));
  }, [visible]);

  // On open: check if a valid Supabase Auth session already exists.
  // If yes, skip the email/password step — go straight to PIN.
  useEffect(() => {
    if (!visible) return;
    setPin(''); setError(''); setLoading(false);
    setStep('checking');

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setStep('pin');
      } else {
        setStep('auth');
      }
    }).catch(() => setStep('auth'));
  }, [visible]);

  // Focus PIN input when we reach the PIN step
  useEffect(() => {
    if (step === 'pin') {
      setTimeout(() => pinInputRef.current?.focus(), 100);
    }
  }, [step]);

  // ── Auth step: sign in with Supabase Auth ─────────────────────────────────

  const handleAuthSignIn = useCallback(async () => {
    if (!email.trim() || !password) {
      setError('Fyll i e-post och lösenord.');
      return;
    }
    setLoading(true);
    setError('');
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setLoading(false);
    if (authError) {
      setError('Fel e-post eller lösenord.');
      return;
    }
    // Session now established — move to PIN step
    setPassword('');
    setStep('pin');
  }, [email, password]);

  // ── PIN step ──────────────────────────────────────────────────────────────

  const handlePinChange = useCallback((v: string) => {
    setPin(v); setError('');
    if (v.length >= 4 && user.pin_hash) {
      const hash = sha256(norm + ':' + v);
      if (hash === user.pin_hash) {
        setLoading(true);
        supabase.from('app_users')
          .update({ last_login: Date.now() })
          .eq('id', user.id)
          .then(() => { setLoading(false); onSuccess(); });
      }
    }
  }, [norm, user.pin_hash, user.id, onSuccess]);

  // ── Shared icon ───────────────────────────────────────────────────────────

  const iconBg = {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: T.accent + '22',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    alignSelf: 'center' as const, marginBottom: 14,
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <BlurView intensity={isDark ? 60 : 80} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.25)' }]} />

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
            <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>

              <TouchableOpacity onPress={onCancel} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Svg width={18} height={18} viewBox="0 0 24 24">
                  <Path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill={T.textMuted} />
                </Svg>
              </TouchableOpacity>

              {/* ── Checking session ── */}
              {step === 'checking' && (
                <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                  <ActivityIndicator color={T.accent} size="large" />
                </View>
              )}

              {/* ── Auth step: email + password ── */}
              {step === 'auth' && (
                <>
                  <View style={{ alignItems: 'center', marginBottom: 20 }}>
                    <View style={iconBg}>
                      <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                        <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke={T.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        <Circle cx="12" cy="7" r="4" stroke={T.accent} strokeWidth="1.8"/>
                      </Svg>
                    </View>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: T.text }}>Admin-inloggning</Text>
                    <Text style={{ fontSize: 13, color: T.textMuted, marginTop: 4, textAlign: 'center' }}>
                      Logga in med ditt Supabase-konto
                    </Text>
                  </View>

                  <TextInput
                    value={email}
                    onChangeText={v => { setEmail(v); setError(''); }}
                    placeholder="E-postadress"
                    placeholderTextColor={T.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, { backgroundColor: T.bg, borderColor: T.border, color: T.text }]}
                  />
                  <TextInput
                    value={password}
                    onChangeText={v => { setPassword(v); setError(''); }}
                    placeholder="Lösenord"
                    placeholderTextColor={T.textMuted}
                    secureTextEntry
                    style={[styles.input, { backgroundColor: T.bg, borderColor: T.border, color: T.text, marginTop: 10 }]}
                    onSubmitEditing={handleAuthSignIn}
                    returnKeyType="go"
                  />

                  {!!error && <Text style={styles.errorText}>{error}</Text>}

                  <TouchableOpacity
                    style={[styles.primaryBtn, { backgroundColor: T.accent, marginTop: 16 }]}
                    onPress={handleAuthSignIn}
                    activeOpacity={0.8}
                    disabled={loading}
                  >
                    {loading
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Logga in</Text>
                    }
                  </TouchableOpacity>
                </>
              )}

              {/* ── PIN step ── */}
              {step === 'pin' && (
                <>
                  <View style={{ alignItems: 'center', marginBottom: 20 }}>
                    <View style={iconBg}>
                      <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                        <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke={T.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        <Circle cx="12" cy="7" r="4" stroke={T.accent} strokeWidth="1.8"/>
                      </Svg>
                    </View>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: T.text }}>Välkommen, {user.name}</Text>
                    <Text style={{ fontSize: 13, color: T.textMuted, marginTop: 4 }}>Ange din PIN-kod</Text>
                  </View>

                  {/* Dot display — only filled dots shown, centered, animate in */}
                  <TouchableOpacity activeOpacity={1} onPress={() => pinInputRef.current?.focus()}
                    style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 14, minHeight: 28, marginBottom: 8 }}>
                    {Array.from({ length: pin.length }).map((_, i) => (
                      <Animated.View key={i} style={{
                        width: 14, height: 14, borderRadius: 7,
                        backgroundColor: T.text,
                        transform: [{ scale: dotAnims[i] }],
                      }} />
                    ))}
                  </TouchableOpacity>

                  {!!error && <Text style={styles.errorText}>{error}</Text>}

                  <TextInput
                    ref={pinInputRef}
                    value={pin}
                    onChangeText={handlePinChange}
                    keyboardType="phone-pad"
                    maxLength={6}
                    caretHidden
                    style={{ height: 1, opacity: 0 }}
                  />

                  {loading && (
                    <View style={{ alignItems: 'center', marginTop: 16 }}>
                      <ActivityIndicator color={T.accent} />
                    </View>
                  )}
                </>
              )}

            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  card: {
    borderRadius: 20, borderWidth: 0.5, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25, shadowRadius: 24, elevation: 8,
  },
  closeBtn: {
    position: 'absolute', top: 16, right: 16, zIndex: 1,
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
  },
  input: {
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15,
  },
  primaryBtn: {
    borderRadius: 13, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
    minHeight: 48,
  },
  errorText: { color: '#FF3B30', fontSize: 13, marginTop: 8, textAlign: 'center' },
});
