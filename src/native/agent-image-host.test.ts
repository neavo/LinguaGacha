import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { expect, it } from "vitest";

it("真实 Chromium 转换、缩小、透明度、规范字节复用与取消释放", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linguagacha-image-"));
  try {
    await build({
      configFile: false,
      logLevel: "silent",
      build: {
        outDir: path.join(directory, "bundle"),
        lib: {
          entry: {
            host: path.resolve("src/native/agent-image-host.ts"),
            service: path.resolve("src/backend/agent/agent-image-service.ts"),
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
      import assert from 'node:assert/strict';
      import { prepare_agent_image } from ${JSON.stringify(pathToFileURL(path.join(directory, "bundle/host.mjs")).href)};
      import { AgentImageService, AGENT_IMAGE_POLICY } from ${JSON.stringify(pathToFileURL(path.join(directory, "bundle/service.mjs")).href)};
      app.commandLine.appendSwitch('disable-gpu');
      app.on('window-all-closed', () => {});
      void (async () => {
        await app.whenReady();
        try {
          const fixture = new BrowserWindow({show:false});
          await fixture.loadURL('about:blank');
          const png = await fixture.webContents.executeJavaScript(
            "(() => { const c=document.createElement('canvas'); c.width=4000;c.height=2000; const x=c.getContext('2d'); x.fillStyle='red';x.fillRect(100,100,300,300); return c.toDataURL('image/png').split(',')[1]; })()"
          );
          fixture.destroy();
          const images = new AgentImageService(prepare_agent_image);
          const image = await images.prepare_base64(png);
          assert.equal(image.mimeType, 'image/webp');
          assert.equal(image.originalWidth, 4000);
          assert.equal(image.originalHeight, 2000);
          const canonical = await images.prepare_base64(image.data);
          assert.equal(canonical.data, image.data);
          assert.equal(canonical.originalWidth, image.width);
          assert.ok(image.width < 4000 && image.width / image.height === 2);
          const verifier = new BrowserWindow({show:false});
          await verifier.loadURL('about:blank');
          const decoded = await verifier.webContents.executeJavaScript(
            '(async () => { const b=await createImageBitmap(new Blob([Uint8Array.from(atob(' + JSON.stringify(image.data) + '),c=>c.charCodeAt(0))],{type:"image/webp"})); const c=document.createElement("canvas"); c.width=b.width;c.height=b.height;const x=c.getContext("2d");x.drawImage(b,0,0);const result={width:b.width,alpha:x.getImageData(0,0,1,1).data[3]};b.close();return result; })()'
          );
          verifier.destroy();
          assert.equal(decoded.width, image.width);
          assert.equal(decoded.alpha, 0);
          images.clear();
          const reused = await images.prepare_base64(image.data);
          assert.equal(reused.data, image.data);
          const bytes = Buffer.from(png, 'base64');
          const small = await prepare_agent_image({ kind:'prepare_image',bytes,mimeType:'image/png',policy:{...AGENT_IMAGE_POLICY,maxBytes:2048}}, new AbortController().signal);
          assert.ok(small.bytes.length <= 2048);
          await assert.rejects(images.prepare(Buffer.from([137,80,78,71,13,10,26,10])));
          const controller = new AbortController();
          const pending = prepare_agent_image({kind:'prepare_image',bytes,mimeType:'image/png',policy:AGENT_IMAGE_POLICY}, controller.signal);
          controller.abort();
          await assert.rejects(pending);
          assert.equal(BrowserWindow.getAllWindows().length, 0);
          process.stdout.write('IMAGE_HOST_OK');
          app.exit(0);
        } catch (error) { console.error(error); app.exit(1); }
      })();
    `,
    );
    const environment: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "" };
    delete environment.ELECTRON_RUN_AS_NODE;
    const electron =
      process.env.LINGUAGACHA_TEST_ELECTRON ??
      (createRequire(import.meta.url)("electron") as string);
    const result = await promisify(execFile)(electron, [entry], {
      windowsHide: true,
      timeout: 60_000,
      env: environment,
      maxBuffer: 2 * 1024 * 1024,
    });
    expect(result.stdout).toContain("IMAGE_HOST_OK");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 90_000);
