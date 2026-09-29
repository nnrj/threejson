// Static dependency allows bundlers using a single IIFE worker artifact.
import * as library from "gifenc";
import { installGifWorker } from "./gifWorkerRuntime.js";
installGifWorker(() => library);
