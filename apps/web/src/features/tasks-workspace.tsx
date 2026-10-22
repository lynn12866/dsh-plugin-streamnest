import { displayMessage, messageFromError, type DisplayMessage } from '../messages';
import { t, resolvedLanguage, type TranslationKey } from '../i18n';
import { useEffect, useState } from 'react';
import {
  LuArrowDownToLine,
  LuArrowLeft,
  LuArrowRight,
  LuFolderOpen,
  LuPause,
  LuPlay,
  LuRefreshCw,
  LuSearch,
  LuX,
} from 'react-icons/lu';

import type { SystemDiagnostics } from '../../../shared/src/system';
import type { DownloadTask, TaskPage, TaskState } from '../../../shared/src/contracts';
import { api } from '../api';
import { useToast } from '../components/toast';
import { Button, EmptyState, Input, PageHeading, StateDot, Tag, bytes } from '../components/ui';

const labels: Record<TaskState, TranslationKey> = {
  queued: 'tasks.state.queued',
  downloading: 'tasks.state.downloading',
  processing: 'tasks.state.processing',
  paused: 'tasks.state.paused',
  completed: 'tasks.state.completed',
  failed: 'tasks.state.failed',
  cancelled: 'tasks.state.cancelled',
};
const modes = { video: 'media.video', audio: 'media.audio', subtitle: 'media.subtitle' } as const;

