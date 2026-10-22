import { useState } from 'react';
import { LuCaptions, LuClapperboard, LuMusic2 } from 'react-icons/lu';

import type { DownloadTask } from '../../../shared/src/contracts';
import { taskThumbnailPath } from '../../../shared/src/thumbnail';

export function TaskThumbnail({ task, revision }: { task: DownloadTask; revision: number }) {
  const [failed, setFailed] = useState('');
  const source = `${taskThumbnailPath(task.id)}?v=${encodeURIComponent(`${task.updatedAt}:${revision}`)}`;
  const Icon =
    task.request.mode === 'audio'
      ? LuMusic2
      : task.request.mode === 'subtitle'
        ? LuCaptions
        : LuClapperboard;

  return (
    <div className="mv-task-thumbnail mv-cover-placeholder" aria-hidden>
      {task.request.mode === 'video' && source !== failed ? (
        <img
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(source)}
        />
      ) : (
        <Icon size={24} />
      )}
    </div>
  );
}
