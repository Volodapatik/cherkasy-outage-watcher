"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const server_1 = require("./server");
const watcher_1 = require("./watcher");
(0, server_1.startServer)();
(0, watcher_1.startWatcher)().catch((error) => {
    console.error("Failed to start", error);
});
