// All coordinates measured from public/template.png (1080x1350).
export const CANVAS = { width: 1080, height: 1350 } as const;

// Inner area of the glowing card frame (media goes here).
export const CARD = { x: 76, y: 256, width: 926, height: 627, radius: 34 } as const;

// Free zone between the card frame and the gradient underline (y≈1186).
export const HEADLINE = {
  x: 90,
  y: 912,
  width: 900,
  height: 258,
  maxLines: 3,
  maxFontSize: 78,
  minFontSize: 44,
  lineHeight: 1.32,
} as const;

export const BRAND = {
  blue: '#2340E0',
  violet: '#6A2BE8',
  neon: '#A64DFF',
  text: '#FFFFFF',
} as const;

export const FPS = 30;
