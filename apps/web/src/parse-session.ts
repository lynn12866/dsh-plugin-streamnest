import { LocalizedError, message, messageFromError, type DisplayMessage } from './messages';
import type { DownloadMode, DownloadRequest, MediaInfo } from '../../shared/src/contracts';
import { api } from './api';

interface ParseClient {
  parse: (url: string, signal: AbortSignal) => Promise<MediaInfo>;
  enqueue: (request: DownloadRequest) => Promise<unknown>;
}
export interface ParseState {
  url: string;
  media?: MediaInfo;
  mode: DownloadMode;
  formatId: string;
  audioTrackId: string;
  audioFormatId: string;
  subtitle: string;
  subtitleFormat: 'srt' | 'source';
  busy?: 'parse' | 'download';
  error: DisplayMessage;
  notice: DisplayMessage;
}

/** 页面切换只取消订阅，不取消业务请求；显式取消才中止解析。 */
export function createParseSession(client: ParseClient) {
  let state: ParseState = {
    url: '',
    mode: 'video',
    formatId: '',
    audioTrackId: '',
    audioFormatId: '',
    subtitle: '',
    subtitleFormat: 'srt',
    error: '',
    notice: '',
  };
  let controller: AbortController | undefined;
  const subscribers = new Set<() => void>();
  const patch = (value: Partial<ParseState>) => {
    state = { ...state, ...value };
    subscribers.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    patch,
    set:
      <K extends keyof ParseState>(key: K) =>
      (value: ParseState[K]) =>
        patch({ [key]: value }),
    cancel: () => {
      controller?.abort(new LocalizedError('parse.cancelled'));
      controller = undefined;
      patch({ busy: undefined, notice: message('parse.cancelled') });
    },
    async parse() {
      controller?.abort();
      const operation = new AbortController();
      controller = operation;
      patch({ busy: 'parse', error: '', notice: '', media: undefined });
      try {
        const media = await client.parse(state.url, operation.signal);
        if (controller === operation && !operation.signal.aborted)
          patch({ media, formatId: '', audioTrackId: '', audioFormatId: '', subtitle: '' });
      } catch (error) {
        if (controller === operation && !operation.signal.aborted)
          patch({ error: messageFromError(error) });
      } finally {
        if (controller === operation) {
          controller = undefined;
          patch({ busy: undefined });
        }
      }
    },
    async download() {
      const { media, mode, formatId, audioTrackId, audioFormatId, subtitle, subtitleFormat } =
        state;
      if (!media || state.busy) return;
      patch({ busy: 'download', error: '' });
      try {
        await client.enqueue({
          mediaId: media.id,
          mode,
          ...(formatId && mode === 'video' ? { formatId } : {}),
          ...(audioTrackId ? { audioTrackId } : {}),
          ...(audioFormatId && mode === 'audio' ? { audioFormatId } : {}),
          ...(subtitle ? { subtitles: [subtitle] } : {}),
          subtitleFormat,
        });
        patch({ notice: message('parse.enqueued') });
      } catch (error) {
        patch({ error: messageFromError(error) });
      } finally {
        patch({ busy: undefined });
      }
    },
  };
}

export const parseSession = createParseSession(api);
