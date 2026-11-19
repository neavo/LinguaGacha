import path from "node:path";
import { fileURLToPath } from "node:url";
import { visualize as render } from "@lg/media";
import { locate_source, read_package_manifest } from "./media.mjs";

const script = new URL("./visualize.py", import.meta.url);

/**
 * 用包内来源身份找回原音频，以技能自带背景和已生成的双语 ASS 合成成片。
 * `source` 是含 `media.json` 的包目录或工作目录，`fonts` 传 `ws.fontsDirectory`。
 */
export async function visualize({ source, bilingual, fonts, output }) {
  const manifest = await read_package_manifest(path.join(source, "media.json"));
  if (manifest.video !== null) throw new Error("纯音频资产才能生成可视化成片");
  return render(script, await locate_source(manifest.source), {
    track: manifest.source.track,
    background: fileURLToPath(new URL("../assets/audio-background.webp", import.meta.url)),
    subtitles: bilingual,
    fonts,
    output,
  });
}
