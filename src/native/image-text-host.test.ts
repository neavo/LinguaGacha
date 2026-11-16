import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { expect, inject, it } from "vitest";
import { IMAGE_TEXT_RULES } from "../shared/image-text";

it("真实 Chromium 保持横竖排、原生逐行覆盖、透明像素和取消回收", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lg-image-text-host-"));
  try {
    await build({
      configFile: false,
      logLevel: "silent",
      publicDir: false,
      build: {
        outDir: path.join(directory, "bundle"),
        minify: false,
        lib: {
          entry: path.resolve("src/native/image-text-host.ts"),
          formats: ["es"],
          fileName: () => "host.mjs",
        },
        rolldownOptions: { external: ["electron", /^node:/u], platform: "node" },
      },
    });
    const report = process.env.LINGUAGACHA_IMAGE_TEXT_QA_DIR ?? directory;
    await fs.mkdir(report, { recursive: true });
    const entry = path.join(directory, "main.mjs");
    await fs.writeFile(
      entry,
      `
      import { app, BrowserWindow, nativeImage } from 'electron';
      import fs from 'node:fs/promises';
      import assert from 'node:assert/strict';
      import { create_image_text_host } from ${JSON.stringify(pathToFileURL(path.join(directory, "bundle/host.mjs")).href)};
      app.setPath('userData', ${JSON.stringify(path.join(directory, "user-data"))});
      app.commandLine.appendSwitch('disable-gpu');
      void (async () => {
        await app.whenReady(); app.on('window-all-closed', () => {});
        const host = create_image_text_host(${JSON.stringify({
          fontsDirectory: path.resolve("public/fonts"),
          workspaceRuntimeDirectory: inject("workspaceRuntimeDirectory"),
        })});
        try {
          function page(direction, text, color = [255,255,255], width = 64, height = 76) {
            const distance = Buffer.alloc(width*height*4);
            for(let y=0;y<height;y++)for(let x=0;x<width;x++)distance.writeFloatLE(Math.min(x+1,y+1,width-x,height-y),(y*width+x)*4);
            const block={blockId:'B1',box:[0,0,width,height],distance:distance.toString('base64'),centroid:[width/2,height/2]};
            return {kind:'render_image_text_page',page:{pageId:'p1',width,height,regions:[{regionId:'r1',text,direction,fill:{color},preferredFontSize:12,sourceLineCount:3,candidates:[{candidateId:'C0',blocks:[block]}]}]}};
          }
          const samples = [
            page('horizontal-tb','中文「你好！」'),
            page('vertical-rl','日本語１２！'),
            page('horizontal-tb','New York\\n\\ncafé', [0,0,0]),
            page('vertical-rl','AB12中文'),
            // 竖排及空白段落复用同一候选模型，实际字形由最终像素验收。
            page('vertical-rl','これで春からまた一緒だね!!', [255,255,255], 44, 86),
            page('horizontal-tb','你好'),
            page('horizontal-tb','GRIS, HAVE YOU SEEN MY CREDIT CARD?'),
            page('horizontal-tb','LongWordWithoutSpaces0123456789 中文「A12」 café'),
            page('horizontal-tb','abc 12 \\u202EABC\\u202C 中文'),
          ];
          const results=[];
          let captures=0;
          let rejectNextCapture=false;
          app.on('web-contents-created',(_event,contents)=>{
            const send=contents.debugger.sendCommand.bind(contents.debugger);
            contents.debugger.sendCommand=async (...args)=>{
              const result=await send(...args);
              if(args[0]==='Page.captureScreenshot' && rejectNextCapture){
                rejectNextCapture=false;
                const size=nativeImage.createFromDataURL('data:image/png;base64,'+result.data).getSize();
                result.data=nativeImage.createFromBitmap(Buffer.alloc(size.width*size.height*4),size).toPNG().toString('base64');
              }
              if(args[0]==='Page.captureScreenshot' && ++captures%100===1){
                const state=await contents.executeJavaScript('JSON.stringify({style:document.body.firstChild?.style.cssText,text:document.body.innerText,dpr:devicePixelRatio})');
                await fs.writeFile(${JSON.stringify(path.join(report, "progress.json"))},JSON.stringify({captures,state}));
                await fs.writeFile(${JSON.stringify(path.join(report, "last.png"))},Buffer.from(result.data,'base64'));
              }
              return result;
            };
          });
          for (const [index,sample] of samples.entries()) {
            const start=Date.now();
            const beforeCaptures=captures;
            const result=await host(sample);
            assert.equal(result.regions[0].result.status,'rendered', JSON.stringify(result));
            assert.equal(BrowserWindow.getAllWindows().length,0);
            await fs.writeFile(${JSON.stringify(path.join(report, "sample-"))}+index+'.png',Buffer.from(result.regions[0].png,'base64'));
            if(index===0)assert.equal(captures-beforeCaptures,1,'A fitting candidate needs only its final raster');
            results.push({result:result.regions[0].result, captures:captures-beforeCaptures, elapsedMs:Date.now()-start,environment:result.environment});
          }
          const multi = structuredClone(samples[0]);
          multi.page.width *= 2;
          const first=structuredClone(multi.page.regions[0].candidates[0].blocks[0]);
          const second={...first,blockId:'B2',box:[64,0,64,76]};
          multi.page.regions[0].candidates[0].blocks[0].distance=Buffer.alloc(64*76*4).toString('base64');
          multi.page.regions[0].candidates.push({candidateId:'C1',blocks:[first,second]});
          const multiResult = await host(multi);
          assert.deepEqual(multiResult.regions.map(r=>r.result.blockId),['B1','B2']);
          assert(multiResult.regions.every(r=>r.result.status==='rendered'));
          assert(multiResult.regions.every(r=>r.result.candidateId==='C1'));
          assert.equal(new Set(multiResult.regions.map(r=>r.result.fontSize)).size,1);
          const repeat = await host(samples[0]);
          assert.deepEqual(repeat.regions[0].result,results[0].result);
          rejectNextCapture=true;
          const beforeRetry=captures;
          const retried=await host(samples[0]);
          assert.equal(retried.regions[0].result.status,'failed');
          assert.equal(captures-beforeRetry,1,'Only the chosen layout is rasterized');
          // 缺字由 SDK 的实际字体覆盖检查验证。CDP 只能识别系统字体回退，不能识别自带字体的缺字方框。
          const noRoom = page('vertical-rl','字');
          noRoom.page.regions[0].candidates[0].blocks[0].distance=Buffer.alloc(64*76*4).toString('base64');
          const failed = await host(noRoom);
          assert.equal(failed.regions[0].result.reason,'no_fit');
          assert.equal(failed.regions[0].png,undefined);
          let activeDone=false;
          const active=host(page('horizontal-tb','A')).finally(()=>{activeDone=true});
          const queuedController=new AbortController();const reason=new Error('queued cancellation');
          const queued=host(samples[0],queuedController.signal);queuedController.abort(reason);
          await assert.rejects(queued,e=>e===reason);assert.equal(activeDone,false);await active;
          const controller=new AbortController();const stopped=new Error('active cancellation');
          app.once('web-contents-created',(_event,contents)=>{
            const execute=contents.executeJavaScript.bind(contents);
            contents.executeJavaScript=(...args)=>{
              const result=execute(...args);
              if(args[0].startsWith('globalThis.imageTextTask.next'))setImmediate(()=>controller.abort(stopped));
              return result;
            };
          });
          await assert.rejects(host(samples[0],controller.signal),e=>e===stopped);
          assert.equal(BrowserWindow.getAllWindows().length,0);
          await host(page('horizontal-tb','A'));
          app.once('web-contents-created',(_event,contents)=>{
            const execute=contents.executeJavaScript.bind(contents);
            contents.executeJavaScript=(...args)=>{
              const result=execute(...args);
              if(args[0].startsWith('globalThis.imageTextTask.next'))setImmediate(()=>contents.forcefullyCrashRenderer());
              return result;
            };
          });
          await assert.rejects(host(samples[0]));
          assert.equal(BrowserWindow.getAllWindows().length,0);
          const originalTimeout=globalThis.setTimeout;
          globalThis.setTimeout=(callback,ms,...args)=>originalTimeout(callback,ms===${IMAGE_TEXT_RULES.pageTimeoutMs}?1:ms,...args);
          try { await assert.rejects(host(samples[0]),/timed out/); }
          finally { globalThis.setTimeout=originalTimeout; }
          assert.equal(BrowserWindow.getAllWindows().length,0);
          await host(page('horizontal-tb','A'));
          await host.dispose();
          await assert.rejects(host(samples[0]));
          await fs.writeFile(${JSON.stringify(path.join(report, "results.json"))},JSON.stringify(results,null,2));
          console.log('IMAGE_TEXT_HOST_OK');app.exit(0);
        } catch(error) {console.error(error);await host.dispose();app.exit(1)}
      })();
    `,
    );
    const environment: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "" };
    delete environment.ELECTRON_RUN_AS_NODE;
    const result = await promisify(execFile)(
      createRequire(import.meta.url)("electron") as string,
      [entry],
      {
        windowsHide: true,
        timeout: 240_000,
        env: environment,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    expect(result.stdout).toContain("IMAGE_TEXT_HOST_OK");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 250_000);
