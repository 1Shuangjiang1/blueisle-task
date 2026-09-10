# 蓝屿任务 Next — Development Status

更新时间：2026-09-10（Asia/Shanghai）
总体状态：in progress — v0.1.5 GitHub 云端构建中
当前里程碑：M6 UI 视觉与交互修复（已推送）

## Resume here

- 最后完成：Android APK 与 Windows installer 均已产出；本地 Git main 仓库和 Web/Windows/Android checks workflow 已建立。
- 当前/可能运行：GitHub Actions release run 34482708764 正在构建 v0.1.5 Windows 正式包；本地隐藏预览服务准备停止。
- 精确下一动作：等待 run 34482708764 完成，核验安装包、签名与 latest.json；若失败则读取具体步骤日志修复。
- 远程状态：v0.1.2、v0.1.3、v0.1.4 已发布；v0.1.5 tag 与代码已推送。正确的两个 GitHub Secrets 已保存。
- 若立即中断：先运行 `Get-ChildItem -Force` 检查骨架，再按本文件“精确下一步”继续。
- 阻塞：无。
- 远程状态：未修改；未创建 GitHub 仓库，未修改 Supabase。

## 目标与成功标准

开发个人任务系统，支持两台 Windows 电脑、安卓手机和安卓平板：

- 规划页：月历、重要日期、近期宽泛目标。
- 今日页：未来 7 日提醒、今日重点、定时与待安排任务。
- 目标页：多层步骤、投入与成果、完成记录。
- 回顾页：每日自动汇总、备注、未完成事项处理。
- 日间蓝白简约和夜间赛博朋克主题，主题偏好按设备保存。
- 本地优先、离线可用，后续实现 Supabase 多端同步。
- Windows 安装包和 GitHub Releases 更新；Android APK 和版本提醒。

M1 验收闭环：创建目标 → 子步骤 → 安排今天 14:00–16:00 → 完成并记录 90 分钟与备注 → 目标投入和今日回顾同步显示；刷新后仍保留。

## 架构与关键决定

- 新工程：`D:\cbl_file\blueisle-task-next`；旧版仅作为迁移参考，保持原状。
- Web：Vite + React + TypeScript。
- 本地：Dexie/IndexedDB；UI 只依赖 repository 接口，为未来 SQLite 留边界。
- Windows：M2+ 加入 Tauri 2，输出 NSIS/MSI；GitHub Releases + 签名更新。
- Android：M3+ 加入 Capacitor 8，共用 `dist`；APK 更新由系统确认安装。
- 同步：M4+ 使用 Supabase Auth/RLS、逐实体版本、outbox 幂等操作、游标拉取和 tombstone；不采用旧版整包覆盖。
- 日期：日计划用 `YYYY-MM-DD` + 分钟；重要事件保留本地时间和 IANA 时区。
- 密钥：仅放本地环境变量或发布平台 Secrets，永不写入本文件和仓库。

## 模型路由与所有权

协调路线：M1–M3 Terra-coordinated；M4 账号与同步切换为 Sol-coordinated。

| 范围 | 所有者 | 状态 |
| --- | --- | --- |
| 架构、集成、配置、状态文档 | 根协调代理 | in progress |
| `src/domain/**`, `src/data/**` | Terra data worker | verified locally |
| `src/features/**`, `src/components/ui/**`, `src/styles/**` | Terra UI worker | verified in browser |
| `src/app/**`, `src/components/layout/**`,入口 | 根协调代理 | verified in browser |
| M1 复核 | Terra reviewer | complete — accepted with follow-ups |
| M4 同步架构 | Sol architect | complete |
| M4 本地 outbox 数据基础 | Terra worker | verified locally — 11 tests |
| M4 同步引擎/RPC/mock | Sol worker | verified locally — 22 total tests |
| M4 认证与同步设置 UI | Terra worker | implemented but app integration unverified |
| M4 App runtime/lifecycle | Terra worker | verified locally — pending review |
| M4 最终复核 | 根代理修复并完成线上验收 | complete |