export function TasksWorkspace() {
  const toast = useToast();
  const [page, setPage] = useState<TaskPage>({ items: [], total: 0, offset: 0, nextOffset: null });
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<DisplayMessage>('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [space, setSpace] = useState<SystemDiagnostics['disk']>();

  useEffect(() => {
    let alive = true;
    const read = () =>
      void api
        .diskSpace()
        .then((value) => {
          if (alive) setSpace(value);
        })
        .catch(() => undefined);
    read();
    const timer = setInterval(read, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await api.tasks('queue', query, offset, undefined, controller.signal);
        setPage(value);
        setError('');
      } catch (failure) {
        if (!controller.signal.aborted) setError(messageFromError(failure));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(() => void poll(), 1_500);
        }
      }
    };
    void poll();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, offset, revision]);

  async function act(task: DownloadTask, action: 'pause' | 'resume' | 'retry' | 'cancel') {
    setBusy(task.id);
    setError('');
    try {
      await api.action(task.id, action);
      setRevision((value) => value + 1);
    } catch (failure) {
      toast(messageFromError(failure), { tone: 'error' });
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="mv-feature">
      <PageHeading title={t('navigation.queue')} description={t('tasks.queueDescription')} />
      <div className="mv-list-toolbar">
        <Input
          aria-label={t('tasks.searchMedia')}
          placeholder={t('tasks.searchTitlesSitesOrLinks')}
          icon={<LuSearch size={16} />}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOffset(0);
          }}
        />
        <span className="mv-muted mv-small">
          {page.total}
          {t('tasks.records')}
        </span>
      </div>
      {space && (
        <div className="mv-list-toolbar">
          <span className="mv-muted mv-small">
            {t('diagnostics.freeSpace')} {bytes(space.free, '0 B')} / {bytes(space.total, '0 B')}
            <span
              title={`${t('tasks.diskSpaceHint')}\n${space.directory}\n${space.checkedAt}`}
              className="mv-muted"
            >
              {' '}
              · {t('tasks.downloadVolume')}
            </span>
          </span>
          <Button
            variant="ghost"
            icon={LuFolderOpen}
            onClick={() =>
              void api
                .open('download-directory')
                .catch((failure: unknown) => toast(messageFromError(failure), { tone: 'error' }))
            }
          >
            {t('tasks.openDownloadFolder')}
          </Button>
        </div>
      )}
      {error && (
        <div className="mv-error" role="alert">
          {displayMessage(error)}
        </div>
      )}
      <div className="mv-scroll mv-task-list">
        {loading ? (
          <div className="mv-empty">
            <StateDot state="ongoing" />
            <p>{t('tasks.loadingDownloadRecords')}</p>
          </div>
        ) : !page.items.length ? (
          <EmptyState
            icon={LuArrowDownToLine}
            title={query ? t('tasks.noMatchingRecords') : t('tasks.queueIsEmpty')}
          >
            {t('tasks.queueEmptyHint')}
          </EmptyState>
        ) : (
          page.items.map((task) => (
            <article className="mv-task-row" key={task.id}>
              <div className="mv-task-icon">
                <StateDot
                  state={
                    task.state === 'completed'
                      ? 'done'
                      : task.state === 'failed'
                        ? 'error'
                        : ['downloading', 'processing'].includes(task.state)
                          ? 'ongoing'
                          : task.state === 'paused'
                            ? 'warning'
                            : 'idle'
                  }
                />
              </div>
              <div className="mv-task-content">
                <div className="mv-task-heading">
                  <strong className="mv-ellipsis" title={task.media.title}>
                    {task.media.title}
                  </strong>
                  <Tag
                    tone={
                      task.state === 'failed'
                        ? 'danger'
                        : task.state === 'completed'
                          ? 'success'
                          : 'neutral'
                    }
                  >
                    {t(labels[task.state])}
                  </Tag>
                </div>
                <p className="mv-muted mv-small">
                  {task.media.platform} · {t(modes[task.request.mode])} ·{' '}
                  {new Date(task.createdAt).toLocaleString(resolvedLanguage())}
                </p>
                {['queued', 'downloading', 'processing', 'paused'].includes(task.state) && (
                  <div className="mv-task-progress">
                    <progress
                      max={100}
                      value={task.progress}
                      aria-label={t('tasks.downloadProgress', { title: task.media.title })}
                    />
                    <span className="mv-muted mv-small">
                      {task.progress.toFixed(0)}%{task.speed > 0 ? ` · ${bytes(task.speed)}/s` : ''}
                      {task.eta > 0
                        ? t('tasks.remainingTime', { seconds: Math.ceil(task.eta) })
                        : ''}
                    </span>
                  </div>
                )}
                {task.state === 'failed' && (
                  <p className="mv-error-text mv-wrap">{displayMessage(task)}</p>
                )}
              </div>
              <div className="mv-actions mv-task-actions">
                {['queued', 'downloading', 'processing'].includes(task.state) && (
                  <Button icon={LuPause} disabled={!!busy} onClick={() => void act(task, 'pause')}>
                    {t('tasks.pause')}
                  </Button>
                )}
                {task.state === 'paused' && (
                  <Button icon={LuPlay} disabled={!!busy} onClick={() => void act(task, 'resume')}>
                    {t('tasks.resume')}
                  </Button>
                )}
                {['failed', 'cancelled'].includes(task.state) && (
                  <Button
                    icon={LuRefreshCw}
                    disabled={!!busy}
                    onClick={() => void act(task, 'retry')}
                  >
                    {t('tasks.retry')}
                  </Button>
                )}
                {['queued', 'downloading', 'processing', 'paused'].includes(task.state) && (
                  <Button
                    icon={LuX}
                    variant="ghost"
                    disabled={!!busy}
                    aria-label={t('tasks.cancelTitle', { title: task.media.title })}
                    title={t('tasks.cancelTaskRetainTemporaryFiles')}
                    onClick={() => void act(task, 'cancel')}
                  />
                )}
              </div>
            </article>
          ))
        )}
      </div>
      {(offset > 0 || page.nextOffset !== null) && (
        <footer className="mv-pagination">
          <Button
            icon={LuArrowLeft}
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            {t('tasks.previous')}
          </Button>
          <span className="mv-muted mv-small">
            {Math.floor(offset / 20) + 1} / {Math.max(1, Math.ceil(page.total / 20))}
          </span>
          <Button
            icon={LuArrowRight}
            disabled={page.nextOffset === null}
            onClick={() => setOffset(page.nextOffset ?? 0)}
          >
            {t('tasks.next')}
          </Button>
        </footer>
      )}
    </section>
  );
}
