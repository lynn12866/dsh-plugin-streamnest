import { afterEach, describe, expect, it, vi } from 'vitest';

import chinese from '../../web/src/locale/zh.json';
import english from '../../web/src/locale/en.json';
import { resolvedLanguage, setLanguage, t } from '../../web/src/i18n.js';
import {
  displayMessage,
  LocalizedError,
  message,
  messageFromError,
} from '../../web/src/messages.js';

const placeholders = (template: string) =>
  [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

afterEach(() => {
  setLanguage('system');
  vi.unstubAllGlobals();
});

describe('稳定 key 词库', () => {
  it('中英文词条完整对应，并保留相同的插值参数', () => {
    expect(Object.keys(english).sort()).toEqual(Object.keys(chinese).sort());
    for (const key of Object.keys(chinese) as (keyof typeof chinese)[]) {
      expect(key).toMatch(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/);
      expect(chinese[key].trim()).not.toBe('');
      expect(english[key].trim()).not.toBe('');
      expect(placeholders(english[key]), key).toEqual(placeholders(chinese[key]));
    }
  });
});

describe('界面语言切换', () => {
  it('跟随宿主语言，并支持显式覆盖和恢复跟随', () => {
    vi.stubGlobal('document', { documentElement: { lang: 'en-US' } });
    expect(resolvedLanguage()).toBe('en-US');
    expect(t('navigation.library')).toBe('Completed downloads');

    setLanguage('zh-CN');
    expect(t('navigation.library')).toBe('已完成下载');
    vi.stubGlobal('document', { documentElement: { lang: 'en-US' } });
    expect(resolvedLanguage()).toBe('zh-CN');

    setLanguage('system');
    expect(resolvedLanguage()).toBe('en-US');
    vi.stubGlobal('document', { documentElement: { lang: 'zh-TW' } });
    expect(resolvedLanguage()).toBe('zh-CN');
  });

  it('宿主语言为空时跟随浏览器语言，其他语言回退英文', () => {
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    expect(resolvedLanguage()).toBe('zh-CN');
    vi.stubGlobal('navigator', { language: 'fr-FR' });
    expect(resolvedLanguage()).toBe('en-US');
  });

  it('提示与错误保留 key 和参数，切换语言后重新渲染', () => {
    const notice = message('tasks.recordsRestored', { count: 3 });
    const error = messageFromError(new LocalizedError('clipboard.invalidMediaLink'));
    setLanguage('zh-CN');
    expect(displayMessage(notice)).toBe('已恢复 3 条记录。');
    expect(displayMessage(error)).toBe('剪贴板中没有可用的 HTTP(S) 媒体链接。');

    setLanguage('en-US');
    expect(displayMessage(notice)).toBe('Restored 3 records.');
    expect(displayMessage(error)).toBe('No valid HTTP(S) media link found on the clipboard.');
  });
});

describe('参数和原始数据', () => {
  it('原样插入路径、媒体标题和特殊字符，支持数字零及缺少参数', () => {
    setLanguage('en-US');
    const name = '/视频/媒体库 {title} $& <原片>.mp4';
    expect(t('files.open', { name })).toBe(`Open ${name}`);
    expect(t('tasks.recordsRestored', { count: 0 })).toBe('Restored 0 records.');
    expect(t('tasks.recordsRestored')).toBe('Restored {count} records.');
    expect(t('settings.proxy.httpStatus', { status: 403, latency: 0 })).toBe(
      'Target returned HTTP 403 · 0 ms',
    );
  });

  it('原始诊断和用户文本不做反向查找或整句翻译', () => {
    const text = '媒体库 原片 01\nOpen /视频/媒体库.mp4';
    setLanguage('en-US');
    expect(displayMessage(text)).toBe(text);
    setLanguage('zh-CN');
    expect(displayMessage('Media library')).toBe('Media library');
    expect(displayMessage(messageFromError(new Error(text)))).toBe(text);
  });
});