所有 worker 必须保留他人修改，不得回退无关文件。

## 数据模型

- 同步实体统一含：`id`, `createdAt`, `updatedAt`, `entityVersion`, `deletedAt?`。
- `Goal`：宽泛目标和截止日期。
- `GoalStep`：可递归步骤及 binary/manual/count 进度方式。
- `CalendarEvent`：面试、笔试、DDL 等重要日期。
- `PlanBlock`：某日具体时段或待安排工作，可关联目标步骤。
- `CompletionLog`：某次安排的完成结果、实际时长、备注、下一步。
- `DailyReview`：反思、阻塞、明日重点。
- 本地实体：`DeviceSettings`, `SyncMeta`, `OutboxOp`。

## 当前步骤

步骤：M5 Windows 应用内更新与 GitHub Releases。

- 状态：in progress；0.1.1 发布已证实签名有效但缺少更新清单；workflow 已切换至 tauri-action v1 并显式生成 NSIS 更新清单，待 0.1.2 远程验证。
- 即将修改：`src-tauri/src/lib.rs`、`src-tauri/capabilities/default.json`、`src-tauri/tauri.conf.json`、`src/update/**`、`src/app/App.tsx`、GitHub Actions release workflow。
- 计划验证：`npm run typecheck`、一次 `npm run tauri build`，确认安装包、签名文件与更新清单产物。
- 中断后的下一动作：提交并推送 0.1.2 与 tag，监视 GitHub Actions，随后请求公开 latest.json。
- 中断后的下一动作：若 0.1.2 workflow 成功，验证 GitHub Release 资产含 latest.json，Windows 平台 URL 指向 NSIS 安装包。


## UI 改造（进行中）

- 目标：将现有简约界面升级为有层次的“蓝白纸感工作台”和更强烈的赛博夜间界面；统一楷体、圆角表单、圆润日历、不会换行的日程时间条，并将回顾页合成一个工作台卡片。
- 当前步骤：deployed but unverified — v0.1.4 已推送，等待 GitHub 发布完成。
- 计划验证：运行一次 typecheck 和 production build，然后在浏览器检查今天、规划、回顾及弹窗的桌面/手机布局。
- 中断后的下一动作：v0.1.4 已成功发布；本节由下方 v0.1.5 修复状态取代。
## UI 精修（进行中）

- 当前步骤：verified locally — 规划页对齐、状态标签收缩与圆角 date/time/select 已在浏览器确认；准备发布 v0.1.4。
- 将修改：`src/styles/app.css`、`src/styles/shell.css`；不修改业务组件或数据。
- 计划验证：一次 typecheck/build，并在浏览器的规划页面与新增安排弹窗确认桌面和移动布局。
- 中断后的下一动作：此小节已由下方“UI 控件与交互修复”取代。

## UI 控件与交互修复（已本地验证）

- 当前步骤：verified locally — 自定义月历、选项菜单、时间菜单、提交闭环与布局测量均通过。
- 已定位：CSS 将原生日历 indicator 扩大为整个控件，可能截获“创建/保存”点击并再次打开日期面板。
- 将修改：`src/components/ui/FormControls.tsx`、`src/components/ui/index.ts`、`src/app/dialogs.tsx`、`src/features/ReviewPage.tsx`、`src/styles/shell.css`、`src/styles/app.css`、`src-tauri/src/main.rs`。
- 成功标准：展开后的日期表和选项菜单均为主题化圆角面板；选择日期后可一次提交并关闭弹窗；即将到来三列对齐；Windows 正式版启动不出现控制台窗口。
- 验证计划：typecheck、production build、浏览器创建日期/目标/安排闭环；检查 Rust release subsystem 配置。
- 验证结果：页面内原生 date/select 数量均为 0；选择日期后创建目标成功且弹窗关闭；09:00—10:00 安排保存成功；临近日期标签文字完整、水平不溢出、垂直偏差 0；typecheck/build 成功；Rust release check 完成。
- 中断后的下一动作：推送 v0.1.5 tag并查询 release workflow。

