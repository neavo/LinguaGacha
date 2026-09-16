import { read_pdf_document } from "../backend/file/formats/pdf/pdf-document";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { expect, it } from "vitest";
import { create_pdf_fixture } from "../backend/file/formats/pdf/test-support";
import * as mupdf from "mupdf";

it("真实 Electron 复用打印窗口，MuPDF 裁剪、中文合并与取消后释放", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linguagacha-pdf-host-"));
  try {
    const runtime =
      process.env.LINGUAGACHA_TEST_WORKSPACE_RUNTIME ?? path.resolve("build/resources/workspace");
    await fs.symlink(
      path.join(runtime, "node_modules"),
      path.join(directory, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await build({
      configFile: false,
      logLevel: "silent",
      resolve: { conditions: ["node"], mainFields: ["module", "main"] },
      build: {
        outDir: path.join(directory, "bundle"),
        lib: {
          entry: {
            host: path.resolve("src/native/pdf-host.ts"),
            document: path.resolve("src/backend/file/formats/pdf/pdf-document.ts"),
          },
          formats: ["es"],
          fileName: (_format, name) => `${name}.mjs`,
        },
        rolldownOptions: { external: ["electron", /^node:/u, "mupdf"], platform: "node" },
        minify: false,
      },
    });
    const source = create_pdf_fixture();
    await fs.writeFile(path.join(directory, "source.pdf"), source);
    const parsed = read_pdf_document(source);
    parsed.translation = {
      reviewed_pages: [1, 2, 3],
      notes: "",
      sections: [
        {
          page_start: 1,
          page_end: 1,
          markdown:
            "# 中文研究报告\n\n跨页内容已经整理为连续的语义段落。\n\n| 项目 | 结果 |\n| --- | --- |\n| 准确率 | 98% |\n| 页数 | 3 |\n\n## 结果说明\n\n- 来源身份稳定\n- 停止后继续处理\n\n图例：蓝色矩形。",
        },
      ],
    };
    await fs.writeFile(path.join(directory, "document.json"), JSON.stringify(parsed));
    const entry = path.join(directory, "main.mjs");
    await fs.writeFile(
      entry,
      `
      import { app, BrowserWindow } from 'electron';
      import fs from 'node:fs/promises';
      import assert from 'node:assert/strict';
      import { create_pdf_host } from ${JSON.stringify(pathToFileURL(path.join(directory, "bundle/host.mjs")).href)};
      import * as mupdf from "mupdf";
      import { build_pdf_document, render_pdf_page } from ${JSON.stringify(pathToFileURL(path.join(directory, "bundle/document.mjs")).href)};
      app.commandLine.appendSwitch('disable-gpu');
      void (async () => {
      await app.whenReady();
      app.on('window-all-closed', () => {});
      try {
        const host = create_pdf_host();
        const source = new Uint8Array(await fs.readFile(${JSON.stringify(path.join(directory, "source.pdf"))}));
        const source_pdf = new mupdf.PDFDocument(source);
        const image = render_pdf_page(source_pdf,{page:3,scale:1,region:{page:3,x:40,y:180,width:120,height:80}}); source_pdf.destroy();
        await fs.writeFile(${JSON.stringify(path.join(directory, "crop.png"))}, image);
        assert.equal(Buffer.from(image).toString('ascii',1,4), 'PNG');
        const document = JSON.parse(await fs.readFile(${JSON.stringify(path.join(directory, "document.json"))}, 'utf8'));
        const output = await build_pdf_document({
          title: '中文 PDF 验证', document, source_bytes: source,
          print: html => host({kind:'print_pdf',html: html + '<script>document.body.textContent="UNSAFE_SCRIPT_EXECUTED"</script>'}),
        });
        await fs.writeFile(${JSON.stringify(path.join(directory, "translated.pdf"))}, output);
        const output_pdf = new mupdf.PDFDocument(output);
        const rendered = render_pdf_page(output_pdf,{page:1,scale:1.5});
        await fs.writeFile(${JSON.stringify(path.join(directory, "translated.png"))}, rendered);
        const original_page = render_pdf_page(output_pdf,{page:3,scale:1.5}); output_pdf.destroy();
        await fs.writeFile(${JSON.stringify(path.join(directory, "original.png"))}, original_page);
        await host({kind:'print_pdf',html:'<!--' + 'x'.repeat(2_100_000) + '--><p>Second document</p>'});
        assert.equal(BrowserWindow.getAllWindows().length,1);
        const controller = new AbortController();
        const cancelled = host({kind:'print_pdf',html:'<p>Cancelled</p>'}, controller.signal);
        await new Promise(resolve => setImmediate(resolve));
        controller.abort();
        await assert.rejects(cancelled);
        await host({kind:"print_pdf",html:"<p>After cancel</p>"});
        await host.dispose();
        assert.equal(BrowserWindow.getAllWindows().length, 0);
        process.stdout.write('PDF_HOST_OK'); app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
      })();
    `,
    );
    const electron =
      process.env.LINGUAGACHA_TEST_ELECTRON ??
      (createRequire(import.meta.url)("electron") as string);
    const environment: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "" };
    delete environment.ELECTRON_RUN_AS_NODE;
    const result = await promisify(execFile)(electron, [entry], {
      windowsHide: true,
      timeout: 60_000,
      env: environment,
      maxBuffer: 2 * 1024 * 1024,
    });
    expect(result.stdout).toContain("PDF_HOST_OK");
    const document = new mupdf.PDFDocument(
      new Uint8Array(await fs.readFile(path.join(directory, "translated.pdf"))),
    );
    try {
      expect(document.countPages()).toBe(3);
      const read_text = (index: number) => {
        const page = document.loadPage(index);
        const text = page.toStructuredText("");
        try {
          return text.asText().replaceAll(/\s/g, "");
        } finally {
          text.destroy();
          page.destroy();
        }
      };
      expect(read_text(1)).toContain("secondhalf");
      expect(read_text(0)).toContain("中文研究报告");
      expect(read_text(0)).not.toContain("UNSAFE_SCRIPT_EXECUTED");
    } finally {
      document.destroy();
    }
    // 可选 QA 目录只保留本次生成物，便于人工检查真实 Chromium 版式。
    if (process.env.LINGUAGACHA_PDF_QA_DIR) {
      await fs.mkdir(process.env.LINGUAGACHA_PDF_QA_DIR, { recursive: true });
      for (const name of ["translated.pdf", "translated.png", "crop.png", "original.png"])
        await fs.copyFile(
          path.join(directory, name),
          path.join(process.env.LINGUAGACHA_PDF_QA_DIR, name),
        );
    }
  } finally {
    await fs.unlink(path.join(directory, "node_modules"));
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 90_000);
