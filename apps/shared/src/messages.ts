import type { ParseErrorKind } from './parse-errors.js';

/** Stable business identifiers. Messages are a fallback for older/unknown clients. */
export const BUSINESS_MESSAGES = {
  RUNTIME_ARCHIVE_INVALID: '安装包格式无效或不包含安全的可执行文件，旧工具已保留。',
  RUNTIME_ARCHIVE_ENTRY_MISSING: '安装包中缺少 {entry}，旧工具已保留。',
  RUNTIME_VERSION_MISMATCH: '{kind} 版本不符：需要 {expected}，实际为 {actual}；旧工具已保留。',
  TASK_FAILED_UNKNOWN: '下载失败。',
  PARSE_WECHAT_RESOLVED: '视频号分享链接已通过腾讯元宝解析。',
  HTTP_ONLY: '只支持 HTTP(S) 请求。',
  RESPONSE_TIMEOUT: '网络请求响应超时。',
  CONNECTION_TIMEOUT: '网络连接超时。',
  TOO_MANY_REDIRECTS: '网络重定向次数过多。',
  PROCESS_TIMEOUT: '运行超时，请检查网络或运行依赖。',
  PROCESS_OUTPUT_LIMIT: '解析结果超过 8 MB，已停止进程。',
  DOWNLOAD_INCOMPLETE: '下载数据不完整',
  HTTP_RANGE_OVERFLOW: '分段数据超出请求范围',
  SEGMENT_INCOMPLETE: '分段数据不完整',
  FILE_WRITE_FAILED: '文件写入失败',
  DOWNLOAD_TIMEOUT: '下载连接读取超时',
  THUMBNAIL_CANCELLED: '图片请求已取消。',
  PARSE_CANCELLED: '解析已取消。',
  MEDIA_URL_INVALID: '请输入完整的 HTTP 或 HTTPS 媒体链接。',
  MEDIA_URL_CREDENTIALS: '仅支持不含账号密码的 HTTP 或 HTTPS 链接。',
  MEDIA_URL_PUBLIC_REQUIRED: '媒体链接必须指向公开网站。',
  MEDIA_URL_PRIVATE: '不支持本机或内网媒体链接。',
  LIVE_UNSUPPORTED: '暂不支持正在直播的媒体，请使用已结束的回放。',
  PARSE_RUNTIME_UNAVAILABLE:
    '[[parse-error:runtime-unavailable]]YouTube 解析需要可运行的 Node.js 22+ 或 Deno 2.3+。',
  WECHAT_FORMAT_UNAVAILABLE: '视频号没有可用的所选视频格式。',
  ARIA2_RESUME_REQUIRED:
    '此任务使用 aria2 片段，请安装或重新指定 aria2 后继续，避免混用不兼容的断点。',
  OUTPUT_PATH_ESCAPE: '文件名模板生成了下载目录外的路径。',
  WECHAT_VIDEO_TRACK_MISSING: '视频号下载文件没有可播放的视频轨道。',
  FILENAME_TEMPLATE_INVALID: '文件名模板必须是下载目录内的相对模板，不能包含父目录或控制字符。',
  ARIA2_PATH_INVALID: 'aria2 路径必须为本机绝对路径。',
  BROWSER_PROFILE_INVALID: '浏览器配置目录只支持 Default、Profile 4 等目录名。',
  DOWNLOAD_DIRECTORY_INVALID: '下载目录必须为本机绝对路径。',
  DIRECTORY_SYNC_FAILED: '无法同步下载目录，记录未改动：{reason}',
  DIRECTORY_SYNC_LIMIT: '目录条目超过 50000 个，请缩小下载目录后重试；记录未改动。',
  DIRECTORY_SYNC_CANCELLED: '目录同步已取消。',
  DELETE_CONFIRM_REQUIRED: '请再次确认永久删除所选下载文件，此操作无法撤销。',
  DELETE_COMPLETED_ONLY: '只能删除已完成下载的文件。',
  DELETE_PATH_UNSAFE: '文件路径越界、包含符号链接或不是普通文件，未删除。',
  DELETE_FILE_SHARED: '文件被其他未选中的下载记录或活动任务使用，未删除。',
  DELETE_FAILED: '文件删除失败，记录已保留：{reason}',
  DELETE_CANCELLED: '已停止删除；已删除文件的记录仍会同步。',
  DELETE_SYNC_FAILED: '已删除 {deleted} 个文件，但记录更新失败，请重试或同步目录：{reason}',
  DEPENDENCY_PATH_INVALID: 'Cookie 和运行依赖路径必须为本机绝对路径。',
  PROXY_INVALID: '代理地址无效。',
  PROXY_UNSUPPORTED: '代理仅支持 HTTP(S) / SOCKS5，暂不支持地址内凭据。',
  COOKIE_FILE_TOO_LARGE: 'Cookie 文件必须小于 10 MB。',
  COOKIE_FILE_FORMAT_INVALID:
    '请选择已导出的 Netscape 格式 cookies.txt，浏览器内部的 Cookies 数据库无法导入。也可以清空此项，直接选择浏览器账号。',
  PAGINATION_INVALID: '分页参数无效：limit 为 1–100，offset 为非负整数。',
  TASK_SCOPE_INVALID: 'scope 无效。',
  TASK_NOT_FOUND: '下载任务不存在。',
  TASK_LIMIT: '已达到 5000 条任务上限，请先备份并整理数据。',
  PARSE_EXPIRED: '解析结果已过期，请重新解析链接。',
  FORMAT_NOT_FOUND: '所选格式不存在。',
  AUDIO_TRACK_NOT_FOUND: '所选音轨不存在。',
  SUBTITLE_NOT_FOUND: '所选字幕语言不存在。',
  AUDIO_FORMAT_NOT_FOUND: '所选音频格式不存在。',
  SUBTITLE_REQUIRED: '请选择至少一种字幕语言。',
  TASK_DUPLICATE: '相同下载任务已在队列中。',
  TASK_ACTION_INVALID: '当前任务状态不支持此操作。',
  TASK_STOPPED: '任务已停止。',
  TASK_ARCHIVE_ACTIVE: '请先完成或取消任务，再归档。',
  TASK_REMOVE_ACTIVE: '请先取消任务，或明确选择停止并移除。',
  TASK_REMOVED: '任务已停止并移除。',
  TASK_RESTORE_LIMIT: '恢复后会超过 5000 条记录上限。',
  DOWNLOAD_OUTPUT_MISSING: '下载未生成可用文件，请检查字幕或格式选择。',
  ARTIFACT_NOT_FOUND: '媒体文件不存在。',
  ARTIFACT_PATH_ESCAPE: '媒体文件路径越界。',
  ARTIFACT_MOVED: '媒体文件已移动。',
  PLUGIN_STOPPING: '插件正在关闭。',
  BROWSER_NOT_FOUND: '未找到 Chrome 或 Edge。请安装浏览器后重试，或使用 yt-dlp 解析。',
  PARSE_CACHE_INVALID: '解析缓存 ID 无效。',
  COOKIE_SNAPSHOT_INVALID: 'Failed to load cookies: 浏览器未生成有效 Cookie 快照。',
  COOKIE_SOURCE_UNAVAILABLE: 'Cookie 来源不可用，请重新选择浏览器或 Cookie 文件。',
  PLATFORM_VIDEO_MISSING: '平台数据没有可下载的视频地址。',
  PLATFORM_VIDEO_ID_MISSING: '分享链接未返回可识别的视频 ID。',
  PLATFORM_DETAILS_MISSING: '平台 API 未返回视频详情，继续尝试兼容解析。',
  BROWSER_VIDEO_MISSING: '浏览器解析未找到已加载的真实视频，继续尝试 yt-dlp。',
  THUMBNAIL_EXPIRED: '缩略图已过期，请重新解析。',
  THUMBNAIL_SOURCE_INVALID: '不支持的缩略图来源。',
  THUMBNAIL_MISSING: '网站没有返回可显示的缩略图。',
  THUMBNAIL_TOO_LARGE: '缩略图超过 8 MB。',
  WECHAT_RESPONSE_EMPTY: '视频号接口没有返回数据。',
  WECHAT_RESPONSE_TOO_LARGE: '视频号接口返回的数据过大。',
  WECHAT_CDN_INVALID: '视频号没有返回受支持的腾讯 CDN 地址。',
  WECHAT_ACCESS_DENIED:
    '[[parse-error:access-denied]]视频号详情接口拒绝请求，请重新解析或检查访问权限。',
  WECHAT_SINGLE_VIDEO_ONLY:
    '[[parse-error:format-unavailable]]当前仅支持视频号单个视频，暂不支持图集或直播。',
  WECHAT_VIDEO_MISSING: '视频号没有返回可播放的视频地址。',
  WECHAT_KEY_EXPIRED: '视频号密钥无效，请重新解析。',
  WECHAT_URL_INVALID: '无效的视频号分享链接。',
  YUANBAO_REDIRECT_INVALID: '元宝接口重定向到非预期站点。',
  WECHAT_LOGIN_REQUIRED:
    '[[parse-error:authentication]]元宝未返回视频号播放信息，请确认登录有效并重新解析。',
  WECHAT_PARAMETERS_MISSING: '元宝返回的视频号播放参数不完整。',
  WECHAT_REDIRECT_INVALID: '视频号接口重定向到非预期站点。',
  WECHAT_KEY_INVALID: '视频号密钥无效。',
  WECHAT_RANGE_INVALID: '视频号解码范围无效。',
  WECHAT_INTEGRITY_FAILED: '视频号文件校验失败，请重新解析；未将无法播放的文件标记为完成。',
  RUNTIME_FILE_INVALID: '指定路径不是可执行文件。',
  RUNTIME_VERSION_INVALID: '无法识别该文件的工具版本。',
  RUNTIME_HASH_MISMATCH: '依赖 SHA-256 校验失败，原工具已保留。',
  RUNTIME_DETECTION_CANCELLED: '依赖检测已取消。',
  RUNTIME_INSTALL_BUSY: '运行依赖正在安装，请等待完成。',
  RUNTIME_KIND_INVALID: '请选择有效的运行依赖。',
  RUNTIME_INSTALL_CANCELLED: '已取消运行依赖安装，旧工具保留。',
  PLUGIN_STOPPED: '插件已停止。',
  VAULT_INVALID: '拾流数据格式无效；原文件已保留，请恢复备份。',
  BACKUP_ID_INVALID: '备份 ID 无效。',
  BACKUP_INVALID: '记录备份格式无效。',
  BROWSER_METADATA_INVALID: '请选择当前浏览器的 Local State 文件。',
  BROWSER_ACCOUNTS_MISSING: '未找到有效浏览器账号。',
  NATIVE_PENDING_LIMIT: '请先完成或取消当前选择。',
  NATIVE_KIND_INVALID: '不支持的原生操作。',
  NATIVE_DESCRIPTION_TOO_LONG: '操作说明过长。',
  NATIVE_NOT_FOUND: '此操作不存在或已过期。',
  NATIVE_ENDED: '此操作已结束。',
  LOCAL_PATH_REQUIRED: '请选择本机绝对路径。',
  LOCAL_PATH_TYPE_INVALID: '所选路径类型不符。',
  CLIPBOARD_URL_MISSING: '剪贴板中没有可用的 HTTP(S) 媒体链接。',
  DIRECTORY_INVALID: '目录必须是绝对路径。',
  PROXY_CREDENTIALS: '请输入不含账号密码的 HTTP(S) 或 SOCKS5 代理地址。',
  TASK_REQUIRED: '请选择下载任务。',
  OPEN_TARGET_INVALID: '不支持的打开目标。',
  AGENT_SESSION_REQUIRED: '修改拾流数据需要当前 Agent 会话。',
  APPROVAL_UNAVAILABLE: '宿主没有审批通道，操作未执行。',
  NONE: '',
  LEGACY_MESSAGE: '{reason}',
  UNEXPECTED_ERROR: '操作失败：{reason}',
  REQUEST_FAILED: '请求失败。',
  SERVICE_UNAVAILABLE: '服务暂时不可用。',
  REQUEST_FORBIDDEN: '仅允许本机同源访问。',
  ROUTE_NOT_FOUND: '接口不存在。',
  VALIDATION_FAILED: '参数校验失败：{fields}。',
  PROCESS_FAILED: '进程执行失败：{reason}',
  DOWNLOAD_HTTP_FAILED: '下载请求失败：HTTP {status} {statusText}',
  DOWNLOAD_RANGE_UNAVAILABLE: '下载范围不可用（HTTP {status}）',
  PLATFORM_HTTP_FAILED: '平台 API 返回 HTTP {status}。',
  WECHAT_SHARE_HTTP_FAILED: '视频号分享接口 HTTP {status}',
  WECHAT_DETAILS_HTTP_FAILED: '视频号详情 HTTP {status}',
  RUNTIME_DOWNLOAD_FAILED: '依赖下载失败：HTTP {status}。',
  RUNTIME_UNAVAILABLE: '{kind} 不可用，请安装依赖或手动选择文件。',
  RUNTIME_PLATFORM_UNSUPPORTED: '暂不支持 {platform} 的 {kind} 安装。',
  APPROVAL_DENIED: '操作未获批准（{outcome}），未执行；请勿绕过审批。',
  BROWSER_ACCOUNT_REQUIRED: '请选择要使用的浏览器账号，或提供 Cookie 文件；不会自动使用默认账号。',
  TASK_QUEUED: '等待下载。',
  TASK_DOWNLOADING: '正在下载…',
  TASK_PROCESSING: '正在合并或转换媒体…',
  TASK_PAUSED: '任务已暂停。',
  TASK_CANCELLED: '任务已取消。',
  TASK_COMPLETED: '下载已完成。',
  TASK_FAILED: '下载失败：{reason}',
  TASK_INTERRUPTED: '宿主已重启，点击继续以恢复下载。',
  TASK_SAVE_FAILED: '任务已结束，但保存记录失败。请检查数据目录权限。',
  RUNTIME_INSTALL_PREPARING: '正在准备依赖安装…',
  RUNTIME_INSTALL_DOWNLOADING: '正在下载并校验 {kind}…',
  RUNTIME_INSTALL_COMPLETED: '运行依赖已安装，通过 SHA-256 校验与执行检查。',
  RUNTIME_INSTALL_FAILED: '依赖安装失败：{reason}',
  RUNTIME_NOT_FOUND: '未找到可执行文件，请安装依赖或手动选择文件。',
  RUNTIME_STALE: '{kind} 版本 {version} 过旧，请更新。',
  RUNTIME_DETECTION_TIMEOUT: '依赖检测达到时限，请重新检测。',
  NATIVE_CONFIRM: '请在拾流页面确认并完成此操作。',
  NATIVE_EXPIRED: '选择已超时，请重新发起。',
  NATIVE_CANCELLED: '用户已取消。',
  NATIVE_COMPLETED: '操作已完成。',
  PROXY_CONNECTED: '连接成功。',
  PROXY_HTTP_STATUS: '目标返回 HTTP {status}。',
  PROXY_FAILED: '连接失败或超时，请检查网络、代理地址及目标站点。',
  BROWSER_PROFILES_IMPORTED: '账号列表已读取，只保存名称和账号标识。',
  BROWSER_PROFILES_EMPTY: '未找到浏览器账号，请先启动该浏览器。',
  BROWSER_PROFILES_CACHED: '使用上次授权读取的账号列表；新增账号后可重新读取。',
  BROWSER_PROFILES_PERMISSION:
    'macOS 限制直接读取浏览器账号，请点击“允许读取账号列表”完成一次授权。',
  BROWSER_PROFILES_NAMES_UNAVAILABLE: '账号名称暂不可读，按浏览器配置名称显示。',
  BROWSER_PROFILES_MISSING: '未找到浏览器配置，请先启动该浏览器。',
  BROWSER_SAFARI_DEFAULT: 'Safari 仅支持默认来源。',
  BROWSER_FIREFOX_MISSING: '未找到 Firefox 配置。',
  BROWSER_PROFILES_UNSUPPORTED: '该浏览器暂不支持账号列表。',
  PARSE_BROWSER_RECOVERED: '已通过浏览器兼容解析恢复。',
  PARSE_COMPATIBILITY_RECOVERED: '已通过兼容解析恢复，下载将复用本次解析和登录来源。',
  PARSE_UNSUPPORTED_URL: '暂不支持该网站或链接类型',
  PARSE_INVALID_URL: '请输入有效的链接',
  PARSE_FORMAT_UNAVAILABLE: '未找到可下载的视频格式，请检查运行依赖或登录状态',
  PARSE_PAGE_RELOAD: 'YouTube 客户端解析失败，请更新 yt-dlp 后重试',
  PARSE_CHALLENGE_FAILED: 'YouTube 验证脚本执行失败，请检查 JS 运行时和 yt-dlp',
  PARSE_VERIFICATION_REQUIRED: '网站要求安全验证，请在所选浏览器中完成验证后重试',
  PARSE_AUTHENTICATION: '该视频需要登录或访问权限，请检查 Cookies 设置',
  PARSE_ACCESS_DENIED: '网站拒绝了访问请求，请检查权限或稍后重试',
  PARSE_NETWORK: '网络请求失败或超时，请检查连接后重试',
  PARSE_NOT_FOUND: '视频不存在、不可用或已被删除',
  PARSE_RATE_LIMIT: '网站请求过于频繁，请稍后重试',
  PARSE_UNKNOWN: '无法解析该链接',
} as const;

