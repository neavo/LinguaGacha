import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { default_native_fs } from "../../../native/native-fs";
import { create_workspace_host } from "./host";

it("停止后的迟到打印结果不落盘", async () => {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-workspace-host-"));
  const root = path.join(directory.path, "workspace");
  fs.mkdirSync(path.join(root, "work"), { recursive: true });
  const controller = new AbortController();
  const pdfHost = vi.fn(async () => {
    controller.abort();
    return new Uint8Array([1, 2]);
  });
  const host = create_workspace_host({
    root,
    nativeFs: default_native_fs,
    pdfHost,
  });
  await expect(
    host({ kind: "print_pdf", html: "<p>test</p>" }, controller.signal),
  ).rejects.toThrow();
  expect(fs.readdirSync(path.join(root, "work"))).toEqual([]);
});
