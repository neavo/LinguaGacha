import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it, vi } from "vitest";
import { image_fixture } from "../../../test/image-fixture";
import { create_image_layout_port } from "./host";
import type { ImageHost, ImageLayoutRequest } from "../../../shared/image";

it("宿主只接收结构化参数与工作目录内的真实掩码路径", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lg-image-port-"));
  try {
    const work = path.join(root, "work"),
      outside = path.join(root, "outside");
    await fs.mkdir(work);
    await fs.mkdir(outside);
    const fixture = image_fixture();
    await fs.writeFile(path.join(work, "mask.png"), fixture.original);
    await fs.writeFile(path.join(outside, "mask.png"), fixture.original);
    await fs.symlink(
      outside,
      path.join(work, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const host = vi.fn<ImageHost>(async () => ({ regions: [] }));
    const call = create_image_layout_port(root, host),
      signal = new AbortController().signal;
    const request: ImageLayoutRequest = {
      kind: "render_image",
      regions: [
        {
          regionId: "text",
          text: "<b>字面文字</b>",
          width: 1,
          height: 1,
          mask: path.join(work, "mask.png"),
          direction: "horizontal-tb",
          style: fixture.book.pages[0]!.regions[0]!.style,
          measurement: { status: "uncertain", value: null },
        },
      ],
    };
    await call(request, signal);
    const [received, receivedSignal] = host.mock.calls[0]!;
    expect(received.regions[0]!.text).toBe(request.regions[0]!.text);
    expect(path.relative(work, received.outputDirectory).startsWith(".." + path.sep)).toBe(false);
    expect(receivedSignal).toBe(signal);
    request.regions[0]!.mask = path.join(work, "linked/mask.png");
    await expect(call(request, signal)).rejects.toThrow("outside workspace");
    await expect(call({ ...request, html: "<script>" } as never, signal)).rejects.toThrow(
      "Invalid image layout",
    );
    expect(host).toHaveBeenCalledOnce();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
