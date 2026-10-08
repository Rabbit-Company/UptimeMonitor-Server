import { copyFileSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import TOML from "smol-toml";
import { reloadConfig } from "../../src/config";
import { cache } from "../../src/cache";
import type { Config } from "../../src/types";

const FIXTURE_PATH = join(import.meta.dir, "..", "fixtures", "config.toml");

export const ADMIN_TOKEN = "test-admin-token";
export const RELOAD_TOKEN = "test-reload-token";

/** Path of the temporary config file the server reads during tests. */
export function configPath(): string {
	return process.env["CONFIG"]!;
}

/** A fresh, mutable copy of the baseline fixture configuration. */
export function baseConfig(): Record<string, any> {
	return Bun.TOML.parse(readFileSync(FIXTURE_PATH, "utf-8")) as Record<string, any>;
}

/** The configuration currently stored in the temporary config file. */
export function readConfigFile(): Record<string, any> {
	return Bun.TOML.parse(readFileSync(configPath(), "utf-8")) as Record<string, any>;
}

/**
 * Write the baseline configuration with `mutate` applied and load it.
 * Throws the server's validation error when the configuration is invalid.
 */
export function loadConfig(mutate?: (raw: Record<string, any>) => void): Config {
	const raw = baseConfig();
	mutate?.(raw);
	writeFileSync(configPath(), TOML.stringify(raw));
	const loaded = reloadConfig();
	cache.reload();
	return loaded;
}

/** Validation errors reported for the baseline configuration with `mutate` applied ([] when valid). */
export function configErrors(mutate: (raw: Record<string, any>) => void): string[] {
	try {
		loadConfig(mutate);
		return [];
	} catch (err: any) {
		if (Array.isArray(err?.errors)) return err.errors;
		throw err;
	}
}

/** Put the baseline configuration back and reload it everywhere. */
export function restoreConfig(): void {
	copyFileSync(FIXTURE_PATH, configPath());
	reloadConfig();
	cache.reload();
}
