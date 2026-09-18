import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { expect, it } from "vitest";
import { renderer_runtime_reload } from "./renderer-runtime-reload.ts";

it("真实热更新保留语言和通知状态，Context 与 Store 依赖变更重建窗口", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linguagacha-hmr-"));
  let server;
  try {
    const frontend = path.join(directory, "src/frontend");
    const write = async (file, source) => {
      const target = path.join(directory, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, source);
    };
    await fs.symlink(
      path.resolve("node_modules"),
      path.join(directory, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    // 使用实际 Provider、Hook 和通知模块，词典与长期 Store 由测试自有资源提供。
    for (const file of [
      "app/locale/locale-provider.tsx",
      "app/locale/locale-context.ts",
      "app/feedback/desktop-toast.ts",
      "app/feedback/desktop-progress-toast.tsx",
    ])
      await write(`src/frontend/${file}`, await fs.readFile(`src/frontend/${file}`, "utf8"));
    await write(
      "src/frontend/widgets/progress-toast-ring/progress-toast-ring.tsx",
      "export function ProgressToastRing() { return <span />; }",
    );
    await write("src/shared/i18n/en.ts", 'export const message = "EN initial";');
    await write("src/shared/i18n/zh.ts", 'export const message = "ZH initial";');
    await write(
      "src/shared/i18n/index.ts",
      `
      import { message as en } from './en';
      import { message as zh } from './zh';
      export type Locale = 'en-US' | 'zh-CN';
      export type LocaleKey = 'message';
      export function create_text_resolver(locale: Locale) { return () => locale === 'zh-CN' ? zh : en; }
    `,
    );
    await write(
      "src/frontend/app/session/runtime-value.ts",
      'export const value = "store initial";',
    );
    await write(
      "src/frontend/app/session/example-store.ts",
      `
      import { value } from './runtime-value';
      export class ExampleStore { value = value; }
    `,
    );
    await write(
      "src/frontend/probe.tsx",
      `
      import { useRef, useState } from 'react';
      import { LocaleProvider } from '@frontend/app/locale/locale-provider';
      import { useI18n } from '@frontend/app/locale/locale-context';
      import { DesktopProgressToast } from '@frontend/app/feedback/desktop-progress-toast';
      import { push_progress_toast, dismiss_toast } from '@frontend/app/feedback/desktop-toast';
      import { ExampleStore } from '@frontend/app/session/example-store';
      import { Toaster } from 'sonner';
      function Content() {
        const { t } = useI18n();
        const [count, setCount] = useState(0);
        const store = useRef(new ExampleStore());
        return <><output id="message">{t('message')}</output><output id="store">{store.current.value}</output>
          <button id="count" onClick={() => setCount(count + 1)}>{count}</button>
          <button id="progress" onClick={() => push_progress_toast({message:'working', presentation:'modal'})}>progress</button>
          <button id="finish" onClick={() => dismiss_toast()}>finish</button>
          <Toaster /><DesktopProgressToast /></>;
      }
      export default function Probe() {
        return <LocaleProvider locale={location.search.includes('zh') ? 'zh-CN' : 'en-US'}><Content /></LocaleProvider>;
      }
    `,
    );
    await write(
      "entry.tsx",
      `
      import { createRoot } from 'react-dom/client';
      import Probe from './src/frontend/probe';
      window.boot = crypto.randomUUID();
      createRoot(document.getElementById('root')!).render(<Probe />);
    `,
    );
    await write(
      "index.html",
      '<div id="root"></div><script type="module" src="/entry.tsx"></script>',
    );
    server = await createServer({
      configFile: false,
      root: directory,
      logLevel: "error",
      plugins: [renderer_runtime_reload(), react()],
      resolve: {
        alias: {
          "@frontend": frontend,
          "@shared/i18n": path.join(directory, "src/shared/i18n/index.ts"),
        },
      },
      server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/profile/**"] } },
    });
    await server.listen();
    const url = server.resolvedUrls.local[0];
    await write(
      "main.cjs",
      `
      const { app, BrowserWindow } = require('electron');
      const fs = require('node:fs/promises');
      const path = require('node:path');
      const assert = require('node:assert/strict');
      const directory = ${JSON.stringify(directory)};
      app.setPath('userData', path.join(directory, 'profile'));
      app.commandLine.appendSwitch('disable-gpu');
      const windows = [];
      const errors = [];
      const messages = [];
      const evaluate = (win, code) => win.webContents.executeJavaScript(code);
      async function until(check) {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          if (await check()) return;
          await new Promise(resolve => setTimeout(resolve, 40));
        }
        throw new Error('HMR condition timed out: ' + check.toString());
      }
      const change = (file, text) => fs.writeFile(path.join(directory, file), text);
      void (async () => {
        await app.whenReady();
        for (const locale of ['en', 'zh']) {
          const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
          windows.push(win);
          win.webContents.on('console-message', (event) => {
            messages.push(event.message);
            if (event.level === 'error') errors.push(event.message);
          });
          await win.loadURL(${JSON.stringify(url)} + '?' + locale);
          await until(() => evaluate(win, "document.querySelector('#count') !== null"));
          await evaluate(win, "document.querySelector('#count').click(); document.querySelector('#progress').click()");
          await until(() => evaluate(win, "document.querySelector('.cn-progress-toast-modal-layer') !== null"));
        }
        const boots = await Promise.all(windows.map(win => evaluate(win, 'window.boot')));
        for (let round = 0; round < 3; round++) {
          // Vite 文件监听器合并同一文件 50ms 内的重复事件，各轮保存跨过该窗口。
          await new Promise(resolve => setTimeout(resolve, 100));
          await Promise.all(['en', 'zh'].map(locale => change('src/shared/i18n/' + locale + '.ts', 'export const message = "' + locale + round + '";')));
          for (const [index, locale] of ['en', 'zh'].entries()) {
            await until(() => evaluate(windows[index], "document.querySelector('#message')?.textContent === '" + locale + round + "'"));
            assert.equal(await evaluate(windows[index], 'window.boot'), boots[index]);
            assert.equal(await evaluate(windows[index], "document.querySelector('#count').textContent"), '1');
          }
        }
        const display = 'src/frontend/app/feedback/desktop-progress-toast.tsx';
        const displaySource = await fs.readFile(path.join(directory, display), 'utf8');
        await change(display, displaySource.replace('aria-hidden="true"', 'aria-hidden="true" data-hmr="updated"'));
        for (const [index, win] of windows.entries()) {
          await until(() => evaluate(win, "document.querySelector('[data-hmr=updated]') !== null"));
          await until(() => evaluate(win, "document.querySelector('li[data-sonner-toast][data-removed=false] [data-title]')?.textContent === 'working'"));
          assert.equal(await evaluate(win, 'window.boot'), boots[index]);
          await evaluate(win, "document.querySelector('#finish').click()");
          await until(() => evaluate(win, "document.querySelector('.cn-progress-toast-modal-layer') === null"));
        }
        await change('src/frontend/app/session/runtime-value.ts', 'export const value = "store updated";');
        for (const [index, win] of windows.entries()) {
          await until(() => evaluate(win, "document.querySelector('#store')?.textContent === 'store updated'"));
          assert.notEqual(await evaluate(win, 'window.boot'), boots[index]);
          assert.equal(await evaluate(win, "document.querySelector('#count').textContent"), '0');
          boots[index] = await evaluate(win, 'window.boot');
        }
        const context = 'src/frontend/app/locale/locale-context.ts';
        await change(context, (await fs.readFile(path.join(directory, context), 'utf8')) + '\\n// context changed\\n');
        for (const [index, win] of windows.entries()) {
          await until(async () => (await evaluate(win, 'window.boot')) !== boots[index]);
          await until(() => evaluate(win, "document.querySelector('#message') !== null"));
        }
        assert.deepEqual(errors, []);
        process.stdout.write('HMR_OK');
        app.exit(0);
      })().catch(async error => {
        console.error(error, messages);
        for (const win of windows) console.error(await evaluate(win, "({message:document.querySelector('#message')?.textContent, boot:window.boot})"));
        app.exit(1);
      });
    `,
    );
    const electron = createRequire(import.meta.url)("electron");
    const env = { ...process.env, NODE_OPTIONS: "" };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await promisify(execFile)(electron, [path.join(directory, "main.cjs")], {
      windowsHide: true,
      timeout: 60_000,
      env,
      maxBuffer: 2 * 1024 * 1024,
    });
    expect(result.stdout).toContain("HMR_OK");
  } finally {
    await server?.close();
    // 临时目录由本测试创建，node_modules 是联接，fs.rm 删除联接本身。
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 90_000);
