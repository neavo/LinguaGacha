import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, inject, it } from "vitest";
import { AgentExecutionRuntime } from "../execution/runtime";
import { AgentWorkspaceRunner } from "../workspace/runtime/runner";
import { AGENT_WORKSPACE_RUN_ROOT } from "../workspace/runtime/policy";
import { AGENT_WORKSPACE_CONTRACT } from "../tools/contract";

it.runIf(process.env.LINGUAGACHA_MEDIA_SOURCE)(
  "real workspace prepares media and completes listen, scan and refine",
  async () => {
    const root = path.resolve(process.env.LINGUAGACHA_MEDIA_REPORT ?? "output/media-acceptance");
    const workspace = path.join(root, "workspace");
    await mkdir(path.join(workspace, AGENT_WORKSPACE_RUN_ROOT), { recursive: true });
    await writeFile(path.join(workspace, "package.json"), '{"type":"module"}');
    await writeFile(
      path.join(workspace, "contract.json"),
      JSON.stringify(AGENT_WORKSPACE_CONTRACT),
    );
    const runtime = inject("workspaceRuntimeDirectory");
    const executable =
      process.env.LINGUAGACHA_TEST_ELECTRON ??
      (createRequire(import.meta.url)("electron") as string);
    const execution = new AgentExecutionRuntime({
      runtimeDirectory: runtime,
      fontsDirectory: path.resolve("public/fonts"),
      executablePath: executable,
      electronVersion: "45.2.3",
      paths: {
        get_agent_node_root_dir: () => path.join(root, "node"),
        get_agent_models_dir: () => path.join(root, "models"),
        get_agent_media_cache_dir: () => path.join(root, "cache/media"),
        get_agent_python_root_dir: () => path.join(root, "python"),
        get_agent_execution_lock_path: () => path.join(root, "node.lock"),
        get_user_data_path: (...parts) => path.join(root, "userdata", ...parts),
      },
      proxyResolver: { resolveProxy: async () => "DIRECT" },
    });
    const scriptPath = `${AGENT_WORKSPACE_RUN_ROOT}/media.mjs`;
    await writeFile(
      path.join(workspace, scriptPath),
      `
    import * as media from '@lg/media';
    import { uv } from '@lg/uv';
    import fs from 'node:fs/promises';
    import assert from 'node:assert/strict';
    const source = ${JSON.stringify(path.resolve(process.env.LINGUAGACHA_MEDIA_SOURCE!))};
    const began = Date.now();
    console.log('before', JSON.stringify(await media.missing(["speech"])));
    const missing = await media.setup(["speech"]);
    assert.deepEqual(missing, { packages: [], python: [], models: [] });
    const info = await media.inspect(source);
    if (info.video) await media.setup(["text"]);
    // media.test.py 同时检查检测后处理，只在准备了检测用途时执行。
    for (const test of ${JSON.stringify(["fsmn_vad.test.py", "media.test.py"].map((file) => path.resolve("src/backend/agent/media", file)))})
      if (info.video || test.endsWith('fsmn_vad.test.py')) await uv.run(['run', 'python', '-I', test, ${JSON.stringify(path.join(runtime, "runtime"))}]);
    const listened = await media.listen(source, {language:${JSON.stringify(process.env.LINGUAGACHA_MEDIA_LANGUAGE ?? "JA")} });
    const scanned = info.video ? await media.scan(source, {directory:'work/scan', out:'work/scan/text'}) : [];
    const refined = info.video ? await media.refine(source, {directory:'work/scan', rows:scanned.slice(0,2).map((x,row)=>({...x,row}))}) : [];
    await fs.writeFile('work/result.json', JSON.stringify({versions:process.versions, elapsed:Date.now()-began, listened, scanned, refined, video:info.video}, null, 2));
    console.log('completed', listened.asr.length, scanned.length, refined.length);
  `,
    );
    try {
      const runner = new AgentWorkspaceRunner({
        paths: {
          get_agent_user_skill_dir: () => path.join(root, "skills"),
          get_agent_builtin_skill_dir: () => path.join(root, "builtin"),
        },
        execution,
        proxyResolver: { resolveProxy: async () => "DIRECT" },
      });
      const result = await runner.run(
        {
          workspacePath: workspace,
          scriptPath,
          stdoutPath: `${AGENT_WORKSPACE_RUN_ROOT}/stdout.log`,
          stderrPath: `${AGENT_WORKSPACE_RUN_ROOT}/stderr.log`,
          timeoutMs: 900_000,
        },
        AbortSignal.timeout(900_000),
      );
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(
        await readFile(path.join(workspace, "work/result.json"), "utf8"),
      ) as { listened: { speech: number[][] }; scanned: unknown[]; video: unknown };
      expect(report.listened.speech.length).toBeGreaterThan(0);
      if (report.video) expect(report.scanned.length).toBeGreaterThan(0);
      const retryPath = `${AGENT_WORKSPACE_RUN_ROOT}/retry.mjs`;
      await writeFile(
        path.join(workspace, retryPath),
        `
        import * as media from '@lg/media';
        console.log('inference starting');
        const result = await media.listen(${JSON.stringify(path.resolve(process.env.LINGUAGACHA_MEDIA_SOURCE!))}, {language:${JSON.stringify(process.env.LINGUAGACHA_MEDIA_LANGUAGE ?? "JA")}});
        console.log('inference completed', result.asr.length);
      `,
      );
      const request = {
        workspacePath: workspace,
        scriptPath: retryPath,
        timeoutMs: 120_000,
        stdoutPath: `${AGENT_WORKSPACE_RUN_ROOT}/cancel.stdout.log`,
        stderrPath: `${AGENT_WORKSPACE_RUN_ROOT}/cancel.stderr.log`,
      };
      await expect(runner.run(request, AbortSignal.timeout(2500))).rejects.toThrow();
      expect(await readFile(path.join(workspace, request.stdoutPath), "utf8")).toContain(
        "inference starting",
      );
      const recovered = await runner.run(
        {
          ...request,
          stdoutPath: `${AGENT_WORKSPACE_RUN_ROOT}/retry.stdout.log`,
          stderrPath: `${AGENT_WORKSPACE_RUN_ROOT}/retry.stderr.log`,
        },
        AbortSignal.timeout(120_000),
      );
      expect(recovered.exitCode).toBe(0);
    } finally {
      await execution.close();
    }
  },
  960_000,
);
