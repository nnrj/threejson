import { installGifWorker } from "./gifWorkerRuntime.js";
installGifWorker((data) => import(/* @vite-ignore */ data.url));
