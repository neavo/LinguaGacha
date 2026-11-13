import { BrowserWindow, session, type Session } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { default_native_fs as fs } from "./native-fs";
import type { ImageHost, ImageLayoutResult, ImageTile } from "../shared/image";
import { run_window_task } from "./window-task";

const TILE = 1024; // 单次离屏窗口截取的图块最大边长。
const TIMEOUT = 180_000; // 单页渲染任务总超时毫秒数。
const CAPTURE_RETRY_MS = 50; // 空白截图退避重试等待毫秒数。
const INK_ALPHA = 16; // 判定截图存在有效文字笔画的最小透明通道阈值。
type Candidate = { size: number; html: string }; // 排版脚本返回的拟合字号与渲染片段。

/** 固定模板独占隔离窗口，实际销毁后才释放调用方的运行占用。 */
export function create_image_host(resources: {
  fontsDirectory: string;
  workspaceRuntimeDirectory: string;
}): ImageHost & { dispose(): Promise<void> } {
  const lifetime = new AbortController(); // 宿主销毁时中止排队与执行中的任务。
  let isolated: Session | undefined; // 固定权限属于宿主，每页仅创建独立窗口。
  let tail: Promise<unknown> = Promise.resolve(); // 串行执行各次排版请求，防止窗口抢占。
  const host: ImageHost = (operation, signal) => {
    const combined = AbortSignal.any([signal, lifetime.signal]);
    const result = tail.then(async (): Promise<ImageLayoutResult> => {
      combined.throwIfAborted();
      if (!isolated) {
        isolated = session.fromPartition(`image-${randomUUID()}`, { cache: false });
        isolated.webRequest.onBeforeRequest((details, done) =>
          done({ cancel: !details.url.startsWith("data:") }),
        );
        isolated.setPermissionRequestHandler((_contents, _permission, done) => done(false));
      }
      const window = new BrowserWindow({
        show: false,
        width: TILE,
        height: TILE,
        useContentSize: true,
        transparent: true,
        frame: false,
        webPreferences: {
          session: isolated,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      return await run_window_task(window, combined, TIMEOUT, async (step) => {
        const fonts = [400, 700].map(
          (weight) =>
            `@font-face{font-family:LG;src:url(data:font/ttf;base64,${fs.read_file(path.join(resources.fontsDirectory, weight === 400 ? "LGBaseFont-Regular.ttf" : "LGBaseFont-Bold.ttf")).toString("base64")});font-weight:${weight}}`,
        );
        const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"><style>${fonts.join("")}html,body{margin:0;background:transparent;overflow:hidden}#stage{position:absolute;transform-origin:center}#measure{position:absolute;left:-100000px;top:0;visibility:hidden}.text,#measure{font-family:LG;white-space:pre-wrap;line-break:strict;overflow-wrap:anywhere;text-orientation:mixed}.text{position:absolute}</style><div id="stage"></div><div id="measure"></div>`;
        await step("load", () => window.loadURL("data:text/html;charset=utf-8,<html></html>"));
        await step("document", () =>
          window.webContents.executeJavaScript(
            `document.open();document.write(${JSON.stringify(html)});document.close();`,
          ),
        );
        const script = fs.read_text_file(
          path.join(resources.workspaceRuntimeDirectory, "runtime", "image-layout.js"),
        );
        await step("template", () => window.webContents.executeJavaScript(script + "\nvoid 0;"));
        await fs.make_dir_async(operation.outputDirectory);
        const regions: ImageLayoutResult["regions"] = [];
        for (const region of operation.regions) {
          combined.throwIfAborted();
          const candidate = await step(
            "layout",
            () =>
              window.webContents.executeJavaScript(
                `window.imageLayout(${JSON.stringify(region)})`,
              ) as Promise<Candidate | null>,
          );
          let accepted: { size: number; tiles: ImageTile[] } | undefined;
          let reason = "needs_layout";
          if (candidate && !region.text.trim()) accepted = { size: 0, tiles: [] };
          for (let attempt = 0; candidate && !accepted && attempt < 2; attempt++) {
            if (attempt)
              await step(
                "capture-retry",
                () => new Promise<void>((resolve) => setTimeout(resolve, CAPTURE_RETRY_MS)),
              );
            const tiles: ImageTile[] = [];
            let inkPixels = 0;
            for (let y = 0; y < region.height; y += TILE)
              for (let x = 0; x < region.width; x += TILE) {
                const width = Math.min(TILE, region.width - x),
                  height = Math.min(TILE, region.height - y);
                await step("render", () =>
                  window.webContents.executeJavaScript(
                    `window.imageRender(${JSON.stringify(candidate.html)},${x},${y})`,
                  ),
                );
                const screenshot = await step("capture", () =>
                  window.webContents.capturePage(
                    { x: 0, y: 0, width, height },
                    { stayHidden: true, stayAwake: true },
                  ),
                );
                if (screenshot.isEmpty()) continue;
                // 显示器物理像素统一还原为原图坐标。
                const captured = screenshot.resize({ width, height, quality: "best" });
                const bitmap = captured.toBitmap();
                for (let i = 3; i < bitmap.length; i += 4) if (bitmap[i]! > INK_ALPHA) inkPixels++;
                const file = path.join(
                  operation.outputDirectory,
                  `${region.regionId}-${x}-${y}.png`,
                );
                await fs.write_file(file, captured.toPNG());
                tiles.push({ path: file, x, y, width, height });
              }
            if (
              inkPixels > 0 &&
              tiles.length === Math.ceil(region.width / TILE) * Math.ceil(region.height / TILE)
            )
              accepted = { size: candidate.size, tiles };
            else reason = "empty_capture";
          }
          regions.push({
            regionId: region.regionId,
            ready: accepted !== undefined,
            size: accepted?.size ?? 0,
            tiles: accepted?.tiles ?? [],
            ...(accepted ? {} : { reason }),
          });
        }
        return { regions };
      });
    });
    tail = result.catch(() => undefined); // 错误由本次调用返回，串行队列保持可用。
    return result;
  };
  return Object.assign(host, {
    /** 中止在途任务并等待队列排空后清理隔离会话。 */
    dispose: async () => {
      lifetime.abort();
      await tail;
      isolated?.webRequest.onBeforeRequest(null);
      await isolated?.clearStorageData();
    },
  });
}
