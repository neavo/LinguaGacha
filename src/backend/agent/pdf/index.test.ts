import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { bind_workspace_requests } from "../workspace/runtime/request-channel";
import { printPdf } from "./index";

it("打印文件已被移除时保留读取错误，清理不覆盖失败主因", async () => {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-pdf-sdk-"));
  bind_workspace_requests({
    call: async () => ({ path: path.join(directory.path, "missing.pdf") }),
  });
  await expect(printPdf("<p>fixture</p>")).rejects.toMatchObject({
    code: "ENOENT",
    syscall: "open",
  });
});
