import type { Configuration } from "electron-builder";

import { LOCALES } from "../../src/domain/app-language";

export default {
  appId: "me.neavo.linguagacha",
  asar: true,
  electronFuses: { runAsNode: true }, // 工作区复用 Electron 的 Node 子进程入口
  extraResources: [
    { from: "builtin", to: "builtin" }, // 业务按真实路径读取版本资源
    { from: "public/fonts", to: "fonts" }, // 界面与 PDF 共用同一份字体
    // builder 会过滤复制源直属的 node_modules；从 resources 映射整棵运行目录以保留标准依赖树。
    { from: "build/resources", to: ".", filter: ["workspace/**/*", "pdf-print.css"] },
  ],
  productName: "LinguaGacha",
  electronLanguages: [...LOCALES], // 发行包原生资源与应用界面 locale 共用同一集合
  directories: {
    buildResources: "public",
    output: "build/release/${version}",
  },
  afterPack: "buildtools/builder/after-pack.mjs",
  files: ["build/dist/**/*", "build/dist-electron/**/*", "!build/dist/fonts/**/*"], // 界面字体改由 resources/fonts 提供
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
