import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "vite";
import { it } from "vitest";

it("仓库外 Electron 从部署目录加载原生绑定并生成可解析译文文件", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rm-deployment-"));
  const runtime =
    process.env["LINGUAGACHA_TEST_WORKSPACE_RUNTIME"] ?? path.resolve("build/resources/workspace");
  const electron =
    process.env["LINGUAGACHA_TEST_ELECTRON"] ??
    (createRequire(import.meta.url)("electron") as string);
  const entry = path.join(temp.path, "entry.ts");
  const module = path.resolve("src/backend/file/rpgmaker-mv-mz");
  fs.writeFileSync(
    entry,
    `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import { RPGMakerMvMzFormat } from ${JSON.stringify(pathToFileURL(path.join(module, "rpgmaker-format.ts")).href)};
    import { configure_rpgmaker_parser, read_javascript_strings } from ${JSON.stringify(pathToFileURL(path.join(module, "javascript.ts")).href)};
    configure_rpgmaker_parser(process.argv[2]);
    const format = new RPGMakerMvMzFormat({target_language:"ZH"});
    const bytes = Buffer.from('const s = "中文😀";');
    const items = await format.read_from_stream(bytes, "js/plugins/test.js");
    assert.equal(items.length, 1);
    items[0].status = "PROCESSED";
    items[0].dst = '译文"\\\\😀';
    const output = await format.render(bytes, "js/plugins/test.js", items);
    fs.writeFileSync("translated.js", output);
    assert.equal(read_javascript_strings(fs.readFileSync("translated.js", "utf8"))[0].src, items[0].dst);
    console.log("rpgmaker-deployment-ok");
  `,
  );
  await build({
    configFile: false,
    logLevel: "silent",
    build: {
      ssr: entry,
      target: "node24",
      outDir: path.join(temp.path, "bundle"),
      rolldownOptions: { output: { entryFileNames: "smoke.mjs" } },
    },
    ssr: { noExternal: true },
  });
  const result = await promisify(execFile)(
    electron,
    [path.join(temp.path, "bundle/smoke.mjs"), runtime],
    {
      cwd: temp.path,
      windowsHide: true,
      timeout: 30000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    },
  );
  assert.match(result.stdout, /rpgmaker-deployment-ok/u);
}, 60000);
