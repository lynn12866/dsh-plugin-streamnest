import type { Plugin } from 'vite';

export const harnessInputStyle: string;
export function readHarnessThemeCSS(): Promise<string>;
export function harnessPreviewTheme(): Plugin;
