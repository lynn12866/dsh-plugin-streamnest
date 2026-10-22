import { displayMessage, messageFromError, type DisplayMessage } from '../messages';
import { t } from '../i18n';
import { useEffect, useState } from 'react';
import type { NativeInteraction } from '../../../shared/src/system';
import { api } from '../api';
import { clipboardLink, pickDirectory, pickFile } from '../native';
import { Button, Dialog, Field, Input } from './ui';

export function NativeInteractions() {
  const [requests, setRequests] = useState<NativeInteraction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayMessage>('');
  const [preview, setPreview] = useState<{ id: string; value: string }>();
  useEffect(() => {
    let active = true;
    const poll = () =>
      void api
        .nativePending()
        .then((result) => {
          if (active) setRequests(result.requests);
        })
        .catch(() => undefined);
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const pending = requests[0];
  if (!pending) return null;
  const current: NativeInteraction = pending;
  async function complete(value: string, cancelled = false) {
    await api.nativeComplete(current.id, value, cancelled);
    setRequests((values) => values.filter((request) => request.id !== current.id));
    setPreview(undefined);
    setError('');
  }
  async function act() {
    setBusy(true);
    setError('');
    try {
      if (current.kind === 'clipboard-read' && preview?.id !== current.id) {
        setPreview({ id: current.id, value: await clipboardLink() });
        return;
      }
      if (current.kind === 'clipboard-read') {
        await complete(preview!.value);
        return;
      }
      if (current.kind === 'clipboard-write') {
        await navigator.clipboard.writeText(current.text);
        await complete(current.text);
        return;
      }
      const path = await (current.kind === 'pick-folder' ? pickDirectory() : pickFile());
      await complete(path ?? '', !path);
    } catch (failure) {
      setError(messageFromError(failure));
    } finally {
      setBusy(false);
    }
  }
  const labels = {
    'pick-folder': 'native.chooseFolder',
    'pick-file': 'native.chooseFile',
    'clipboard-read': 'native.readMediaLinkFromClipboard',
    'clipboard-write': 'native.copyTextToClipboard',
  } as const;
  return (
    <Dialog
      title={t(labels[current.kind])}
      onClose={() => {
        if (!busy) void complete('', true).catch((failure) => setError(messageFromError(failure)));
      }}
    >
      <div className="mv-detail-stack">
        <p>{current.purpose}</p>
        {current.kind === 'clipboard-write' && <p className="mv-wrap">{current.text}</p>}
        {preview?.id === current.id && (
          <Field label={t('native.confirmTheLinkToShareWithAgent')}>
            {(id) => (
              <Input
                id={id}
                value={preview.value}
                onChange={(event) => setPreview({ id: current.id, value: event.target.value })}
              />
            )}
          </Field>
        )}
        {error && (
          <p role="alert" className="mv-error">
            {displayMessage(error)}
          </p>
        )}
        <div className="mv-actions">
          <Button
            disabled={busy}
            onClick={() =>
              void complete('', true).catch((failure) => setError(messageFromError(failure)))
            }
          >
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void act()}>
            {preview?.id === current.id ? t('native.useThisLink') : t(labels[current.kind])}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
