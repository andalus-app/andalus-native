/**
 * Web stub for react-native-pdf.
 * Metro automatically picks this file over NativePdf.tsx when bundling for web,
 * preventing the native-only Fabric codegen module from being imported.
 * PDF reading is native-only; the ebooks screen is not accessible on web.
 */
import React from 'react';
import { View, Text } from 'react-native';

const Pdf = (props: { style?: object }) => (
  <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center' }, props.style]}>
    <Text style={{ color: '#888' }}>PDF-läsaren är inte tillgänglig på webben.</Text>
  </View>
);

export default Pdf;
