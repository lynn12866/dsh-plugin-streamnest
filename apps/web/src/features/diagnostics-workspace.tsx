import { displayMessage, message, messageFromError, type DisplayMessage } from '../messages';
import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { LuClipboardCopy, LuFolderOpen, LuRefreshCw, LuTrash2 } from 'react-icons/lu';
import type { SystemDiagnostics } from '../../../shared/src/system';
import { api } from '../api';
import { Button, Dialog, EmptyState, PageHeading, StateDot, Tag, bytes } from '../components/ui';
import { useToast } from '../components/toast';

export function DiagnosticsWorkspace() {
  const toast = useToast();
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics>();
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<DisplayMessage>('');
  const [busy, setBusy] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const [report, setReport] = useState<string>();
  async function refresh(force = false) {
    setBusy(true);
    setError('');
    try {
      const [status, journal] = await Promise.all([api.diagnostics(force), api.logs()]);
      setDiagnostics(status);
      setLogs(journal.lines);
      if (journal.error) setError(journal.error);
    } catch (failure) {
      setError(messageFromError(failure));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    void Promise.all([api.diagnostics(), api.logs()])
      .then(([status, journal]) => {
        if (alive) {
          setDiagnostics(status);
          setLogs(journal.lines);
        }
      })
      .catch((failure: unknown) => {
        if (alive) setError(messageFromError(failure));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(message('common.copied'), { tone: 'success' });
    } catch {
      toast(message('clipboard.writeFailed'), { tone: 'error' });
    }
  }
  async function clear() {
    setBusy(true);
    setError('');
    try {
      await api.clearLogs();
      setLogs([]);
      setConfirmClear(false);
      toast(message('diagnostics.logsCleared'), { tone: 'success' });
    } catch (failure) {
      setError(messageFromError(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mv-feature">
      <PageHeading title={t('navigation.diagnostics')} description={t('diagnostics.description')}>
        <Button icon={LuRefreshCw} loading={busy} onClick={() => void refresh(true)}>
          {t('diagnostics.checkAgain')}
        </Button>
      </PageHeading>
      <div className="mv-scroll mv-settings">
        {error && (
          <p className="mv-error" role="alert">
            {displayMessage(error)}
          </p>
        )}
        {!diagnostics && busy && (
          <div className="mv-empty">
            <StateDot state="ongoing" />
            <p>{t('diagnostics.checkingEnvironment')}</p>
          </div>
        )}
        {diagnostics && (
          <>
            <section className="mv-settings-section">
              <h2>{t('diagnostics.runtimeTools')}</h2>
              <div className="mv-runtime-list">
                {diagnostics.runtime.results.map((result) => (
                  <div className="mv-runtime-row" key={result.kind}>
                    <div className="mv-section-heading">
                      <strong>{result.kind}</strong>
                      <Tag tone={result.found ? 'success' : 'warning'}>
                        {result.found ? t('common.ready') : t('common.notReady')}
                      </Tag>
                    </div>
                    <p className="mv-muted mv-small mv-wrap">
                      {result.version ||
                        (result.reasonInfo ? displayMessage(result.reasonInfo) : result.reason) ||
                        ''}
                    </p>
                    <p className="mv-muted mv-small mv-wrap">{result.path}</p>
                  </div>
                ))}
              </div>
              <div className="mv-actions">
                <Button
                  icon={LuFolderOpen}
                  onClick={() =>
                    void api
                      .open('runtime')
                      .catch((failure: unknown) => setError(messageFromError(failure)))
                  }
                >
                  {t('diagnostics.openToolsFolder')}
                </Button>
              </div>
            </section>
            <section className="mv-settings-section">
              <h2>{t('diagnostics.compatibilityAndAcceleration')}</h2>
              <div className="mv-runtime-list">
                <div className="mv-runtime-row">
                  <div className="mv-section-heading">
                    <strong>aria2</strong>
                    <Tag tone={diagnostics.acceleration.found ? 'success' : 'neutral'}>
                      {diagnostics.acceleration.found
                        ? t('common.ready')
                        : t('diagnostics.usingBuiltInDownloader')}
                    </Tag>
                  </div>
                  <p className="mv-muted mv-small mv-wrap">
                    {diagnostics.acceleration.version || diagnostics.acceleration.reason}
                  </p>
                  <p className="mv-muted mv-small mv-wrap">{diagnostics.acceleration.path}</p>
                </div>
                <div className="mv-runtime-row">
                  <div className="mv-section-heading">
                    <strong>Node.js / Deno</strong>
                    <Tag tone={diagnostics.jsRuntime.available ? 'success' : 'warning'}>
                      {diagnostics.jsRuntime.available ? t('common.ready') : t('common.notFound')}
                    </Tag>
                  </div>
                  <p className="mv-muted mv-small">
                    {diagnostics.jsRuntime.name} {diagnostics.jsRuntime.version}
                  </p>
                  <p className="mv-muted mv-small mv-wrap">{diagnostics.jsRuntime.path}</p>
                </div>
                <div className="mv-runtime-row">
                  <div className="mv-section-heading">
                    <strong>Chrome / Edge</strong>
                    <Tag tone={diagnostics.browser.path ? 'success' : 'warning'}>
                      {diagnostics.browser.path ? t('common.ready') : t('common.notFound')}
                    </Tag>
                  </div>
                  <p className="mv-muted mv-small mv-wrap">
                    {diagnostics.browser.path || t('diagnostics.browserRequired')}
                  </p>
                </div>
              </div>
            </section>
            <section className="mv-settings-section">
              <h2>{t('diagnostics.loginSourcesAndDisk')}</h2>
              <p className="mv-muted">
                {diagnostics.cookies.enabled
                  ? t('diagnostics.loginSourceConfigured')
                  : t('diagnostics.browserCookiesAreDisabled')}
              </p>
              <p className="mv-muted">
                {diagnostics.cookies.hasSnapshot
                  ? t('diagnostics.localCookieSnapshotAvailable')
                  : t('diagnostics.noReusableSnapshot')}
              </p>
              <p>
                {t('diagnostics.freeSpace')} {bytes(diagnostics.disk.free)} /{' '}
                {bytes(diagnostics.disk.total)}
              </p>
              <p className="mv-muted mv-small">
                {t('brand.name')} {diagnostics.version} · {diagnostics.platform}
              </p>
            </section>
          </>
        )}
        <section className="mv-settings-section">
          <div className="mv-section-heading">
            <h2>{t('diagnostics.eventLog')}</h2>
            <div className="mv-actions">
              <Button
                icon={LuClipboardCopy}
                onClick={() => void copy(logs.join('\n'))}
                disabled={!logs.length}
              >
                {t('diagnostics.copyLogs')}
              </Button>
              <Button
                icon={LuFolderOpen}
                onClick={() =>
                  void api
                    .open('logs')
                    .catch((failure: unknown) => setError(messageFromError(failure)))
                }
              >
                {t('diagnostics.openFolder')}
              </Button>
              <Button
                icon={LuTrash2}
                onClick={() => setConfirmClear(true)}
                disabled={busy || !logs.length}
              >
                {t('diagnostics.clearLogs')}
              </Button>
            </div>
          </div>
          <p className="mv-muted mv-small">{t('diagnostics.logsPrivacyHint')}</p>
          {logs.length ? (
            <pre className="mv-diagnostic-log">{logs.join('\n')}</pre>
          ) : (
            <EmptyState icon={LuRefreshCw} title={t('diagnostics.noLogsYet')}>
              {t('diagnostics.logsEmptyHint')}
            </EmptyState>
          )}
        </section>
        <section className="mv-settings-section">
          <h2>{t('diagnostics.feedbackDraft')}</h2>
          <p className="mv-muted">{t('diagnostics.reportHint')}</p>
          <div className="mv-actions">
            <Button
              onClick={() =>
                void api
                  .errorReport()
                  .then((value) => setReport(`${value.title}\n\n${value.body}`))
                  .catch((failure: unknown) => setError(messageFromError(failure)))
              }
            >
              {t('diagnostics.prepareFeedbackDraft')}
            </Button>
          </div>
        </section>
      </div>
      {confirmClear && (
        <Dialog title={t('diagnostics.clearLogs')} onClose={() => setConfirmClear(false)}>
          <div className="mv-detail-stack">
            <p>{t('diagnostics.clearLogsConfirmation')}</p>
            <div className="mv-actions">
              <Button onClick={() => setConfirmClear(false)}>{t('common.cancel')}</Button>
              <Button variant="primary" loading={busy} onClick={() => void clear()}>
                {t('common.clear')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      {report && (
        <Dialog
          title={t('diagnostics.sanitizedFeedbackDraft')}
          onClose={() => setReport(undefined)}
        >
          <div className="mv-detail-stack">
            <pre className="mv-diagnostic-log">{report}</pre>
            <div className="mv-actions">
              <Button icon={LuClipboardCopy} onClick={() => void copy(report)}>
                {t('diagnostics.copyDraft')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
