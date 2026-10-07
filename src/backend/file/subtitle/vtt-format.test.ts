import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { VTTFormat } from "./vtt-format";

const format = new VTTFormat({ target_language: "ZH", deduplication_in_bilingual: true });
it("标签保留在结构中，正文槽位分别翻译且新增换行是真实显示换行", async () => {
  const text =
    "WEBVTT\r\n\r\nSTYLE\r\n::cue { color: red }\r\n\r\nREGION\r\nid:bottom\r\n\r\nNOTE before\r\nkept\r\n\r\nfirst\r\n00:01.000 --> 00:03.000 line:90%\r\n<v Alice><b><00:01.100>Hello</b>, world.\r\nGoodbye.\r\n\r\nNOTE tail\r\nkept\r\n";
  const items = await format.read_from_stream(Buffer.from(text), "sub.vtt");
  expect(items.map((item) => item.src)).toEqual(["Hello", ", world.\nGoodbye."]);
  items[0]!.status = "PROCESSED";
  items[0]!.dst = "你好\n朋友";
  items[1]!.status = "PROCESSED";
  items[1]!.dst = "，世界。\n再见。";
  const output = format.render_text(text, items, "sub.vtt");
  expect(output.translated).toContain("<v Alice><b>你好\r\n朋友</b>，世界。\r\n再见。");
  expect(output.translated).not.toContain("<00:01.100>");
  expect(output.bilingual).toContain(
    "<v Alice><b>Hello</b>, world.\r\nGoodbye.</v>\r\n<v Alice><b>你好",
  );
  expect(output.translated.slice(0, text.indexOf("first"))).toBe(
    text.slice(0, text.indexOf("first")),
  );
  expect(output.translated).toMatch(/NOTE tail\r\nkept\r\n$/u);
});
it("译文为纯文字，实体与未知尖括号正文可往返", async () => {
  const text = "WEBVTT\n\n00:00.000 --> 00:01.000\nA &amp; B <unknown>\n&nbsp;\nend\n";
  const items = await format.read_from_stream(Buffer.from(text), "sub.vtt");
  expect(items[0]?.src).toBe("A & B <unknown>\n\u00a0\nend");
  items[0]!.status = "PROCESSED";
  const target = "A --> <b> & B\n\u00a0\nend";
  items[0]!.dst = target + "\n";
  const output = format.render_text(text, items, "sub.vtt");
  expect(output.translated).toContain("A --&gt; &lt;b&gt; &amp; B");
  expect((await format.read_from_stream(Buffer.from(output.translated), "sub.vtt"))[0]?.src).toBe(
    target,
  );
});
it("注音不进入翻译，改写正文后展开 ruby，双语原文保留注音", async () => {
  const text = "WEBVTT\n\n00:00.000 --> 00:02.000\n<lang ja><ruby>漢<rt>かん</ruby></lang>字\n";
  const items = await format.read_from_stream(Buffer.from(text), "sub.vtt");
  expect(items.map((item) => item.src)).toEqual(["漢", "字"]);
  items[0]!.status = "PROCESSED";
  items[0]!.dst = "汉";
  const output = format.render_text(text, items, "sub.vtt");
  expect(output.translated).toContain("<lang zh>汉</lang>字");
  expect(output.translated).not.toContain("<rt>");
  expect(output.bilingual).toContain("<ruby>漢<rt>かん</rt></ruby>");
});
it("部分空译文清空槽位，整块空译文省略 cue，注释和尾部结构保留", async () => {
  const text = "WEBVTT\n\nNOTE before\n\nid\n00:00.000 --> 00:02.000\n<b>A</b>B\n\nNOTE tail\n";
  const items = await format.read_from_stream(Buffer.from(text), "sub.vtt");
  items[0]!.status = "PROCESSED";
  items[0]!.dst = "";
  expect(format.render_text(text, items, "sub.vtt").translated).toContain("<b></b>B");
  items[1]!.status = "PROCESSED";
  items[1]!.dst = "";
  const output = format.render_text(text, items, "sub.vtt");
  expect(output.translated).toBe("WEBVTT\n\nNOTE before\n\n\nNOTE tail\n");
  expect(output.bilingual).toBe(text);
});
it("标签不闭合、时间错误与正文空行在写盘前拒绝", async () => {
  const text = "WEBVTT\n\n00:00.000 --> 00:01.000\nA\n";
  const fresh = await format.read_from_stream(Buffer.from(text), "sub.vtt");
  fresh[0]!.status = "PROCESSED";
  fresh[0]!.dst = "a\n\nb";
  expect(() => format.render_text(text, fresh, "sub.vtt")).toThrow("empty cue line");
  for (const invalid of [text.replace("A\n", "<b>A\n"), text.replace("00:01.000", "00:00.000")])
    await expect(format.read_from_stream(Buffer.from(invalid), "bad.vtt")).rejects.toMatchObject({
      code: "file.invalid_structure",
    });
});
it("零正文文件与空 cue 保留结构", async () => {
  const text = "WEBVTT\n\nSTYLE\n::cue { color: red }\n\n00:00.000 --> 00:01.000\n\nNOTE tail";
  expect(await format.read_from_stream(Buffer.from(text), "empty.vtt")).toEqual([]);
  expect(format.render_text(text, [], "empty.vtt")).toEqual({ translated: text, bilingual: text });
});

