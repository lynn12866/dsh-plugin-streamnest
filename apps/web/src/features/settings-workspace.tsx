import { businessMessage } from '../../../shared/src/messages';
import { displayMessage, message, messageFromError, type DisplayMessage } from '../messages';
import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { LuCheck, LuDownload, LuFolderOpen, LuRefreshCw, LuSave, LuX } from 'react-icons/lu';

import type {
  Preferences,
  RuntimeInstall,
  RuntimeKind,
  RuntimeStatus,
} from '../../../shared/src/contracts';
import { api } from '../api';
import { pickDirectory, pickFile, pickBrowserAccounts } from '../native';
import { normalizeAcceleration } from '../../../shared/src/preferences';
import { browserAccountError } from '../../../shared/src/cookies';
import { browserSupportsProfiles } from '../../../shared/src/browser-profiles';
import type { BrowserProfileList } from '../../../shared/src/system';
import type { AccelerationSettings } from '../../../shared/src/contracts';
import { Button, Field, Input, PageHeading, Select, StateDot, Tag, bytes } from '../components/ui';
import { useToast } from '../components/toast';
import { OpenSourceAcknowledgements } from '../components/open-source-acknowledgements';

export function SettingsWorkspace() {
  const toast = useToast();
  const [preferences, setPreferences] = useState<Preferences>();
  const [runtime, setRuntime] = useState<RuntimeStatus>();
  const [installation, setInstallation] = useState<RuntimeInstall>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayMessage>('');
  const [profiles, setProfiles] = useState<BrowserProfileList>({
    profiles: [],
    ...businessMessage('NONE'),
  });
  const [profilesBusy, setProfilesBusy] = useState(false);
  const [profileRevision, setProfileRevision] = useState(0);
  const manualLogin = preferences?.cookieStrategy !== 'auto';
  const browser = manualLogin ? preferences?.cookieBrowser : undefined;
  const supportsProfiles = browserSupportsProfiles(browser ?? '');
  const selectableProfiles = profiles.profiles.filter((profile) => profile.id);
  const showProfileSelector =
    supportsProfiles && (!!selectableProfiles.length || !!preferences?.cookieProfile);
  useEffect(() => {
    let alive = true;
    setProfiles({ profiles: [], ...businessMessage('NONE') });
    if (!browser || !supportsProfiles) {
      setProfilesBusy(false);
      return;
    }
    setProfilesBusy(true);
    void api
      .browserProfiles(browser)
      .then((value) => {
        if (!alive) return;
        setProfiles(value);
        if (value.profiles.length === 1)
          setPreferences((current) =>
            current?.cookieBrowser === browser && !current.cookieProfile
              ? { ...current, cookieProfile: value.profiles[0]!.id }
              : current,
          );
      })
      .catch((failure: unknown) => {
        if (alive) {
          setProfiles({ profiles: [], ...businessMessage('NONE') });
          setError(messageFromError(failure));
        }
      })
      .finally(() => {
        if (alive) setProfilesBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [browser, supportsProfiles, profileRevision]);

  useEffect(() => {
    let alive = true;
    void api
      .preferences()
      .then((value) => {
        if (alive) setPreferences(value);
      })
      .catch((failure: unknown) => {
        if (alive) setError(messageFromError(failure));
      });
    void api
      .runtime()
      .then((value) => {
        if (alive) {
          setRuntime(value.status);
          setInstallation(value.installation);
        }
      })
      .catch((failure: unknown) => {
        if (alive) setError(messageFromError(failure));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (installation?.state !== 'installing') return;
    let alive = true;
    const timer = setInterval(() => {
      void api
        .runtime()
        .then((value) => {
          if (alive) {
            setRuntime(value.status);
            setInstallation(value.installation);
          }
        })
        .catch((failure: unknown) => {
          if (alive) setError(messageFromError(failure));
        });
    }, 1_500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [installation?.state]);

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences((current) => (current ? { ...current, [key]: value } : undefined));
  }

  function updateAcceleration(patch: Partial<AccelerationSettings>) {
    update('acceleration', { ...normalizeAcceleration(preferences?.acceleration), ...patch });
  }

  async function choose(kind: 'directory' | 'cookies' | 'aria2' | 'yt-dlp' | 'ffmpeg' | 'ffprobe') {
    try {
      const path = await (kind === 'directory' ? pickDirectory() : pickFile());
      if (!path) return;
      if (kind === 'directory') update('downloadDirectory', path);
      else if (kind === 'cookies') update('cookiesFile', path);
      else if (kind === 'aria2') updateAcceleration({ aria2Path: path });
      else update('binaryPaths', { ...preferences?.binaryPaths, [kind]: path });
    } catch (failure) {
      setError(messageFromError(failure));
    }
  }

  async function testProxy() {
    if (!preferences) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.proxyTest(preferences.proxy);
      toast(
        message(
          result.connected
            ? 'settings.proxy.connected'
            : result.status
              ? 'settings.proxy.httpStatus'
              : 'settings.proxy.failed',
          { status: result.status, latency: result.latencyMs },
        ),
        { tone: result.connected ? 'success' : 'error' },
      );
    } catch (failure) {
      setError(messageFromError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function allowProfiles() {
    if (!browser || !profiles.metadataPath) return;
    setProfilesBusy(true);
    setError('');
    try {
      const value = await pickBrowserAccounts(profiles.metadataPath);
      if (value)
        setProfiles(await api.importBrowserProfiles(browser, value.sourcePath, value.profiles));
    } catch (failure) {
      setError(messageFromError(failure));
    } finally {
      setProfilesBusy(false);
    }
  }

  async function save() {
    if (!preferences) return;
    const accountError = browserAccountError(preferences);

    if (accountError) {
      toast(message('settings.accountRequired'), { tone: 'error' });
      return;
    }
    setBusy(true);
    setError('');
    try {
      setPreferences(await api.updatePreferences(preferences));
      toast(message('settings.saved'), { tone: 'success' });
    } catch (failure) {
      toast(messageFromError(failure), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError('');
    try {
      const value = await api.runtime(true);
      setRuntime(value.status);
      setInstallation(value.installation);
    } catch (failure) {
      setError(messageFromError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function install(kinds: RuntimeKind[] = ['yt-dlp', 'ffmpeg', 'ffprobe'], force = false) {
    setBusy(true);
    setError('');
    try {
      setInstallation(await api.install(kinds, force));
    } catch (failure) {
      setError(messageFromError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mv-feature">
      <PageHeading title={t('navigation.settings')} description={t('settings.description')}>
        <Button
          icon={LuSave}
          variant="primary"
          loading={busy}
          disabled={!preferences}
          onClick={() => void save()}
        >
          {t('settings.saveSettings')}
        </Button>
      </PageHeading>
      <div className="mv-scroll mv-settings">
        {error && (
          <div role="alert" className="mv-error">
            {displayMessage(error)}
          </div>
        )}
        {preferences && (
          <>
            <section className="mv-settings-section">
              <Field label={t('settings.interfaceLanguage')}>
                {(id) => (
                  <Select
                    id={id}
                    value={preferences.language ?? 'system'}
                    disabled={busy}
                    onChange={(value) => update('language', value as Preferences['language'])}
                  >
                    <option value="system">{t('settings.followSystem')}</option>
                    <option value="zh-CN">{t('settings.language.chinese')}</option>
                    <option value="en-US">{t('settings.language.english')}</option>
                  </Select>
                )}
              </Field>
            </section>
            <section className="mv-settings-section">
              <h2>{t('settings.downloads')}</h2>
              <div className="mv-form-grid">
                <Field
                  label={t('settings.filenameTemplate')}
                  hint={t('settings.filenameTemplateHint')}
                >
                  {(id) => (
                    <Input
                      id={id}
                      value={preferences.filenameTemplate ?? ''}
                      disabled={busy}
                      onChange={(event) => update('filenameTemplate', event.target.value)}
                    />
                  )}
                </Field>
                <Field label={t('settings.defaultQuality')} hint={t('settings.qualityHint')}>
                  {(id) => (
                    <Select
                      id={id}
                      value={preferences.preferredQuality ?? 'best'}
                      disabled={busy}
                      onChange={(value) => update('preferredQuality', value)}
                    >
                      <option value="best">{t('settings.bestQuality')}</option>
                      {['2160', '1440', '1080', '720', '480', '360'].map((height) => (
                        <option key={height} value={height}>
                          {height}P
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t('settings.saveFolder')} hint={t('settings.downloadDirectoryHint')}>
                  {(id) => (
                    <div className="mv-link-row">
                      <Input
                        id={id}
                        value={preferences.downloadDirectory}
                        disabled={busy}
                        onChange={(event) => update('downloadDirectory', event.target.value)}
                      />
                      <Button
                        icon={LuFolderOpen}
                        disabled={busy}
                        onClick={() => void choose('directory')}
                      >
                        {t('common.choose')}
                      </Button>
                    </div>
                  )}
                </Field>
                <Field label={t('settings.concurrentDownloads')}>
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      max={4}
                      value={preferences.concurrency}
                      disabled={busy}
                      onChange={(event) => update('concurrency', Number(event.target.value))}
                    />
                  )}
                </Field>
                <Field label={t('settings.concurrentFragments')} hint={t('settings.fragmentsHint')}>
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      max={16}
                      value={preferences.fragments}
                      disabled={busy}
                      onChange={(event) => update('fragments', Number(event.target.value))}
                    />
                  )}
                </Field>
              </div>
            </section>
            <section className="mv-settings-section">
              <h2>{t('settings.downloadAcceleration')}</h2>
              <div className="mv-form-grid">
                <Field
                  label={t('settings.enableAcceleration')}
                  hint={t('settings.accelerationHint')}
                >
                  {(id) => (
                    <Select
                      id={id}
                      value={String(normalizeAcceleration(preferences.acceleration).enabled)}
                      disabled={busy}
                      onChange={(value) => updateAcceleration({ enabled: value === 'true' })}
                    >
                      <option value="true">{t('common.enable')}</option>
                      <option value="false">{t('common.close')}</option>
                    </Select>
                  )}
                </Field>
                <Field
                  label={t('settings.maximumConnections')}
                  hint={t('settings.connectionsHint')}
                >
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      max={16}
                      value={normalizeAcceleration(preferences.acceleration).maxConnections}
                      disabled={busy}
                      onChange={(event) =>
                        updateAcceleration({ maxConnections: Number(event.target.value) })
                      }
                    />
                  )}
                </Field>
                <Field label={t('settings.aria2Path')} hint={t('settings.aria2PathHint')}>
                  {(id) => (
                    <div className="mv-link-row">
                      <Input
                        id={id}
                        value={preferences.acceleration?.aria2Path ?? ''}
                        disabled={busy}
                        onChange={(event) => updateAcceleration({ aria2Path: event.target.value })}
                      />
                      <Button
                        icon={LuFolderOpen}
                        disabled={busy}
                        onClick={() => void choose('aria2')}
                      >
                        {t('common.choose')}
                      </Button>
                    </div>
                  )}
                </Field>
              </div>
            </section>
            <section className="mv-settings-section">
              <div className="mv-section-heading">
                <h2>{t('settings.networkAndLogin')}</h2>
              </div>
              <div className="mv-form-grid">
                <Field label={t('settings.proxyAddress')} hint={t('settings.proxyHint')}>
                  {(id) => (
                    <div className="mv-link-row">
                      <Input
                        id={id}
                        placeholder="http://127.0.0.1:7890"
                        value={preferences.proxy}
                        disabled={busy}
                        onChange={(event) => update('proxy', event.target.value)}
                      />
                      <Button disabled={busy} onClick={() => void testProxy()}>
                        {t('settings.testConnection')}
                      </Button>
                    </div>
                  )}
                </Field>
                <Field label={t('settings.loginSource')} hint={t('settings.loginSourceHint')}>
                  {(id) => (
                    <Select
                      id={id}
                      value={preferences.cookieStrategy ?? 'selected'}
                      disabled={busy}
                      onChange={(value) => update('cookieStrategy', value as 'selected' | 'auto')}
                    >
                      <option value="selected">{t('settings.selectSourceManually')}</option>
                      <option value="auto">{t('settings.tryBrowsersAutomatically')}</option>
                    </Select>
                  )}
                </Field>
                {manualLogin && (
                  <>
                    <Field
                      label={t('settings.browserCookies')}
                      hint={t(
                        !browser
                          ? 'settings.noBrowserHint'
                          : supportsProfiles
                            ? 'settings.selectedAccountHint'
                            : 'settings.safariHint',
                      )}
                    >
                      {(id) => (
                        <Select
                          id={id}
                          value={preferences.cookieBrowser}
                          disabled={busy}
                          onChange={(value) => {
                            setProfiles({ profiles: [], ...businessMessage('NONE') });
                            setPreferences((current) =>
                              current
                                ? {
                                    ...current,
                                    cookieBrowser: value as Preferences['cookieBrowser'],
                                    cookieProfile: '',
                                  }
                                : current,
                            );
                          }}
                        >
                          <option value="">{t('settings.disabled')}</option>
                          <option value="chrome">Chrome</option>
                          <option value="edge">Edge</option>
                          <option value="firefox">Firefox</option>
                          <option value="safari">Safari</option>
                          <option value="brave">Brave</option>
                          <option value="chromium">Chromium</option>
                        </Select>
                      )}
                    </Field>
                    {showProfileSelector && (
                      <Field label={t('settings.browserAccount')} hint={t('settings.accountHint')}>
                        {(id) => (
                          <div className="mv-detail-stack">
                            <div className="mv-link-row">
                              <Select
                                id={id}
                                value={preferences.cookieProfile ?? ''}
                                disabled={
                                  busy ||
                                  profilesBusy ||
                                  !browser ||
                                  preferences.cookieStrategy === 'auto'
                                }
                                onChange={(value) => update('cookieProfile', value)}
                              >
                                <option value="">
                                  {t(
                                    profilesBusy
                                      ? 'settings.loadingBrowserAccounts'
                                      : browser
                                        ? 'settings.selectABrowserAccount'
                                        : 'settings.selectABrowserFirst',
                                  )}
                                </option>
                                {selectableProfiles.map((profile) => (
                                  <option key={profile.id} value={profile.id}>
                                    {profile.label}
                                  </option>
                                ))}
                                {!!preferences.cookieProfile &&
                                  !profiles.profiles.some(
                                    (profile) => profile.id === preferences.cookieProfile,
                                  ) && (
                                    <option value={preferences.cookieProfile}>
                                      {t('settings.savedAccountCurrentlyUnavailable')}
                                    </option>
                                  )}
                              </Select>
                              <Button
                                icon={LuRefreshCw}
                                title={t('settings.refreshBrowserAccounts')}
                                aria-label={t('settings.refreshBrowserAccounts')}
                                disabled={busy || profilesBusy || !browser}
                                onClick={() => setProfileRevision((value) => value + 1)}
                              />
                            </div>
                          </div>
                        )}
                      </Field>
                    )}
                    {!!browser && supportsProfiles && (
                      <div className="mv-detail-stack">
                        {profilesBusy && (
                          <span className="mv-muted mv-small">
                            {t('settings.loadingBrowserAccounts')}
                          </span>
                        )}
                        {profiles.permissionRequired && profiles.metadataPath && (
                          <div className="mv-detail-stack">
                            <span className="mv-muted mv-small">
                              {t('settings.accountFileHint')}
                            </span>
                            <code className="mv-wrap mv-small">{profiles.metadataPath}</code>
                            <div className="mv-actions">
                              <Button disabled={profilesBusy} onClick={() => void allowProfiles()}>
                                {t(
                                  profiles.profiles.length
                                    ? 'settings.readAccountListAgain'
                                    : 'settings.allowReadingAccountList',
                                )}
                              </Button>
                              <Button
                                disabled={profilesBusy}
                                onClick={() =>
                                  void navigator.clipboard.writeText(profiles.metadataPath!)
                                }
                              >
                                {t('settings.copyConfigurationPath')}
                              </Button>
                            </div>
                          </div>
                        )}
                        {profiles.message && (
                          <span className="mv-muted mv-small">{displayMessage(profiles)}</span>
                        )}
                        {!showProfileSelector && !profilesBusy && (
                          <div className="mv-actions">
                            <Button
                              icon={LuRefreshCw}
                              disabled={busy}
                              onClick={() => setProfileRevision((value) => value + 1)}
                            >
                              {t('settings.refreshBrowserAccounts')}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                    <Field
                      label={t('settings.cookieFileOptional')}
                      hint={t('settings.cookieFileHint')}
                    >
                      {(id) => (
                        <div className="mv-link-row">
                          <Input
                            id={id}
                            value={preferences.cookiesFile}
                            disabled={busy}
                            onChange={(event) => update('cookiesFile', event.target.value)}
                          />
                          <Button
                            icon={LuFolderOpen}
                            disabled={busy}
                            onClick={() => void choose('cookies')}
                          >
                            {t('common.choose')}
                          </Button>
                          {preferences.cookiesFile && (
                            <Button
                              icon={LuX}
                              aria-label={t('settings.clearCookieFileSetting')}
                              disabled={busy}
                              onClick={() => update('cookiesFile', '')}
                            />
                          )}
                        </div>
                      )}
                    </Field>
                  </>
                )}
              </div>
            </section>
            <section className="mv-settings-section">
              <div className="mv-section-heading">
                <h2>{t('settings.runtimeDependencies')}</h2>
                <div className="mv-actions">
                  <Button icon={LuRefreshCw} disabled={busy} onClick={() => void refresh()}>
                    {t('diagnostics.checkAgain')}
                  </Button>
                  <Button
                    icon={LuDownload}
                    disabled={busy || installation?.state === 'installing'}
                    onClick={() => void install()}
                  >
                    {t('settings.installMissingTools')}
                  </Button>
                </div>
              </div>
              <p className="mv-muted">{t('settings.runtimeDownloadHint')}</p>
              <div className="mv-runtime-list">
                {(['yt-dlp', 'ffmpeg', 'ffprobe'] as const).map((kind) => {
                  const status = runtime?.results.find((entry) => entry.kind === kind);
                  return (
                    <div className="mv-runtime-row" key={kind}>
                      <div className="mv-section-heading">
                        <strong>{kind}</strong>
                        <Tag tone={status?.found ? 'success' : 'warning'}>
                          {status?.found ? (
                            <>
                              <LuCheck size={12} />
                              {t('common.ready')}
                            </>
                          ) : status ? (
                            t('common.notFound')
                          ) : (
                            t('settings.checking')
                          )}
                        </Tag>
                      </div>
                      <p className="mv-muted mv-small mv-wrap">
                        {status?.found
                          ? `${status.version ?? ''} · ${status.path ?? ''}`
                          : status?.reasonInfo
                            ? displayMessage(status.reasonInfo)
                            : (status?.reason ?? t('settings.checkingLocalTools'))}
                      </p>
                      {status && (!status.found || status.stale) && (
                        <Button
                          icon={LuDownload}
                          disabled={busy || installation?.state === 'installing'}
                          onClick={() => void install([kind], !!status.stale)}
                        >
                          {status.stale
                            ? t('settings.updateTool', {
                                version: status.requiredVersion ?? t('settings.managedVersion'),
                              })
                            : t('settings.installTool', { tool: kind })}
                        </Button>
                      )}
                      {status?.found && status.requiredVersion && (
                        <p className="mv-muted mv-small">
                          {status.managed
                            ? t('settings.managedVersionReady')
                            : t('settings.usingSystemVersion')}
                          {t('settings.manifestVersion')} {status.requiredVersion}
                        </p>
                      )}
                      <Field label={t('settings.toolPath', { tool: kind })}>
                        {(id) => (
                          <div className="mv-link-row">
                            <Input
                              id={id}
                              placeholder={t('settings.leaveBlankForAutomaticDetection')}
                              value={preferences.binaryPaths[kind] ?? ''}
                              disabled={busy}
                              onChange={(event) =>
                                update('binaryPaths', {
                                  ...preferences.binaryPaths,
                                  [kind]: event.target.value,
                                })
                              }
                            />
                            <Button
                              icon={LuFolderOpen}
                              disabled={busy}
                              onClick={() => void choose(kind)}
                            >
                              {t('common.choose')}
                            </Button>
                          </div>
                        )}
                      </Field>
                    </div>
                  );
                })}
              </div>
              {installation && installation.state !== 'idle' && (
                <div
                  role="status"
                  className={installation.state === 'failed' ? 'mv-error' : 'mv-notice'}
                >
                  <div className="mv-actions">
                    {installation.state === 'installing' && <StateDot state="ongoing" />}
                    <span className="mv-wrap">{displayMessage(installation)}</span>
                    {installation.state === 'installing' && (
                      <Button
                        icon={LuX}
                        variant="ghost"
                        onClick={() =>
                          void api
                            .cancelInstall()
                            .then(setInstallation)
                            .catch((failure: unknown) => setError(messageFromError(failure)))
                        }
                      >
                        {t('settings.cancelInstallation')}
                      </Button>
                    )}
                  </div>
                  {installation.total > 0 && (
                    <p className="mv-small">
                      {bytes(installation.downloaded)} / {bytes(installation.total)}
                    </p>
                  )}
                </div>
              )}
            </section>
          </>
        )}
        <OpenSourceAcknowledgements />
      </div>
    </section>
  );
}
