/**
 * Test preload (see bunfig.toml). Runs once before any test file.
 *
 * The source modules read config.toml, create a ClickHouse client and reference the
 * running HTTP server at import time, so those are replaced here before anything is imported.
 */
import { mock } from "bun:test";
import { copyFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fakeClickHouse, fakeServer } from "./helpers/fakes";

const dir = mkdtempSync(join(tmpdir(), "uptime-monitor-test-"));
const configPath = join(dir, "config.toml");
copyFileSync(join(import.meta.dir, "fixtures", "base-config.toml"), configPath);

process.env["CONFIG"] = configPath;
process.env["TZ"] = "UTC";

mock.module("@clickhouse/client", () => ({
	createClient: () => fakeClickHouse.client,
	ClickHouseLogLevel: { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4, OFF: 127 },
}));

// src/index.ts starts the whole server on import; modules only need its `server` export.
mock.module(join(import.meta.dir, "..", "src", "index.ts"), () => ({ server: fakeServer }));

// Keep test output readable. Run with TEST_LOGS=1 to see server logs.
if (!process.env["TEST_LOGS"]) {
	const { Logger } = await import("../src/logger");
	(Logger as any).transports = [];
}