it("Chromium 原生解析保留同标识字幕，并接受逐字降级与双语注音输出", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linguagacha-vtt-native-"));
  try {
    const format = new VTTFormat({ target_language: "ZH", deduplication_in_bilingual: true });
    const source =
      "WEBVTT\n\nSTYLE\n::cue { color: red }\n\ncue\n00:01.000 --> 00:02.000\n<v Alice><b><00:01.100>Hello</b> &amp; <ruby>漢<rt>かん</ruby> <lang en>world</lang>\n\ncue\n00:00.000 --> 00:01.000\nSecond\n";
    const items = await format.read_from_stream(Buffer.from(source), "sub.vtt");
    const translations: Readonly<Record<string, string>> = {
      Hello: "你好",
      漢: "汉",
      world: "世界",
    };
    for (const item of items) {
      if (translations[item.src] === undefined) continue;
      item.status = "PROCESSED";
      item.dst = translations[item.src]!;
    }
    const output = format.render_text(source, items, "sub.vtt");
    const entry = path.join(directory, "main.mjs");
    await fs.writeFile(
      entry,
      `
      import { app, BrowserWindow } from 'electron';
      app.commandLine.appendSwitch('disable-gpu');
      void (async () => {
      await app.whenReady();
      try {
        const window = new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true}});
        await window.loadURL('data:text/html,<html><body></body></html>');
        const result = await window.webContents.executeJavaScript(${JSON.stringify(`
          Promise.all(${JSON.stringify([output.translated, output.bilingual])}.map(text => new Promise((resolve,reject) => {
            const video = document.createElement('video');
            const track = document.createElement('track');
            track.kind = 'subtitles';
            const timeout = setTimeout(() => reject(new Error('Subtitle loading timed out')), 5000);
            track.onload = () => {
              clearTimeout(timeout);
              resolve(Array.from(track.track.cues, cue => {
                const body = document.createElement('div');
                body.append(cue.getCueAsHTML());
                return {id:cue.id,start:cue.startTime,end:cue.endTime,text:body.textContent,bold:Array.from(body.querySelectorAll('b'),b=>b.textContent),ruby:body.querySelectorAll('ruby').length};
              }));
            };
            track.onerror = () => { clearTimeout(timeout); reject(new Error('Subtitle loading failed')); };
            video.append(track); document.body.append(video);
            track.track.mode = 'hidden';
            track.src = URL.createObjectURL(new Blob([text], {type:'text/vtt'}));
          })))
        `)});
        console.log('VTT_RESULT:' + JSON.stringify(result));
        app.exit(0);
      } catch(error) { console.error(error); app.exit(1); }
      })();
    `,
    );
    const electron = createRequire(import.meta.url)("electron") as string;
    const environment: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "" };
    delete environment.ELECTRON_RUN_AS_NODE;
    const result = await promisify(execFile)(electron, [entry], {
      env: environment,
      timeout: 15000,
      windowsHide: true,
    });
    const record = result.stdout.split(/\r?\n/u).find((line) => line.startsWith("VTT_RESULT:"));
    expect(record).toBeDefined();
    const parsed = JSON.parse(record!.slice("VTT_RESULT:".length));
    expect(parsed[0]).toEqual([
      { id: "cue", start: 0, end: 1, text: "Second", bold: [], ruby: 0 },
      { id: "cue", start: 1, end: 2, text: "你好 & 汉 世界", bold: ["你好"], ruby: 0 },
    ]);
    expect(parsed[1]).toHaveLength(2);
    expect(parsed[1][1]).toMatchObject({ id: "cue", bold: ["Hello", "你好"], ruby: 1 });
    expect(parsed[1][1].text).toContain("你好 & 汉 世界");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 20000);
