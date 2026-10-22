import { describe, expect, it } from 'vitest';
import { playableArtifactIndex } from '../../web/src/task-artifacts.js';

describe('library playback selection', () => {
  it('opens the video rather than a subtitle that appears first', () => {
    expect(
      playableArtifactIndex({
        request: { mediaId: 'fixture', mode: 'video' },
        artifacts: [
          { name: 'captions.srt', bytes: 10 },
          { name: 'video.MP4', bytes: 100 },
        ],
      }),
    ).toBe(1);
  });

  it('skips missing files and chooses an available audio file', () => {
    expect(
      playableArtifactIndex({
        request: { mediaId: 'fixture', mode: 'audio' },
        artifacts: [
          { name: 'old.mp3', bytes: 10, exists: false },
          { name: 'audio.mp3', bytes: 100, exists: true },
        ],
      }),
    ).toBe(1);
  });

  it('does not treat subtitles or arbitrary attachments as playable media', () => {
    expect(
      playableArtifactIndex({
        request: { mediaId: 'fixture', mode: 'subtitle' },
        artifacts: [{ name: 'captions.srt', bytes: 10 }],
      }),
    ).toBe(-1);
    expect(
      playableArtifactIndex({
        request: { mediaId: 'fixture', mode: 'video' },
        artifacts: [
          { name: 'attachment.exe', bytes: 10 },
          { name: 'video.mp4', bytes: 100, exists: false },
        ],
      }),
    ).toBe(-1);
  });
});
