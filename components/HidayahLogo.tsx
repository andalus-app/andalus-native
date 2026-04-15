import React from 'react';
import { Image } from 'react-native';

export default function HidayahLogo({ size = 48 }: { size?: number }) {
  return (
    <Image
      source={require('../assets/images/hidayah-logo.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}
