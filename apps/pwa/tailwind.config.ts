import type { Config } from 'tailwindcss';
import { tokensPreset } from '@mat-inspect/design-tokens/preset';

const config: Config = {
  presets: [tokensPreset],
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
