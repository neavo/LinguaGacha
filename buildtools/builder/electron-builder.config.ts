import type { Configuration } from "electron-builder";

import { LOCALES } from "../../src/shared/i18n/types";

export default {
  appId: "me.neavo.linguagacha",
  asar: true,
  electronFuses: { runAsNode: true }, // 工作区复用 Electron 的 Node 子进程入口
  // builder 会过滤复制源直属的 node_modules；从 resources 映射整棵运行目录以保留标准依赖树。
  extraResources: [
    { from: "build/resources", to: ".", filter: ["workspace/**/*", "pdf-print.css"] },
  ],
  productName: "LinguaGacha",
  electronLanguages: [...LOCALES], // 发行包原生资源与应用界面 locale 共用同一集合
  directories: {
    buildResources: "public",
    output: "build/release/${version}",
  },
  afterPack: "buildtools/builder/after-pack.mjs",
  files: [
    "build/dist/**/*",
    "build/dist-electron/**/*",
    "builtin/**/*",
    "!node_modules/**/*.map",
    // 应用使用普通 SDK 入口；上游截图与独立 RPC bundle 不参与该加载链。
    "!node_modules/@earendil-works/pi-coding-agent/docs/images/**/*",
    "!node_modules/@earendil-works/pi-coding-agent/dist/bundle/**/*",
  ],
  win: {
    target: ["zip"],
    artifactName: "${productName}_v${version}_Windows_${arch}.${ext}",
    executableName: "app",
    icon: "icon.png",
    extraFiles: [{ from: "version.txt", to: "version.txt" }],
  },
  mac: {
    target: ["dmg"],
    artifactName: "${productName}_v${version}_macOS_${arch}.${ext}",
    category: "public.app-category.productivity",
    icon: "icon.png",
    identity: null,
    extraFiles: [{ from: "version.txt", to: "MacOS/version.txt" }],
  },
  dmg: {
    sign: false,
  },
  linux: {
    target: ["AppImage"],
    artifactName: "${productName}_v${version}_Linux_${arch}.${ext}",
    category: "Utility",
    icon: "icon.png",
    extraFiles: [{ from: "version.txt", to: "version.txt" }],
  },
} satisfies Configuration;
