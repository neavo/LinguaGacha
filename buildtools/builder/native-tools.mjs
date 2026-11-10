import { execa } from "execa";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Arch } from "builder-util";
import { deploy_uv } from "./uv.mjs";
import { deploy_aria2 } from "./aria2.mjs";

const GO_ARCH = { x64: "amd64", arm64: "arm64" };
const GO_OS = { win32: "windows", darwin: "darwin", linux: "linux" };

/** 发行架构来自 electron-builder 的 Arch 枚举。 */
export function resolve_builder_arch(arch) {
  const name = Arch[arch];
  if (!GO_ARCH[name]) throw new Error(`Unsupported release architecture: ${String(name ?? arch)}.`);
  return name;
}

/** afterPack 只负责目标平台产物，共享 npm 与种子在资源生成阶段完成。 */
export async function deploy_packaged_tools({
  root,
  appDirectory,
  workspaceDirectory,
  platform,
  arch,
}) {
  if (platform === "win32") {
    for (const name of ["cli", "berserker"]) {
      await build_native_tool({
        root,
        name,
        platform,
        arch,
        binary: path.join(appDirectory, `${name}.exe`),
      });
    }
  }
  await deploy_workspace_tools({ root, workspaceDirectory, platform, arch });
}

/** 开发与测试补齐宿主工具，发行调用方显式提供目标平台与架构。 */
export async function deploy_workspace_tools({ root, workspaceDirectory, platform, arch }) {
  const directory = path.join(workspaceDirectory, "bin", `${platform}-${arch}`);
  await build_native_tool({
    root,
    name: "supervisor",
    platform,
    arch,
    binary: path.join(directory, platform === "win32" ? "supervisor.exe" : "supervisor"),
  });
  await deploy_uv({ root, workspaceDirectory, platform, arch });
  await deploy_aria2({ root, workspaceDirectory, platform, arch });
  if (platform === "win32") {
    await build_native_tool({
      root,
      name: "node",
      platform,
      arch,
      binary: path.join(directory, "node.exe"),
    });
    for (const name of ["npm", "npx"])
      await writeFile(
        path.join(directory, `${name}.cmd`),
        `@ECHO OFF\r\nSETLOCAL\r\nSET ELECTRON_RUN_AS_NODE=1\r\n"%LG_NODE_EXECUTABLE%" "%LG_NPM_CLI_ROOT%\\${name}-cli.js" %*\r\nEXIT /B %ERRORLEVEL%\r\n`,
      );
  } else {
    await writeFile(
      path.join(directory, "node"),
      '#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "$LG_NODE_EXECUTABLE" "$@"\n',
      { mode: 0o755 },
    );
    for (const name of ["npm", "npx"])
      await writeFile(
        path.join(directory, name),
        `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "$LG_NODE_EXECUTABLE" "$LG_NPM_CLI_ROOT/${name}-cli.js" "$@"\n`,
        { mode: 0o755 },
      );
  }
}

/** 直接构建到调用方的部署目录，避免开发与发行共用可写中转产物。 */
async function build_native_tool({ root, name, platform, arch, binary }) {
  if (!GO_OS[platform] || !GO_ARCH[arch])
    throw new Error(`Unsupported native target: ${platform}-${arch}`);
  const cwd = path.join(root, "buildtools/builder", name);
  await mkdir(path.dirname(binary), { recursive: true });
  try {
    // 测试固定使用宿主平台与架构，交叉构建只影响最终可执行文件。
    await execa("go", ["test", "./..."], {
      cwd,
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        GOOS: GO_OS[process.platform],
        GOARCH: GO_ARCH[process.arch],
      },
      stdio: "inherit",
    });
    await execa(
      "go",
      [
        "build",
        "-trimpath",
        "-ldflags",
        name === "berserker" ? "-s -w -H windowsgui" : "-s -w",
        "-o",
        binary,
        ".",
      ],
      {
        cwd,
        env: { ...process.env, CGO_ENABLED: "0", GOOS: GO_OS[platform], GOARCH: GO_ARCH[arch] },
        stdio: "inherit",
      },
    );
  } catch (cause) {
    if (cause !== null && typeof cause === "object" && "code" in cause && cause.code === "ENOENT")
      throw new Error("Building native tools requires Go on PATH.", { cause });
    throw cause;
  }
  let info;
  try {
    info = await stat(binary);
  } catch (cause) {
    throw new Error(`Cannot read native tool: ${binary}`, { cause });
  }
  if (!info.isFile()) throw new Error(`Native tool is not a file: ${binary}`);
}
