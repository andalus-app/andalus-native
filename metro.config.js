const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Exclude QCF Quran fonts from the app bundle.
// These fonts are downloaded at runtime (mushafFontManager OFFLINE_MODE='download')
// and must NOT be bundled — Apple's ITMS-90853 rejects their PUA-only cmap tables.
const qcfFontsDir = path.resolve(__dirname, 'assets/fonts/qcf');
config.resolver = config.resolver ?? {};
const originalBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(originalBlockList
    ? Array.isArray(originalBlockList)
      ? originalBlockList
      : [originalBlockList]
    : []),
  new RegExp(`^${qcfFontsDir.replace(/[/\\]/g, '[/\\\\]')}.*`),
];

module.exports = config;
