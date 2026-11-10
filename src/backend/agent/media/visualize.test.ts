import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, inject, it } from "vitest";
import { AgentExecutionRuntime } from "../execution/runtime";
import { AgentWorkspaceRunner } from "../workspace/runtime/runner";
import { AGENT_WORKSPACE_RUN_ROOT } from "../workspace/runtime/policy";
import { AGENT_WORKSPACE_CONTRACT } from "../tools/contract";

it.runIf(process.env.LINGUAGACHA_VISUALIZE_REPORT)(
  "deployed visualization preserves audio, output and cancellation boundaries with the complete media environment",
  async () => {
    const root = path.resolve(process.env.LINGUAGACHA_VISUALIZE_REPORT!);
    const workspace = path.join(root, "workspace");
    const runtime = inject("workspaceRuntimeDirectory");
    await mkdir(path.join(workspace, AGENT_WORKSPACE_RUN_ROOT), { recursive: true });
    await writeFile(path.join(workspace, "package.json"), '{"type":"module"}');
    await writeFile(
      path.join(workspace, "contract.json"),
      JSON.stringify(AGENT_WORKSPACE_CONTRACT),
    );
    await cp(path.resolve("public/fonts"), path.join(root, "fonts"), { recursive: true });
    const execution = new AgentExecutionRuntime({
      runtimeDirectory: runtime,
      fontsDirectory: path.join(root, "fonts"),
      executablePath:
        process.env.LINGUAGACHA_TEST_ELECTRON ??
        (createRequire(import.meta.url)("electron") as string),
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
    const runner = new AgentWorkspaceRunner({
      execution,
      proxyResolver: { resolveProxy: async () => "DIRECT" },
      paths: {
        get_agent_user_skill_dir: () => path.join(root, "skills"),
        get_agent_builtin_skill_dir: () => path.join(root, "builtin"),
      },
    });
    let sequence = 0;
    const run = async (script: string, signal = AbortSignal.timeout(900_000)) => {
      const scriptPath = `${AGENT_WORKSPACE_RUN_ROOT}/visual-${++sequence}.mjs`;
      await writeFile(path.join(workspace, scriptPath), script);
      return runner.run(
        {
          workspacePath: workspace,
          scriptPath,
          stdoutPath: `${scriptPath}.stdout.log`,
          stderrPath: `${scriptPath}.stderr.log`,
          timeoutMs: 900_000,
        },
        signal,
      );
    };
    try {
      const prepared = await run(`
      import * as media from '@lg/media';
      import { uv } from '@lg/uv';
      import fs from 'node:fs/promises';
      import assert from 'node:assert/strict';
      assert.deepEqual(await media.setup(), {packages:[],python:[],models:[]});
      await uv.run(['run','python','-I', ${JSON.stringify(path.resolve("src/backend/agent/media/visualize.test.py"))}, ${JSON.stringify(path.join(runtime, "runtime"))}]);
      await media.ffmpeg(['-v','error','-y','-f','lavfi','-i','color=c=white:s=1920x1080','-frames:v','1','work/background.png']);
      await fs.writeFile('work/subtitles.ass', '[Script Info]\\nScriptType: v4.00+\\nPlayResX: 1920\\nPlayResY: 1080\\n[V4+ Styles]\\nFormat: Name, Fontname, Fontsize, PrimaryColour, Alignment\\nStyle: Default,LGBaseFont,48,&H002C2725,2\\n[Events]\\nFormat: Layer, Start, End, Style, Text\\nDialogue: 0,0:00:00.00,0:00:02.00,Default,字幕テスト 한글 Latin\\n');
      const cases = [
        ['aac','sine=frequency=440:duration=2','aac'],
        ['fallback','sine=frequency=440:duration=2','pcm_mulaw'],
        ['short','anullsrc=r=24000:cl=stereo:d=0.02','pcm_s16le'],
        ['surround','anullsrc=r=24000:cl=5.1:d=0.2','aac'],
      ];
      const reports = [];
      for (const [name, input, codec] of cases) {
        const source = 'work/' + name + (codec === 'aac' ? '.m4a' : '.wav');
        await media.ffmpeg(['-v','error','-y','-f','lavfi','-i',input,'-c:a',codec,source]);
        const output = 'work/' + name + '.mp4';
        const result = await media.visualize(source,{track:0,background:'work/background.png',subtitles:'work/subtitles.ass',fonts:ws.fontsDirectory,output});
        assert.equal(result.audio, name === 'fallback' ? 'aac' : 'copy');
        await media.ffmpeg(['-v','error','-i',output,'-f','null','-']);
        reports.push(result);
      }
      await media.ffmpeg(['-v','error','-y','-f','lavfi','-i','sine=frequency=880:duration=2','-c:a','aac','work/other.m4a']);
      await media.ffmpeg(['-v','error','-y','-i','work/aac.m4a','-i','work/other.m4a','-i','work/background.png','-map','0:a:0','-map','1:a:0','-map','2:v:0','-c','copy','-disposition:v','attached_pic','work/covered.m4a']);
      const covered = await media.inspect('work/covered.m4a');
      assert.equal(covered.video,null);
      assert.equal(covered.audio.length,2);
      await media.visualize('work/covered.m4a',{track:1,background:'work/background.png',subtitles:'work/subtitles.ass',fonts:ws.fontsDirectory,output:'work/selected.mp4'});
      const hash = async (source,track) => {
        let text='';
        await media.ffmpeg(['-v','error','-i',source,'-map','0:a:'+track,'-c:a','copy','-f','hash','-hash','md5','-'],{consume:async(stdout)=>{for await(const chunk of stdout) text+=chunk;}});
        return text;
      };
      assert.equal(await hash('work/selected.mp4',0),await hash('work/covered.m4a',1));
      const old = await fs.readFile('work/aac.mp4');
      await assert.rejects(media.visualize('work/aac.m4a',{track:0,background:'work/absent.png',subtitles:'work/subtitles.ass',fonts:ws.fontsDirectory,output:'work/aac.mp4'}));
      assert.deepEqual(await fs.readFile('work/aac.mp4'),old);
      await media.ffmpeg(['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=1800','-c:a','aac','work/long.m4a']);
      await fs.writeFile('work/report.json',JSON.stringify(reports,null,2));
    `);
      expect(prepared.exitCode).toBe(0);
      const cancel = `
      import * as media from '@lg/media';
      await media.visualize('work/long.m4a',{track:0,background:'work/background.png',subtitles:'work/subtitles.ass',fonts:ws.fontsDirectory,output:'work/aac.mp4'});
    `;
      const original = await readFile(path.join(workspace, "work/aac.mp4"));
      await expect(run(cancel, AbortSignal.timeout(3000))).rejects.toThrow();
      expect(await readFile(path.join(workspace, "work/aac.mp4"))).toEqual(original);
      const retried = await run(`
      import * as media from '@lg/media';
      const result = await media.visualize('work/aac.m4a',{track:0,background:'work/background.png',subtitles:'work/subtitles.ass',fonts:ws.fontsDirectory,output:'work/aac.mp4'});
      console.log(JSON.stringify(result));
    `);
      expect(retried.exitCode).toBe(0);
    } finally {
      await execution.close();
    }
  },
  960_000,
);
