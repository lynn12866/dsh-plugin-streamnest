import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function getChromiumPath(): string | null {
  const platform = process.platform;

  if (platform === 'win32') {
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const p of chromePaths) {
      if (fs.existsSync(p)) return p;
    }
    const edgePaths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    for (const p of edgePaths) {
      if (fs.existsSync(p)) return p;
    }
  } else if (platform === 'darwin') {
    const chromePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(
        os.homedir(),
        'Applications',
        'Google Chrome.app',
        'Contents',
        'MacOS',
        'Google Chrome',
      ),
    ];
    for (const p of chromePaths) {
      if (fs.existsSync(p)) return p;
    }
    const edgePaths = ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
    for (const p of edgePaths) {
      if (fs.existsSync(p)) return p;
    }
  } else if (platform === 'linux') {
    const chromePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ];
    for (const p of chromePaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

// 已安装且 yt-dlp 可读取 cookie 的浏览器（跨平台，按优先级排序）
export function getInstalledBrowsers(): string[] {
  const platform = process.platform;
  const found: string[] = [];
  const add = (name: string, paths: string[]) => {
    if (!found.includes(name) && paths.some((p) => fs.existsSync(p))) found.push(name);
  };

  if (platform === 'win32') {
    const local = path.join(os.homedir(), 'AppData', 'Local');
    add('chrome', [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]);
    add('edge', [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]);
    add('firefox', [
      path.join(local, 'Mozilla Firefox', 'firefox.exe'),
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
    ]);
    add('brave', [
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ]);
  } else if (platform === 'darwin') {
    add('chrome', ['/Applications/Google Chrome.app']);
    add('edge', ['/Applications/Microsoft Edge.app']);
    add('safari', ['/Applications/Safari.app']);
    add('firefox', ['/Applications/Firefox.app']);
    add('brave', ['/Applications/Brave Browser.app']);
  } else if (platform === 'linux') {
    add('chrome', ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']);
    add('chromium', ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/snap/bin/chromium']);
    add('firefox', ['/usr/bin/firefox', '/snap/bin/firefox']);
    add('edge', ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable']);
    add('brave', ['/usr/bin/brave-browser', '/usr/bin/brave']);
  }

  return found;
}

// 获取首选浏览器名称（跨平台）
export function getAvailableBrowser(): string {
  return getInstalledBrowsers()[0] || '';
}
