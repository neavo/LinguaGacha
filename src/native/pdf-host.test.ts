import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { inject, expect, it } from "vitest";

it("真实打印嵌入共享字体、隔离脚本并在取消后继续调度", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linguagacha-pdf-host-"));
  try {
    const runtime = inject("workspaceRuntimeDirectory");
    await build({
      configFile: false,
      logLevel: "silent",
      resolve: { conditions: ["node"], mainFields: ["module", "main"] },
      build: {
        outDir: path.join(directory, "bundle"),
        lib: {
          entry: {
            host: path.resolve("src/native/pdf-host.ts"),
          },
          formats: ["es"],
          fileName: (_format, name) => `${name}.mjs`,
        },
        rolldownOptions: { external: ["electron", /^node:/u], platform: "node" },
        minify: false,
      },
    });
    const entry = path.join(directory, "main.mjs");
    await fs.writeFile(
      entry,
      `
      import { app, BrowserWindow } from 'electron';
      import fs from 'node:fs/promises';
      import assert from 'node:assert/strict';
      import { create_pdf_host } from ${JSON.stringify(pathToFileURL(path.join(directory, "bundle/host.mjs")).href)};
      app.setPath('userData', ${JSON.stringify(path.join(directory, "user-data"))}); // 并发 Electron 实例各用独立缓存。
      app.commandLine.appendSwitch('disable-gpu');
      void (async () => {
      await app.whenReady();
      app.on('window-all-closed', () => {});
      try {
        const host = create_pdf_host(${JSON.stringify({
          fontsDirectory: path.resolve(runtime, "..", "fonts"),
        })});
        const html = \`<style>body { font-family: LGBaseFont } .second { break-before: page }</style><p>中文报告</p><p class="second">Second page</p><script>document.body.replaceChildren()</script>\`;
        const output = await host({kind:"print_pdf", html});
        await fs.writeFile(${JSON.stringify(path.join(directory, "host.pdf"))}, output);
        assert.equal(BrowserWindow.getAllWindows().length, 0);
        let activeFinished = false;
        const active = host({kind:'print_pdf',html:'<p>Active print</p>'}).finally(() => { activeFinished = true; });
        const queuedController = new AbortController();
        const queuedReason = new Error('cancel queued preview');
        const queued = host({kind:'print_pdf',html:'<p>Queued preview</p>'}, queuedController.signal);
        queuedController.abort(queuedReason);
        await assert.rejects(queued, error => error === queuedReason);
        assert.equal(activeFinished, false, "排队取消应在活动打印完成前返回");
        assert.ok((await active).length > 0);
        const interrupted = new AbortController();
        const reason = new Error('cancel active preview');
        let following;
        // 在真实页面脚本开始等待后触发取消，覆盖窗口销毁后 Promise 悬挂的时序。
        function when_script_waits(action) {
          app.once('web-contents-created', (_event, contents) => {
            const execute = contents.executeJavaScript.bind(contents);
            contents.executeJavaScript = (...args) => {
              const result = execute(...args);
              if (args[0].includes('document.fonts.ready')) setImmediate(action);
              return result;
            };
          });
        }
        const cancellation = Promise.withResolvers();
        let guard;
        when_script_waits(() => {
          following = host({kind:'print_pdf',html:'<p>Agent after preview</p>'});
          // 只计取消收尾时间，窗口加载和字体准备由外层进程超时约束。
          guard = setTimeout(() => cancellation.reject(new Error('Cancellation did not settle')), 3000);
          interrupted.abort(reason);
        });
        try {
          await assert.rejects(Promise.race([
            host({kind:'print_pdf',html:'<p>Preview to cancel</p>'}, interrupted.signal),
            cancellation.promise,
          ]), error => error === reason);
        } finally { clearTimeout(guard); }
        assert.ok((await following).length > 0);
        // 关闭宿主也须中断活动脚本、跳过排队任务并排空资源。
        let closing;
        when_script_waits(() => { closing = host.dispose(); });
        await Promise.all([
          assert.rejects(host({kind:'print_pdf',html:'<p>Active during dispose</p>'})),
          assert.rejects(host({kind:'print_pdf',html:'<p>Queued during dispose</p>'})),
        ]);
        await closing;
        await assert.rejects(host({kind:'print_pdf',html:'<p>After dispose</p>'}));
        assert.equal(BrowserWindow.getAllWindows().length, 0);
        process.stdout.write('PDF_HOST_OK'); app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
      })();
    `,
    );
    // 打包应用只启动产品入口，打印探针必须由开发 Electron 加载自己的入口。
    const electron = createRequire(import.meta.url)("electron") as string;
    const environment: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "" };
    delete environment.ELECTRON_RUN_AS_NODE;
    const result = await promisify(execFile)(electron, [entry], {
      windowsHide: true,
      timeout: 60_000,
      env: environment,
      maxBuffer: 2 * 1024 * 1024,
    });
    expect(result.stdout).toContain("PDF_HOST_OK");
    const pdf = await fs.readFile(path.join(directory, "host.pdf"), "latin1");
    expect(pdf).toMatch(/^%PDF-/u);
    expect(pdf.match(/\/Type\s*\/Page\b/gu)).toHaveLength(2);
    expect(pdf).toMatch(/\/FontFile2\s+\d+\s+0\s+R/u);
    expect(pdf).toMatch(/\/BaseFont\s*\/[^\s]*LGBaseFont/u);
    const qa = process.env.LINGUAGACHA_PDF_QA_DIR;
    if (qa) {
      await fs.mkdir(qa, { recursive: true });
      await fs.copyFile(path.join(directory, "host.pdf"), path.join(qa, "host.pdf"));
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 90_000);
