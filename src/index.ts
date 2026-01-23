import "dotenv/config";
import { startServer } from "./server";
import { startWatcher } from "./watcher";

startServer();
startWatcher().catch((error) => {
  console.error("Failed to start", error);
});
