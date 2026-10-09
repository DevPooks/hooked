import { loadConfig } from "./config/env.js";
import { buildServer } from "./api/server.js";

const config = loadConfig();
const app = await buildServer(config);

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

async function shutdown(signal: string) {
  app.log.info({ signal }, "stopping API");
  await app.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
