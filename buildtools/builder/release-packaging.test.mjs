import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

const project_root = process.cwd();
const builder_config_path = path.join(
  project_root,
  "buildtools",
  "builder",
  "electron-builder.json5",
);
const release_workflow_path = path.join(project_root, ".github", "workflows", "build.yml");

describe("发布包构建配置", () => {
  it("electron-builder 只声明产物类型，不持有平台架构", () => {
    const config = read_builder_config();

    expect(config.win.target).toEqual(["zip"]);
    expect(config.win.artifactName).toBe("${productName}_v${version}_Windows_${arch}.${ext}");
    expect(config.mac.target).toEqual(["dmg"]);
    expect(config.linux.target).toEqual(["AppImage"]);
    expect(find_arch_declarations(config)).toEqual([]);
  });

  it("GitHub Actions 只构建和上传当前平台架构的最终发布资产", () => {
    const workflow = read_workflow();

    expect(workflow).toContain("npm run build -- --win zip --x64 --publish never");
    expect(workflow).toContain("npm run build -- --mac dmg --${{ matrix.arch }} --publish never");
    expect(workflow).toContain("npm run build -- --linux AppImage --x64 --publish never");
    expect(workflow).not.toContain("Compress-Archive");
    expect(workflow).not.toContain("--dir --publish never");

    expect(workflow).toContain(
      "build/release/${{ needs.prepare.outputs.version }}/LinguaGacha_v${{ needs.prepare.outputs.version }}_Windows_x64.zip",
    );
    expect(workflow).toContain(
      "build/release/${{ needs.prepare.outputs.version }}/LinguaGacha_v${{ needs.prepare.outputs.version }}_macOS_${{ matrix.arch }}.dmg",
    );
    expect(workflow).toContain(
      "build/release/${{ needs.prepare.outputs.version }}/LinguaGacha_v${{ needs.prepare.outputs.version }}_Linux_x86_64.AppImage",
    );
    expect(workflow).not.toMatch(
      /build\/release\/\$\{\{ needs\.prepare\.outputs\.version }}\/\*\.(zip|dmg|AppImage)/,
    );

    expect(workflow).toContain(
      "./artifacts/${{ needs.prepare.outputs.app_name }}_${{ needs.prepare.outputs.version }}_Windows_x64/LinguaGacha_v${{ needs.prepare.outputs.version }}_Windows_x64.zip",
    );
    expect(workflow).toContain(
      "./artifacts/${{ needs.prepare.outputs.app_name }}_${{ needs.prepare.outputs.version }}_macOS_x64/LinguaGacha_v${{ needs.prepare.outputs.version }}_macOS_x64.dmg",
    );
    expect(workflow).toContain(
      "./artifacts/${{ needs.prepare.outputs.app_name }}_${{ needs.prepare.outputs.version }}_macOS_arm64/LinguaGacha_v${{ needs.prepare.outputs.version }}_macOS_arm64.dmg",
    );
    expect(workflow).toContain(
      "./artifacts/${{ needs.prepare.outputs.app_name }}_${{ needs.prepare.outputs.version }}_Linux_x64/LinguaGacha_v${{ needs.prepare.outputs.version }}_Linux_x86_64.AppImage",
    );
    expect(workflow).not.toMatch(/\.\/artifacts\/.+\/\*\.(zip|dmg|AppImage)/);
  });
});

/**
 * 读取 electron-builder 的 JSON5 对象字面量，避免测试依赖额外解析库。
 */
function read_builder_config() {
  const source = readFileSync(builder_config_path, "utf-8");
  return vm.runInNewContext(`(${source})`, {});
}

/**
 * 收集配置对象内残留的 arch 字段，确保架构只由 workflow 命令行传入。
 */
function find_arch_declarations(value, path_segments = []) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => find_arch_declarations(item, [...path_segments, index]));
  }

  if (value === null || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const child_path = [...path_segments, key];
    if (key === "arch") {
      return [child_path.join(".")];
    }
    return find_arch_declarations(child, child_path);
  });
}

/**
 * 读取发布 workflow，断言构建命令与产物路径保持一一对应。
 */
function read_workflow() {
  return readFileSync(release_workflow_path, "utf-8");
}
