import { Platform } from 'react-native';

/** Палитра «тёмное фэнтези»: ночное небо, пергамент и золото. */
export const colors = {
  bg: '#120E18',
  surface: '#1C1626',
  surfaceAlt: '#251D33',
  border: '#3A2E4F',
  text: '#F2E8CF',
  textMuted: '#A397BA',
  gold: '#E0B050',
  goldDark: '#8C6A26',
  purple: '#7C4DFF',
  purpleDark: '#3B2A66',
  danger: '#E05561',
  success: '#5FBF77',
  info: '#5AA9E6',
  dmBubble: '#221B30',
  playerBubble: '#3B2A66',
  rollBubble: '#2D2414',
  overlay: 'rgba(8, 6, 12, 0.94)',
};

export const fonts = {
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, "Times New Roman", serif' }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' }),
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };
