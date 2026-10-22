import React, { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { loadFont } from '@remotion/google-fonts/Tajawal';
import { BRAND, CANVAS, CARD, HEADLINE } from './layout';
import { fitHeadline, FitResult } from './fitHeadline';
import type { PostProps } from './schema';

const { fontFamily, waitUntilDone } = loadFont('normal', {
  weights: ['700', '800'],
  subsets: ['arabic', 'latin'],
});

const src = (p: string) => (/^https?:\/\//.test(p) ? p : staticFile(p));

/** cover when the media ratio is close to the card ratio, otherwise contain + blurred fill. */
const resolveFit = (p: PostProps): 'cover' | 'contain' => {
  if (p.fit && p.fit !== 'auto') return p.fit;
  const mediaRatio = p.mediaWidth / p.mediaHeight;
  const cardRatio = CARD.width / CARD.height;
  const diff = Math.abs(mediaRatio - cardRatio) / cardRatio;
  // Tight threshold: cropping screenshots with text looks worse than a blurred fill.
  return diff <= 0.12 ? 'cover' : 'contain';
};

const useHeadlineFit = (text: string): FitResult | null => {
  const [fit, setFit] = useState<FitResult | null>(null);
  const [handle] = useState(() => delayRender('Loading Tajawal + fitting headline'));
  useEffect(() => {
    waitUntilDone()
      .then(() => {
        setFit(fitHeadline(text, fontFamily, '800'));
        continueRender(handle);
      })
      .catch((err) => {
        console.error(err);
        setFit({ fontSize: HEADLINE.minFontSize, lines: HEADLINE.maxLines });
        continueRender(handle);
      });
  }, [text, handle]);
  return fit;
};

const MediaLayer: React.FC<{ p: PostProps; fit: 'cover' | 'contain'; isVideo: boolean }> = ({
  p,
  fit,
  isVideo,
}) => {
  const { fps } = useVideoConfig();
  const objectPosition = `${p.focalX ?? 50}% ${p.focalY ?? 50}%`;
  const mediaStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: fit,
    objectPosition,
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: CARD.x,
        top: CARD.y,
        width: CARD.width,
        height: CARD.height,
        borderRadius: CARD.radius,
        overflow: 'hidden',
        background: '#0D0F1F',
      }}
    >
      {fit === 'contain' && !isVideo && (
        <Img
          src={src(p.media)}
          style={{
            ...mediaStyle,
            objectFit: 'cover',
            filter: 'blur(38px) saturate(1.2)',
            transform: 'scale(1.25)',
            opacity: 0.55,
          }}
        />
      )}
      {fit === 'contain' && isVideo && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(120% 90% at 50% 50%, ${BRAND.violet}33 0%, #0D0F1F 70%)`,
          }}
        />
      )}
      {isVideo ? (
        <OffthreadVideo
          src={src(p.media)}
          startFrom={Math.round((p.startSec ?? 0) * fps)}
          muted={Boolean(p.voiceover)}
          style={mediaStyle}
        />
      ) : (
        <Img src={src(p.media)} style={mediaStyle} />
      )}
      {/* inner edge shading so media sits under the neon frame */}
      <AbsoluteFill
        style={{ boxShadow: 'inset 0 0 40px rgba(5,6,15,0.55)', borderRadius: CARD.radius }}
      />
    </div>
  );
};

const Badge: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      position: 'absolute',
      top: CARD.y - 24,
      right: CANVAS.width - (CARD.x + CARD.width) + 28,
      padding: '10px 26px 14px',
      borderRadius: 999,
      background: `linear-gradient(90deg, ${BRAND.blue}, ${BRAND.neon})`,
      boxShadow: `0 0 28px ${BRAND.neon}99`,
      color: '#fff',
      fontFamily,
      fontWeight: 800,
      fontSize: 34,
      lineHeight: 1,
      direction: 'rtl',
    }}
  >
    {text}
  </div>
);

export const Post: React.FC<PostProps & { animate?: boolean }> = (props) => {
  const frame = useCurrentFrame();
  const fit = resolveFit(props);
  const headlineFit = useHeadlineFit(props.headline);
  const isVideo = props.mediaType === 'video';

  const enter = props.animate ? interpolate(frame, [4, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1;

  return (
    <AbsoluteFill style={{ backgroundColor: '#05060F' }}>
      <MediaLayer p={props} fit={fit} isVideo={isVideo} />
      {/* template on top: header, neon frame, underline (card interior is transparent-safe via z-order) */}
      <Img
        src={staticFile('template-frame.png')}
        style={{ position: 'absolute', inset: 0, width: CANVAS.width, height: CANVAS.height }}
      />
      {props.badge ? <Badge text={props.badge} /> : null}
      {headlineFit && (
        <div
          style={{
            position: 'absolute',
            left: HEADLINE.x,
            top: HEADLINE.y,
            width: HEADLINE.width,
            height: HEADLINE.height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: enter,
            transform: `translateY(${(1 - enter) * 24}px)`,
          }}
        >
          <h1
            style={{
              margin: 0,
              direction: 'rtl',
              textAlign: 'center',
              fontFamily,
              fontWeight: 800,
              fontSize: headlineFit.fontSize,
              lineHeight: HEADLINE.lineHeight,
              color: BRAND.text,
              textShadow: `0 0 24px ${BRAND.violet}66`,
              // balanced line breaks (Chromium)
              ...({ textWrap: 'balance' } as React.CSSProperties),
            }}
          >
            {props.headline}
          </h1>
        </div>
      )}
      {isVideo && props.voiceover ? <Audio src={src(props.voiceover)} /> : null}
    </AbsoluteFill>
  );
};
