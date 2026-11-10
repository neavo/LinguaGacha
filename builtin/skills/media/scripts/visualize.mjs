import path from "node:path";
import { fileURLToPath } from "node:url";
import * as sdk from "@lg/media";
import { load, locate } from "./media.mjs";

/**
 * 用包内来源身份找回原音频，以技能自带背景和已生成的双语 ASS 合成成片。
 * `source` 是含 `media.json` 的包目录或工作目录，`fonts` 传 `ws.fontsDirectory`。
 */
export async function visualize({ source, bilingual, fonts, output }) {
  const manifest = await load(path.join(source, "media.json"));
  if (manifest.video !== null) throw new Error("纯音频资产才能生成可视化成片");
  const media = await locate(source);
  await sdk.setup(["visualize"]);
  return sdk.visualize(media, {
    track: manifest.source.track,
    background: fileURLToPath(new URL("../assets/audio-background.webp", import.meta.url)),
    subtitles: bilingual,
    fonts,
    output,
  });
}
