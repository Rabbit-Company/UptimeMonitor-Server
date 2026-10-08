import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, writeFileSync } from "fs";
import { join } from "path";
import { config, reloadConfig } from "../src/config";
import { getPulseMonitorConfigs } from "../src/pulsemonitor";
import { GAMEDIG_PROTOCOLS } from "../src/types";
import { configErrors, configPath, loadConfig, restoreConfig } from "./helpers/config";

afterEach(() => {
	restoreConfig();
});

describe("config", () => {
	describe("loading", () => {
		test("baseline fixture loads", () => {
			const cfg = loadConfig();
			expect(cfg.monitors.map((m) => m.id)).toEqual(["api", "db", "worker", "web"]);
			expect(cfg.groups.map((g) => g.id)).toEqual(["backend", "everything"]);
			expect(cfg.statusPages.map((p) => p.slug)).toEqual(["main", "collapsed", "private"]);
			expect(cfg.pulseMonitors.map((p) => p.id)).toEqual(["pm-eu"]);
		});

		test("example configuration is valid", () => {
			copyFileSync(join(import.meta.dir, "..", "config.example.toml"), configPath());
			expect(() => reloadConfig()).not.toThrow();
		});

		test("applies defaults for omitted sections", () => {
			const cfg = loadConfig((raw) => {
				delete raw.clickhouse;
				delete raw.server;
				delete raw.adminAPI;
				delete raw.logger;
				delete raw.missingPulseDetector;
				delete raw.selfMonitoring;
			});

			expect(cfg.clickhouse.url).toBe("http://localhost:8123/uptime_monitor");
			expect(cfg.server.port).toBe(3000);
			expect(cfg.server.proxy).toBe("direct");
			expect(cfg.server.reloadToken.length).toBeGreaterThanOrEqual(32);
			expect(cfg.server.burrowgate).toBeUndefined();
			expect(cfg.adminAPI.enabled).toBe(false);
			expect(cfg.adminAPI.token.length).toBeGreaterThanOrEqual(32);
			expect(cfg.logger.level).toBe(4);
			expect(cfg.missingPulseDetector.interval).toBe(5);
			expect(cfg.selfMonitoring).toEqual({
				enabled: false,
				id: "self-monitor",
				interval: 3,
				backfillOnRecovery: false,
				latencyStrategy: "last-known",
			});
			expect(cfg.notifications).toEqual({ channels: {} });
		});

		test("a failed reload keeps the previous configuration", () => {
			const before = config;
			expect(configErrors((raw) => (raw.monitors = []))).not.toEqual([]);
			expect(config).toBe(before);
		});

		test("invalid TOML is rejected", () => {
			writeFileSync(configPath(), "this is = = not toml");
			expect(() => reloadConfig()).toThrow();
		});

		test("reports every problem at once", () => {
			const errors = configErrors((raw) => {
				raw.server.port = 0;
				raw.monitors[0].interval = -1;
				raw.groups[0].strategy = "nope";
			});
			expect(errors).toContain("server.port must be a valid port number (1-65535)");
			expect(errors).toContain("monitors[0].interval must be a positive number");
			expect(errors).toContain("groups[0].strategy must be either 'any-up', 'percentage' or 'all-up'");
		});
	});

	describe("server", () => {
		test.each([0, -1, 65536, "3000"])("rejects port %p", (port) => {
			expect(configErrors((raw) => (raw.server.port = port))).toEqual(["server.port must be a valid port number (1-65535)"]);
		});

		test.each(["direct", "cloudflare", "aws", "gcp", "azure", "vercel", "nginx", "burrowgate", "development"])("accepts proxy preset %p", (proxy) => {
			expect(loadConfig((raw) => (raw.server.proxy = proxy)).server.proxy).toBe(proxy as any);
		});

		test("rejects an unknown proxy preset", () => {
			const errors = configErrors((raw) => (raw.server.proxy = "haproxy"));
			expect(errors).toHaveLength(1);
			expect(errors[0]).toStartWith("server.proxy must be one of:");
		});

		test("rejects an empty reload token", () => {
			expect(configErrors((raw) => (raw.server.reloadToken = " "))).toEqual(["server.reloadToken must be a non-empty string if provided"]);
		});

		describe("burrowgate", () => {
			test("accepts an origin secret and defaults maxAgeSeconds to 60", () => {
				const cfg = loadConfig((raw) => (raw.server.burrowgate = { originSecret: "secret" }));
				expect(cfg.server.burrowgate).toEqual({ originSecret: "secret", maxAgeSeconds: 60 });
			});

			test("accepts a custom maxAgeSeconds, including 0", () => {
				expect(loadConfig((raw) => (raw.server.burrowgate = { originSecret: "s", maxAgeSeconds: 0 })).server.burrowgate?.maxAgeSeconds).toBe(0);
				expect(loadConfig((raw) => (raw.server.burrowgate = { originSecret: "s", maxAgeSeconds: 300 })).server.burrowgate?.maxAgeSeconds).toBe(300);
			});

			test("requires a non-empty origin secret", () => {
				const expected = ["server.burrowgate.originSecret must be a non-empty string"];
				expect(configErrors((raw) => (raw.server.burrowgate = {}))).toEqual(expected);
				expect(configErrors((raw) => (raw.server.burrowgate = { originSecret: "  " }))).toEqual(expected);
			});

			test("rejects a negative or non-numeric maxAgeSeconds", () => {
				const expected = ["server.burrowgate.maxAgeSeconds must be a non-negative number"];
				expect(configErrors((raw) => (raw.server.burrowgate = { originSecret: "s", maxAgeSeconds: -1 }))).toEqual(expected);
				expect(configErrors((raw) => (raw.server.burrowgate = { originSecret: "s", maxAgeSeconds: "60" }))).toEqual(expected);
			});

			test("rejects a non-object value", () => {
				expect(configErrors((raw) => (raw.server.burrowgate = "secret"))).toEqual(["server.burrowgate must be an object"]);
			});
		});
	});

	describe("general sections", () => {
		test("rejects an empty clickhouse url", () => {
			expect(configErrors((raw) => (raw.clickhouse.url = ""))).toEqual(["clickhouse.url must be a non-empty string"]);
		});

		test("rejects an empty database url", () => {
			expect(configErrors((raw) => (raw.database = { url: "" }))).toEqual(["database.url must be a non-empty string"]);
		});

		test("keeps a configured database url", () => {
			expect(loadConfig((raw) => (raw.database = { url: "sqlite://:memory:" })).database?.url).toBe("sqlite://:memory:");
		});

		test("validates adminAPI", () => {
			expect(configErrors((raw) => (raw.adminAPI.enabled = "yes"))).toEqual(["adminAPI.enabled must be a boolean"]);
			expect(configErrors((raw) => (raw.adminAPI.token = ""))).toEqual(["adminAPI.token must be a non-empty string if provided"]);
		});

		test.each([-1, 8, "7"])("rejects logger level %p", (level) => {
			expect(configErrors((raw) => (raw.logger.level = level))).toEqual(["logger.level must be a valid number (0-7)"]);
		});

		test("validates the Loki transport", () => {
			expect(configErrors((raw) => (raw.logger.loki = { url: "" }))).toEqual(["logger.loki.url is required and must be a non-empty string"]);
			expect(configErrors((raw) => (raw.logger.loki = { url: "http://loki:3100", batchTimeout: 50 }))).toEqual([
				"logger.loki.batchTimeout must be a number >= 100 (ms)",
			]);
			expect(configErrors((raw) => (raw.logger.loki = { url: "http://loki:3100", basicAuth: { username: "u" } }))).toEqual([
				"logger.loki.basicAuth.password is required",
			]);
		});

		test("rejects a missing pulse detector interval below 1", () => {
			expect(configErrors((raw) => (raw.missingPulseDetector.interval = 0))).toEqual(["missingPulseDetector.interval must be a number >= 1"]);
		});

		test("self monitoring falls back to defaults for invalid values", () => {
			const cfg = loadConfig((raw) => {
				raw.selfMonitoring = { enabled: true, id: "", interval: 0, backfillOnRecovery: true, latencyStrategy: "bogus" };
			});
			expect(cfg.selfMonitoring).toEqual({
				enabled: true,
				id: "self-monitor",
				interval: 3,
				backfillOnRecovery: true,
				latencyStrategy: "last-known",
			});
		});
	});

	describe("monitors", () => {
		test("requires at least one monitor", () => {
			expect(configErrors((raw) => (raw.monitors = []))).toContain("At least one monitor must be configured");
			expect(configErrors((raw) => delete raw.monitors)).toContain("monitors must be an array");
		});

		test.each([
			["id", "", "monitors[1].id must be a non-empty string"],
			["name", "   ", "monitors[1].name must be a non-empty string"],
			["token", 123, "monitors[1].token must be a non-empty string"],
			["interval", 0, "monitors[1].interval must be a positive number"],
			["interval", "30", "monitors[1].interval must be a positive number"],
			["maxRetries", -1, "monitors[1].maxRetries must be a positive number"],
			["resendNotification", -1, "monitors[1].resendNotification must be a positive number"],
			["children", "api", "monitors[1].children must be an array if provided"],
			["dependencies", "api", "monitors[1].dependencies must be an array if provided"],
			["pulseMonitors", "pm-eu", "monitors[1].pulseMonitors must be an array if provided"],
			["notificationChannels", "critical", "monitors[1].notificationChannels must be an array if provided"],
		])("rejects %s = %p", (field, value, message) => {
			expect(configErrors((raw) => (raw.monitors[1][field] = value))).toContain(message);
		});

		test.each(["interval", "maxRetries", "resendNotification", "id", "name", "token"])("requires %s", (field) => {
			expect(configErrors((raw) => delete raw.monitors[1][field])).not.toEqual([]);
		});

		test("accepts zero maxRetries and resendNotification", () => {
			const cfg = loadConfig();
			expect(cfg.monitors[0]!.maxRetries).toBe(0);
			expect(cfg.monitors[0]!.resendNotification).toBe(0);
		});

		test("parses custom metrics, dependencies and pulse configuration", () => {
			const cfg = loadConfig();
			const api = cfg.monitors.find((m) => m.id === "api")!;
			expect(api.custom1).toEqual({ id: "connections", name: "Connections", unit: "conn" });
			expect(api.custom2).toBeUndefined();
			expect(api.pulseMonitors).toEqual(["pm-eu"]);
			expect(api.pulse?.http).toMatchObject({ method: "GET", url: "https://example.com", timeout: 10 });
			expect(cfg.monitors.find((m) => m.id === "worker")!.dependencies).toEqual(["db"]);
		});

		test("pulseMonitors require a pulse configuration", () => {
			expect(configErrors((raw) => delete raw.monitors[0].pulse)).toContain("monitors[0] has pulseMonitors configured but no pulse configuration");
		});

		test("rejects duplicate ids and tokens", () => {
			expect(configErrors((raw) => (raw.monitors[1].id = "api"))).toContain("Duplicate monitor ID: api");
			expect(configErrors((raw) => (raw.monitors[1].token = "tk_api"))).toContain("Duplicate monitor token: tk_api");
		});

		test("rejects references to things that do not exist", () => {
			expect(configErrors((raw) => (raw.monitors[1].dependencies = ["ghost"]))).toEqual(["Monitor 'db' has dependency on non-existent monitor/group: ghost"]);
			expect(configErrors((raw) => (raw.monitors[1].children = ["ghost"]))).toEqual(["Monitor 'db' references non-existent child: ghost"]);
			expect(configErrors((raw) => (raw.monitors[0].pulseMonitors = ["ghost"]))).toEqual(["Monitor 'api' references non-existent PulseMonitor: ghost"]);
			expect(configErrors((raw) => (raw.monitors[1].notificationChannels = ["ghost"]))).toEqual([
				"Monitor 'db' references non-existent notification channel: ghost",
			]);
		});

		test("rejects self references", () => {
			expect(configErrors((raw) => (raw.monitors[1].dependencies = ["db"]))).toContain("Monitor 'db' cannot depend on itself");
			expect(configErrors((raw) => (raw.monitors[1].children = ["db"]))).toContain("Monitor 'db' cannot be its own child");
		});
	});

	describe("game server (gamedig) checks", () => {
		const withGamedig = (gamedig: Record<string, unknown>) => (raw: Record<string, any>) => {
			raw.monitors[0].pulse = { gamedig };
		};
		const pulseOf = (gamedig: Record<string, unknown>) => loadConfig(withGamedig(gamedig)).monitors[0]!.pulse!;

		test("accepts a game ID with only a host", () => {
			expect(pulseOf({ game: "valheim", host: "game.example.com" })).toEqual({
				gamedig: { game: "valheim", protocol: undefined, host: "game.example.com", port: undefined, timeout: undefined },
			});
		});

		test("keeps port and timeout", () => {
			expect(pulseOf({ game: "minecraftjava", host: "mc.example.com", port: 25566, timeout: 10 }).gamedig).toMatchObject({ port: 25566, timeout: 10 });
		});

		test.each([...GAMEDIG_PROTOCOLS])("accepts the generic protocol %p", (protocol) => {
			expect(pulseOf({ protocol, host: "game.example.com", port: 27016 }).gamedig).toMatchObject({ protocol, port: 27016 });
		});

		test("requires exactly one of game and protocol", () => {
			const expected = "monitors[0].pulse.gamedig must have exactly one of game or protocol";
			expect(configErrors(withGamedig({ host: "game.example.com" }))).toContain(expected);
			expect(configErrors(withGamedig({ game: "rust", protocol: "valve", host: "game.example.com", port: 28015 }))).toContain(expected);
		});

		test.each(["Valheim", "space engineers", "valve-game", "", 7])("rejects the game ID %p", (game) => {
			expect(configErrors(withGamedig({ game, host: "game.example.com" }))).toContain(
				"monitors[0].pulse.gamedig.game must be a GameDig game ID (lowercase letters and numbers)",
			);
		});

		test("rejects an unknown protocol", () => {
			const errors = configErrors(withGamedig({ protocol: "carrier-pigeon", host: "game.example.com", port: 1 }));
			expect(errors.some((e) => e.startsWith("monitors[0].pulse.gamedig.protocol must be one of: valve, gamespy1"))).toBe(true);
		});

		test("a generic protocol needs a port", () => {
			expect(configErrors(withGamedig({ protocol: "valve", host: "game.example.com" }))).toContain(
				"monitors[0].pulse.gamedig.port is required when protocol is set",
			);
		});

		test.each([
			[{ game: "rust" }, "monitors[0].pulse.gamedig.host must be a non-empty string"],
			[{ game: "rust", host: " " }, "monitors[0].pulse.gamedig.host must be a non-empty string"],
			[{ game: "rust", host: "h", port: 0 }, "monitors[0].pulse.gamedig.port must be a valid port number (1-65535)"],
			[{ game: "rust", host: "h", port: 70000 }, "monitors[0].pulse.gamedig.port must be a valid port number (1-65535)"],
			[{ game: "rust", host: "h", timeout: 0 }, "monitors[0].pulse.gamedig.timeout must be a positive number"],
			[{ game: "rust", host: "h", timeout: "5" }, "monitors[0].pulse.gamedig.timeout must be a positive number"],
		])("rejects %p", (gamedig, message) => {
			expect(configErrors(withGamedig(gamedig))).toContain(message);
		});

		test("rejects a non-object value", () => {
			expect(configErrors((raw) => (raw.monitors[0].pulse = { gamedig: "valheim" }))).toContain("monitors[0].pulse.gamedig must be an object");
		});

		test("an empty pulse section lists gamedig among the available types", () => {
			const errors = configErrors((raw) => (raw.monitors[0].pulse = {}));
			expect(errors.some((e) => e.includes("at least one monitoring type") && e.endsWith("gamedig)"))).toBe(true);
		});

		test("the settings are sent to the assigned PulseMonitor", () => {
			loadConfig(withGamedig({ protocol: "valve", host: "se.example.com", port: 27016, timeout: 4 }));
			const sent = getPulseMonitorConfigs("pm-eu").find((m) => m.gamedig);
			expect(sent.gamedig).toEqual({ protocol: "valve", host: "se.example.com", port: 27016, timeout: 4 });
			expect(sent.token).toBe("tk_api");

			loadConfig(withGamedig({ game: "valheim", host: "game.example.com" }));
			const byGame = getPulseMonitorConfigs("pm-eu").find((m) => m.gamedig);
			expect(byGame.gamedig).toEqual({ game: "valheim", host: "game.example.com", port: undefined, timeout: undefined });
		});
	});

	describe("groups", () => {
		test("groups are optional", () => {
			const cfg = loadConfig((raw) => {
				delete raw.groups;
				raw.monitors[3].dependencies = [];
				for (const page of raw.status_pages) {
					page.items = ["api"];
					delete page.leafItems;
				}
			});
			expect(cfg.groups).toEqual([]);
		});

		test.each([
			["id", "", "groups[0].id must be a non-empty string"],
			["name", "", "groups[0].name must be a non-empty string"],
			["strategy", "most-up", "groups[0].strategy must be either 'any-up', 'percentage' or 'all-up'"],
			["degradedThreshold", "50", "groups[0].degradedThreshold must be a number"],
			["degradedThreshold", -1, "groups[0].degradedThreshold must be between 0 and 100"],
			["degradedThreshold", 101, "groups[0].degradedThreshold must be between 0 and 100"],
			["resendNotification", -1, "groups[0].resendNotification must be a non-negative number"],
			["children", "api", "groups[0].children must be an array if provided"],
			["dependencies", "api", "groups[0].dependencies must be an array if provided"],
		])("rejects %s = %p", (field, value, message) => {
			expect(configErrors((raw) => (raw.groups[0][field] = value))).toContain(message);
		});

		test("rejects a non-positive interval", () => {
			expect(configErrors((raw) => (raw.groups[0].interval = 0))).toHaveLength(1);
		});

		test.each(["any-up", "percentage", "all-up"])("accepts strategy %p", (strategy) => {
			expect(loadConfig((raw) => (raw.groups[0].strategy = strategy)).groups[0]!.strategy).toBe(strategy as any);
		});

		test("resendNotification defaults to 0", () => {
			expect(loadConfig().groups[0]!.resendNotification).toBe(0);
		});

		test("rejects duplicate group ids", () => {
			expect(configErrors((raw) => (raw.groups[1].id = "backend"))).toContain("Duplicate group ID: backend");
		});

		test("rejects references to things that do not exist", () => {
			expect(configErrors((raw) => raw.groups[0].children.push("ghost"))).toEqual(["Group 'backend' references non-existent child: ghost"]);
			expect(configErrors((raw) => (raw.groups[0].dependencies = ["ghost"]))).toEqual(["Group 'backend' has dependency on non-existent monitor/group: ghost"]);
			expect(configErrors((raw) => (raw.groups[0].notificationChannels = ["ghost"]))).toEqual([
				"Group 'backend' references non-existent notification channel: ghost",
			]);
		});

		test("rejects self references", () => {
			expect(configErrors((raw) => raw.groups[0].children.push("backend"))).toContain("Group 'backend' cannot be its own child");
			expect(configErrors((raw) => (raw.groups[0].dependencies = ["backend"]))).toContain("Group 'backend' cannot depend on itself");
		});
	});

	describe("circular references", () => {
		test("rejects circular children", () => {
			const errors = configErrors((raw) => raw.groups[0].children.push("everything"));
			expect(errors).toHaveLength(1);
			expect(errors[0]).toStartWith("Circular children reference detected:");
			expect(errors[0]).toContain("backend");
			expect(errors[0]).toContain("everything");
		});

		test("rejects circular dependencies", () => {
			const errors = configErrors((raw) => (raw.monitors[1].dependencies = ["worker"]));
			expect(errors).toEqual(["Circular dependency detected: db -> worker -> db"]);
		});

		test("rejects longer dependency cycles across monitors and groups", () => {
			const errors = configErrors((raw) => {
				raw.groups[0].dependencies = ["web"];
			});
			expect(errors).toHaveLength(1);
			expect(errors[0]).toStartWith("Circular dependency detected:");
		});

		test("allows a diamond shaped dependency graph", () => {
			const cfg = loadConfig((raw) => {
				raw.monitors[0].dependencies = ["db"];
				raw.monitors[3].dependencies = ["api", "worker"];
			});
			expect(cfg.monitors[3]!.dependencies).toEqual(["api", "worker"]);
		});
	});

	describe("status pages", () => {
		test("requires at least one status page", () => {
			expect(configErrors((raw) => (raw.status_pages = []))).toContain("At least one status page must be configured");
			expect(configErrors((raw) => delete raw.status_pages)).toContain("status_pages must be an array");
		});

		test.each([
			["id", "", "status_pages[0].id must be a non-empty string"],
			["name", "", "status_pages[0].name must be a non-empty string"],
			["slug", "", "status_pages[0].slug must be a non-empty string"],
			["slug", "Main Page", "status_pages[0].slug must contain only lowercase letters, numbers, and hyphens"],
			["slug", "main_page", "status_pages[0].slug must contain only lowercase letters, numbers, and hyphens"],
			["items", "api", "status_pages[0].items must be an array"],
			["items", [], "status_pages[0].items must have at least one item"],
			["items", [""], "status_pages[0].items[0] must be a non-empty string"],
			["password", "short", "status_pages[0].password must be at least 8 characters long"],
			["password", "", "status_pages[0].password must be a non-empty string if provided"],
			["leafItems", "backend", "status_pages[0].leafItems must be an array if provided"],
			["reports", "yes", "status_pages[0].reports must be a boolean if provided"],
		])("rejects %s = %p", (field, value, message) => {
			expect(configErrors((raw) => (raw.status_pages[0][field] = value))).toContain(message);
		});

		test("hashes the password with blake2b512", () => {
			const page = loadConfig().statusPages.find((p) => p.slug === "private")!;
			const expected = new Bun.CryptoHasher("blake2b512").update("correct-horse-battery").digest("hex");
			expect(page.password).toBe("correct-horse-battery");
			expect(page.hashedPassword).toBe(expected);
		});

		test("pages without a password have no hash", () => {
			const page = loadConfig().statusPages.find((p) => p.slug === "main")!;
			expect(page.password).toBeUndefined();
			expect(page.hashedPassword).toBeUndefined();
		});

		test("keeps leafItems and reports", () => {
			const cfg = loadConfig();
			expect(cfg.statusPages.find((p) => p.slug === "collapsed")!.leafItems).toEqual(["backend"]);
			expect(cfg.statusPages.find((p) => p.slug === "private")!.reports).toBe(true);
			expect(cfg.statusPages.find((p) => p.slug === "main")!.reports).toBeUndefined();
		});

		test("rejects duplicate ids and slugs", () => {
			expect(configErrors((raw) => (raw.status_pages[1].id = "main"))).toContain("Duplicate status page ID: main");
			expect(configErrors((raw) => (raw.status_pages[1].slug = "main"))).toContain("Duplicate status page slug: main");
		});

		test("rejects items that do not exist", () => {
			expect(configErrors((raw) => (raw.status_pages[0].items = ["ghost"]))).toEqual(["Status page 'main' references non-existent item: ghost"]);
		});
	});

	describe("pulse monitors", () => {
		test("are optional", () => {
			const cfg = loadConfig((raw) => {
				delete raw.PulseMonitors;
				delete raw.monitors[0].pulseMonitors;
			});
			expect(cfg.pulseMonitors).toEqual([]);
		});

		test.each([
			["id", "", "PulseMonitors[0].id must be a non-empty string"],
			["name", "", "PulseMonitors[0].name must be a non-empty string"],
			["token", "", "PulseMonitors[0].token must be a non-empty string"],
		])("rejects %s = %p", (field, value, message) => {
			expect(configErrors((raw) => (raw.PulseMonitors[0][field] = value))).toContain(message);
		});

		test("rejects duplicate ids and tokens", () => {
			const errors = configErrors((raw) => raw.PulseMonitors.push({ id: "pm-eu", name: "Copy", token: "tk_pm_eu" }));
			expect(errors).toContain("Duplicate PulseMonitor ID: pm-eu");
			expect(errors).toContain("Duplicate PulseMonitor token: tk_pm_eu");
		});
	});

	describe("notifications", () => {
		const channel = (overrides: Record<string, any> = {}) => ({
			id: "critical",
			name: "Critical",
			enabled: true,
			webhook: { enabled: true, url: "https://example.com/hook" },
			...overrides,
		});

		test("accepts a channel and lets monitors and groups reference it", () => {
			const cfg = loadConfig((raw) => {
				raw.notifications = { channels: { critical: channel() } };
				raw.monitors[0].notificationChannels = ["critical"];
				raw.groups[0].notificationChannels = ["critical"];
			});
			expect(cfg.notifications?.channels["critical"]).toMatchObject({ id: "critical", enabled: true, webhook: { enabled: true } });
			expect(cfg.monitors[0]!.notificationChannels).toEqual(["critical"]);
			expect(cfg.groups[0]!.notificationChannels).toEqual(["critical"]);
		});

		test("the channel key must match its id", () => {
			expect(configErrors((raw) => (raw.notifications = { channels: { other: channel() } }))).toEqual([
				"Notification channel key 'other' does not match channel ID 'critical'",
			]);
		});

		test("validates channel fields", () => {
			expect(configErrors((raw) => (raw.notifications = { channels: { critical: channel({ name: "" }) } }))).toEqual([
				"notifications.channels.critical.name must be a non-empty string",
			]);
			expect(configErrors((raw) => (raw.notifications = { channels: { critical: channel({ enabled: "yes" }) } }))).toEqual([
				"notifications.channels.critical.enabled must be a boolean",
			]);
		});

		test("an enabled channel needs at least one enabled provider", () => {
			const expected = ["Notification channel 'critical' is enabled but has no providers configured"];
			expect(configErrors((raw) => (raw.notifications = { channels: { critical: channel({ webhook: undefined }) } }))).toEqual(expected);
			expect(configErrors((raw) => (raw.notifications = { channels: { critical: channel({ webhook: { enabled: false } }) } }))).toEqual(expected);
		});

		test("a disabled channel needs no providers", () => {
			const cfg = loadConfig((raw) => (raw.notifications = { channels: { critical: channel({ enabled: false, webhook: undefined }) } }));
			expect(cfg.notifications?.channels["critical"]?.enabled).toBe(false);
		});

		test("validates the webhook provider", () => {
			expect(configErrors((raw) => (raw.notifications = { channels: { critical: channel({ webhook: { enabled: true, url: "" } }) } }))).toEqual([
				"notifications.channels.critical.webhook.url must be a non-empty string",
			]);
			expect(
				configErrors((raw) => (raw.notifications = { channels: { critical: channel({ webhook: { enabled: true, url: "https://x", headers: { A: 1 } } }) } })),
			).toEqual(["notifications.channels.critical.webhook.headers.A must be a string"]);
		});
	});
});
