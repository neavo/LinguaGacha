// Windows release 资产只支持当前发布矩阵内的两个原生架构。
export type WindowsReleaseArch = "x64" | "arm64";

// release 检查阶段只保存实际存在的架构 URL，缺失架构交给 main 回退发布页。
export type WindowsReleaseZipUrls = Partial<Record<WindowsReleaseArch, string>>;

type GithubReleaseAssetPayload = {
  name?: unknown;
  browser_download_url?: unknown;
};

const WINDOWS_RELEASE_ARCHES: readonly WindowsReleaseArch[] = ["x64", "arm64"];
const WINDOWS_RELEASE_ZIP_NAME_PREFIX = "LinguaGacha_";

/**
 * 把 Node / Electron / 外部输入中的架构值收口到 Windows 发布资产架构。
 */
export function normalize_windows_release_arch(value: unknown): WindowsReleaseArch | null {
  if (value === "x64" || value === "arm64") {
    return value;
  }

  return null;
}

/**
 * 生成 Windows release zip 的权威文件名，用于下载兜底名和本地启动校验。
 */
export function build_windows_release_zip_name(version: string, arch: WindowsReleaseArch): string {
  return `LinguaGacha_v${version}_Windows_${arch}.zip`;
}

/**
 * 从 GitHub release assets 中解析 Windows x64 / arm64 zip 下载地址。
 */
export function select_windows_release_zip_urls(
  assets: unknown,
  latest_version: string,
): WindowsReleaseZipUrls {
  if (!Array.isArray(assets)) {
    return {};
  }

  // GitHub payload 是外部边界，先裁剪成可消费的轻量 asset 快照。
  const normalized_assets = assets
    .map((asset): GithubReleaseAssetPayload => {
      return asset !== null && typeof asset === "object" ? asset : {};
    })
    .filter((asset) => {
      return typeof asset.name === "string" && typeof asset.browser_download_url === "string";
    });

  const urls: WindowsReleaseZipUrls = {};
  for (const arch of WINDOWS_RELEASE_ARCHES) {
    const asset = select_windows_release_zip_asset(normalized_assets, latest_version, arch);
    const download_url =
      typeof asset?.browser_download_url === "string" ? asset.browser_download_url.trim() : "";
    if (download_url !== "") {
      urls[arch] = download_url;
    }
  }

  return urls;
}

/**
 * 按当前运行架构选择下载 URL，缺失或空白值统一交给回退流程。
 */
export function select_windows_release_zip_url(
  urls: WindowsReleaseZipUrls,
  arch: WindowsReleaseArch,
): string | null {
  const download_url = urls[arch]?.trim() ?? "";
  return download_url === "" ? null : download_url;
}

/**
 * 校验 renderer 传回的本地 zip 文件名仍匹配当前版本和运行架构。
 */
export function is_windows_release_zip_name_for_arch(
  file_name: string,
  latest_version: string,
  arch: WindowsReleaseArch,
): boolean {
  const normalized_file_name = file_name.trim();
  return (
    (is_safe_release_zip_file_name(normalized_file_name) &&
      build_windows_release_zip_name(latest_version, arch) === normalized_file_name) ||
    is_fallback_windows_release_zip_name(normalized_file_name, latest_version, arch)
  );
}

function select_windows_release_zip_asset(
  assets: GithubReleaseAssetPayload[],
  latest_version: string,
  arch: WindowsReleaseArch,
): GithubReleaseAssetPayload | null {
  // 精确产物名优先，带构建前缀的资产名作为 release 工具链差异兜底。
  const expected_asset_name = build_windows_release_zip_name(latest_version, arch);
  const exact_asset = assets.find((asset) => {
    return String(asset.name).trim() === expected_asset_name;
  });

  return (
    exact_asset ??
    assets.find((asset) => {
      return is_fallback_windows_release_zip_name(String(asset.name).trim(), latest_version, arch);
    }) ??
    null
  );
}

function is_fallback_windows_release_zip_name(
  file_name: string,
  latest_version: string,
  arch: WindowsReleaseArch,
): boolean {
  return (
    is_safe_release_zip_file_name(file_name) &&
    file_name.startsWith(WINDOWS_RELEASE_ZIP_NAME_PREFIX) &&
    file_name.includes(`v${latest_version}_Windows_${arch}.zip`)
  );
}

function is_safe_release_zip_file_name(file_name: string): boolean {
  return (
    file_name !== "" &&
    !file_name.includes("/") &&
    !file_name.includes("\\") &&
    file_name.endsWith(".zip")
  );
}
