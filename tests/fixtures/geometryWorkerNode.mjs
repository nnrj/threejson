import { parentPort } from "node:worker_threads";
import { attachGeometryWorkerHost } from "../../core/geometry/geometryWorkerHost.js";
attachGeometryWorkerHost(parentPort);
