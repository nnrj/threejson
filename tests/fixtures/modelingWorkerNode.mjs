import { parentPort } from "node:worker_threads";
import { attachModelingWorkerHost } from "../../core/modeling/workerHost.js";
attachModelingWorkerHost(parentPort);
