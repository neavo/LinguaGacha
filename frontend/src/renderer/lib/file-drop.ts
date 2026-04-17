export type DroppedPathResult = {
  path: string | null
  has_multiple_paths: boolean
}

function normalize_dropped_file_uri_path(file_uri: string): string | null {
  try {
    const normalized_url = new URL(file_uri)
    if (normalized_url.protocol !== 'file:') {
      return null
    }

    let normalized_path = decodeURIComponent(normalized_url.pathname)
    if (/^\/[A-Za-z]:\//u.test(normalized_path)) {
      normalized_path = normalized_path.slice(1)
    }

    if (/^[A-Za-z]:\//u.test(normalized_path)) {
      normalized_path = normalized_path.split('/').join('\\')
    }

    return normalized_path
  } catch {
    return null
  }
}

export function has_path_drop_payload(data_transfer: DataTransfer): boolean {
  const payload_type_set = new Set(data_transfer.types)
  return payload_type_set.has('Files') || payload_type_set.has('text/uri-list')
}

export function resolve_dropped_path(data_transfer: DataTransfer): DroppedPathResult {
  const dropped_files = Array.from(data_transfer.files)
  if (dropped_files.length > 1) {
    return {
      path: null,
      has_multiple_paths: true,
    }
  }

  const dropped_file = dropped_files[0]
  if (dropped_file !== undefined) {
    try {
      const normalized_file_path = window.desktopApp.getPathForFile(dropped_file)
      if (normalized_file_path !== '') {
        return {
          path: normalized_file_path,
          has_multiple_paths: false,
        }
      }
    } catch {
      // 某些拖拽源不会暴露本地路径，这里继续回退到 text/uri-list。
    }
  }

  const raw_uri_list = data_transfer.getData('text/uri-list')
  const normalized_uri_list = raw_uri_list
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))

  if (normalized_uri_list.length > 1) {
    return {
      path: null,
      has_multiple_paths: true,
    }
  }

  const normalized_path = normalized_uri_list.length === 1
    ? normalize_dropped_file_uri_path(normalized_uri_list[0])
    : null

  return {
    path: normalized_path,
    has_multiple_paths: false,
  }
}
