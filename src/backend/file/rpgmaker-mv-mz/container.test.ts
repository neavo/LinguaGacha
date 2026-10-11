import JSZip from "jszip";
import { expect, it } from "vitest";
import { read_rpgmaker_container } from "./container";

it("RM 拒绝没有原稿文件的容器", async () => {
  const zip = new JSZip().folder("data")!;
  await expect(
    read_rpgmaker_container(await zip.generateAsync({ type: "uint8array" }), "game.zip"),
  ).rejects.toMatchObject({ code: "file.invalid_structure" });
});
