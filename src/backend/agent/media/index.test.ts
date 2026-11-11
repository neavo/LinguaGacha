import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, inject, it } from "vitest";
import { AgentExecutionRuntime } from "../execution/runtime";
import { AgentWorkspaceRunner } from "../workspace/runtime/runner";
import { AGENT_WORKSPACE_RUN_ROOT } from "../workspace/runtime/policy";
import { AGENT_WORKSPACE_CONTRACT } from "../tools/contract";
import { AgentPackageSources } from "../package-source";

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
    import { npm } from '@lg/npm';
    import fs from 'node:fs/promises';
    import assert from 'node:assert/strict';
    const source = ${JSON.stringify(path.resolve(process.env.LINGUAGACHA_MEDIA_SOURCE!))};
    const began = Date.now();
    console.log('before', JSON.stringify(await media.missing_models()));
    // 依赖按 media 技能「环境准备」的固定版本显式安装，计算入口不再隐式准备。
    await npm.run(['install', '--save-exact', \`ffmpeg-static-electron-v5-\${process.platform}-\${process.arch}@^5.2.5\`, 'onnxruntime-node@1.31.1']);
    await uv.run(['add', 'numpy==2.5.4', 'kaldi-native-fbank==1.23.0', 'opencv-python-headless==5.0.0.93', 'pyclipper==1.4.0']);
    assert.deepEqual(await media.prepare_models(), []);
    const info = await media.inspect(source);
    const probe = await media.probe_gpu();
    console.log('GPU probe', JSON.stringify(probe));
    const device = probe.available ? 'gpu' : 'cpu';
    // media.test.py 同时检查检测后处理，只在准备了检测用途时执行。
    for (const test of ${JSON.stringify(["fsmn_vad.test.py", "media.test.py"].map((file) => path.resolve("src/backend/agent/media", file)))})
      if (info.video || test.endsWith('fsmn_vad.test.py')) await uv.run(['run', 'python', '-I', test, ${JSON.stringify(path.join(runtime, "runtime"))}]);
    const listened = await media.listen(source, {device, language:${JSON.stringify(process.env.LINGUAGACHA_MEDIA_LANGUAGE ?? "JA")} });
    const scanned = info.video ? await media.scan(source, {out:'work/scan/text',device}) : [];
    const refined = info.video ? await media.refine(source, {device,rows:scanned.slice(0,2).map((x,row)=>({...x,row}))}) : [];
    await fs.writeFile('work/result.json', JSON.stringify({versions:process.versions, elapsed:Date.now()-began, listened, scanned, refined, probe, device, video:info.video}, null, 2));
    console.log('completed', listened.asr.length, scanned.length, refined.length);
  `,
    );
    const package_sources = new AgentPackageSources({ log: console.log }); // 同一验收对话共用判定
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
          packageSource: (signal) => package_sources.resolve("acceptance", signal),
        },
        AbortSignal.timeout(900_000),
      );
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(
        await readFile(path.join(workspace, "work/result.json"), "utf8"),
      ) as { listened: { speech: number[][] }; scanned: unknown[]; video: unknown };
      expect(report.listened.speech.length).toBeGreaterThan(0);
      if (report.video) expect(report.scanned.length).toBeGreaterThan(0);
      // 显式设备覆盖在独立运行中验收，短片只验证双路执行与正常退出。
      if (report.video) {
        const overridePath = `${AGENT_WORKSPACE_RUN_ROOT}/override.mjs`;
        await writeFile(
          path.join(workspace, overridePath),
          `
          import * as media from '@lg/media';
          import fs from 'node:fs/promises';
          import assert from 'node:assert/strict';
          await media.ffmpeg(['-y','-i',${JSON.stringify(path.resolve(process.env.LINGUAGACHA_MEDIA_SOURCE!))},'-t','2','-c','copy','work/short.mp4']);
          const result = await media.scan('work/short.mp4', {out:'work/override/text',device:'cpu'});
          assert.ok(Array.isArray(result));
          await fs.writeFile('work/override.json',JSON.stringify({device:'cpu',regions:result.length}));
          console.log('explicit CPU completed',result.length);
        `,
        );
        const override = await runner.run(
          {
            workspacePath: workspace,
            scriptPath: overridePath,
            timeoutMs: 120_000,
            stdoutPath: `${AGENT_WORKSPACE_RUN_ROOT}/override.stdout.log`,
            stderrPath: `${AGENT_WORKSPACE_RUN_ROOT}/override.stderr.log`,
          },
          AbortSignal.timeout(120_000),
        );
        expect(override.exitCode).toBe(0);
      }
      const retryPath = `${AGENT_WORKSPACE_RUN_ROOT}/retry.mjs`;
      await writeFile(
        path.join(workspace, retryPath),
        `
        import * as media from '@lg/media';
        console.log('inference starting');
        const result = await media.listen(${JSON.stringify(path.resolve(process.env.LINGUAGACHA_MEDIA_SOURCE!))}, {device:"cpu",language:${JSON.stringify(process.env.LINGUAGACHA_MEDIA_LANGUAGE ?? "JA")}});
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
      package_sources.close();
      await execution.close();
    }
  },
  960_000,
);
