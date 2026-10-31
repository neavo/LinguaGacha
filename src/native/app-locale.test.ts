import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "vite";

import { expect, it } from "vitest";

it("真实 Electron 在 ready 前覆盖集合外语言，并正常创建文件控件", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linguagacha-app-locale-"));
  try {
    await build({
      configFile: false,
      logLevel: "silent",
      build: {
        outDir: directory,
        lib: {
          entry: path.resolve("src/native/app-locale.ts"),
          formats: ["es"],
          fileName: () => "app-locale.mjs",
        },
        rolldownOptions: { external: ["electron"] },
      },
    });
    const entry = path.join(directory, "probe.mjs");
    await fs.writeFile(
      entry,
      `
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { configure_app_locale } from './app-locale.mjs';

// 启动期断言也进入退出路径，避免失败时弹出 Electron 原生错误框并等待超时。
void (async () => {
  assert.equal(app.isReady(), false);
  // 保留额外语言包，防止缺包回退掩盖启动语言选择错误。
  if (process.platform !== 'darwin') {
    assert.ok(existsSync(path.join(path.dirname(process.execPath), 'locales', 'zh-TW.pak')));
  }
  app.getPreferredSystemLanguages(); // 验证真实 API 可在 ready 前调用。
  app.getPreferredSystemLanguages = () => ['zh-TW']; // 固定系统偏好，隔离本机语言。
  configure_app_locale();
  await app.whenReady();
  assert.equal(app.getLocale(), 'zh-CN');
  const window = new BrowserWindow({ show: false });
  try {
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<input type="file"><input type="file" multiple>'
    ));
    assert.equal(await window.webContents.executeJavaScript('navigator.language'), 'zh-CN');
    console.log('app-locale-ok');
  } finally {
    window.destroy();
  }
})().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
`,
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const executable = createRequire(import.meta.url)("electron") as string;
    const result = await promisify(execFile)(
      executable,
      [entry, "--lang=zh-TW", `--user-data-dir=${path.join(directory, "profile")}`],
      { env, timeout: 20_000, windowsHide: true },
    );
    expect(result.stdout).toContain("app-locale-ok");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 30_000);
