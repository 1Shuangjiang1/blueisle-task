import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.blueisle.tasks",
  appName: "蓝屿任务",
  webDir: "dist",
  android: {
    backgroundColor: "#070b16",
    allowMixedContent: false,
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: "DARK",
      backgroundColor: "#edf4fa",
    },
    SplashScreen: {
      launchShowDuration: 700,
      backgroundColor: "#070b16",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
  },
};

export default config;
