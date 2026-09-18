import { normalizePath, type EnvironmentModuleNode, type Plugin } from "vite";

/** Context 身份和常驻实例的实现变更需要重建窗口运行态，组件和资源仍走正常热更新。 */
export function renderer_runtime_reload(): Plugin {
  return {
    name: "linguagacha:renderer-runtime-reload",
    apply: "serve",
    hotUpdate: {
      order: "pre",
      // 热更新先判断是否需要重建常驻实例，再交给 React 处理局部组件。
      handler({ modules, timestamp }) {
        const pending = [...modules];
        const visited = new Set<EnvironmentModuleNode>();
        // 从实际导入图回溯，覆盖 Store 捕获的函数与类，类型导入不进入运行时图。
        while (pending.length > 0) {
          const module = pending.pop()!;
          if (visited.has(module)) continue;
          visited.add(module);
          const file = normalizePath(module.file ?? "");
          if (
            /\/src\/frontend\/.*-context\.ts$/.test(file) ||
            /\/src\/frontend\/app\/(?:state|session)\/.*-store\.ts$/.test(file) ||
            file.endsWith("/src/frontend/app/feedback/desktop-toast.ts")
          ) {
            const invalidated = new Set<EnvironmentModuleNode>();
            for (const changed of modules) {
              this.environment.moduleGraph.invalidateModule(changed, invalidated, timestamp, true);
            }
            this.environment.hot.send({ type: "full-reload" });
            return [];
          }
          for (const importer of module.importers) pending.push(importer);
        }
      },
    },
  };
}
