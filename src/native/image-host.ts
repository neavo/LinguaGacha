import { BrowserWindow, session, nativeImage, type Session } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { default_native_fs as fs } from "./native-fs";
import type { ImageHost, ImageLayoutResult, ImageTile } from "../shared/image";
import { run_window_task } from "./window-task";

const TILE = 1024;
const TIMEOUT = 180_000;
type Candidate = { size: number; html: string };

/** 固定模板独占隔离窗口，实际销毁后才释放调用方的运行占用。 */
export function create_image_host(resources: {
  fontsDirectory: string;
  workspaceRuntimeDirectory: string;
}): ImageHost & { dispose(): Promise<void> } {
  const lifetime = new AbortController();
  let isolated: Session | undefined; // 固定权限属于宿主，每页仅创建独立窗口。
  let tail: Promise<unknown> = Promise.resolve();
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
          const maskBytes = fs.read_file(region.mask);
          const maskImage = nativeImage.createFromBuffer(maskBytes);
          if (
            maskImage.getSize().width !== region.width ||
            maskImage.getSize().height !== region.height
          )
            throw new Error("Image layout mask dimensions differ");
          const mask = maskImage.toBitmap();
          const candidates = await step(
            "layout",
            () =>
              window.webContents.executeJavaScript(
                `window.imageCandidates(${JSON.stringify({ ...region, mask: "data:image/png;base64," + maskBytes.toString("base64") })})`,
              ) as Promise<Candidate[]>,
          );
          let accepted: { size: number; tiles: ImageTile[] } | undefined;
          for (const candidate of candidates) {
            const tiles: ImageTile[] = [];
            let valid = true;
            for (let y = 0; valid && y < region.height; y += TILE)
              for (let x = 0; valid && x < region.width; x += TILE) {
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
                if (screenshot.isEmpty()) throw new Error("Image capture returned no pixels");
                // capturePage 使用显示器物理像素，文字层统一还原为原图像素再验证。
                const captured = screenshot.resize({ width, height, quality: "best" });
                const bitmap = captured.toBitmap();
                for (let ty = 0; valid && ty < height; ty++)
                  for (let tx = 0; tx < width; tx++) {
                    if (
                      bitmap[(ty * width + tx) * 4 + 3]! > 8 &&
                      mask[((y + ty) * region.width + x + tx) * 4]! < 250
                    ) {
                      valid = false;
                      break;
                    }
                  }
                if (valid) {
                  const file = path.join(
                    operation.outputDirectory,
                    `${region.regionId}-${x}-${y}.png`,
                  );
                  await fs.write_file(file, captured.toPNG());
                  tiles.push({ path: file, x, y, width, height });
                }
              }
            if (valid) {
              accepted = { size: candidate.size, tiles };
              break;
            }
          }
          regions.push({
            regionId: region.regionId,
            ready: accepted !== undefined,
            size: accepted?.size ?? 0,
            tiles: accepted?.tiles ?? [],
            ...(accepted ? {} : { reason: "needs_layout" }),
          });
        }
        return { regions };
      });
    });
    tail = result.catch(() => undefined); // 错误由本次调用返回，串行队列保持可用。
    return result;
  };
  return Object.assign(host, {
    dispose: async () => {
      lifetime.abort();
      await tail;
      isolated?.webRequest.onBeforeRequest(null);
      await isolated?.clearStorageData();
    },
  });
}