export type BusinessCode = keyof typeof BUSINESS_MESSAGES;
export type MessageParams = Readonly<Record<string, string | number>>;
export interface BusinessMessage {
  code: string;
  params: MessageParams;
  message: string;
}

export function businessMessage(
  code: BusinessCode,
  params: MessageParams = {},
  fallback?: string,
): BusinessMessage & { code: BusinessCode } {
  return {
    code,
    params: { ...params },
    message:
      fallback ??
      BUSINESS_MESSAGES[code].replace(/\{(\w+)\}/g, (token, name: string) =>
        String(params[name] ?? token),
      ),
  };
}

export class BusinessError extends Error implements BusinessMessage {
  readonly code: BusinessCode;
  readonly params: MessageParams;

  constructor(code: BusinessCode, params: MessageParams = {}, fallback?: string) {
    const value = businessMessage(code, params, fallback);
    super(value.message);
    this.name = 'BusinessError';
    this.code = code;
    this.params = value.params;
  }
}

export function readBusinessMessage(value: unknown): BusinessMessage | undefined {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (
    typeof record.code !== 'string' ||
    typeof record.message !== 'string' ||
    !record.params ||
    typeof record.params !== 'object' ||
    Array.isArray(record.params)
  )
    return;
  const entries = Object.entries(record.params);
  if (
    entries.some(
      ([, item]) =>
        typeof item !== 'string' && (typeof item !== 'number' || !Number.isFinite(item)),
    )
  )
    return;
  return {
    code: record.code,
    params: Object.fromEntries(entries) as MessageParams,
    message: record.message,
  };
}

