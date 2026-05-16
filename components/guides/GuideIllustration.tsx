import React, { useState, useCallback, useRef } from 'react';
import {
  Image, ImageSourcePropType, TouchableOpacity, Modal,
  View, Animated, useWindowDimensions, StyleSheet, Easing,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import GuideIllustrationPlaceholder from './GuideIllustrationPlaceholder';

// To add a new illustration: place the file under assets/illustrations/{prayer|wudu}/
// and uncomment (or add) the corresponding line below.
const guideIllustrations: Partial<Record<string, ImageSourcePropType>> = {
  // ── Prayer ────────────────────────────────────────────────────────────────
  prayer_takbir:              require('@/assets/illustrations/prayer/prayer_takbir.png'),
  prayer_standing_hands:      require('@/assets/illustrations/prayer/prayer_standing_hands.png'),
  prayer_ruku:                require('@/assets/illustrations/prayer/prayer_ruku.png'),
  prayer_rise_from_ruku:      require('@/assets/illustrations/prayer/prayer_rise_from_ruku.png'),
  prayer_sujud:               require('@/assets/illustrations/prayer/prayer_sujud.png'),
  prayer_sitting_between_sujud: require('@/assets/illustrations/prayer/prayer_sitting_between_sujud.png'),
  prayer_second_sujud:        require('@/assets/illustrations/prayer/prayer_second_sujud.png'),
  prayer_tashahhud:           require('@/assets/illustrations/prayer/prayer_tashahhud.png'),
  prayer_salam:               require('@/assets/illustrations/prayer/prayer_salam.png'),
  prayer_prepare:             require('@/assets/illustrations/prayer/prayer_prepare.png'),
  prayer_fatiha:              require('@/assets/illustrations/prayer/prayer_fatiha.png'),
  prayer_surah:               require('@/assets/illustrations/prayer/prayer_surah.png'),
  prayer_takbir_ruku:         require('@/assets/illustrations/prayer/prayer_takbir_ruku.png'),
  prayer_standing_after_ruku: require('@/assets/illustrations/prayer/prayer_standing_after_ruku.png'),
  prayer_rakah_repeat:        require('@/assets/illustrations/prayer/prayer_rakah_repeat.png'),
  prayer_continue:            require('@/assets/illustrations/prayer/prayer_continue.png'),
  prayer_final_tashahhud:     require('@/assets/illustrations/prayer/prayer_final_tashahhud.png'),
  prayer_dua:                 require('@/assets/illustrations/prayer/prayer_dua.png'),
  prayer_salam_right:         require('@/assets/illustrations/prayer/prayer_salam_right.png'),
  prayer_salam_left:          require('@/assets/illustrations/prayer/prayer_salam_left.png'),
  prayer_rise_next_rakah:     require('@/assets/illustrations/prayer/prayer_rise_next_rakah.png'),
  // ── Wudu ─────────────────────────────────────────────────────────────────
  wudu_intention:             require('@/assets/illustrations/wudu/wudu_intention.png'),
  wudu_bismillah:             require('@/assets/illustrations/wudu/wudu_bismillah.png'),
  wudu_hands:                 require('@/assets/illustrations/wudu/wudu_hands.png'),
  wudu_mouth:                 require('@/assets/illustrations/wudu/wudu_mouth.png'),
  wudu_nose:                  require('@/assets/illustrations/wudu/wudu_nose.png'),
  wudu_face:                  require('@/assets/illustrations/wudu/wudu_face.png'),
  wudu_arms:                  require('@/assets/illustrations/wudu/wudu_arms.png'),
  wudu_head:                  require('@/assets/illustrations/wudu/wudu_head.png'),
  wudu_ears:                  require('@/assets/illustrations/wudu/wudu_ears.png'),
  wudu_feet:                  require('@/assets/illustrations/wudu/wudu_feet.png'),
  wudu_after:                 require('@/assets/illustrations/wudu/wudu_after.png'),
};

type Props = {
  illustrationKey: string;
  size?: number;
  variant?: 'compact' | 'large';
  zoomable?: boolean;
};

export default function GuideIllustration({
  illustrationKey,
  size = 80,
  variant = 'compact',
  zoomable = true,
}: Props) {
  const source = guideIllustrations[illustrationKey];
  const actualSize = variant === 'large' ? size * 1.5 : size;
  const { width, height } = useWindowDimensions();

  const [modalVisible, setModalVisible] = useState(false);
  const scaleAnim   = useRef(new Animated.Value(0.5)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const maxImageSize = Math.min(width - 48, height * 0.72);

  const open = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setModalVisible(true);
    scaleAnim.setValue(0.5);
    opacityAnim.setValue(0);
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        bounciness: 5,
        speed: 14,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [scaleAnim, opacityAnim]);

  const close = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.5,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => setModalVisible(false));
  }, [scaleAnim, opacityAnim]);

  if (!source) {
    return (
      <GuideIllustrationPlaceholder
        illustrationKey={illustrationKey}
        size={size}
        variant={variant}
      />
    );
  }

  const imageEl = (
    <Image
      source={source}
      style={{
        width: actualSize,
        height: actualSize,
        borderRadius: actualSize * 0.18,
      }}
      resizeMode="contain"
    />
  );

  return (
    <>
      {zoomable ? (
        <TouchableOpacity
          onPress={open}
          activeOpacity={0.8}
          accessibilityLabel={`Förstora bild: ${illustrationKey.replace(/_/g, ' ')}`}
          accessibilityRole="imagebutton"
        >
          {imageEl}
        </TouchableOpacity>
      ) : (
        <View>{imageEl}</View>
      )}

      <Modal
        visible={modalVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={close}
      >
        <Animated.View style={[styles.overlay, { opacity: opacityAnim }]}>
          <TouchableOpacity
            style={styles.backdrop}
            onPress={close}
            activeOpacity={1}
            accessibilityLabel="Stäng bild"
          >
            <Animated.View
              style={{ transform: [{ scale: scaleAnim }] }}
            >
              {/* Inner touchable blocks the close from firing when tapping the image itself */}
              <TouchableOpacity activeOpacity={1} onPress={close}>
                <Image
                  source={source}
                  style={{
                    width: maxImageSize,
                    height: maxImageSize,
                    borderRadius: 18,
                  }}
                  resizeMode="contain"
                />
              </TouchableOpacity>
            </Animated.View>
          </TouchableOpacity>
        </Animated.View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
  },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
