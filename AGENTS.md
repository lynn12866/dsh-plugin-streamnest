# 开发约定

- 业务放在 `apps`，宿主适配放在 `packages/harness`；禁止业务 Service 引入 Harness Context。
- 页面与 Agent 复用同一 NestJS Service 与 DTO 校验。Agent 使用官方 `defineTool`，输入输出声明明确 schema，观察取消信号。
- 控件使用官方 UI primitives，按钮为 `sm`。按用户明确要求，紧凑表单 Input 从官方 Button.sm CSS 提取相同的高度、字号、圆角和内边距，统一同排尺寸；禁止维护独立调色板或修改主题色，其余只写布局 CSS。页面标题为官方 20px、正文 13px、辅助信息 12px token。
- Desktop 继承宿主主题；开发预览从官方 ui-theme 包提取 CSS。不要维护另一套调色板、缩放比例或模拟侧边栏。
- 业务及依赖管理统一 TypeScript，使用 strict、ESLint、Prettier；禁止引入 Go 侧车。声明、校验、业务步骤之间留空行。
- 包管理统一 pnpm，版本由 `packageManager` 固定，workspace 与构建依赖授权配置在 `pnpm-workspace.yaml`；提交 `pnpm-lock.yaml`，安装使用 `pnpm install --frozen-lockfile`。
- 前端中英文词库使用相同的稳定 key，组件通过 key 翻译；提示保存 key 与参数，禁止按原文反查或匹配整句。媒体信息、路径和服务诊断原文不参与翻译匹配。
- 新增功能同时增加页面/API/Agent 入口。导航只注册已实现功能。
- 任务状态、设置、输出文件来自共享契约；取消子进程必须等待进程关闭。
- 禁止读取未指定的浏览器 Cookie；禁止自动恢复宿主重启前的下载；归档不删除文件。
- 改动后运行 `pnpm run check`，打包并检查 Desktop 侧边栏、主要流程和真实 Agent 调用。验收结果与未完成的验收仅在回复中明示，不把单元测试写成真实平台验收。
- 保留原创许可、第三方许可原文及来源清单；依赖安装清单的 SHA-256 不得省略。
