import type { DownloadTask } from './contracts.js';

const extensions = {
  video: /\.(?:mp4|m4v|mkv|webm|mov|avi|flv|mpeg|mpg|ts|m2ts|wmv|ogv|3gp)$/i,
  audio: /\.(?:mp3|m4a|aac|flac|wav|ogg|opus|wma|aiff|alac)$/i,
};

export function mediaFileMode(name: string): 'video' | 'audio' | undefined {
  if (extensions.video.test(name)) return 'video';
  if (extensions.audio.test(name)) return 'audio';
  return undefined;
}

export function playableArtifactIndex(task: Pick<DownloadTask, 'request' | 'artifacts'>): number {
  if (task.request.mode === 'subtitle') return -1;

  return task.artifacts.findIndex(
    (file) => file.exists !== false && mediaFileMode(file.name) === task.request.mode,
  );
}
