import { useEffect, useState } from 'react';
import { LuPanelLeftClose, LuPanelLeftOpen } from 'react-icons/lu';

import { Button } from './components/ui';
import { StreamMark } from './components/stream-mark';
import { BRAND } from '../../shared/src/brand';
import { NAVIGATION, type PageId } from './navigation/modules';
import { NativeInteractions } from './components/native-interactions';
import { ToastProvider } from './components/toast';
import { api } from './api';
import { t, useLanguage } from './i18n';

export function App() {
  const locale = useLanguage();
  const [page, setPage] = useState<PageId>('download');
  const [collapsed, setCollapsed] = useState(false);
  const active = NAVIGATION.find((entry) => entry.id === page)!;
  useEffect(() => {
    const read = () => void api.preferences().catch(() => undefined);
    read();
    const timer = setInterval(read, 10_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <ToastProvider>
      <div className="mv-panel" lang={locale}>
        <NativeInteractions />
        <div className="mv-shell" data-collapsed={collapsed}>
          <aside className="mv-navigation" aria-label={t('navigation.streamNestMenu')}>
            <header className="mv-navigation-header" data-window-drag>
              <span className="mv-brand">
                <StreamMark size={20} />
                <strong>{t('brand.name')}</strong>
              </span>
              <Button
                variant="ghost"
                icon={collapsed ? LuPanelLeftOpen : LuPanelLeftClose}
                aria-label={t(collapsed ? 'navigation.expandMenu' : 'navigation.collapseMenu')}
                aria-expanded={!collapsed}
                aria-controls="mv-navigation"
                onClick={() => setCollapsed(!collapsed)}
              />
            </header>
            <nav id="mv-navigation" aria-label={t('navigation.streamNestNavigation')}>
              {(['navigation.media', 'navigation.preferences'] as const).map((group) => (
                <section className="mv-navigation-group" key={group}>
                  <h2 className="mv-navigation-label">{t(group)}</h2>
                  {NAVIGATION.filter((entry) => entry.group === group).map((entry) => (
                    <Button
                      className="mv-navigation-item"
                      key={entry.id}
                      icon={entry.icon}
                      variant="ghost"
                      aria-label={t(entry.label)}
                      title={t(entry.label)}
                      aria-current={entry.id === page ? 'page' : undefined}
                      onClick={() => setPage(entry.id)}
                    >
                      <span className="mv-navigation-text">{t(entry.label)}</span>
                    </Button>
                  ))}
                </section>
              ))}
            </nav>
            <footer
              className="mv-navigation-footer"
              aria-label={t('navigation.streamNestWorkspaceInformation')}
            >
              <span className="mv-navigation-footer-mark" title={BRAND.englishName} aria-hidden>
                <StreamMark size={20} />
              </span>
              <div className="mv-navigation-footer-copy">
                <span className="mv-navigation-footer-title">{BRAND.englishName}</span>
                <span className="mv-navigation-footer-description">
                  {t('navigation.storedLocally')}
                </span>
              </div>
            </footer>
          </aside>
          <main className="mv-feature-content" aria-label={t(active.label)}>
            {active.render(setPage)}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
