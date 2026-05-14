import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AppPathService } from "../service/path-service";
import { JsonTool } from "../../shared/utils/json-tool";
import { set_main_log_text_paths, t_main_log } from "./log-text";

describe("main log text", () => {
  const cleanup_paths: string[] = [];

  afterEach(() => {
    set_main_log_text_paths(null);
    for (const cleanup_path of cleanup_paths.splice(0)) {
      fs.rmSync(cleanup_path, { recursive: true, force: true });
    }
  });

  it("按当前 app_language 生成日志正文", () => {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-log-text-"));
    cleanup_paths.push(app_root);
    const paths = new AppPathService({ appRoot: app_root });
    fs.mkdirSync(path.dirname(paths.get_config_path()), { recursive: true });
    fs.writeFileSync(
      paths.get_config_path(),
      JsonTool.stringifyStrict({ app_language: "EN" }),
      "utf-8",
    );
    set_main_log_text_paths(paths);

    expect(t_main_log("app.log.api_gateway_started", { BASE_URL: "http://127.0.0.1:65425" })).toBe(
      "API Gateway started - http://127.0.0.1:65425",
    );
  });
});
