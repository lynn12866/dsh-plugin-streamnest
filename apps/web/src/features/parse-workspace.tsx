import { displayMessage, message, messageFromError } from '../messages';
import { t } from '../i18n';
import { useState, useSyncExternalStore } from 'react';
import {
  LuArrowDownToLine,
  LuClapperboard,
  LuClipboardPaste,
  LuLink,
  LuListVideo,
  LuX,
} from 'react-icons/lu';

import { parseSession } from '../parse-session';
import { clipboardLink } from '../native';
import { ClipboardInput } from '../components/clipboard-input';
import { useToast } from '../components/toast';
import {
  Button,
  EmptyState,
  Field,
  PageHeading,
  SegmentedControl,
  Select,
  Tag,
  bytes,
  duration,
} from '../components/ui';

export function ParseWorkspace({ onQueue }: { onQueue: () => void }) {
  const toast = useToast();
  const {
    url,
    media,
    mode,
    formatId,
    audioTrackId,
    audioFormatId,
    subtitle,
    subtitleFormat,
    busy,
    error,
  } = useSyncExternalStore(parseSession.subscribe, parseSession.getSnapshot);
  const setUrl = parseSession.set('url');
  const setMode = parseSession.set('mode');
  const setFormatId = parseSession.set('formatId');
  const setAudioTrackId = parseSession.set('audioTrackId');
  const setAudioFormatId = parseSession.set('audioFormatId');
  const setSubtitle = parseSession.set('subtitle');
  const setSubtitleFormat = parseSession.set('subtitleFormat');
  const setError = parseSession.set('error');
  const [failedThumbnail, setFailedThumbnail] = useState('');
  const parse = () => parseSession.parse();
  function notify() {
    const { notice } = parseSession.getSnapshot();
    if (!notice) return;

    const enqueued =
      typeof notice !== 'string' && 'key' in notice && notice.key === 'parse.enqueued';
    toast(notice, {
      tone: enqueued ? 'success' : 'info',
      actions: enqueued ? [{ label: message('parse.viewQueue'), onClick: onQueue }] : undefined,
    });
    parseSession.patch({ notice: '' });
  }

  async function download() {
    await parseSession.download();
    notify();
  }

  function cancel() {
    parseSession.cancel();
    notify();
  }

  return (
    <section className="mv-feature">
      <PageHeading title={t('navigation.download')} description={t('parse.description')}>
        <Button icon={LuListVideo} onClick={onQueue}>
          {t('navigation.queue')}
        </Button>
      </PageHeading>
      <div className="mv-scroll">
        <form
          className="mv-link-form"
          onSubmit={(event) => {
            event.preventDefault();
            void parse();
          }}
        >
          <Field label={t('parse.mediaLink')} hint={t('parse.supportedLinksHint')}>
            {(id) => (
              <div className="mv-link-row">
                <ClipboardInput
                  id={id}
                  aria-label={t('parse.mediaLink')}
                  type="text"
                  placeholder="https://…"
                  icon={<LuLink size={16} />}
                  value={url}
                  onChange={setUrl}
                  onError={setError}
                  required
                  disabled={!!busy}
                />
                <Button
                  type="button"
                  icon={LuClipboardPaste}
                  disabled={!!busy}
                  aria-label={t('parse.pasteLink')}
                  title={t('parse.pasteLinkFromClipboard')}
                  onClick={() =>
                    void clipboardLink()
                      .then(setUrl)
                      .catch((failure: unknown) => setError(messageFromError(failure)))
                  }
                />
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy === 'parse'}
                  disabled={!url.trim() || !!busy}
                >
                  {t('parse.parseLink')}
                </Button>
                {busy === 'parse' && (
                  <Button icon={LuX} type="button" onClick={cancel}>
                    {t('common.cancel')}
                  </Button>
                )}
              </div>
            )}
          </Field>
        </form>
        {busy === 'parse' && (
          <p role="status" className="mv-notice">
            {t('parse.backgroundParsingHint')}
          </p>
        )}
        {error && (
          <div role="alert" className="mv-error">
            {displayMessage(error)}
          </div>
        )}
        {media?.notice && (
          <p className="mv-notice" role="status">
            {displayMessage(media.noticeInfo ?? media.notice)}
          </p>
        )}
        {!media && !busy && (
          <EmptyState icon={LuClapperboard} title={t('parse.startWithALink')}>
            {t('parse.emptyHint')}
          </EmptyState>
        )}
        {media && (
          <div className="mv-media-result">
            <div className="mv-media-identity">
              {media.thumbnail && failedThumbnail !== media.id ? (
                <img
                  src={media.thumbnail}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="mv-cover"
                  onError={() => setFailedThumbnail(media.id)}
                />
              ) : (
                <div className="mv-cover mv-cover-placeholder">
                  <LuClapperboard size={28} />
                </div>
              )}
              <div className="mv-min-width">
                <h2>{media.title}</h2>
                <p className="mv-muted">{media.uploader || media.platform}</p>
                <div className="mv-actions">
                  <Tag>{media.platform}</Tag>
                  {media.duration > 0 && <Tag tone="quiet">{duration(media.duration)}</Tag>}
                  <Tag tone="quiet">
                    {media.formats.length
                      ? t('parse.videoFormatCount', { count: media.formats.length })
                      : t('parse.automaticFormat')}
                  </Tag>
                </div>
              </div>
            </div>
            <SegmentedControl
              id="mv-download-mode"
              label={t('parse.downloadContent')}
              value={mode}
              onChange={setMode}
              disabled={!!busy}
              options={[
                { value: 'video', label: t('media.video') },
                { value: 'audio', label: t('parse.audioOnly') },
                { value: 'subtitle', label: t('parse.subtitlesOnly') },
              ]}
            />
            <div
              id={`mv-download-mode-${mode}-panel`}
              role="tabpanel"
              aria-labelledby={`mv-download-mode-${mode}`}
              className="mv-form-grid"
            >
              {mode === 'video' && (
                <Field label={t('parse.qualityAndFormat')}>
                  {(id) => (
                    <Select id={id} value={formatId} onChange={setFormatId} disabled={!!busy}>
                      <option value="">{t('parse.bestQualityAutomatic')}</option>
                      {media.formats.map((format) => (
                        <option key={format.id} value={format.id}>
                          {format.label} · {format.extension} · {bytes(format.bytes)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              {mode !== 'subtitle' && (
                <Field
                  label={t('parse.audioTrack')}
                  hint={mode === 'audio' ? t('parse.mp3Hint') : t('parse.mergeTracksHint')}
                >
                  {(id) => (
                    <Select
                      id={id}
                      value={audioTrackId}
                      onChange={(value) => {
                        setAudioTrackId(value);
                        if (value) setAudioFormatId('');
                      }}
                      disabled={!!busy}
                    >
                      <option value="">{t('parse.defaultAudioTrack')}</option>
                      {media.audioTracks.map((track) => (
                        <option key={track.id} value={track.id}>
                          {track.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              {mode === 'audio' && !!media.audioFormats?.length && (
                <Field label={t('parse.audioBitrate')} hint={t('parse.audioFormatHint')}>
                  {(id) => (
                    <Select
                      id={id}
                      value={audioFormatId}
                      disabled={!!busy}
                      onChange={(value) => {
                        setAudioFormatId(value);
                        if (value) setAudioTrackId('');
                      }}
                    >
                      <option value="">{t('parse.bestAudioAutomatic')}</option>
                      {media.audioFormats!.map((format) => (
                        <option key={format.id} value={format.id}>
                          {format.label} · {format.extension} · {bytes(format.bytes)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              <Field
                label={
                  mode === 'subtitle' ? t('parse.subtitleLanguage') : t('parse.additionalSubtitles')
                }
                hint={t('parse.subtitleHint')}
              >
                {(id) => (
                  <Select id={id} value={subtitle} onChange={setSubtitle} disabled={!!busy}>
                    <option value="">
                      {mode === 'subtitle' ? t('parse.chooseLanguage') : t('parse.noSubtitles')}
                    </option>
                    {media.subtitles.map((language) => (
                      <option key={language} value={language}>
                        {language}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {(subtitle || mode === 'subtitle') && (
                <Field label={t('parse.subtitleFormat')}>
                  {(id) => (
                    <Select
                      id={id}
                      value={subtitleFormat}
                      onChange={(value) => setSubtitleFormat(value as 'srt' | 'source')}
                      disabled={!!busy}
                    >
                      <option value="srt">{t('parse.subtitleFormatSrt')}</option>
                      <option value="source">{t('parse.keepSourceFormat')}</option>
                    </Select>
                  )}
                </Field>
              )}
            </div>
            {mode === 'subtitle' && !media.subtitles.length && (
              <p className="mv-muted">{t('parse.noSubtitlesAvailableForThisMedia')}</p>
            )}
            <div className="mv-result-footer">
              <span className="mv-muted mv-small">{t('parse.backgroundDownloadHint')}</span>
              <Button
                icon={LuArrowDownToLine}
                variant="primary"
                loading={busy === 'download'}
                disabled={!!busy || (mode === 'subtitle' && !subtitle)}
                onClick={() => void download()}
              >
                {t('parse.addToQueue')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