## 已完成

- 创建长期任务。
- 盘点旧版单文件、Capacitor 安卓工程和 Supabase 同步实验。
- 完成架构评审；旧文件未覆盖，历史凭据未迁移。
- 确认环境有 Node 24、npm 11、Rust 1.97、JDK 21。
- 创建 Vite/React/TypeScript 配置、环境变量示例和忽略规则。
- 安装依赖成功，顶层依赖树无缺失。
- 实现 Dexie schema、领域仓库、初始化示例数据、CRUD、计划完成事务和核心 selectors。
- 数据层独立测试 `npx vitest run src/data/service.test.ts`：3 passed。
- 已实现四个主页面、双主题、桌面侧栏、移动底栏和设置面板。
- 已实现新增目标/日期/步骤/安排、完成记录、回顾保存、未完成安排调整和备份导出。

## 风险、问题与阻塞

- Android Rust/NDK 环境不完整，因此不在首版使用 Tauri Mobile。
- IndexedDB 可能被系统清理；M1 必须提供 JSON 导入导出作为保险。
- 更新签名、GitHub 仓库和正式 Supabase 项目尚未配置，不阻塞本地开发。
- 安卓后台通知和安装权限需要在真机阶段验证。
- 当前无安卓设备连接，APK 的真机 WebView、触控和状态栏主题仍待验证。
- `npm audit` 的 3 个 moderate 均来自仅开发时使用的 Capacitor CLI → xcode → uuid 链；不进入运行时 APK，暂不降级 Capacitor。
- M1 reviewer 提出的备份导入、历史事件过滤、日程编辑和时间校验问题均已修复并复验。
- 冲突 UI 初版出现了“合并”按钮，但底层没有可编辑合并结果的可靠实现；本次集成将移除该按钮，只保留安全的“本机/云端”选择，避免误导用户。
- outbox 测试暴露同毫秒 `createdAt` 不能单独作为稳定链排序依据；生产链已有 `predecessorOpId`，正在补稳定写入/验证方式，尚未判定为数据丢失问题。
- Sol review 高风险：账号切换时旧 workspace 尚可操作；采用云端会删除冲突后新增的本机编辑。中风险：默认全端登出、非 UUID fallback、snapshot 无服务端大小/字段限制、outbox tail 仍依赖时间、Tauri CSP 为空。
- 已解除：真实 Supabase 本地与线上 RLS/RPC/PostgREST/Auth 验证完成；Windows/APK 已重建并包含线上同步配置。仍待：GitHub updater/签名/release、Android 真机验收。
- 本地 Supabase 第二次启动成功并实际应用 migration。SQL 事务测试验证 grants、anon 拒绝、RLS 两用户隔离、CAS conflict、applied receipt 幂等、字段白名单与 256 KiB 限制；真实 Supabase JS/PostgREST/Auth 测试也验证 RPC、bigint 文本、两用户隔离和直接写拒绝。测试用户已清理。即将运行 `npx supabase stop` 停止本地容器；若中断先查 `npx supabase status`。远程状态未变。

## 验证记录

