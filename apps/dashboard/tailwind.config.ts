import type { Config } from 'tailwindcss';
import { tokensPreset } from '@mat-inspect/design-tokens/preset';
// tailwindcss-animate ships CJS-only with no default/named export Tailwind's config format accepts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tailwindcssAnimate = require('tailwindcss-animate');

const config: Config = {
  darkMode: ['class'],
  presets: [tokensPreset],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [tailwindcssAnimate],
};

export default config;
