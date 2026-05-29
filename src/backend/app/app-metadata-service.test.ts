import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AppMetadataService } from "./app-metadata-service";
import { AppPathService } from "./app-path-service";

const cleanup_roots: string[] = [];

afterEach(() => {
  while (cleanup_roots.length > 0) {
    const temp_root = cleanup_roots.pop();
    if (temp_root !== undefined) {
      fs.rmSync(temp_root, { force: true, recursive: true });
    }
  }
});

describe("AppMetadataService", () => {
  it("读取 version.txt 后缓存版本并生成 LinguaGacha User-Agent", () => {
    const app_root = create_temp_root("linguagacha-metadata-");
    fs.writeFileSync(path.join(app_root, "version.txt"), "1.2.3\n", "utf-8");
    const service = new AppMetadataService(new AppPathService({ appRoot: app_root }));

    expect(service.read_version()).toBe("1.2.3");
    fs.writeFileSync(path.join(app_root, "version.txt"), "9.9.9", "utf-8");

    expect(service.read_version()).toBe("1.2.3");
    expect(service.build_linguagacha_user_agent()).toBe(
      "LinguaGacha/v1.2.3 (https://github.com/neavo/LinguaGacha)",
    );
  });

  it("允许 User-Agent 在缺失版本文件时使用占位版本", () => {
    const app_root = create_temp_root("linguagacha-metadata-missing-");
    const service = new AppMetadataService(new AppPathService({ appRoot: app_root }));

    expect(service.build_linguagacha_user_agent()).toBe(
      "LinguaGacha/v0.0.0 (https://github.com/neavo/LinguaGacha)",
    );
    expect(() => service.read_version()).toThrow();
  });
});

/**
 * 创建隔离应用根，避免应用元信息测试读取真实 version.txt。
 */
function create_temp_root(prefix: string): string {
  const temp_root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup_roots.push(temp_root);
  return temp_root;
}
