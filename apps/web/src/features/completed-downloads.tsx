import { useEffect, useState } from 'react';
import {
  LuArrowLeft,
  LuArrowRight,
  LuFolderOpen,
  LuFolderSync,
  LuPlay,
  LuSearch,
  LuTrash2,
  LuX,
} from 'react-icons/lu';

import type { DownloadTask, TaskPage } from '../../../shared/src/contracts';
import type { BusinessMessage } from '../../../shared/src/messages';
import { api } from '../api';
import { useToast } from '../components/toast';
import { TaskThumbnail } from '../components/task-thumbnail';
import {
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Input,
  PageHeading,
  StateDot,
} from '../components/ui';
import { t } from '../i18n';
import { displayMessage, message, messageFromError, type DisplayMessage } from '../messages';
import { playableArtifactIndex } from '../task-artifacts';

export function CompletedDownloads() {
  const toast = useToast();
  const [page, setPage] = useState<TaskPage>({ items: [], total: 0, offset: 0, nextOffset: null });
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DisplayMessage>('');
  const [busy, setBusy] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<DownloadTask[]>([]);
  const [deleteFailures, setDeleteFailures] = useState<(BusinessMessage & { title: string })[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true);
    const poll = async () => {
      try {
        const result = await api.tasks('library', query, offset, undefined, controller.signal);
        if (controller.signal.aborted) return;

        setPage(result);
        setSelected((current) => {
          const next = current.filter((id) => result.items.some((task) => task.id === id));
          return next.length === current.length ? current : next;
        });
        setError('');
        if (offset > 0 && !result.items.length) setOffset(0);
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

  async function syncDirectory() {
    setBusy('sync');
    try {
      const result = await api.syncDirectory();
      setOffset(0);
      setRevision((value) => value + 1);
      toast(
        message('tasks.directorySynced', {
          imported: result.imported,
          removed: result.removed,
          updated: result.updated,
        }),
        {
          tone: 'success',
          actions: result.backupId
            ? [
                {
                  label: message('tasks.undoRemoval'),
                  onClick: () => void undoRemoval(result.backupId!),
                },
              ]
            : undefined,
        },
      );
    } catch (failure) {
      toast(messageFromError(failure), { tone: 'error' });
    } finally {
      setBusy('');
    }
  }

  async function undoRemoval(backupId: string) {
    setBusy('sync');
    try {
      const result = await api.restoreHistory(backupId);
      setOffset(0);
      setRevision((value) => value + 1);
      toast(message('tasks.recordsRestored', { count: result.count }), { tone: 'success' });
    } catch (failure) {
      toast(messageFromError(failure), { tone: 'error' });
    } finally {
      setBusy('');
    }
  }

  async function open(task: DownloadTask, target: 'artifact' | 'task-folder', index = 0) {
    setBusy(task.id);
    try {
      await api.open(target, task.id, index);
    } catch (failure) {
      toast(messageFromError(failure), { tone: 'error' });
    } finally {
      setBusy('');
    }
  }

  async function deleteDownloads() {
    if (!confirmation.length || busy) return;
    setBusy('delete');
    setDeleteFailures([]);
    try {
      const result = await api.deleteDownloads(confirmation.map((task) => task.id));
      setSelected((current) => current.filter((id) => !result.removedTaskIds.includes(id)));
      setDeleteFailures(
        result.failures.map((failure) => ({
          ...failure,
          title:
            confirmation.find((task) => task.id === failure.taskId)?.media.title ?? failure.taskId,
        })),
      );
      toast(
        message('tasks.deleteResult', {
          files: result.deletedFiles,
          records: result.removedRecords,
          failed: result.failures.length,
        }),
        { tone: result.failures.length || result.cancelled ? 'error' : 'success' },
      );
      setConfirmation([]);
      setOffset(0);
    } catch (failure) {
      toast(messageFromError(failure), { tone: 'error' });
    } finally {
      setRevision((value) => value + 1);
      setBusy('');
    }
  }

  return (
    <section className="mv-feature">
      <PageHeading
        title={t('navigation.library')}
        description={t('tasks.completedDownloadsDescription')}
      >
        <Button
          icon={LuTrash2}
          disabled={!!busy || !selected.length}
          onClick={() => setConfirmation(page.items.filter((task) => selected.includes(task.id)))}
        >
          {t('tasks.deleteSelected', { count: selected.length })}
        </Button>
        <Button
          icon={LuFolderSync}
          disabled={!!busy}
          loading={busy === 'sync'}
          title={t('tasks.syncDirectoryHint')}
          onClick={() => void syncDirectory()}
        >
          {t('tasks.syncDirectory')}
        </Button>
      </PageHeading>
      <div
        className="mv-list-toolbar"
        role="search"
        aria-label={t('tasks.searchCompletedDownloads')}
      >
        <Input
          aria-label={t('tasks.searchCompletedDownloads')}
          placeholder={t('tasks.searchTitlesSitesOrLinks')}
          icon={<LuSearch size={16} />}
          value={query}
          onChange={(event) => {
            setSelected([]);
            setQuery(event.target.value);
            setOffset(0);
          }}
        />
        {query && (
          <Button
            icon={LuX}
            variant="ghost"
            aria-label={t('tasks.clearSearch')}
            title={t('tasks.clearSearch')}
            onClick={() => {
              setSelected([]);
              setQuery('');
              setOffset(0);
            }}
          />
        )}
        {!loading && (
          <span className="mv-muted mv-small">
            {t('tasks.downloadCount', { count: page.total })}
          </span>
        )}
      </div>
      {!loading && page.items.length > 0 && (
        <div className="mv-actions mv-list-toolbar">
          <Checkbox
            label={t('tasks.selectCurrentPage')}
            disabled={!!busy}
            checked={page.items.every((task) => selected.includes(task.id))}
            onChange={(checked) => setSelected(checked ? page.items.map((task) => task.id) : [])}
          />
          <span className="mv-muted mv-small">
            {t('tasks.selectedDownloads', { count: selected.length })}
          </span>
        </div>
      )}
      {deleteFailures.length > 0 && (
        <div className="mv-error" role="alert">
          {deleteFailures.map((failure, index) => (
            <p key={index}>
              {failure.title}：{displayMessage(failure)}
            </p>
          ))}
        </div>
      )}
      {error && (
        <p className="mv-error" role="alert">
          {displayMessage(error)}
        </p>
      )}
      <div className="mv-scroll mv-task-list">
        {loading ? (
          <div className="mv-empty">
            <StateDot state="ongoing" />
            <p>{t('tasks.loadingDownloadRecords')}</p>
          </div>
        ) : !page.items.length ? (
          <EmptyState
            icon={query.trim() ? LuSearch : LuFolderOpen}
            title={t(query.trim() ? 'tasks.noMatchingRecords' : 'tasks.libraryIsEmpty')}
          >
            {t(
              query.trim()
                ? 'tasks.noMatchingDownloadsHint'
                : 'tasks.completedDownloadsAreSavedHere',
            )}
          </EmptyState>
        ) : (
          page.items.map((task) => {
            const playableIndex = playableArtifactIndex(task);
            return (
              <article className="mv-task-row mv-completed-row" key={task.id}>
                <Checkbox
                  className="mv-task-select"
                  label={t('tasks.selectDownload', { title: task.media.title })}
                  checked={selected.includes(task.id)}
                  disabled={!!busy}
                  onChange={(checked) =>
                    setSelected((current) =>
                      checked ? [...current, task.id] : current.filter((id) => id !== task.id),
                    )
                  }
                />
                <TaskThumbnail task={task} revision={revision} />
                <div className="mv-task-content">
                  <strong className="mv-ellipsis" title={task.media.title}>
                    {task.media.title}
                  </strong>
                </div>
                <div className="mv-actions mv-task-actions">
                  {task.request.mode !== 'subtitle' && (
                    <Button
                      icon={LuPlay}
                      disabled={!!busy || playableIndex < 0}
                      aria-label={t('tasks.playTitle', { title: task.media.title })}
                      title={t(
                        playableIndex < 0 ? 'tasks.noPlayableFile' : 'tasks.openWithDefaultApp',
                      )}
                      onClick={() => void open(task, 'artifact', playableIndex)}
                    >
                      {t('tasks.play')}
                    </Button>
                  )}
                  <Button
                    icon={LuFolderOpen}
                    disabled={!!busy}
                    aria-label={t('tasks.openFolderTitle', { title: task.media.title })}
                    title={t('tasks.openTaskFolder')}
                    onClick={() => void open(task, 'task-folder')}
                  >
                    {t('tasks.openFolder')}
                  </Button>
                  <Button
                    icon={LuTrash2}
                    disabled={!!busy}
                    variant="ghost"
                    aria-label={t('tasks.deleteTitle', { title: task.media.title })}
                    title={t('tasks.permanentlyDelete')}
                    onClick={() => setConfirmation([task])}
                  />
                </div>
              </article>
            );
          })
        )}
      </div>
      {(offset > 0 || page.nextOffset !== null) && (
        <footer className="mv-pagination">
          <Button
            icon={LuArrowLeft}
            disabled={offset === 0}
            onClick={() => {
              setSelected([]);
              setOffset(Math.max(0, offset - 20));
            }}
          >
            {t('tasks.previous')}
          </Button>
          <span className="mv-muted mv-small">
            {Math.floor(offset / 20) + 1} / {Math.max(1, Math.ceil(page.total / 20))}
          </span>
          <Button
            icon={LuArrowRight}
            disabled={page.nextOffset === null}
            onClick={() => {
              setSelected([]);
              setOffset(page.nextOffset ?? 0);
            }}
          >
            {t('tasks.next')}
          </Button>
        </footer>
      )}
      {confirmation.length > 0 && (
        <Dialog
          title={t('tasks.deleteConfirmationTitle', { count: confirmation.length })}
          onClose={() => {
            if (!busy) setConfirmation([]);
          }}
        >
          <div className="mv-detail-stack">
            <p>{t('tasks.deleteConfirmationHint')}</p>
            <ul className="mv-delete-files">
              {confirmation.map((task) => (
                <li key={task.id}>
                  <strong className="mv-wrap">{task.media.title}</strong>
                  <p className="mv-muted mv-small mv-wrap">{task.outputDirectory}</p>
                  {task.artifacts.map((file) => (
                    <p className="mv-small mv-wrap" key={file.name}>
                      {file.name}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
            <div className="mv-actions">
              <Button disabled={!!busy} onClick={() => setConfirmation([])}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                loading={busy === 'delete'}
                disabled={!!busy && busy !== 'delete'}
                onClick={() => void deleteDownloads()}
              >
                {t('tasks.permanentlyDelete')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
