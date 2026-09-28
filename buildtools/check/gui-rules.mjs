import path from "node:path";

import { is_test_file, is_typescript_source } from "./core.mjs";

/** 禁止 Electron 宿主重新持有 Backend 服务实现，测试文件不受生产依赖边界限制。 */
export function create_gui_boundary_rules() {
  return [
    {
      name: "GUI 宿主依赖边界",
      check: (context) => {
        const backend_root = path.join(context.project_root, "src", "backend");
        return context.files
          .filter((file_path) => is_typescript_source(file_path) && !is_test_file(file_path))
          .flatMap((file_path) =>
            context.read_imports(file_path).flatMap((import_entry) => {
              const target = context.resolve_import(file_path, import_entry.specifier);
              if (target === null || !target.startsWith(backend_root + path.sep)) return [];
              return [
                {
                  relative_path: context.relative_path(file_path),
                  line: import_entry.line,
                  message: "GUI 宿主只能依赖 runtime 协议，不得导入 Backend 实现",
                },
              ];
            }),
          );
      },
    },
  ];
}
