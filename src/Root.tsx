import React from 'react';
import { Composition, Still } from 'remotion';
import { Post } from './Post';
import { CANVAS, FPS } from './layout';
import { defaultProps, PostProps } from './schema';

const PostVideo: React.FC<PostProps> = (p) => <Post {...p} animate />;

export const RemotionRoot: React.FC = () => (
  <>
    <Still id="Post" component={Post} width={CANVAS.width} height={CANVAS.height} defaultProps={defaultProps} />
    <Composition
      id="PostVideo"
      component={PostVideo}
      width={CANVAS.width}
      height={CANVAS.height}
      fps={FPS}
      durationInFrames={FPS * 15}
      defaultProps={{ ...defaultProps, mediaType: 'video' as const }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.round((props.durationSec ?? 15) * FPS)),
      })}
    />
  </>
);
