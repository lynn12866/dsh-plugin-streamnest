import { LocalizedError } from './messages';
import { chromiumProfiles } from '../../shared/src/browser-profiles';
import { extractMediaLink } from '../../shared/src/links';

declare global {
  interface Window {
    __DSH_DIRECTORY_PICKER__?: { pick(): Promise<string | null> };
    __DSH_HOST_PATHS__?: { pathFor(file: File): string };
  }
}

export async function pickDirectory(): Promise<string | undefined> {
  if (!window.__DSH_DIRECTORY_PICKER__) throw new LocalizedError('native.folderPickerUnavailable');
  return (await window.__DSH_DIRECTORY_PICKER__.pick()) ?? undefined;
}

function chooseNativeFile(): Promise<File | undefined> {
  if (!window.__DSH_HOST_PATHS__)
    return Promise.reject(new LocalizedError('native.filePathUnavailable'));
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    input.addEventListener(
      'cancel',
      () => {
        input.remove();
        resolve(undefined);
      },
      { once: true },
    );
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0];
        input.remove();
        resolve(file);
      },
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  });
}

export async function pickFile(): Promise<string | undefined> {
  const file = await chooseNativeFile();
  return file ? window.__DSH_HOST_PATHS__!.pathFor(file) : undefined;
}

export async function pickBrowserAccounts(expectedPath: string) {
  const file = await chooseNativeFile();
  if (!file) return;
  const sourcePath = window.__DSH_HOST_PATHS__!.pathFor(file);
  if (sourcePath !== expectedPath || file.name !== 'Local State' || file.size > 5 * 1024 * 1024)
    throw new LocalizedError('native.invalidAccountFile');
  const profiles = chromiumProfiles(await file.text());
  return { sourcePath, profiles };
}

export async function clipboardLink(): Promise<string> {
  const value = extractMediaLink(await navigator.clipboard.readText());
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LocalizedError('clipboard.invalidMediaLink');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new LocalizedError('clipboard.invalidMediaLink');
  return url.href;
}
