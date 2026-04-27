type DroppedPathResult = {
  path: string | null;
  paths: string[];
  has_multiple_paths: boolean;
};

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
    return null;
  }
}

export function has_path_drop_payload(data_transfer: DataTransfer): boolean {
  const payload_type_set = new Set(data_transfer.types);
  return payload_type_set.has("Files") || payload_type_set.has("text/uri-list");
}

export function resolve_dropped_path(data_transfer: DataTransfer): DroppedPathResult {
  const dropped_paths = resolve_dropped_paths(data_transfer);
  return {
    path: dropped_paths.paths[0] ?? null,
    paths: dropped_paths.paths,
    has_multiple_paths: dropped_paths.has_multiple_paths,
  };
}

export function resolve_dropped_paths(data_transfer: DataTransfer): DroppedPathResult {
  const dropped_files = Array.from(data_transfer.files);
  if (dropped_files.length > 0) {
    const normalized_file_paths: string[] = [];
    for (const dropped_file of dropped_files) {
      try {
        const normalized_file_path = window.desktopApp.getPathForFile(dropped_file);
        if (normalized_file_path !== "") {
          normalized_file_paths.push(normalized_file_path);
        }
      } catch {
        // 某些拖拽源不会暴露本地路径，这里继续回退到 text/uri-list。
      }
    }
    if (normalized_file_paths.length > 0) {
      return {
        path: normalized_file_paths[0] ?? null,
        paths: normalized_file_paths,
        has_multiple_paths: normalized_file_paths.length > 1,
      };
    }
  }

  const raw_uri_list = data_transfer.getData("text/uri-list");
  const normalized_uri_list = raw_uri_list
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

  const normalized_paths = normalized_uri_list.flatMap((uri) => {
    const normalized_path = normalize_dropped_file_uri_path(uri);
    return normalized_path === null ? [] : [normalized_path];
  });

  return {
    path: normalized_paths[0] ?? null,
    paths: normalized_paths,
    has_multiple_paths: normalized_paths.length > 1,
  };
}
