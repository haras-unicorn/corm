export type CormLogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface CormLogger {
  trace(message: string): void;

  debug(message: string): void;

  info(message: string): void;

  warn(message: string): void;

  error(message: string): void;
}

export const createCormLogger = (host: Host): CormLogger => ({
  trace: (message) => host.log("trace", message),
  debug: (message) => host.log("debug", message),
  info: (message) => host.log("info", message),
  warn: (message) => host.log("warn", message),
  error: (message) => host.log("error", message),
});
