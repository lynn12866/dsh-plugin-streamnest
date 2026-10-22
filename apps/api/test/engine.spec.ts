import { describe, expect, it } from 'vitest';
import { downloadArguments, parseProgress } from '../src/media/arguments.js';
import { normalizeFormats, normalizeInfo } from '../src/media/formats.js';
import { validateMediaUrl } from '../src/media/media.engine.js';
import { runProcess } from '../src/common/process.js';
import type { Preferences } from '../../shared/src/contracts.js';
import { classifyParseError, parseDiagnostic } from '../../shared/src/parse-errors.js';
import { isPlatformVideoSource } from '../src/media/parsing/platform-data.js';

const preferences: Preferences = {
  downloadDirectory: '/tmp/streamnest-test',
  concurrency: 2,
  fragments: 4,
  proxy: '',
  cookieBrowser: '',
  cookiesFile: '',
  binaryPaths: {},
};

describe('extractor and process boundary', () => {
  it('rejects the observed Douyin static animation instead of reporting a parsed video', () => {
    expect(
      isPlatformVideoSource(
        'douyin',
        'https://lf-douyin-pc-web.douyinstatic.com/obj/douyin-pc-web/uuu_265.mp4',
        '站点动画',
      ),
    ).toBe(false);
    expect(isPlatformVideoSource('douyin', 'https://v.example.com/video.mp4', '')).toBe(false);
    expect(isPlatformVideoSource('kuaishou', 'https://v.example.com/video.mp4', '视频')).toBe(true);
  });

  it('merges separate HLS language audio with video instead of returning audio only', () => {
    const media = normalizeInfo(
      {
        formats: [
          { format_id: 'v', height: 720, vcodec: 'h264', acodec: 'none', protocol: 'm3u8_native' },
          {
            format_id: 'en',
            vcodec: 'none',
            acodec: 'aac',
            protocol: 'm3u8_native',
            language: 'en',
          },
          {
            format_id: 'zh',
            vcodec: 'none',
            acodec: 'aac',
            protocol: 'm3u8_native',
            language: 'zh',
          },
        ],
      },
      'https://example.com/hls',
      'media-id',
    );
    const args = downloadArguments(
      media,
      { mediaId: media.id, mode: 'video', audioTrackId: 'zh' },
      preferences,
      preferences.downloadDirectory,
    );
    expect(args[args.indexOf('-f') + 1]).toBe('bv*+zh/b');
  });

  it('classifies the actual unavailable YouTube response and omits the original output', () => {
    const message = 'ERROR: [youtube] BaW_jenozKc: This video is unavailable';
    expect(classifyParseError(message)).toBe('not-found');
    expect(parseDiagnostic(message)).toContain('not-found');
    expect(parseDiagnostic(message)).not.toContain('BaW_jenozKc');
  });
  it('keeps unknown codecs, direct resolutions, HLS-only resolutions and high fps', () => {
    const formats = normalizeFormats({
      formats: [
        { format_id: 'x-direct', height: 1080, fps: 30, tbr: 1000 },
        { format_id: 'hls-duplicate', height: 1080, protocol: 'm3u8_native', tbr: 2000 },
        {
          format_id: 'hls-only',
          height: 720,
          protocol: 'm3u8_native',
          vcodec: 'h264',
          acodec: 'aac',
        },
        { format_id: 'high-fps', height: 1080, fps: 60, vcodec: 'h264', acodec: 'none' },
        { format_id: 'audio', height: 1080, vcodec: 'none' },
      ],
    });
    expect(formats.map((format) => format.id)).toEqual(['high-fps', 'x-direct', 'hls-only']);
    expect(formats[1]?.hasAudio).toBe(true);
    expect(formats[0]?.hasAudio).toBe(false);
  });

  it('keeps audio-only media and builds selected audio/subtitle arguments', () => {
    const media = normalizeInfo(
      {
        title: 'Test',
        formats: [{ format_id: 'audio-en', vcodec: 'none', acodec: 'aac', language: 'en' }],
        subtitles: { en: [] },
      },
      'https://example.com/video',
      'media-id',
    );
    const audio = downloadArguments(
      media,
      { mediaId: media.id, mode: 'audio', audioTrackId: 'audio-en' },
      preferences,
      preferences.downloadDirectory,
      '/tmp/bin/ffmpeg',
    );
    expect(audio).toContain('audio-en');
    expect(audio).toContain('--audio-format');
    expect(audio).toContain('mp3');
    expect(audio).toContain('--ignore-config');
    expect(audio.slice(-2)).toEqual(['--', media.url]);
    const subtitle = downloadArguments(
      media,
      { mediaId: media.id, mode: 'subtitle', subtitles: ['en'] },
      preferences,
      preferences.downloadDirectory,
    );
    expect(subtitle).toContain('--skip-download');
    expect(subtitle).toContain('--write-auto-subs');
    expect(subtitle).not.toContain('--ffmpeg-location');
  });

  it('merges an explicitly selected independent video track with audio', () => {
    const media = normalizeInfo(
      { formats: [{ format_id: '137', height: 1080, vcodec: 'h264', acodec: 'none' }] },
      'https://example.com/video',
      'media-id',
    );
    const args = downloadArguments(
      media,
      { mediaId: media.id, mode: 'video', formatId: '137' },
      preferences,
      preferences.downloadDirectory,
      '/tmp/bin/ffmpeg',
    );
    expect(args[args.indexOf('-f') + 1]).toBe('137+bestaudio/137/bv*+ba/b');
  });

  it('extracts audio from progressive media without a separate audio-only format', () => {
    const media = normalizeInfo(
      { title: 'Progressive MP4', url: 'https://example.com/file.mp4' },
      'https://example.com/file.mp4',
      'media-id',
    );
    const args = downloadArguments(
      media,
      { mediaId: media.id, mode: 'audio' },
      preferences,
      preferences.downloadDirectory,
      '/tmp/bin/ffmpeg',
    );
    expect(args[args.indexOf('-f') + 1]).toBe('bestaudio/best');
  });

  it('exposes a generic direct-file format without inventing a resolution', () => {
    const media = normalizeInfo(
      {
        title: 'mov_bbb',
        url: 'https://example.com/mov_bbb.mp4',
        format_id: 'mp4',
        ext: 'mp4',
        filesize: 788493,
      },
      'https://example.com/mov_bbb.mp4',
      'direct-media',
    );
    expect(media.formats).toEqual([
      {
        id: 'mp4',
        label: '原始格式 · MP4',
        extension: 'mp4',
        height: 0,
        fps: 0,
        bytes: 788493,
        hasAudio: true,
      },
    ]);
    const args = downloadArguments(
      media,
      { mediaId: media.id, mode: 'video', formatId: 'mp4' },
      preferences,
      preferences.downloadDirectory,
      '/tmp/bin/ffmpeg',
    );
    expect(args[args.indexOf('-f') + 1]).toBe('mp4/bv*+ba/b');
  });

  it('uses estimated totals and contains NA/nonfinite progress', () => {
    expect(parseProgress('[mv-progress]50|NA|100|NA|NA')).toEqual({
      downloadedBytes: 50,
      totalBytes: 100,
      speed: 0,
      eta: 0,
      progress: 50,
    });
    expect(parseProgress('[mv-progress]100|100|NA|Infinity|-3')?.progress).toBe(99);
    expect(parseProgress('WARNING: test')).toBeUndefined();
  });

  it.each([
    'file:///tmp/a.mp4',
    'http://127.0.0.1/a',
    'http://[::1]/a',
    'https://user:secret@example.com/a',
    'http://192.168.0.1/a',
    'http://localhost/a',
  ])('rejects unsupported/private link %s', async (url) => {
    await expect(validateMediaUrl(url)).rejects.toThrow();
  });

  it('cancels a running child and settles after process closure', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('fixture cancellation')), 100);
    await expect(
      runProcess(process.execPath, ['-e', 'setInterval(() => console.log("fixture"), 10)'], {
        signal: controller.signal,
      }),
    ).rejects.toThrow('fixture cancellation');
    clearTimeout(timer);
  });
});
