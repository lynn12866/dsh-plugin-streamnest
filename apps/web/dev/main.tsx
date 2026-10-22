import { t, useLanguage } from '../src/i18n';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LuMoon, LuSun } from 'react-icons/lu';

import { App } from '../src/app';
import { Button } from '../src/components/ui';

import 'virtual:harness-theme.css';
import '../src/styles.css';
import 'virtual:harness-compact-input.css';
import './preview.css';

function Preview() {
  const locale = useLanguage();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.title = t('preview.documentTitle');
  }, [locale]);
  useEffect(() => {
    document.body.toggleAttribute('data-ds-dark-theme', dark);
    return () => document.body.removeAttribute('data-ds-dark-theme');
  }, [dark]);
  return (
    <div className="preview-shell">
      <div className="preview-toolbar">
        <span>{t('preview.title')}</span>
        <Button icon={dark ? LuSun : LuMoon} onClick={() => setDark(!dark)}>
          {t(dark ? 'preview.lightMode' : 'preview.darkMode')}
        </Button>
      </div>
      <div className="preview-content">
        <App />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
