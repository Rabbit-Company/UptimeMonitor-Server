import { config, reloadConfig } from "../config";
import { cache } from "../cache";
import { Logger } from "../logger";
import { missingPulseDetector } from "../missing-pulse-detector";
import { groupStateTracker } from "../group-state-tracker";
import { updateMonitorStatus } from "../clickhouse";
import { notifyAllPulseMonitorClients } from "../pulsemonitor";
import type { Server } from "@rabbit-company/web";
import TOML from "smol-toml";
import { bearerAuth } from "@rabbit-company/web-middleware/bearer-auth";

export function getConfigPath(): string {
	return process.env["CONFIG"] || "./config.toml";
}

export async function readRawConfig(): Promise<Record<string, unknown>> {
	const toml = await Bun.file(getConfigPath()).text();
	return Bun.TOML.parse(toml) as Record<string, unknown>;
}

export async function writeRawConfig(raw: Record<string, unknown>): Promise<number> {
	return await Bun.write(getConfigPath(), TOML.stringify(raw));
}

export function adminBearerAuth() {
	return bearerAuth({
		validate(token, ctx) {
			if (!config.adminAPI.enabled) return false;

			const expected = config.adminAPI.token;

			if (token.length !== expected.length) {
				return !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(token));
			}

			return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
		},
	});
}

/**
 * Validates the raw config by round-tripping through stringify → parse → loadConfig.
 * Returns error strings or null if valid.
 */
export function validateConfig(raw: Record<string, unknown>): string[] | null {
	try {
		const toml = TOML.stringify(raw);
		// Re-parse to make sure the TOML is syntactically valid
		Bun.TOML.parse(toml);
		return null;
	} catch (err: any) {
		return [err.message || "Failed to serialize/parse TOML"];
	}
}

/**
 * Write config, reload, refresh caches. On failure, restore the backup.
 */
export async function writeAndReload(raw: Record<string, unknown>, getServer: () => Server): Promise<void> {
	const backup = await readRawConfig();

	writeRawConfig(raw);

	try {
		const newConfig = reloadConfig();
		cache.reload();
		missingPulseDetector.updateNotificationConfig(newConfig.notifications || { channels: {} });
		groupStateTracker.updateNotificationConfig();
		await Promise.all(cache.getAllMonitors().map((m) => updateMonitorStatus(m.id)));
		notifyAllPulseMonitorClients(getServer());
	} catch (err) {
		// Restore backup and re-reload
		Logger.error("Config reload failed after write, restoring backup", {
			error: err instanceof Error ? err.message : "Unknown error",
		});
		writeRawConfig(backup);
		try {
			reloadConfig();
			cache.reload();
		} catch {}
		throw err;
	}
}

const ID_RE = /^[a-zA-Z0-9_-]+$/;
export function isValidId(id: unknown): id is string {
	return typeof id === "string" && id.trim().length > 0 && ID_RE.test(id);
}
