# 蓝屿任务 Next

蓝屿任务是一套本地优先的个人规划应用，把重要日期、长期目标、每日安排和每日回顾连在一起。界面支持蓝白日间模式和赛博朋克夜间模式，目标平台为 Windows、安卓手机和安卓平板。

## 当前能力

- 规划月历、重要日期和近期目标
- 多层目标步骤与目标投入统计
- 每日定时/待安排任务
- 完成记录、实际投入、成果、备注与下一步
- 每日自动汇总和回顾
- IndexedDB 离线存储，以及 JSON 导入/导出
- Windows NSIS 安装包
- Android debug APK

多端账号同步、正式签名发布和应用内自动更新仍在开发。

## 本地开发

```powershell
npm install
npm run dev
```

质量检查：

```powershell
npm run typecheck
npm test
npm run build
```

Windows 安装包：

```powershell
npm run tauri build
```

Android debug APK：

```powershell
npm run android:debug
```

Android 构建需要 JDK 21 与 Android SDK；本机路径写在不提交的 `android/local.properties`。

## 数据安全

任务数据默认只保存在当前设备。设置里可以导出和恢复 JSON 备份。任何 Supabase 地址和公开客户端 key 将通过 `.env` 配置；管理员密钥、发布签名私钥和账号密码不得进入仓库。

完整进度和中断恢复步骤见 [DEVELOPMENT_STATUS.md](./DEVELOPMENT_STATUS.md)。