export function errorMessage(
  error: unknown,
  fallback: BusinessCode = 'UNEXPECTED_ERROR',
): BusinessMessage {
  const known = readBusinessMessage(error);
  if (known) return known;
  const reason = (error instanceof Error ? error.message : String(error)).slice(-2_000);
  return businessMessage(fallback, { reason }, reason);
}

const PARSE_CODES: Record<ParseErrorKind, BusinessCode> = {
  'unsupported-url': 'PARSE_UNSUPPORTED_URL',
  'invalid-url': 'PARSE_INVALID_URL',
  'runtime-unavailable': 'PARSE_RUNTIME_UNAVAILABLE',
  'format-unavailable': 'PARSE_FORMAT_UNAVAILABLE',
  'page-reload': 'PARSE_PAGE_RELOAD',
  'challenge-failed': 'PARSE_CHALLENGE_FAILED',
  'verification-required': 'PARSE_VERIFICATION_REQUIRED',
  authentication: 'PARSE_AUTHENTICATION',
  'access-denied': 'PARSE_ACCESS_DENIED',
  network: 'PARSE_NETWORK',
  'not-found': 'PARSE_NOT_FOUND',
  'rate-limit': 'PARSE_RATE_LIMIT',
  unknown: 'PARSE_UNKNOWN',
};
export function parseMessage(
  kind: ParseErrorKind,
  fallback?: string,
): BusinessMessage & { code: BusinessCode } {
  return businessMessage(PARSE_CODES[kind], { category: kind }, fallback);
}
