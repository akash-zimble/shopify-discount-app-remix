export type LogLevel = "debug" | "info" | "warn" | "error";
import fs from "node:fs";

export interface Logger {
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string | Error, meta?: Record<string, unknown>): void;
}

type ConsoleLike = Pick<Console, "debug" | "info" | "warn" | "error">;

interface LoggerOptions {
    name?: string;
    level?: LogLevel;
    console?: ConsoleLike;
    filePath?: string;
}

const levelOrder: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
};

export function createLogger(options: LoggerOptions = {}): Logger {
    const { name = "app", level = "info", console: sink = globalThis.console, filePath="./log.txt" } = options;
    const minLevel = levelOrder[level] ?? levelOrder.info;

    function format(message: string, meta?: Record<string, unknown>) {
        const base = { logger: name, ts: new Date().toISOString() };
        return meta ? { ...base, message, ...meta } : { ...base, message };
    }

    function write(line: string, level: LogLevel) {
        // Always write to console sink
        switch (level) {
            case "debug": sink.debug(line); break;
            case "info": sink.info(line); break;
            case "warn": sink.warn(line); break;
            case "error": sink.error(line); break;
        }
        // Optionally append to file
        if (filePath) {
            try {
                fs.appendFile(filePath, line + "\n", () => {});
            } catch {
                // ignore file write errors to avoid crashing request handlers
            }
        }
    }

    return {
        debug(message, meta) {
            if (levelOrder.debug < minLevel) return;
            write(JSON.stringify(format(message, meta)), "debug");
        },
        info(message, meta) {
            if (levelOrder.info < minLevel) return;
            write(JSON.stringify(format(message, meta)), "info");
        },
        warn(message, meta) {
            if (levelOrder.warn < minLevel) return;
            write(JSON.stringify(format(message, meta)), "warn");
        },
        error(message, meta) {
            const msg = message instanceof Error ? message.message : message;
            const errMeta = message instanceof Error ? { stack: message.stack, ...meta } : meta;
            write(JSON.stringify(format(msg, errMeta)), "error");
        }
    };
}