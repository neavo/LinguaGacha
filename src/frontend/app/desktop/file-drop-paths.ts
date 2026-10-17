/** URI 回退只接收本地文件，并还原 Windows 盘符与路径分隔符。 */
function normalize_dropped_file_uri_path(file_uri: string): string | null {
  try {
    const normalized_url = new URL(file_uri);
    if (normalized_url.protocol !== "file:") {
      return null;
    }

    let normalized_path = decodeURIComponent(normalized_url.pathname);
    if (/^\/[A-Za-z]:\//u.test(normalized_path)) {
      normalized_path = normalized_path.slice(1);
    }

    if (/^[A-Za-z]:\//u.test(normalized_path)) {
      normalized_path = normalized_path.split("/").join("\\");
    }

    return normalized_path;
  } catch {
    return null; // 无效 URL 或转义不代表本地文件，忽略后继续解析其余条目。
  }
}

/** 拖入阶段只能依据载荷类型决定是否接收，路径在 drop 时读取。 */
export function has_path_drop_payload(data_transfer: DataTransfer): boolean {
  return data_transfer.types.includes("Files") || data_transfer.types.includes("text/uri-list");
}

/** 优先采用宿主文件路径，全部不可用时回退到 URI 列表。 */
export function resolve_dropped_paths(data_transfer: DataTransfer): string[] {
  const normalized_file_paths: string[] = [];
  for (const dropped_file of Array.from(data_transfer.files)) {
    try {
      const normalized_file_path = window.desktopApp.getPathForFile(dropped_file);
      if (normalized_file_path !== "") {
        normalized_file_paths.push(normalized_file_path);
      }
    } catch {
      // 某些拖拽源不会暴露本地路径，继续检查其余文件和 URI 列表。
    }
  }
  if (normalized_file_paths.length > 0) {
    return normalized_file_paths;
  }

  const raw_uri_list = data_transfer.getData("text/uri-list");
  const normalized_uri_list = raw_uri_list
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

  return normalized_uri_list.flatMap((uri) => {
    const normalized_path = normalize_dropped_file_uri_path(uri);
    return normalized_path === null ? [] : [normalized_path];
  });
}
