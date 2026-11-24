import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, inject, it } from "vitest";
import { AgentExecutionRuntime } from "../execution/runtime";
import { AgentWorkspaceRunner } from "../workspace/runtime/runner";
import { AGENT_WORKSPACE_RUN_ROOT } from "../workspace/runtime/policy";
import { AgentPackageSources } from "../package-source";
import { t_main_log } from "../../log/log-text";

const ORT_VERSION = "1.30.0"; // 验收固定运行时版本，核对实际安装结果。

it.runIf(process.env.LINGUAGACHA_MEDIA_SOURCE)(
  "real workspace prepares media and completes listen, scan and refine",
  async () => {
    const root = path.resolve(process.env.LINGUAGACHA_MEDIA_REPORT ?? "output/media-acceptance");
    const workspace = path.join(root, "workspace");
    await mkdir(path.join(workspace, AGENT_WORKSPACE_RUN_ROOT), { recursive: true });
    await writeFile(path.join(workspace, "package.json"), '{"type":"module"}');
    const runtime = inject("workspaceRuntimeDirectory");
    const executable =
      process.env.LINGUAGACHA_TEST_ELECTRON ??
      (createRequire(import.meta.url)("electron") as string);
    const execution = new AgentExecutionRuntime({
      runtimeDirectory: runtime,
      fontsDirectory: path.resolve("public/fonts"),
      executablePath: executable,
      electronVersion: createRequire(import.meta.url)("electron/package.json").version as string,
      paths: {
        get_agent_node_root_dir: () => path.join(root, "node"),
        get_agent_models_dir: () => path.join(root, "models"),
        get_agent_media_cache_dir: () => path.join(root, "cache/media"),
        get_agent_python_root_dir: () => path.join(root, "python"),
        get_agent_preparation_lock_path: () => path.join(root, "node.lock"),
        get_user_data_path: (...parts) => path.join(root, "userdata", ...parts),
      },
      proxyResolver: { resolveProxy: async () => "DIRECT" },
    });
    const scriptPath = `${AGENT_WORKSPACE_RUN_ROOT}/media.mjs`;
    const helper = JSON.stringify(
      new URL("../../../../builtin/skills/media/scripts/helper.py", import.meta.url).href,
    );
    await writeFile(
      path.join(workspace, scriptPath),
      `
    import * as media from '@lg/media';
    import { uv } from '@lg/uv';
    import { npm } from '@lg/npm';
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import assert from 'node:assert/strict';
    const pipeline = media.create_media_pipeline(new URL(${helper}));
    const source = ${JSON.stringify(path.resolve(process.env.LINGUAGACHA_MEDIA_SOURCE!))};
    await assert.rejects(pipeline.scan(source, {out:'work/scan/text',device:'auto'}), /cpu or gpu/);
    const began = Date.now();
    console.log('before', JSON.stringify(await media.missing_models()));
    const ortPackage = path.join(npm.directory, 'node_modules/onnxruntime-node/package.json');
    const previousOrt = JSON.parse(await fs.readFile(ortPackage, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '{}';
      throw error;
    })).version ?? null;
    await npm.run(['install', '--save-exact', \`ffmpeg-static-electron-v5-\${process.platform}-\${process.arch}@5.2.5\`, ${JSON.stringify(`onnxruntime-node@${ORT_VERSION}`)}]);
    const installedOrt = JSON.parse(await fs.readFile(ortPackage, 'utf8')).version;
    assert.equal(installedOrt, ${JSON.stringify(ORT_VERSION)});
    await uv.run(['add', 'kaldi-native-fbank==1.23.1', 'numpy==2.5.5', 'opencv-python-headless==5.1.0.95', 'pyclipper==1.4.0']);
    await media.prepare_models();
    const info = await media.inspect(source);
    const run = async device => {
      const listened = await pipeline.listen(source, {device, language:${JSON.stringify(process.env.LINGUAGACHA_MEDIA_LANGUAGE ?? "JA")} });
      const scanned = info.video ? await pipeline.scan(source, {out:'work/scan/text',device}) : [];
      const refined = info.video ? await pipeline.refine(source, {device,rows:scanned.slice(0,2).map((x,row)=>({...x,row}))}) : [];
      return {listened, scanned, refined};
    };
    let device = 'gpu';
    let completed;
    try {
      completed = await run(device);
    } catch (error) {
      if (!(error instanceof media.DeviceFailure)) throw error;
      device = 'cpu';
      completed = await run(device);
    }
    const {listened, scanned, refined} = completed;
    await fs.writeFile('work/result.json', JSON.stringify({versions:process.versions, ort:{before:previousOrt,after:installedOrt}, elapsed:Date.now()-began, listened, scanned, refined, device, video:info.video}, null, 2));
    console.log('completed', listened.asr.length, scanned.length, refined.length);
  `,
    );
    const package_sources = new AgentPackageSources({ log: console.log, t: t_main_log });
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
          packageSource: (signal) => package_sources.resolve(signal),
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
          const pipeline = media.create_media_pipeline(new URL(${helper}));
          await media.ffmpeg(['-y','-i',${JSON.stringify(path.resolve(process.env.LINGUAGACHA_MEDIA_SOURCE!))},'-t','2','-c','copy','work/short.mp4']);
          const result = await pipeline.scan('work/short.mp4', {out:'work/override/text',device:'cpu'});
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
        import { create_media_pipeline } from '@lg/media';
        const { listen } = create_media_pipeline(new URL(${helper}));
        console.log('inference starting');
        const result = await listen(${JSON.stringify(path.resolve(process.env.LINGUAGACHA_MEDIA_SOURCE!))}, {device:"cpu",language:${JSON.stringify(process.env.LINGUAGACHA_MEDIA_LANGUAGE ?? "JA")}});
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
