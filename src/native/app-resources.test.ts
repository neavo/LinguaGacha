import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listPackage } from "@electron/asar";
import { expect, it } from "vitest";
import { resolve_app_resources } from "./app-resources";

it.skipIf(!process.env.LINGUAGACHA_TEST_RESOURCES)(
  "发行资源独立部署，实际界面加载共享字体",
  async () => {
    const resources = path.resolve(process.env.LINGUAGACHA_TEST_RESOURCES!);
    const archive = path.join(resources, "app.asar");
    const entries = listPackage(archive, { isPack: false });
    expect(entries.some((entry) => /[/\\]builtin[/\\]|[/\\]dist[/\\]fonts[/\\]/u.test(entry))).toBe(
      false,
    );
    const deployed = resolve_app_resources({
      packaged: true,
      resourcesPath: resources,
      projectRoot: "",
    });
    for (const target of Object.values(deployed)) expect(fs.existsSync(target)).toBe(true);
    using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-resource-probe-"));
    const entry = path.join(temporary.path, "main.cjs");
    fs.writeFileSync(
      entry,
      `
    const {app, BrowserWindow} = require('electron');
    const assert = require('node:assert/strict');
    app.whenReady().then(async () => {
      const window = new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});
      try {
        await window.loadFile(${JSON.stringify(path.join(archive, "build/dist/index.html"))});
        const faces = await window.webContents.executeJavaScript(
          ${JSON.stringify("Promise.all([document.fonts.load('400 16px LGBaseFont','中文'),document.fonts.load('700 16px LGBaseFont','中文'),document.fonts.load('400 16px LGMono','Code'),document.fonts.load('400 16px Twemoji','😀')]).then(groups=>groups.map(group=>group.map(face=>face.status)))")}
        );
        assert.deepEqual(faces,[['loaded'],['loaded'],['loaded'],['loaded']]);
        console.log('release-fonts-ok'); app.exit(0);
      } catch(error) { console.error(error); app.exit(1); }
    });
  `,
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await promisify(execFile)(
      createRequire(import.meta.url)("electron") as string,
      [entry],
      {
        env,
        timeout: 30_000,
        windowsHide: true,
      },
    );
    expect(result.stdout).toContain("release-fonts-ok");
  },
  40_000,
);
