/**
 * Artha Email System Design Tokens
 * Premium, minimalist fintech design system optimized for cross-client HTML email rendering.
 */
export const EMAIL_DESIGN_TOKENS = {
  colors: {
    // Brand Colors
    primaryNavy: '#102A56',
    secondaryBlue: '#2878D4',
    lightBlueSurface: '#EAF4FF',
    accentBlue: '#0066CC',

    // Surfaces & Neutrals
    emailBackground: '#F4F7FB',
    cardBackground: '#FFFFFF',
    border: '#E5EAF2',
    divider: '#EDF2F7',

    // Typography
    textPrimary: '#172033',
    textSecondary: '#667085',
    textMuted: '#94A3B8',
    textInverse: '#FFFFFF',

    // Semantic States
    success: '#059669',
    successSurface: '#ECFDF5',
    successBorder: '#A7F3D0',
    warning: '#D97706',
    warningSurface: '#FFFBEB',
    warningBorder: '#FDE68A',
    danger: '#DC2626',
    dangerSurface: '#FEF2F2',
    dangerBorder: '#FECACA',
    infoSurface: '#F0F7FF',
    infoBorder: '#BAE6FD',
  },
  typography: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    codeFontFamily:
      "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace",
  },
  dimensions: {
    containerMaxWidth: '580px',
    borderRadiusCard: '10px',
    borderRadiusButton: '6px',
    borderRadiusBadge: '6px',
  },
  branding: {
    appName: 'Artha',
    tagline: 'Know. Spend. Grow.',
    defaultSupportEmail: 'aartha.app@gmail.com',
    defaultAppUrl: 'https://artha.app',
    // Fallback hosted logo image; renders crisp HTML wordmark when missing
    defaultLogoUrl:
      'https://raw.githubusercontent.com/13vanshmehta/Artha-App/main/src/assets/branding/artha_icon_blue.png',
  },
} as const;
