import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cache } from "../src/cache";
import { loadConfig, restoreConfig } from "./helpers/config";
import { resetState, setStatus } from "./helpers/status";

beforeEach(() => {
	restoreConfig();
	resetState();
});

afterEach(() => {
	restoreConfig();
	resetState();
});

describe("cache", () => {
	describe("lookups", () => {
		test("monitors by id and token", () => {
			expect(cache.getMonitor("api")?.name).toBe("API");
			expect(cache.getMonitorByToken("tk_db")?.id).toBe("db");
			expect(cache.getMonitor("ghost")).toBeUndefined();
			expect(cache.getMonitorByToken("ghost")).toBeUndefined();
			expect(cache.getAllMonitors().map((m) => m.id)).toEqual(["api", "db", "worker", "web"]);
		});

		test("groups", () => {
			expect(cache.getGroup("backend")?.strategy).toBe("percentage");
			expect(cache.getGroup("api")).toBeUndefined();
			expect(cache.hasGroup("backend")).toBe(true);
			expect(cache.hasGroup("api")).toBe(false);
			expect(cache.hasMonitor("api")).toBe(true);
			expect(cache.hasMonitor("backend")).toBe(false);
		});

		test("status pages by id and slug", () => {
			expect(cache.getStatusPage("main")?.slug).toBe("main");
			expect(cache.getStatusPageBySlug("private")?.id).toBe("private");
			expect(cache.getStatusPageBySlug("ghost")).toBeUndefined();
			expect(cache.getAllStatusPages()).toHaveLength(3);
		});

		test("pulse monitors by id and token, with their assigned monitors", () => {
			expect(cache.getPulseMonitor("pm-eu")?.name).toBe("EU");
			expect(cache.getPulseMonitorByToken("tk_pm_eu")?.id).toBe("pm-eu");
			expect(cache.getPulseMonitorByToken("tk_api")).toBeUndefined();
			expect(cache.getMonitorsByPulseMonitor("pm-eu").map((m) => m.id)).toEqual(["api"]);
			expect(cache.getMonitorsByPulseMonitor("ghost")).toEqual([]);
		});
	});

	describe("relationships", () => {
		test("direct children are split into monitors and groups", () => {
			const backend = cache.getDirectChildren("backend");
			expect(backend.monitors.map((m) => m.id)).toEqual(["api", "db", "worker"]);
			expect(backend.groups).toEqual([]);

			const everything = cache.getDirectChildren("everything");
			expect(everything.monitors.map((m) => m.id)).toEqual(["web"]);
			expect(everything.groups.map((g) => g.id)).toEqual(["backend"]);

			expect(cache.getDirectChildIds("everything")).toEqual(["backend", "web"]);
			expect(cache.getDirectChildIds("api")).toEqual([]);
		});

		test("parents", () => {
			expect(cache.getParentIds("api")).toEqual(["backend"]);
			expect(cache.getParentIds("backend")).toEqual(["everything"]);
			expect(cache.getParentIds("everything")).toEqual([]);
		});

		test("a monitor can have children", () => {
			loadConfig((raw) => (raw.monitors[1].children = ["worker"]));
			expect(cache.getDirectChildIds("db")).toEqual(["worker"]);
			expect(cache.getParentIds("worker").sort()).toEqual(["backend", "db"]);
		});
	});

	describe("status page index", () => {
		test("includes nested items", () => {
			for (const id of ["everything", "backend", "web", "api", "db", "worker"]) {
				expect(cache.isItemOnStatusPage("main", id)).toBe(true);
			}
			expect(cache.isItemOnStatusPage("main", "ghost")).toBe(false);
			expect(cache.isItemOnStatusPage("ghost", "api")).toBe(false);
		});

		test("does not descend into leaf items", () => {
			expect(cache.isItemOnStatusPage("collapsed", "backend")).toBe(true);
			expect(cache.isItemOnStatusPage("collapsed", "web")).toBe(true);
			expect(cache.isItemOnStatusPage("collapsed", "api")).toBe(false);
			expect(cache.isItemOnStatusPage("collapsed", "db")).toBe(false);
		});

		test("maps items back to the pages showing them", () => {
			expect(cache.getStatusPageSlugsByItem("api").sort()).toEqual(["main", "private"]);
			expect(cache.getStatusPageSlugsByItem("db")).toEqual(["main"]);
			expect(cache.getStatusPageSlugsByItem("backend").sort()).toEqual(["collapsed", "main"]);
			expect(cache.getStatusPageSlugsByItem("ghost")).toEqual([]);
		});
	});

	describe("status page passwords", () => {
		const hash = (value: string) => new Bun.CryptoHasher("blake2b512").update(value).digest("hex");

		test("reports which pages are protected", () => {
			expect(cache.isStatusPageProtected("private")).toBe(true);
			expect(cache.isStatusPageProtected("main")).toBe(false);
			expect(cache.isStatusPageProtected("ghost")).toBe(false);
		});

		test("verifies the hashed password", () => {
			expect(cache.verifyStatusPagePassword("private", hash("correct-horse-battery"))).toBe(true);
			expect(cache.verifyStatusPagePassword("private", hash("wrong"))).toBe(false);
			expect(cache.verifyStatusPagePassword("private", "correct-horse-battery")).toBe(false);
			expect(cache.verifyStatusPagePassword("private", "")).toBe(false);
		});

		test("unprotected pages accept anything, unknown pages nothing", () => {
			expect(cache.verifyStatusPagePassword("main", "anything")).toBe(true);
			expect(cache.verifyStatusPagePassword("ghost", "anything")).toBe(false);
		});
	});

	describe("dependencies", () => {
		test("computes dependency levels", () => {
			expect(cache.getDependencyLevel("api")).toBe(0);
			expect(cache.getDependencyLevel("db")).toBe(0);
			expect(cache.getDependencyLevel("worker")).toBe(1);
			expect(cache.getDependencyLevel("backend")).toBe(0);
			expect(cache.getDependencyLevel("web")).toBe(1);
			expect(cache.getDependencyLevel("ghost")).toBe(0);
		});

		test("levels follow the longest chain", () => {
			loadConfig((raw) => {
				raw.monitors[0].dependencies = ["worker"]; // api -> worker -> db
				raw.monitors[3].dependencies = ["api", "db"]; // web -> api
			});
			expect(cache.getDependencyLevel("worker")).toBe(1);
			expect(cache.getDependencyLevel("api")).toBe(2);
			expect(cache.getDependencyLevel("web")).toBe(3);
		});

		test("orders monitors so dependencies come first", () => {
			const order = cache.getMonitorsByDependencyLevel().map((m) => m.id);
			expect(order).toHaveLength(4);
			expect(order.indexOf("db")).toBeLessThan(order.indexOf("worker"));
			expect(order.slice(0, 2).sort()).toEqual(["api", "db"]);
		});

		test("exposes dependencies", () => {
			expect(cache.getDependencies("worker")).toEqual(["db"]);
			expect(cache.getDependencies("api")).toEqual([]);
			expect(cache.hasDependencies("worker")).toBe(true);
			expect(cache.hasDependencies("api")).toBe(false);
		});

		test("detects a down dependency", () => {
			expect(cache.isAnyDependencyDown("worker")).toBeUndefined();

			setStatus("db", "up");
			expect(cache.isAnyDependencyDown("worker")).toBeUndefined();

			setStatus("db", "down");
			expect(cache.isAnyDependencyDown("worker")).toBe("db");
			expect(cache.isAnyDependencyDown("api")).toBeUndefined();
		});

		test("a degraded dependency does not count as down", () => {
			setStatus("backend", "degraded");
			expect(cache.isAnyDependencyDown("web")).toBeUndefined();
			setStatus("backend", "down");
			expect(cache.isAnyDependencyDown("web")).toBe("backend");
		});
	});

	describe("statuses", () => {
		test("stores and returns statuses", () => {
			expect(cache.getStatus("api")).toBeUndefined();
			setStatus("api", "up", { latency: 42 });
			expect(cache.getStatus("api")).toMatchObject({ id: "api", type: "monitor", status: "up", latency: 42 });
		});

		test("setMonitorDown flips an existing status and ignores unknown monitors", () => {
			setStatus("api", "up");
			cache.setMonitorDown("api");
			expect(cache.getStatus("api")?.status).toBe("down");

			cache.setMonitorDown("db");
			expect(cache.getStatus("db")).toBeUndefined();
		});

		test("statuses survive a reload", () => {
			setStatus("api", "up");
			cache.reload();
			expect(cache.getStatus("api")?.status).toBe("up");
		});
	});

	describe("incident and maintenance suppression", () => {
		test("reports the first active incident for an entity", () => {
			expect(cache.isUnderActiveIncident("api")).toBeUndefined();
			cache.setActiveIncidentMonitors(
				new Map([
					["api", ["inc-1", "inc-2"]],
					["db", []],
				]),
			);
			expect(cache.isUnderActiveIncident("api")).toBe("inc-1");
			expect(cache.isUnderActiveIncident("db")).toBeUndefined();
			expect(cache.isUnderActiveIncident("web")).toBeUndefined();
		});

		test("reports the first active maintenance for an entity", () => {
			expect(cache.isUnderActiveMaintenance("api")).toBeUndefined();
			cache.setActiveMaintenanceMonitors(new Map([["api", ["mnt-1"]]]));
			expect(cache.isUnderActiveMaintenance("api")).toBe("mnt-1");
			expect(cache.isUnderActiveMaintenance("db")).toBeUndefined();
		});
	});

	describe("reload", () => {
		test("picks up added and removed entities", () => {
			loadConfig((raw) => {
				raw.monitors.push({ id: "cron", name: "Cron", token: "tk_cron", interval: 60, maxRetries: 0, resendNotification: 0 });
				raw.groups[0].children = ["api", "db"];
				raw.monitors = raw.monitors.filter((m: any) => m.id !== "worker");
			});

			expect(cache.getMonitor("cron")?.token).toBe("tk_cron");
			expect(cache.getMonitorByToken("tk_cron")?.id).toBe("cron");
			expect(cache.getMonitor("worker")).toBeUndefined();
			expect(cache.getMonitorByToken("tk_worker")).toBeUndefined();
			expect(cache.getDirectChildIds("backend")).toEqual(["api", "db"]);
			expect(cache.getParentIds("worker")).toEqual([]);
			expect(cache.getDependencies("worker")).toEqual([]);
		});

		test("reports sizes in getStats", () => {
			expect(cache.getStats()).toMatchObject({ pulseMonitors: 1, monitors: 4, groups: 2, statusPages: 3, notificationChannels: 0 });
		});
	});
});
