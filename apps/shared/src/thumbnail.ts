import { API_PREFIX } from './contracts.js';

export function isRefererThumbnail(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      /(^|\.)(hdslb\.com|biliimg\.com)$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}

export const thumbnailPath = (id: string) => `${API_PREFIX}/media/${id}/thumbnail`;
export const taskThumbnailPath = (id: string) => `${API_PREFIX}/tasks/${id}/thumbnail`;
