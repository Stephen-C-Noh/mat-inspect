import type { Config } from 'tailwindcss';

/**
 * Shared Tailwind preset for MAT-Inspect apps.
 *
 * Maps the CSS custom properties in tokens.css to Tailwind theme keys. Import
 * tokens.css once at the app root (layout.tsx) so the variables are defined,
 * then add this preset to the app's tailwind.config.ts presets array.
 */

// Wrap an HSL-channel token so opacity modifiers (bg-primary/50) keep working.
const hsl = (token: string): string => `hsl(var(--${token}) / <alpha-value>)`;

export const tokensPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: hsl('primary'),
          foreground: hsl('primary-foreground'),
        },
        accent: {
          DEFAULT: hsl('accent'),
          foreground: hsl('accent-foreground'),
        },
        success: {
          DEFAULT: hsl('success'),
          foreground: hsl('success-foreground'),
          border: hsl('success-border'),
        },
        destructive: {
          DEFAULT: hsl('destructive'),
          foreground: hsl('destructive-foreground'),
        },
        warning: {
          DEFAULT: hsl('warning'),
          foreground: hsl('warning-foreground'),
        },
        background: hsl('background'),
        foreground: hsl('foreground'),
        card: {
          DEFAULT: hsl('card'),
          foreground: hsl('card-foreground'),
        },
        muted: {
          DEFAULT: hsl('muted'),
          foreground: hsl('muted-foreground'),
        },
        border: hsl('border'),
        input: hsl('input'),
        ring: hsl('ring'),
      },
      borderRadius: {
        lg: 'var(--radius)', // 6px  buttons, pills
        md: 'calc(var(--radius) - 2px)', // 4px
        sm: 'calc(var(--radius) - 4px)', // 2px  cards
      },
      boxShadow: {
        card: 'var(--shadow-card)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
};

export default tokensPreset;
