import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { cache } from "../src/cache";
import { updateGroupStatus } from "../src/clickhouse";
import { groupStateTracker } from "../src/group-state-tracker";
import { STARTUP_TIME } from "../src/times";
import { fakeServer } from "./helpers/fakes";
import { loadConfig, restoreConfig } from "./helpers/config";
import { resetState, setStatus } from "./helpers/status";

/** Set the statuses of backend's three children in one go. */
function children(api: "up" | "down" | null, db: "up" | "down" | null, worker: "up" | "down" | null): void {
	for (const [id, status] of [
		["api", api],
		["db", db],
		["worker", worker],
	] as const) {
		if (status) setStatus(id, status);
		else cache.statusCache.delete(id);
	}
}

function useStrategy(strategy: string, degradedThreshold = 50): void {
	loadConfig((raw) => {
		raw.groups[0].strategy = strategy;
		raw.groups[0].degradedThreshold = degradedThreshold;
	});
}

beforeEach(() => {
	restoreConfig();
	resetState();
});

afterEach(() => {
	setSystemTime();
	restoreConfig();
	resetState();
});

describe("updateGroupStatus", () => {
	describe("percentage strategy", () => {
		test("up when every child is up", async () => {
			children("up", "up", "up");
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")).toMatchObject({ id: "backend", type: "group", name: "Backend", status: "up" });
		});

		test("degraded while at or above the threshold", async () => {
			children("up", "up", "down"); // 66%
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")?.status).toBe("degraded");
		});

		test("down below the threshold", async () => {
			children("up", "down", "down"); // 33%
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")?.status).toBe("down");
		});

		test("exactly at the threshold is degraded", async () => {
			loadConfig((raw) => {
				raw.groups[0].children = ["api", "db"];
				raw.groups[0].degradedThreshold = 50;
			});
			setStatus("api", "up");
			setStatus("db", "down");
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")?.status).toBe("degraded");
		});

		test("a threshold of 0 never reports down", async () => {
			useStrategy("percentage", 0);
			children("down", "down", "down");
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")?.status).toBe("degraded");
		});

		test("a threshold of 100 reports down as soon as one child is down", async () => {
			useStrategy("percentage", 100);
			children("up", "up", "down");
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")?.status).toBe("down");
		});
	});

	describe("any-up strategy", () => {
		test("up while at least one child is up", async () => {
			useStrategy("any-up");
			children("up", "down", "down");
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")?.status).toBe("up");
		});

		test("down when every child is down", async () => {
			useStrategy("any-up");
			children("down", "down", "down");
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")?.status).toBe("down");
		});
	});

	describe("all-up strategy", () => {
		test("up only when every child is up", async () => {
			useStrategy("all-up");
			children("up", "up", "up");
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")?.status).toBe("up");
		});

		test("down when any child is down", async () => {
			useStrategy("all-up");
			children("up", "up", "down");
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")?.status).toBe("down");
		});
	});

	describe("unknown children", () => {
		test("ignores unknown children when most are known", async () => {
			children("up", "up", null);
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")?.status).toBe("up");
		});

		test("does not update when most children are unknown", async () => {
			children("down", null, null);
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")).toBeUndefined();
		});

		test("does not update when nothing is known", async () => {
			children(null, null, null);
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")).toBeUndefined();
		});

		test("does nothing for an unknown group", async () => {
			await updateGroupStatus("ghost");
			expect(cache.getStatus("ghost")).toBeUndefined();
		});
	});

	describe("aggregates", () => {
		test("averages latency over children that report one", async () => {
			setStatus("api", "up", { latency: 100 });
			setStatus("db", "up", { latency: 200 });
			setStatus("worker", "up", { latency: 0 });
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")?.latency).toBe(150);
		});

		test("latency is 0 when no child reports one", async () => {
			children("up", "up", "up");
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")?.latency).toBe(0);
		});

		test.each([
			["percentage", 80],
			["any-up", 100],
			["all-up", 50],
		])("%s strategy aggregates child uptimes", async (strategy, expected) => {
			useStrategy(strategy);
			setStatus("api", "up", { uptime24h: 100 });
			setStatus("db", "up", { uptime24h: 90 });
			setStatus("worker", "up", { uptime24h: 50 });
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")?.uptime24h).toBe(expected);
			expect(cache.getStatus("backend")?.uptime1h).toBe(100);
		});
	});

	describe("propagation", () => {
		test("updates parent groups", async () => {
			children("up", "down", "down");
			setStatus("web", "up");
			await updateGroupStatus("backend");

			expect(cache.getStatus("backend")?.status).toBe("down");
			expect(cache.getStatus("everything")?.status).toBe("down"); // all-up with one child down
		});

		test("a degraded child group counts as not up for its parent", async () => {
			children("up", "up", "down");
			setStatus("web", "up");
			await updateGroupStatus("backend");

			expect(cache.getStatus("backend")?.status).toBe("degraded");
			expect(cache.getStatus("everything")?.status).toBe("down");
		});

		test("parent recovers together with the child group", async () => {
			setStatus("web", "up");
			children("down", "down", "down");
			await updateGroupStatus("backend");
			expect(cache.getStatus("everything")?.status).toBe("down");

			children("up", "up", "up");
			await updateGroupStatus("backend");
			expect(cache.getStatus("backend")?.status).toBe("up");
			expect(cache.getStatus("everything")?.status).toBe("up");
		});
	});

	describe("uptime broadcasts", () => {
		test("publishes to every page showing the group when uptimes change", async () => {
			children("up", "up", "up");
			await updateGroupStatus("backend");
			fakeServer.reset();

			setStatus("api", "up", { uptime1h: 50 });
			await updateGroupStatus("backend");

			const updates = fakeServer.byAction("uptime-update").filter((p) => p.message.data.monitorId === "backend");
			expect(updates.map((p) => p.channel).sort()).toEqual(["slug-collapsed", "slug-main"]);
			expect(updates[0]!.message.data.uptime1h).toBeCloseTo(83.33, 1);
		});

		test("stays quiet when uptimes are unchanged", async () => {
			children("up", "up", "up");
			await updateGroupStatus("backend");
			fakeServer.reset();

			children("up", "up", "down");
			await updateGroupStatus("backend");
			expect(fakeServer.byAction("uptime-update").filter((p) => p.message.data.monitorId === "backend")).toEqual([]);
		});
	});

	describe("down tracking", () => {
		test("tracks consecutive down checks", async () => {
			children("down", "down", "down");
			await updateGroupStatus("backend");
			expect(groupStateTracker.getState("backend")?.consecutiveDownCount).toBe(1);
			expect(groupStateTracker.getState("backend")?.downStartTime).toBeNumber();

			await updateGroupStatus("backend");
			await updateGroupStatus("backend");
			expect(groupStateTracker.getState("backend")?.consecutiveDownCount).toBe(3);
		});

		test("clears the down state on recovery for groups without notification channels", async () => {
			children("down", "down", "down");
			await updateGroupStatus("backend");

			children("up", "up", "up");
			await updateGroupStatus("backend");
			expect(groupStateTracker.getState("backend")).toBeUndefined();
		});

		test("a degraded group is not tracked as down", async () => {
			children("up", "up", "down");
			await updateGroupStatus("backend");
			expect(groupStateTracker.getState("backend")).toBeUndefined();
		});
	});

	describe("notifications", () => {
		let send: ReturnType<typeof spyOn>;

		function enableNotifications(mutate?: (raw: Record<string, any>) => void): void {
			loadConfig((raw) => {
				raw.notifications = {
					channels: { critical: { id: "critical", name: "Critical", enabled: true, webhook: { enabled: true, url: "https://example.invalid/hook" } } },
				};
				raw.groups[0].notificationChannels = ["critical"];
				mutate?.(raw);
			});
		}

		const events = () => send.mock.calls.map((call: any[]) => ({ channels: call[0], type: call[1].type, id: call[1].monitorId }));

		beforeEach(() => {
			send = spyOn(groupStateTracker.getNotificationManager(), "sendNotification").mockResolvedValue(undefined);
			// Notifications are held back during the first minute after startup
			setSystemTime(new Date(STARTUP_TIME + 10 * 60_000));
		});

		afterEach(() => {
			send.mockRestore();
		});

		test("sends down and recovered notifications", async () => {
			enableNotifications();
			children("up", "up", "up");
			await updateGroupStatus("backend");
			expect(events()).toEqual([]);

			children("down", "down", "down");
			await updateGroupStatus("backend");
			expect(events()).toEqual([{ channels: ["critical"], type: "down", id: "backend" }]);
			expect(send.mock.calls[0]![1]).toMatchObject({
				sourceType: "group",
				groupInfo: { strategy: "percentage", childrenUp: 0, totalChildren: 3, upPercentage: 0 },
			});

			children("up", "up", "up");
			await updateGroupStatus("backend");
			expect(events().map((e: any) => e.type)).toEqual(["down", "recovered"]);
			expect(send.mock.calls[1]![1]).toMatchObject({ previousConsecutiveDownCount: 1 });
			expect(groupStateTracker.getState("backend")).toBeUndefined();
		});

		test("stays quiet during the startup grace period", async () => {
			setSystemTime(new Date(STARTUP_TIME + 1000));
			enableNotifications();
			children("down", "down", "down");
			await updateGroupStatus("backend");
			expect(events()).toEqual([]);
			expect(cache.getStatus("backend")?.status).toBe("down");
		});

		test("a group that recovers during the grace period starts its next outage from zero", async () => {
			enableNotifications();
			setSystemTime(new Date(STARTUP_TIME + 1000));
			children("down", "down", "down");
			await updateGroupStatus("backend");
			await updateGroupStatus("backend");
			children("up", "up", "up");
			await updateGroupStatus("backend");
			expect(groupStateTracker.getState("backend")).toBeUndefined();

			setSystemTime(new Date(STARTUP_TIME + 10 * 60_000));
			children("down", "down", "down");
			await updateGroupStatus("backend");
			expect(groupStateTracker.getState("backend")?.consecutiveDownCount).toBe(1);
			expect(events()).toEqual([{ channels: ["critical"], type: "down", id: "backend" }]);
		});

		test("groups without channels send nothing", async () => {
			children("down", "down", "down");
			await updateGroupStatus("backend");
			expect(events()).toEqual([]);
		});

		test("does not repeat the down notification unless resendNotification is set", async () => {
			enableNotifications();
			children("down", "down", "down");
			for (let i = 0; i < 5; i++) await updateGroupStatus("backend");
			expect(events().map((e: any) => e.type)).toEqual(["down"]);
		});

		test("resends a still-down notification every resendNotification checks", async () => {
			enableNotifications((raw) => (raw.groups[0].resendNotification = 2));
			children("down", "down", "down");
			for (let i = 0; i < 5; i++) await updateGroupStatus("backend");
			expect(events().map((e: any) => e.type)).toEqual(["down", "still-down", "still-down"]);
			expect(send.mock.calls[1]![1]).toMatchObject({ consecutiveDownCount: 3 });
		});

		test("suppresses down and recovery during an active maintenance", async () => {
			enableNotifications();
			cache.setActiveMaintenanceMonitors(new Map([["backend", ["mnt-1"]]]));

			children("down", "down", "down");
			await updateGroupStatus("backend");
			expect(groupStateTracker.getState("backend")?.notificationSuppressed).toBe(true);

			children("up", "up", "up");
			await updateGroupStatus("backend");
			expect(events()).toEqual([]);
		});

		test("suppresses down and recovery during an active incident", async () => {
			enableNotifications();
			cache.setActiveIncidentMonitors(new Map([["backend", ["inc-1"]]]));

			children("down", "down", "down");
			await updateGroupStatus("backend");
			children("up", "up", "up");
			await updateGroupStatus("backend");
			expect(events()).toEqual([]);
		});

		test("suppresses the notification when a dependency is already down", async () => {
			enableNotifications((raw) => {
				raw.monitors[3].dependencies = [];
				raw.groups[0].dependencies = ["web"];
			});
			setStatus("web", "down");

			children("down", "down", "down");
			await updateGroupStatus("backend");
			expect(events()).toEqual([]);
			expect(groupStateTracker.getState("backend")?.notificationSuppressed).toBe(true);
		});
	});
});
