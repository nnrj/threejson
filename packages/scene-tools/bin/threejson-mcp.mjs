#!/usr/bin/env node
import { createSceneMcpServer } from "../js/mcp.js";
import { reserveStdoutForProtocol } from "../js/stdio.js";
reserveStdoutForProtocol();
const app = createSceneMcpServer();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { app.close().finally(() => process.exit(0)); });
await app.start();
