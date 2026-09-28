import { format } from "node:util";

/** Entry-point policy only; importing the library never replaces the host's logger. */
export function reserveStdoutForProtocol() {
  for (const method of ["log", "info", "debug"]) console[method] = (...args) => process.stderr.write(`${format(...args)}\n`);
}
