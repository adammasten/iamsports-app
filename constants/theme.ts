/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});

// ============================================================================
// IamSports dark UI tokens — the single source of truth for app screens. Screens
// import these instead of hardcoding hex, so the app stays uniform and
// drift-free. Approved dark system: one brand accent for primary actions;
// amber/green/red are semantic only (status / done / delete). Separate from the
// Expo-template `Colors`/`Fonts` above (used by the tab bar + theme hook).
//   import { colors, radius, spacing } from '@/constants/theme';
// ============================================================================
export const colors = {
  // Surfaces
  bg: '#000000',          // page ground
  surface: '#1a1a1a',     // cards
  surfaceAlt: '#0d0d0d',  // inputs / wells
  border: '#333333',      // hairlines
  borderSubtle: '#2a2a2a',

  // Text
  text: '#ffffff',        // primary
  textSecondary: '#aaaaaa',
  textMuted: '#888888',   // meta / labels
  textFaint: '#555555',

  // Brand — the only accent for primary actions
  brand: '#534ab7',
  brandLight: '#8b82e8',  // links / hovers
  brandTint: '#2a2740',   // selected / chip backgrounds

  // Semantic (not decoration)
  success: '#1d9e75',     // done / posted
  danger: '#dc3545',      // delete (the one red)
  amber: '#c8742b',       // GAME / highlight

  // Tagging-status traffic light (badge outline)
  statusRed: '#ff453a',   // not started
  statusYellow: '#ffd60a',// in progress
  statusGreen: '#32d74b', // done

  // Tag categories — scoped set, used only on tag chips / category filters
  catOffense: '#1a6fd4',
  catDefense: '#c0392b',
  catPlays: '#1e8449',
  catPlayers: '#7d3c98',
} as const;

export const radius = { sm: 8, md: 10, lg: 16 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;
