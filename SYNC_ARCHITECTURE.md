# 多端同步实施规范

更新时间：2026-09-10

## 目标

四台设备通过同一账号同步六类业务实体，同时保证离线编辑、幂等重试、删除 tombstone 和显式文本冲突。云端不使用整包 JSON 覆盖。

## 云端边界

- `sync_objects` 按 `user_id + entity_type + entity_id` 保存一条实体快照。
- 客户端只允许 RLS SELECT；写入只走 `apply_sync_mutation` RPC。
- RPC 从 `auth.uid()` 获取用户，使用固定空 `search_path`、全限定表名和事务级用户锁。
- `base_server_version` 做 CAS；`applied_sync_mutations` 保存 mutation receipt，保证服务端已提交但客户端丢响应后的重试不会重复递增。
- `change_seq` 用于分页 pull；同一用户写入通过 advisory lock 保证提交顺序与序号顺序一致。
- tombstone 首版永久保留，不做云端物理删除。

## 本地表

- `syncOutbox`：不可变操作，含 opId、用户、实体、base shadow、desired snapshot、前驱操作、状态与重试信息。
- `syncShadows`：最近已确认的远端版本与快照；服务端 bigint 一律用十进制字符串。
- `syncConflicts`：base/local/remote 三方内容、冲突字段和原 outbox id。
- `syncMeta`：每个账号的 pull cursor、最后成功时间和错误。

每次本地业务写入必须在一个 Dexie 事务中同时更新实体并追加 outbox。已尝试发送的 outbox 不得改变内容或复用 opId。

## 同步顺序

1. 获取单进程 mutex。
2. 确认会话与联网状态。
3. 先 push outbox；applied 做 acknowledge，CAS conflict 记录冲突并只阻塞该实体链。
4. 再从 cursor 分页 pull。
5. 每一页“应用业务实体 + 更新 shadow + 前进 cursor”必须在同一 Dexie 事务。
6. 网络/5xx 使用相同 opId 指数退避；401 暂停并刷新会话；CAS conflict 不自动重试。

## 冲突

使用 base/local/remote 三方比较。不同字段修改可自动合并；同字段不同值、删除与编辑、标题和文本备注的双改必须生成显式冲突。解决冲突时基于最新远端版本创建全新 mutation，旧冲突保留到新 mutation 被确认。

## 确定性 ID

- `DailyReview.id = daily-review:<date>`
- `CompletionLog.id = completion:<planBlockId>`

这防止两台离线设备为同一天回顾或同一次完成生成两条记录。

## 账号隔离

- guest 与每个 userId 使用不同 Dexie 数据库。
- DeviceSettings 为设备级偏好，不同步。
- 登录时 guest 数据需让用户选择“上传合并”“只下载云端”或“暂不迁移”，不能自动混合。
- 已登录时替换式备份恢复禁用，后续实现生成 outbox 的合并导入。

## 凭据

客户端只允许 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_PUBLISHABLE_KEY`。禁止 service_role、数据库密码、JWT secret、用户密码和发布签名私钥进入仓库、日志或构建产物。

## 无真实云端时的验收

`InMemorySyncServer` 模拟每用户隔离、CAS、receipt、change seq、tombstone、分页与故障注入。至少覆盖：提交后丢响应；过期 base；删除不复活；不同字段自动合并；同字段文本冲突；双设备完成不重复；pull 页失败 cursor 不前进；账号隔离；设备时钟偏差；登出重登继续 outbox。

真实发布前还必须用 Supabase 本地栈或测试项目验证 RLS/RPC 权限。
