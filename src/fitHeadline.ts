import { measureText } from '@remotion/layout-utils';
import { HEADLINE } from './layout';

export type FitResult = { fontSize: number; lines: number };

const countLines = (
  text: string,
  fontFamily: string,
  fontWeight: string,
  fontSize: number,
  maxWidth: number,
): number => {
  let lines = 1;
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    const { width } = measureText({ text: candidate, fontFamily, fontWeight, fontSize });
    if (width > maxWidth && line) {
      lines++;
      line = word;
    } else {
      line = candidate;
    }
  }
  return lines;
};

/** Largest font size that keeps the headline within maxLines and the zone height. */
export const fitHeadline = (text: string, fontFamily: string, fontWeight = '800'): FitResult => {
  const { maxFontSize, minFontSize, maxLines, width, height, lineHeight } = HEADLINE;
  for (let size = maxFontSize; size >= minFontSize; size -= 2) {
    const lines = countLines(text, fontFamily, fontWeight, size, width);
    if (lines <= maxLines && lines * size * lineHeight <= height) {
      return { fontSize: size, lines };
    }
  }
  return { fontSize: minFontSize, lines: maxLines };
};
