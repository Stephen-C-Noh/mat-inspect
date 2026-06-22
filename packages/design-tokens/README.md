# @mat-inspect/design-tokens

Shared design tokens for the MAT-Inspect apps (pwa, dashboard). Values come from
the Figma design system (file `6Mn2bNg04bElelCLE69ilK`).

## Usage

Import the variables once at the app root, then add the Tailwind preset.

`src/app/layout.tsx`:

```ts
import '@mat-inspect/design-tokens/tokens.css';
import './globals.css';
```

`tailwind.config.ts`:

```ts
import { tokensPreset } from '@mat-inspect/design-tokens/preset';

const config: Config = {
  presets: [tokensPreset],
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
};
```

## Color tokens

| Token                 | Hex       | Use                               |
| --------------------- | --------- | --------------------------------- |
| `primary`             | `#004D87` | Headers, primary buttons          |
| `accent`              | `#006FC3` | Secondary action (QR scan)        |
| `success`             | `#529E3E` | Pass / compliant                  |
| `success-border`      | `#64AA52` | Pass-card outline                 |
| `destructive`         | `#CC2929` | Fail / blocking                   |
| `warning`             | `#F28509` | Override / warning                |
| `muted`               | `#F2F2F7` | Grouped section, input background |
| `muted-foreground`    | `#767676` | Placeholder, secondary text       |
| `border` / `input`    | `#D9D9D9` | Borders, dividers, disabled state |
| `background` / `card` | `#FFFFFF` | Page and card surfaces            |
| `foreground`          | `#000000` | Primary text                      |

Each color is a Tailwind utility: `bg-primary`, `text-destructive`,
`border-border`, `bg-success/10`, etc. The `-foreground` pairs are the readable
text color on top of that surface.

## Radius, shadow, type

- `rounded-sm` 2px (cards), `rounded-md` 4px, `rounded-lg` 6px (buttons, pills).
- `shadow-card` matches the Figma card elevation.
- `font-sans` is Inter.

## Icons (not yet tokenized)

The Figma mockups use Material Symbols (for example `material-symbols:info-outline`)
plus one custom voice-note glyph. Icons are a dependency choice, so they are not
added here. Pick one icon set, default size 24px (`size-6`), and color with the
tokens above (`text-muted-foreground`, `text-destructive`). Glyphs the mockups
need: QR scan, voice mic, check circle, warning, chevron left/right/down, info,
forklift, crane, pallet jack, dashboard, settings, history, help.
