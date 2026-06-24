import type { ReactElement, SVGProps } from 'react';

/**
 * Shared icon set for the PWA.
 *
 * Inline SVG keeps icons off the dependency list (design-tokens README: icons not
 * yet tokenized). Each icon is 24px by default (size-6) and inherits currentColor,
 * so size and color come from the caller through Tailwind utilities:
 *
 *   <ChevronLeftIcon className="size-5 text-primary" />
 *
 * Geometry tracks the Material Symbols glyphs used in the Figma mockups.
 */

type IconProps = SVGProps<SVGSVGElement>;

// Stroke icons share these attributes; fill icons set fill="currentColor" instead.
const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export const ChevronLeftIcon = ({ className = 'size-6', ...props }: IconProps): ReactElement => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps} {...props}>
    <path d="m15 18-6-6 6-6" />
  </svg>
);

export const QrCodeIcon = ({ className = 'size-6', ...props }: IconProps): ReactElement => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm10-2h2v2h-2v-2zm4 0h2v2h-2v-2zm-4 4h2v2h-2v-2zm2 2h2v2h-2v-2zm2-2h2v2h-2v-2z" />
  </svg>
);

export const XIcon = ({ className = 'size-6', ...props }: IconProps): ReactElement => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps} {...props}>
    <path d="m15 9-6 6m0-6 6 6" />
  </svg>
);

export const RefreshIcon = ({ className = 'size-6', ...props }: IconProps): ReactElement => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps} {...props}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
  </svg>
);

export const EquipmentIcon = ({ className = 'size-6', ...props }: IconProps): ReactElement => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps} {...props}>
    <path d="M3 17V7l9-4 9 4v10l-9 4-9-4zm9-4v8m9-12-9 4-9-4" />
  </svg>
);
