# 蓝屿任务 Android 安装说明

当前测试包：`release/蓝屿任务-Android-0.1.0-debug.apk`

## 安装

1. 将 APK 复制到安卓手机或平板。
2. 在设备上打开 APK；首次侧载时，按系统提示允许当前文件管理器或浏览器“安装未知应用”。
3. 安装后打开“蓝屿任务”。手机使用底部导航，平板竖屏使用扩展后的单栏布局。

这是 debug 签名的开发测试包。后续 GitHub 正式发布会改用固定的 release 签名；正式签名前不要把此包当作长期升级基线。

## 开发构建

在项目根目录运行：

```powershell
npm run android:debug
```

本机 `android/local.properties` 指向已有 Android SDK。该文件属于本地环境配置，不应提交到公开仓库。
