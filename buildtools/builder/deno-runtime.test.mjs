import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  install_packaged_deno_runtime,
  prepare_deno_runtime_for_development,
  resolve_deno_target,
} from "./deno-runtime.mjs";

const cleanup_roots = [];

afterEach(async () => {
  while (cleanup_roots.length > 0) {
    await rm(cleanup_roots.pop(), { recursive: true, force: true });
  }
});

describe("Deno runtime 构建资产", () => {
  const manifest = {
    version: "2.9.6",
    releaseBaseUrl: "https://example.test",
    targets: Object.fromEntries(
      ["win32-x64", "win32-arm64", "darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64"].map(
        (key) => [
          key,
          {
            asset: `${key}.zip`,
            assetSha256: "hash",
            binarySha256: "binary-hash",
            binary: key.startsWith("win32") ? "deno.exe" : "deno",
          },
        ],
      ),
    ),
  };

  it.each([
    ["win32", "x64", "win32-x64", "deno.exe"],
    ["win32", "arm64", "win32-arm64", "deno.exe"],
    ["darwin", "x64", "darwin-x64", "deno"],
    ["darwin", "arm64", "darwin-arm64", "deno"],
    ["linux", "x64", "linux-x64", "deno"],
    ["linux", "arm64", "linux-arm64", "deno"],
  ])("映射 %s/%s", (platform, arch, key, binary) => {
    expect(resolve_deno_target(manifest, platform, arch)).toMatchObject({ key, binary });
  });

  it("未知目标和不完整 manifest 立即失败", () => {
    expect(() => resolve_deno_target(manifest, "freebsd", "x64")).toThrow("Unsupported");
    expect(() =>
      resolve_deno_target(
        {
          ...manifest,
          targets: {
            "win32-x64": { asset: "a.zip", assetSha256: "hash", binary: "deno.exe" },
          },
        },
        "win32",
        "x64",
      ),
    ).toThrow("missing binarySha256");
  });

  it("下载校验后安装目标二进制与 runtime bundle", async () => {
    const project_dir = await mkdtemp(path.join(os.tmpdir(), "linguagacha-deno-builder-"));
    cleanup_roots.push(project_dir);
    const app_out_dir = path.join(project_dir, "app-out");
    const resources_dir = path.join(app_out_dir, "resources");
    await mkdir(path.join(project_dir, "resources", "deno"), { recursive: true });
    await writeFile(path.join(project_dir, "resources", "deno", "deno-runtime.js"), "runner");
    const zip = new JSZip();
    zip.file("deno.exe", "binary");
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    const target = {
      asset: "deno.zip",
      assetSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      binarySha256: crypto.createHash("sha256").update("binary").digest("hex"),
      binary: "deno.exe",
    };
    const test_manifest = {
      version: "2.9.6",
      releaseBaseUrl: "https://example.test",
      targets: { "win32-x64": target },
    };
    const fetch_impl = vi.fn(async () => new Response(bytes));

    await install_packaged_deno_runtime(
      {
        electronPlatformName: "win32",
        arch: "x64",
        appOutDir: app_out_dir,
        packager: { projectDir: project_dir, getResourcesDir: () => resources_dir },
      },
      { manifest: test_manifest, fetchImpl: fetch_impl },
    );

    await expect(readFile(path.join(resources_dir, "deno", "deno.exe"), "utf8")).resolves.toBe(
      "binary",
    );
    await expect(
      readFile(path.join(resources_dir, "deno", "deno-runtime.js"), "utf8"),
    ).resolves.toBe("runner");
    await expect(readdir(path.join(resources_dir, "deno"))).resolves.toEqual([
      "deno-runtime.js",
      "deno.exe",
    ]);
    expect(fetch_impl).toHaveBeenCalledOnce();
  });

  it("下载内容 hash 不符时删除临时资产并失败", async () => {
    const project_dir = await temporary_project("linguagacha-deno-hash-");
    const test_manifest = development_manifest(Buffer.from("expected"));

    await expect(
      prepare_deno_runtime_for_development({
        projectDir: project_dir,
        platform: "win32",
        arch: "x64",
        manifest: test_manifest,
        fetchImpl: async () => new Response("different"),
      }),
    ).rejects.toThrow("SHA-256 mismatch");
  });

  it("ZIP 缺少目标 binary 时失败", async () => {
    const project_dir = await temporary_project("linguagacha-deno-missing-");
    const zip = new JSZip();
    zip.file("other.exe", "binary");
    const bytes = await zip.generateAsync({ type: "nodebuffer" });

    await expect(
      prepare_deno_runtime_for_development({
        projectDir: project_dir,
        platform: "win32",
        arch: "x64",
        manifest: development_manifest(bytes),
        fetchImpl: async () => new Response(bytes),
      }),
    ).rejects.toThrow("missing deno.exe");
  });

  it("解压后的 binary hash 不符时不安装", async () => {
    const project_dir = await temporary_project("linguagacha-deno-binary-hash-");
    const zip = new JSZip();
    zip.file("deno.exe", "different");
    const bytes = await zip.generateAsync({ type: "nodebuffer" });

    await expect(
      prepare_deno_runtime_for_development({
        projectDir: project_dir,
        platform: "win32",
        arch: "x64",
        manifest: development_manifest(bytes, Buffer.from("expected")),
        fetchImpl: async () => new Response(bytes),
      }),
    ).rejects.toThrow("Deno binary SHA-256 mismatch");
  });

  it("目标 binary 已通过校验时直接复用", async () => {
    const project_dir = await temporary_project("linguagacha-deno-installed-");
    const destination_dir = path.join(project_dir, "resources", "deno");
    await mkdir(destination_dir, { recursive: true });
    const binary = Buffer.from("installed-binary");
    const executable = path.join(destination_dir, "deno.exe");
    await writeFile(executable, binary);
    const fetch_impl = vi.fn();

    const result = await prepare_deno_runtime_for_development({
      projectDir: project_dir,
      platform: "win32",
      arch: "x64",
      manifest: development_manifest(Buffer.from("unused-archive"), binary),
      fetchImpl: fetch_impl,
    });

    expect(result).toBe(executable);
    await expect(readFile(executable)).resolves.toEqual(binary);
    expect(fetch_impl).not.toHaveBeenCalled();
  });

  it("目标 binary 校验失败时以完整文件替换", async () => {
    const project_dir = await temporary_project("linguagacha-deno-replace-");
    const destination_dir = path.join(project_dir, "resources", "deno");
    const archive_dir = path.join(project_dir, "build", "cache", "deno", "2.9.6");
    await mkdir(destination_dir, { recursive: true });
    await mkdir(archive_dir, { recursive: true });
    await writeFile(path.join(destination_dir, "deno.exe"), "stale-binary");
    const zip = new JSZip();
    zip.file("deno.exe", "current-binary");
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    await writeFile(path.join(archive_dir, "deno.zip"), bytes);

    const executable = await prepare_deno_runtime_for_development({
      projectDir: project_dir,
      platform: "win32",
      arch: "x64",
      manifest: development_manifest(bytes, Buffer.from("current-binary")),
      fetchImpl: vi.fn(),
    });

    await expect(readFile(executable, "utf8")).resolves.toBe("current-binary");
    await expect(readdir(destination_dir)).resolves.toEqual(["deno.exe"]);
  });

  it("复用缓存时仍校验 hash 且不下载", async () => {
    const project_dir = await temporary_project("linguagacha-deno-cache-");
    const zip = new JSZip();
    zip.file("deno.exe", "cached-binary");
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    const test_manifest = development_manifest(bytes, Buffer.from("cached-binary"));
    const archive_dir = path.join(project_dir, "build", "cache", "deno", "2.9.6");
    await mkdir(archive_dir, { recursive: true });
    await writeFile(path.join(archive_dir, "deno.zip"), bytes);
    const fetch_impl = vi.fn();

    const executable = await prepare_deno_runtime_for_development({
      projectDir: project_dir,
      platform: "win32",
      arch: "x64",
      manifest: test_manifest,
      fetchImpl: fetch_impl,
    });

    await expect(readFile(executable, "utf8")).resolves.toBe("cached-binary");
    await expect(readdir(path.join(project_dir, "resources", "deno"))).resolves.toEqual([
      "deno.exe",
    ]);
    expect(fetch_impl).not.toHaveBeenCalled();
  });
});

async function temporary_project(prefix) {
  const project_dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  cleanup_roots.push(project_dir);
  return project_dir;
}

function development_manifest(bytes, binary = Buffer.from("binary")) {
  return {
    version: "2.9.6",
    releaseBaseUrl: "https://example.test",
    targets: {
      "win32-x64": {
        asset: "deno.zip",
        assetSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        binarySha256: crypto.createHash("sha256").update(binary).digest("hex"),
        binary: "deno.exe",
      },
    },
  };
}
