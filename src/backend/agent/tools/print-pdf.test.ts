import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { default_native_fs } from "../../../native/native-fs";
import { execute_print_pdf_request, create_pdf_printer } from "./print-pdf";

it("停止后的迟到打印结果不落盘", async () => {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-workspace-host-"));
  const root = path.join(directory.path, "workspace");
  fs.mkdirSync(path.join(root, "work"), { recursive: true });
  const controller = new AbortController();
  const pdfHost = vi.fn(async () => {
    controller.abort();
    return new Uint8Array([1, 2]);
  });
  const host = create_pdf_printer({
    root,
    nativeFs: default_native_fs,
    pdfHost,
  });
  await expect(
    host({ kind: "print_pdf", html: "<p>test</p>" }, controller.signal),
  ).rejects.toThrow();
  expect(fs.readdirSync(path.join(root, "work"))).toEqual([]);
});

it("打印请求在父进程验证，非法输入不能到达端口", async () => {
  const printer = vi.fn(async () => ({ path: "work/result.pdf" }));
  const signal = new AbortController().signal;
  await expect(execute_print_pdf_request({ kind: "print_pdf" }, signal, printer)).rejects.toThrow();
  expect(printer).not.toHaveBeenCalled();
  expect(
    await execute_print_pdf_request({ kind: "print_pdf", html: "<p>test</p>" }, signal, printer),
  ).toEqual({ path: "work/result.pdf" });
});

it("打印回执使用绝对路径，脚本切换目录后仍可定位文件", async () => {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-print-path-"));
  fs.mkdirSync(path.join(directory.path, "work"));
  const printer = create_pdf_printer({
    root: directory.path,
    nativeFs: default_native_fs,
    pdfHost: async () => new Uint8Array([1, 2, 3]),
  });
  const result = await printer(
    { kind: "print_pdf", html: "<p>test</p>" },
    new AbortController().signal,
  );
  expect(path.isAbsolute(result.path)).toBe(true);
  expect(fs.readFileSync(result.path)).toEqual(Buffer.from([1, 2, 3]));
});
