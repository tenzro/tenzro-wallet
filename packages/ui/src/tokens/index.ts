/**
 * Design tokens exposed as TypeScript constants.
 *
 * The CSS in globals.css is the source of truth for runtime values, but
 * we re-export the same names here so non-CSS consumers (Motion configs,
 * canvas drawings, chart colors) can pull them without re-parsing CSS.
 */

export const surfaceColor = {
  native: 'var(--color-surface-native)',
  evm: 'var(--color-surface-evm)',
  svm: 'var(--color-surface-svm)',
  canton: 'var(--color-surface-canton)',
} as const;

export const surfaceGlow = {
  native: 'var(--color-surface-native-glow)',
  evm: 'var(--color-surface-evm-glow)',
  svm: 'var(--color-surface-svm-glow)',
  canton: 'var(--color-surface-canton-glow)',
} as const;

export const motion = {
  /** Snappy spring, used for primary actions and toggles */
  spring: { type: 'spring' as const, stiffness: 380, damping: 30 },
  /** Soft spring for entering panels */
  springSoft: { type: 'spring' as const, stiffness: 220, damping: 26 },
  /** Tween used when a spring would feel sloppy (e.g. progress fills) */
  tween: { duration: 0.24, ease: [0.19, 1, 0.22, 1] as const },
  /** Slower tween for hero transitions */
  tweenLong: { duration: 0.6, ease: [0.19, 1, 0.22, 1] as const },
} as const;

export type SurfaceKind = keyof typeof surfaceColor;
