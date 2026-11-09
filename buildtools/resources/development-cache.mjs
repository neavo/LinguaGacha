import { execa } from "execa";
import { createHash } from "node:crypto";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_CODE_DIRECTORIES } from "./workspace.mjs";

const CACHE_FILE = ".development-cache";
// `go env` 的完整输出含临时目录，只取影响工具构建的稳定配置。
const GO_BUILD_ENV = [
  "GOVERSION",
  "GOROOT",
  "GOTOOLDIR",
  "GOFLAGS",
  "GOTOOLCHAIN",
  "GOAMD64",
  "GOARM64",
  "GOEXPERIMENT",
  "GOWORK",
];

/** 依赖安装、构建规则和 Go 工具共同决定静态资源，业务源码由 Vite 每次重建。 */
export async function read_development_inputs(root) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify([process.version, process.platform, process.arch]));
  for (const file of ["package.json", "package-lock.json", "node_modules/.package-lock.json"])
    hash.update(await readFile(path.join(root, file)));
  // 同版本重新安装也重新准备，避免复用安装前的依赖副本。
  hash.update(String((await stat(path.join(root, "node_modules/.package-lock.json"))).mtimeMs));
  for (const directory of ["buildtools/resources", "buildtools/builder"]) {
    const base = path.join(root, directory);
    const entries = await readdir(base, { recursive: true, withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name))
      .sort();
    for (const file of files) {
      hash.update(path.relative(root, file));
      hash.update(await readFile(file));
    }
  }
  for (const name of ["supervisor", ...(process.platform === "win32" ? ["node"] : [])])
    hash.update(
      (
        await execa("go", ["env", "-json", ...GO_BUILD_ENV], {
          cwd: path.join(root, "buildtools/builder", name),
          windowsHide: true,
          env: { ...process.env, CGO_ENABLED: "0" },
        })
      ).stdout,
    );
  return hash.digest("hex");
}

/** 只在准备完整后记录缓存，缺失文件或失败后的半成品必须重建。调用方持有输出目录锁。 */
export async function prepare_development_resources({ output, inputs, prepare }) {
  const file = path.join(output, CACHE_FILE);
  const previous = await read_optional(file);
  if (previous === `${inputs}\n${await read_inventory(output)}`) {
    console.info("Development resources unchanged; reusing dependencies and native tools.");
    return;
  }
  await rm(file, { force: true });
  await prepare();
  await writeFile(file, `${inputs}\n${await read_inventory(output)}`);
}

/** 缓存记录可缺失，其它读取错误仍阻止构建。 */
async function read_optional(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined; // 首次构建没有缓存记录。
    throw error;
  }
}

/** 检查静态产物的完整目录清单，代码 chunk 的增删由 Vite 自己负责。 */
async function read_inventory(output) {
  let entries;
  try {
    entries = await readdir(output, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return ""; // 输出被清理后必须重新准备。
    throw error;
  }
  const code = WORKSPACE_CODE_DIRECTORIES.map((directory) => `workspace/${directory}`);
  const files = entries
    .map((entry) =>
      path.relative(output, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
    )
    .filter(
      (file) =>
        file !== CACHE_FILE &&
        !code.some((directory) => file === directory || file.startsWith(`${directory}/`)),
    )
    .sort();
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}
