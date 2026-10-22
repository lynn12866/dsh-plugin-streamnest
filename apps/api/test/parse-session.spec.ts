import { describe, expect, it, vi } from 'vitest';
import { createParseSession } from '../../web/src/parse-session.js';
import type { MediaInfo } from '../../shared/src/contracts.js';
import { chromiumProfiles } from '../src/system/browser-profiles.js';

const media: MediaInfo = {
  id: 'fixture',
  url: 'https://example.com/video',
  title: 'Fixture',
  uploader: '',
  platform: 'fixture',
  duration: 1,
  thumbnail: '',
  formats: [],
  audioTracks: [],
  subtitles: [],
  parsedAt: '',
};

describe('page navigation and browser account selection', () => {
  it('continues parsing while the page is unsubscribed, then restores results and choices', async () => {
    let complete!: (value: MediaInfo) => void;
    let signal!: AbortSignal;
    const session = createParseSession({
      parse: (_url, value) => {
        signal = value;
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
      enqueue: async () => undefined,
    });
    session.patch({ url: media.url });
    const unsubscribe = session.subscribe(vi.fn());
    const running = session.parse();
    unsubscribe();
    expect(session.getSnapshot().busy).toBe('parse');
    expect(signal.aborted).toBe(false);
    complete(media);
    await running;
    session.patch({ mode: 'audio', audioFormatId: '140' });
    const next = session.subscribe(vi.fn());
    expect(session.getSnapshot()).toMatchObject({
      media,
      url: media.url,
      mode: 'audio',
      audioFormatId: '140',
      busy: undefined,
    });
    next();
  });
  it('explicit cancellation aborts the actual request and ignores a late response', async () => {
    let complete!: (value: MediaInfo) => void;
    let signal!: AbortSignal;
    const session = createParseSession({
      parse: (_url, value) => {
        signal = value;
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
      enqueue: async () => undefined,
    });
    const running = session.parse();
    session.cancel();
    expect(signal.aborted).toBe(true);
    complete(media);
    await running;
    expect(session.getSnapshot().media).toBeUndefined();
    expect(session.getSnapshot().notice).toMatchObject({ key: 'parse.cancelled' });
  });
  it('lists distinct account labels and directory IDs without exposing other Local State fields', () => {
    const profiles = chromiumProfiles(
      JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: '个人', user_name: 'person@example.com', secret: 'not exposed' },
            'Profile 4': { name: '工作', user_name: 'work@example.com' },
            '../outside': { name: 'invalid' },
          },
        },
        os_crypt: { encrypted_key: 'never returned' },
      }),
    );
    expect(profiles.map((p) => p.id)).toEqual(['Default', 'Profile 4']);
    expect(profiles[1]?.label).toBe('工作 · work@example.com');
    expect(JSON.stringify(profiles)).not.toMatch(/secret|encrypted_key|never returned|not exposed/);
  });
});

it('never reads an unselected Chromium profile and only stores the permitted account labels', async () => {
  const { CookieService } = await import('../src/media/parsing/cookie.service.js');
  const { saveBrowserProfiles, browserMetadataPath } =
    await import('../src/system/browser-profiles.js');
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const directory = await mkdtemp(join(tmpdir(), 'streamnest-account-metadata-'));
  const profiles = chromiumProfiles(
    JSON.stringify({
      profile: { info_cache: { 'Profile 4': { name: 'Work', user_name: 'work@example.com' } } },
    }),
  );
  try {
    await expect(
      new CookieService(directory).run(
        {
          cookieBrowser: 'chrome',
          cookieProfile: '',
          cookiesFile: '',
          cookieStrategy: 'selected',
        } as never,
        async () => true,
      ),
    ).rejects.toThrow('请选择');
    await saveBrowserProfiles(directory, 'chrome', browserMetadataPath('chrome')!, profiles);
    const data = JSON.parse(
      await readFile(join(directory, 'browser-accounts/chrome.json'), 'utf8'),
    );
    expect(data.profiles[0]).toEqual(profiles[0]);
    expect(Object.keys(data)).toEqual(['profiles', 'readAt']);
    await expect(
      saveBrowserProfiles(directory, 'chrome', '/not-the-browser-file', profiles),
    ).rejects.toThrow('Local State');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