- 2026-09-09：环境与旧项目只读盘点完成。
- 2026-09-09：`npm install` 与 `npm ls --depth=0` 成功；M1 尚未构建。
- 2026-09-09：首轮全量 `npm test` 3/3 通过；typecheck/build 因 CSS side-effect import 缺少声明失败，已补声明，待复验。
- 2026-09-09：复验通过：`npm run typecheck` exit 0；`npm test` 3/3；`npm run build` 成功，1868 modules transformed。
- 2026-09-09：浏览器闭环通过：完成示例计划，记录 90 分钟、成果、备注与下一步；回顾页正确显示，刷新后仍保留。360px 手机布局正常。768px 首检发现桌面侧栏挤压，已新增竖屏平板布局覆盖，待复验。
- 2026-09-09：768px 修复后改为平板底部导航，布局正常；1280px 桌面侧栏正常；日间蓝白与夜间赛博主题均可切换，运行控制台无 warning/error。
- 2026-09-09：修复后复验 `typecheck`、`test`、`build` 全部通过；构建 1869 modules transformed。
- 2026-09-09：Terra reviewer 独立复跑 typecheck/test/build 并接受 M1；列出安装版前应处理的数据恢复和日程管理问题。
- 2026-09-09：Reviewer 收尾完成：新增备份导入、日程编辑、即将到来过滤、计划时间与实际时长校验；`typecheck`、5/5 tests、build 全通过；浏览器确认编辑弹窗与恢复入口可达。
- 2026-09-09：Vite session `34821` 已停止，浏览器测试页已关闭。
- 2026-09-09：Capacitor Android 首次 `assembleDebug` BUILD SUCCESSFUL（183 tasks）；复建加入动态状态栏和自定义图标后再次成功。
- 2026-09-09：APK 校验：`com.blueisle.tasks`、versionName 0.1.0、minSdk 24、targetSdk 36、debug 签名有效；release 副本 SHA256 `692454F63FE20935A3DE132F1F67AC9769F3AF97EBB0BE347426413A194BDF2F`。ADB 无连接设备。
- 2026-09-09：初始化本地 Git `main`；加入 README、Android 安装说明与 Web/Windows/Android checks workflow。gitignore 已验证排除 `.env`、Android SDK 本地路径、release 和 `.secrets`。
- 2026-09-10：确认上次额度限制发生在 Sol 同步架构返回后；交接文档完整，无代码丢失。架构已固化到 `SYNC_ARCHITECTURE.md`。
- 2026-09-10：Dexie v2/outbox 业务写入实现完成，原有 5 项测试通过；`src/sync/types.ts` 已冻结，正在实现 `LocalSyncStore` 对接。
- 2026-09-10：M4 本地数据层完成：四张同步表、六类实体原子 outbox、账号数据库隔离、确定性回顾/完成 ID、ack/rebase/pull 事务均已实现；`typecheck`、11/11 tests、build 全通过。
- 2026-09-10：认证 gateway 与设置面板账号/同步/冲突 UI 初版完成，typecheck/build 通过；全量 19 项中 3 项同步引擎测试失败，已由同步 worker 继续修复，根代理尚未接入 App。
- 2026-09-10：同步引擎最终交付：`src/sync` 9 个实现/测试文件与 Supabase migration；全量 typecheck、4 files/22 tests、build 全通过。Pull 通过 SECURITY INVOKER RPC 将 bigint 转成文本，规避 JS 精度丢失。真实 Supabase RLS/RPC 尚未执行，仍是发布阻塞验证项。
- 2026-09-10：App runtime 集成完成：访客/账号数据库切换、共享 Auth client、登录/注册/退出/手动同步、联网/前台触发、同步后刷新、local/remote 冲突处理和登录态禁用替换恢复；typecheck、22/22 tests、build 通过。
- 2026-09-10：修复连续写入同毫秒导致 outbox 测试偶发排序颠倒；改用进程内单调 ISO 时间。专项连续 10 轮与全量 22 项测试全部通过。
- 2026-09-10：根代理独立复跑：`npm run typecheck` exit 0；4 files/22 tests；`npm run build` 成功（仅 598.71 kB chunk 性能提示）。已启动 Sol 最终只读审查。
- 2026-09-10：Sol 最终审查暂不接受；确认 2 个高风险、5 个中风险与 2 个发布阻塞项，进入一轮针对性修复。
- 2026-09-10：根代理完成 reviewer 中风险修复初稿：RPC snapshot 大小、允许字段及关键类型限制；Tauri CSP 仅允许自身资源与 Supabase HTTPS/WSS 连接。状态为 implemented but unverified。
- 2026-09-10：UUID/outbox 修复完成：标准 UUID v4 fallback；按 predecessor 图寻找唯一 tail；缺失前置、分叉、环与不连通均失败关闭；新增跨实例/时钟回退/分叉测试。typecheck、26/26 tests、build 通过。
- 2026-09-10：本地 Supabase migration 实际执行成功；SQL 事务测试与 Supabase JS/PostgREST/Auth 集成测试通过，测试用户已删除，本地容器已停止。
- 2026-09-10：runtime/auth 修复在 worker 额度中断前已写入；根代理检查 typecheck 通过。用户要求后续不再委派并减少测试，已遵从。
- 2026-09-10：修复后唯一一次生产 `npm run build` 成功（1929 modules；仅 602.94 kB chunk 性能提示）。M4 可打包。
- 2026-09-10：最新 Android debug APK BUILD SUCCESSFUL；最新 Windows NSIS 构建成功。APK SHA256 `A643E30C4A9905A2F7DD436CC9B1E66CF291854A12303958607009039887CBC7`；NSIS SHA256 `0F39C5DD3C46CE5CA8B1CCFCA19C3778F23B9A64714C62B251B3A2FD3079FBC7`。
- 2026-09-10：线上 Supabase `nhwtucawxqowtnmszkxt` migration 部署成功；临时账号实测登录、RPC push/pull、receipt 幂等、RLS 写入拒绝均通过。测试账号与临时账号级 CLI token 均已删除/撤销。
- 2026-09-10：线上配置最终包构建成功。APK SHA256 `BACF187F62596FF8E32447FD0CF157614272ABA1DC46669543E6F3B4AF838AC2`；NSIS SHA256 `39B81AA165FF07E7576CB71FDA1428DA1800620AF814652509D49DEFD1BC8F6C`。
- 2026-09-10：确认 `src-tauri/icons` 含 Windows ICO、多尺寸 PNG 与 Android launcher 图标；当前安装包具备任务栏/开始菜单图标。开始 M5 GitHub 在线更新。
- 2026-09-10：M5 Windows 更新运行时、签名公钥、应用内“检查更新”和 GitHub release workflow 已实现；`npm run typecheck` 通过，0.1.1 NSIS 与 updater `.sig` 构建成功。
- 2026-09-09：首次 `tauri build` 失败：Tauri v2 schema 不接受 `app.windows[0].identifier`；已改为 `label`，未产生远程或安装状态变化。
- 2026-09-09：第二次 `tauri build` 成功（release 编译约 2m29s）；生成 `blueisle-task.exe` 与 NSIS `蓝屿任务_0.1.0_x64-setup.exe`。
- 2026-09-09：NSIS `/S` 安装 exit 0；HKCU 登记版本 0.1.0，安装位置 `C:\Users\23132\AppData\Local\蓝屿任务`。安装后的 `blueisle-task.exe` 启动 3 秒仍存活，随后已停止测试进程；SHA256 `947B6D6D78BCB4F834A9B1129EC7EB3AB3729DADB1172A6C5FB0388807D350AE`。

## 配置与运行

工程骨架建立后补充。不得在此记录任何账号密码或密钥。

## 精确下一步

1. 在 Windows 与 Android 真机上用同一邮箱账号完成一次跨设备验收。
2. 接入 Tauri GitHub Releases 自动更新及 Android 版本提醒。
3. 正式发布前生成并安全备份 Android/Tauri 签名密钥。

## Handoff note

新版工程独立于 `html小应用\蓝屿任务系统.html`。任何接手者先读本文件，只在新工程开发；需要迁移时只读取旧数据结构，不复制历史服务配置或密钥。














