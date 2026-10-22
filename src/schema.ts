export type PostProps = {
  /** Image or video URL (http(s) or staticFile path). */
  media: string;
  mediaType: 'image' | 'video';
  /** Natural media size, filled in by the render server. */
  mediaWidth: number;
  mediaHeight: number;
  /** Arabic headline rendered under the card. */
  headline: string;
  /** Optional pill on the card, e.g. "مجاني" / "مفتوح المصدر" / "يعمل محلياً". */
  badge?: string;
  /** Focal point in % (from Gemini), keeps the subject in frame when cropping. */
  focalX?: number;
  focalY?: number;
  /** Force a fit mode instead of the automatic choice. */
  fit?: 'auto' | 'cover' | 'contain';
  /** Video only: seconds to start from (strongest moment) and clip length. */
  startSec?: number;
  durationSec?: number;
  /** Video only: optional voice-over audio URL (replaces original audio). */
  voiceover?: string;
};

export const defaultProps: PostProps = {
  media: 'sample.png',
  mediaType: 'image',
  mediaWidth: 1600,
  mediaHeight: 1000,
  headline: 'ذكاء اصطناعي يراك ويسمعك ويرد عليك فوراً، يعمل محلياً وبدون اشتراك',
  badge: 'مجاني',
  focalX: 50,
  focalY: 50,
  fit: 'auto',
  startSec: 0,
  durationSec: 15,
};
