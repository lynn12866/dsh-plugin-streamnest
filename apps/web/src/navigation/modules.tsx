import type { TranslationKey } from '../i18n';
import {
  LuArrowDownToLine,
  LuFolderOpen,
  LuListVideo,
  LuSettings2,
  LuStethoscope,
} from 'react-icons/lu';
import type { IconType } from 'react-icons';
import type { ReactNode } from 'react';

import { ParseWorkspace } from '../features/parse-workspace';
import { TasksWorkspace } from '../features/tasks-workspace';
import { CompletedDownloads } from '../features/completed-downloads';
import { SettingsWorkspace } from '../features/settings-workspace';
import { DiagnosticsWorkspace } from '../features/diagnostics-workspace';

export type PageId = 'download' | 'queue' | 'library' | 'settings' | 'diagnostics';
export const NAVIGATION: {
  id: PageId;
  label: TranslationKey;
  group: 'navigation.media' | 'navigation.preferences';
  icon: IconType;
  render: (navigate: (page: PageId) => void) => ReactNode;
}[] = [
  {
    id: 'download',
    label: 'navigation.download',
    group: 'navigation.media',
    icon: LuArrowDownToLine,
    render: (navigate) => <ParseWorkspace onQueue={() => navigate('queue')} />,
  },
  {
    id: 'queue',
    label: 'navigation.queue',
    group: 'navigation.media',
    icon: LuListVideo,
    render: () => <TasksWorkspace />,
  },
  {
    id: 'library',
    label: 'navigation.library',
    group: 'navigation.media',
    icon: LuFolderOpen,
    render: () => <CompletedDownloads />,
  },
  {
    id: 'settings',
    label: 'navigation.settings',
    group: 'navigation.preferences',
    icon: LuSettings2,
    render: () => <SettingsWorkspace />,
  },
  {
    id: 'diagnostics',
    label: 'navigation.diagnostics',
    group: 'navigation.preferences',
    icon: LuStethoscope,
    render: () => <DiagnosticsWorkspace />,
  },
];
