/**
 * Web stub for react-native-pdf.
 * The real package imports native-only Fabric codegen components that cannot
 * run on web. This stub exports a no-op component so Metro can bundle the
 * ebooks screen without errors on the web platform.
 * PDF reading is native-only; the ebooks screen guards against this at runtime.
 */
import React from 'react';
import { View, Text } from 'react-native';

const Pdf = (props) => (
  <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center' }, props.style]}>
    <Text style={{ color: '#888' }}>PDF-läsaren är inte tillgänglig på webben.</Text>
  </View>
);

export default Pdf;
