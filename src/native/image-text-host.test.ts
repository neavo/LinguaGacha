import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { expect, inject, it } from "vitest";

it("真实 Chromium 保持排版、像素门禁和取消回收", async () => {
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
    const report = process.env.LINGUAGACHA_IMAGE_TEXT_QA_DIR;
    if (report) await fs.mkdir(report, { recursive: true });
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
          function page(direction, text, color = [255,255,255], width = 64, height = 76,
            distanceAt = (x,y) => Math.min(x+1,y+1,width-x,height-y)) {
            const distance = Buffer.alloc(width*height*4);
            for(let y=0;y<height;y++)for(let x=0;x<width;x++)distance.writeFloatLE(distanceAt(x,y),(y*width+x)*4);
            const region={regionId:'r1',text,direction,kind:'bubble',backgroundColor:color,box:[0,0,width,height],distance:distance.toString('base64'),sourceLines:[]};
            return {kind:'render_image_text_page',page:{pageId:'p1',regions:[region]}};
          }
          const samples = [
            page('horizontal-tb','中文「你好！」'),
            page('vertical-rl','日本語１２！'),
            page('horizontal-tb','New York\\n\\ncafé', [0,0,0]),
            page('vertical-rl','これで春からまた一緒だね!!', [255,255,255], 44, 86),
            page('horizontal-tb','LongWordWithoutSpaces0123456789 中文「A12」 café'),
            page('horizontal-tb','abc 12 \\u202EABC\\u202C 中文'),
            // 应用字体缺少字形时沿用 Chromium 系统字体回退，并继续执行最终像素门禁。
            page('horizontal-tb','A😀中文'),
          ];
          let rejectNextCapture=false;
          let layouts;
          app.on('web-contents-created',(_event,contents)=>{
            const send=contents.debugger.sendCommand.bind(contents.debugger);
            contents.debugger.sendCommand=async (...args)=>{
              const result=await send(...args);
              if(args[0]==='Page.captureScreenshot' && layouts){
                layouts.push(await contents.executeJavaScript(
                  'Array.from(document.querySelectorAll("span"), line => ({ text: line.textContent, size: parseFloat(line.style.fontSize), top: parseFloat(line.style.top) }))'
                ));
              }
              if(args[0]==='Page.captureScreenshot' && rejectNextCapture){
                rejectNextCapture=false;
                const raster=nativeImage.createFromDataURL('data:image/png;base64,'+result.data);
                const bitmap=raster.toBitmap();
                bitmap[3]=255; // 左上角墨迹落在安全区域之外。
                result.data=nativeImage.createFromBitmap(bitmap,raster.getSize()).toPNG().toString('base64');
              }
              return result;
            };
          });
          const batch = structuredClone(samples[0]);
          batch.page.regions = samples.map(({page}, index) => ({...page.regions[0], regionId:'sample'+index}));
          const rasters = await host(batch);
          for (const [index,paint] of rasters.entries()) {
            assert(paint.png, 'No raster for sample '+index);
            const report=${JSON.stringify(report)};
            if(report) await fs.writeFile(report+'/sample-'+index+'.png',Buffer.from(paint.png,'base64'));
          }
          const text = '桃色吐息式告白眼看做不成了';
          const balanced = page('vertical-rl',text, [255,255,255], 42, 112).page.regions[0];
          const largerBubble = page('vertical-rl',text, [255,255,255], 84, 224).page.regions[0];
          largerBubble.regionId = 'large';
          const round = page('vertical-rl','我不会因此就讨厌你的', [255,255,255], 100, 104, (x,y) => {
            const radius = Math.hypot((x+0.5-50)/49, (y+0.5-52)/51);
            return radius <= 1 ? Math.max(1,(1-radius)*49) : 0;
          }).page.regions[0];
          round.regionId = 'round';
          layouts = [];
          const paints = await host({ kind:'render_image_text_page', page:{ pageId:'p1', regions:[balanced, largerBubble, round] } });
          assert(paints.every(paint => paint.png));
          const [balancedLines, largerBubbleLines, roundLines] = layouts;
          layouts = undefined;
          assert.equal(balancedLines.map(line => line.text).join(''), text);
          assert(balancedLines.length === 2 && Math.abs(balancedLines[0].text.length - balancedLines[1].text.length) <= 1,
            'A narrow bubble should balance both columns');
          assert(largerBubbleLines[0].size > balancedLines[0].size, 'The same translation should grow in a larger container');
          assert(roundLines.length > 1 && roundLines[0].text.length > 1 && roundLines.at(-1).text.length > 1,
            'An oval should avoid single-character outer columns: '+JSON.stringify(roundLines));
          for (const lines of [balancedLines, roundLines]) {
            assert(lines.every(line => line.top === lines[0].top), 'Columns in the same paragraph should share a top: '+JSON.stringify(lines));
          }
          assert.equal(BrowserWindow.getAllWindows().length,0);
          rejectNextCapture=true;
          const adjacent = structuredClone(samples[0]);
          adjacent.page.regions.push({...adjacent.page.regions[0],regionId:'r2',box:[64,0,64,76]});
          const noRoom = page('vertical-rl','字');
          adjacent.page.regions.push({...noRoom.page.regions[0],regionId:'r3',distance:Buffer.alloc(64*76*4).toString('base64')});
          const fallback = await host(adjacent);
          assert.deepEqual(fallback.map(({regionId,png})=>[regionId,Boolean(png)]),[['r1',false],['r2',true],['r3',false]]);
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
          await host.dispose();
          await assert.rejects(host(samples[0]));
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
