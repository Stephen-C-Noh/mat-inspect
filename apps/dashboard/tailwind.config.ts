import type { Config } from 'tailwindcss';
import { tokensPreset } from '@mat-inspect/design-tokens/preset';

const config: Config = {
  presets: [tokensPreset],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
