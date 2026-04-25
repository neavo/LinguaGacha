import net from "node:net";

export const CORE_API_HOST = "127.0.0.1";

export function build_core_api_base_url(port: number): string {
  return `http://${CORE_API_HOST}:${port.toString()}`;
}

export async function allocate_core_api_port(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, CORE_API_HOST, () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        server.close(() => {
          reject(new Error("无法分配 Core API 本地端口。"));
        });
        return;
      }

      const allocated_port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(allocated_port);
        }
      });
    });
  });
}
