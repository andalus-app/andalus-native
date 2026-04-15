/**
 * Umrah Guide — standalone theme.
 * Independent of the main app theme. Light by default for outdoor readability.
 */

export type UmrahTheme = {
  bg:              string;
  bgSecondary:     string;
  card:            string;
  cardWarm:        string;
  text:            string;
  textSecondary:   string;
  textMuted:       string;
  accent:          string;
  accentSoft:      string;
  accentBorder:    string;
  important:       string;
  importantBg:     string;
  importantBorder: string;
  warning:         string;
  warningBg:       string;
  warningBorder:   string;
  note:            string;
  noteBg:          string;
  noteBorder:      string;
  dua:             string;
  duaBg:           string;
  duaBorder:       string;
  border:          string;
  separator:       string;
  shadow:          string;
  counterBg:       string;
  counterText:     string;
  counterBtn:      string;
  counterBtnText:  string;
  checkActive:     string;
  checkBorder:     string;
  progressFill:    string;
  progressTrack:   string;
  isDark:          boolean;
  fontScale:       number;
};

export const umrahLight: UmrahTheme = {
  bg:              '#F4EFE8',
  bgSecondary:     '#EDE7DF',
  card:            '#FFFFFF',
  cardWarm:        '#FFFCF8',
  text:            '#1A1A1A',
  textSecondary:   '#3A3A3A',
  textMuted:       '#7A7A7A',
  accent:          '#24645d',
  accentSoft:      'rgba(36,100,93,0.10)',
  accentBorder:    'rgba(36,100,93,0.22)',
  important:       '#1A5C4A',
  importantBg:     'rgba(26,92,74,0.07)',
  importantBorder: 'rgba(26,92,74,0.20)',
  warning:         '#B33A00',
  warningBg:       'rgba(179,58,0,0.06)',
  warningBorder:   'rgba(179,58,0,0.18)',
  note:            '#5A4D3A',
  noteBg:          'rgba(90,77,58,0.06)',
  noteBorder:      'rgba(90,77,58,0.14)',
  dua:             '#1A3D6A',
  duaBg:           'rgba(26,61,106,0.05)',
  duaBorder:       'rgba(26,61,106,0.15)',
  border:          'rgba(0,0,0,0.08)',
  separator:       'rgba(0,0,0,0.06)',
  shadow:          'rgba(0,0,0,0.08)',
  counterBg:       '#24645d',
  counterText:     '#FFFFFF',
  counterBtn:      '#24645d',
  counterBtnText:  '#FFFFFF',
  checkActive:     '#24645d',
  checkBorder:     'rgba(0,0,0,0.18)',
  progressFill:    '#24645d',
  progressTrack:   'rgba(36,100,93,0.15)',
  isDark:          false,
  fontScale:       1,
};

export const umrahDark: UmrahTheme = {
  bg:              '#111A26',
  bgSecondary:     '#182030',
  card:            '#1E2D42',
  cardWarm:        '#1E2A3A',
  text:            '#EEE8DF',
  textSecondary:   '#C8BFB0',
  textMuted:       '#8A8A95',
  accent:          '#3D9E94',
  accentSoft:      'rgba(61,158,148,0.12)',
  accentBorder:    'rgba(61,158,148,0.24)',
  important:       '#4DB89E',
  importantBg:     'rgba(61,158,148,0.10)',
  importantBorder: 'rgba(61,158,148,0.22)',
  warning:         '#FF9060',
  warningBg:       'rgba(255,144,96,0.09)',
  warningBorder:   'rgba(255,144,96,0.22)',
  note:            '#C0B09A',
  noteBg:          'rgba(192,176,154,0.07)',
  noteBorder:      'rgba(192,176,154,0.16)',
  dua:             '#8ABBE8',
  duaBg:           'rgba(138,187,232,0.07)',
  duaBorder:       'rgba(138,187,232,0.18)',
  border:          'rgba(255,255,255,0.10)',
  separator:       'rgba(255,255,255,0.07)',
  shadow:          'rgba(0,0,0,0.30)',
  counterBg:       '#668468',
  counterText:     '#FFFFFF',
  counterBtn:      '#3D9E94',
  counterBtnText:  '#FFFFFF',
  checkActive:     '#3D9E94',
  checkBorder:     'rgba(255,255,255,0.20)',
  progressFill:    '#3D9E94',
  progressTrack:   'rgba(61,158,148,0.18)',
  isDark:          true,
  fontScale:       1,
};
