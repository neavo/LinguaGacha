import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { inject, it } from "vitest";

it("真实图片宿主保留字面文本和横竖排，检查分块像素并在取消后释放窗口", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lg-image-host-"));
  try {
    await build({
      configFile: false,
      logLevel: "silent",
      build: {
        outDir: path.join(directory, "bundle"),
        lib: {
          entry: path.resolve("src/native/image-host.ts"),
          formats: ["es"],
          fileName: () => "host.mjs",
        },
        rolldownOptions: { external: ["electron", /^node:/u], platform: "node" },
        minify: false,
      },
    });
    const entry = path.join(directory, "main.mjs");
    await fs.writeFile(
      entry,
      `
      import { app, BrowserWindow, nativeImage } from 'electron';
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import assert from 'node:assert/strict';
      import { create_image_host } from ${JSON.stringify(pathToFileURL(path.join(directory, "bundle/host.mjs")).href)};
      const directory=${JSON.stringify(directory)};
      app.setPath('userData',path.join(directory,'user-data'));app.commandLine.appendSwitch('disable-gpu');
      app.on('window-all-closed',()=>{});
      void (async () => { try {
        await app.whenReady();
        const host=create_image_host(${JSON.stringify({ fontsDirectory: path.resolve("public/fonts"), workspaceRuntimeDirectory: inject("workspaceRuntimeDirectory") })});
        const style={color:'#000000',stroke:'#ffffff',strokeWidth:1,weight:700,rotation:0,minFontSize:12,fontSize:24};
        const region=(regionId,text,direction='horizontal-tb')=>({regionId,text,width:256,height:200,direction,style});
        const result=await host({kind:'render_image',outputDirectory:path.join(directory,'layers'),regions:[region('literal','<b>你好</b>🌸\\n字面文字'),region('vertical','日本語12の縦書き。「確認」','vertical-rl'),region('empty',''),region('overflow','長'.repeat(10000)),{...region('wide','分块截图保持原始坐标'),width:1200,height:100},{...region('dark','白字左对齐'),style:{...style,color:'#ffffff',stroke:'#000000',align:'start'}}]},new AbortController().signal);
        assert.deepEqual(result.regions.map(r=>r.ready),[true,true,true,false,true,true]);
        let covered=0;
        for(const tile of result.regions[4].tiles){assert.equal(tile.x,covered);assert.equal(tile.y,0);assert.equal(tile.height,100);covered+=tile.width;}
        assert.equal(covered,1200);
        for(const region of result.regions.filter(r=>r.ready&&r.regionId!=='empty')){
          let ink=0;
          for(const tile of region.tiles){const image=nativeImage.createFromBuffer(await fs.readFile(tile.path));assert.deepEqual(image.getSize(),{width:tile.width,height:tile.height});const bytes=image.toBitmap();for(let i=3;i<bytes.length;i+=4)if(bytes[i]>8)ink++;}
          assert.ok(ink>0,region.regionId+' has no rendered ink');
        }
        assert.deepEqual(result.regions[2].tiles, []);
        app.once('browser-window-created',(_event,window)=>{window.webContents.capturePage=async()=>nativeImage.createFromBitmap(Buffer.alloc(256*200*4),{width:256,height:200});});
        const blank=await host({kind:'render_image',outputDirectory:path.join(directory,'empty-capture'),regions:[region('capture','完整文字')]},new AbortController().signal);
        assert.equal(blank.regions[0].ready,false);assert.equal(blank.regions[0].reason,'empty_capture');
        assert.equal(BrowserWindow.getAllWindows().length,0);
        const controller=new AbortController();
        const pending=host({kind:'render_image',outputDirectory:path.join(directory,'cancel'),regions:[region('cancel','取消测试')]},controller.signal);
        setTimeout(()=>controller.abort(new Error('cancelled')),20);
        await assert.rejects(pending);
        assert.equal(BrowserWindow.getAllWindows().length,0);
        await host({kind:'render_image',outputDirectory:path.join(directory,'retry'),regions:[region('retry','继续')]},new AbortController().signal);
        await host.dispose();assert.equal(BrowserWindow.getAllWindows().length,0);
        app.exit(0);
      } catch(error){console.error(error);app.exit(1);} })();
    `,
    );
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    await promisify(execFile)(createRequire(import.meta.url)("electron") as string, [entry], {
      env: environment,
      windowsHide: true,
      timeout: 120000,
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 180000);
