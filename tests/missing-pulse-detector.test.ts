import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { cache } from "../src/cache";
import { MissingPulseDetector } from "../src/missing-pulse-detector";
import { STARTUP_TIME } from "../src/times";
import { fakeServer } from "./helpers/fakes";
import { loadConfig, restoreConfig } from "./helpers/config";
import { resetState, setStatus, settle } from "./helpers/status";

/** A moment well past the startup grace period. */
const NOW = STARTUP_TIME + 10 * 60_000;
const SECOND = 1000;

let detector: MissingPulseDetector;
let send: ReturnType<typeof spyOn>;

/** Run one detection cycle, the same thing the detector does on every interval tick. */
async function check(): Promise<void> {
	await (detector as any).detectMissingPulses();
}

/** Mark a monitor as up with its last pulse `secondsAgo` seconds in the past. */
function lastPulse(id: string, secondsAgo: number): void {
	setStatus(id, "up", { lastCheck: new Date(Date.now() - secondsAgo * SECOND) });
}

function advance(seconds: number): void {
	setSystemTime(new Date(Date.now() + seconds * SECOND));
}

function published(action: string, monitorId: string) {
	return fakeServer.byAction(action).filter((p) => p.message.data.monitorId === monitorId);
}

function notifications() {
	return send.mock.calls.map((call: any[]) => ({ type: call[1].type, id: call[1].monitorId }));
}

/** Reload the configuration with a notification channel attached to every monitor. */
function enableNotifications(mutate?: (raw: Record<string, any>) => void): void {
	loadConfig((raw) => {
		raw.notifications = {
			channels: { critical: { id: "critical", name: "Critical", enabled: true, webhook: { enabled: true, url: "https://example.invalid/hook" } } },
		};
		for (const monitor of raw.monitors) monitor.notificationChannels = ["critical"];
		mutate?.(raw);
	});
}

beforeEach(() => {
	restoreConfig();
	resetState();
	setSystemTime(new Date(NOW));
	detector = new MissingPulseDetector({ checkInterval: 5000 });
	send = spyOn((detector as any).notificationManager, "sendNotification").mockResolvedValue(undefined);
});

afterEach(async () => {
	detector.stop();
	setSystemTime();
	await settle();
	restoreConfig();
	resetState();
});

describe("MissingPulseDetector", () => {
	describe("detection", () => {
		test("leaves monitors with a recent pulse alone", async () => {
			lastPulse("api", 10); // interval 30s
			await check();

			expect(cache.getStatus("api")?.status).toBe("up");
			expect(detector.getStatus().monitorsWithMissingPulses).toEqual([]);
			expect(published("monitor-down", "api")).toEqual([]);
		});

		test("a pulse exactly one interval old is still on time", async () => {
			lastPulse("api", 30);
			await check();
			expect(cache.getStatus("api")?.status).toBe("up");
		});

		test("marks a monitor down once its pulse is overdue", async () => {
			lastPulse("api", 31);
			await check();

			expect(cache.getStatus("api")?.status).toBe("down");
			expect(detector.getStatus().monitorsWithMissingPulses).toEqual([
				expect.objectContaining({ monitorId: "api", monitorName: "API", missedCount: 1, maxRetries: 0, consecutiveDownCount: 1 }),
			]);
		});

		test("announces the outage on every status page showing the monitor", async () => {
			lastPulse("api", 45);
			await check();

			const events = published("monitor-down", "api");
			expect(events.map((e) => e.channel).sort()).toEqual(["slug-main", "slug-private"]);
			// Down since the pulse became overdue: 45s since the last pulse minus the 30s interval
			expect(events[0]!.message.data.downtime).toBe(15 * SECOND);
		});

		test("ignores monitors that have never sent a pulse", async () => {
			await check();
			expect(cache.getStatus("api")).toBeUndefined();
			expect(detector.getStatus().monitorsWithMissingPulses).toEqual([]);
			expect(fakeServer.published).toEqual([]);
		});

		test("uses the most recent of the recorded pulse and the cached status", async () => {
			lastPulse("api", 120);
			detector.recordPulse("api", new Date(Date.now() - 5 * SECOND));
			await check();
			expect(cache.getStatus("api")?.status).toBe("up");
		});

		test("does not change statuses during the startup grace period", async () => {
			setSystemTime(new Date(STARTUP_TIME + 5 * SECOND));
			lastPulse("api", 300);
			await check();

			expect(cache.getStatus("api")?.status).toBe("up");
			expect(published("monitor-down", "api")).toEqual([]);
		});

		test("reports whether it is running", () => {
			expect(detector.getStatus()).toMatchObject({ running: false, checkInterval: 5000 });
		});
	});

	describe("retries", () => {
		test("waits for maxRetries missed checks before marking down", async () => {
			lastPulse("db", 90); // interval 60s, maxRetries 1
			await check();
			expect(cache.getStatus("db")?.status).toBe("up");
			expect(detector.getStatus().monitorsWithMissingPulses[0]).toMatchObject({ monitorId: "db", missedCount: 1, consecutiveDownCount: 0 });

			await check();
			expect(cache.getStatus("db")?.status).toBe("down");
			expect(published("monitor-down", "db")).toHaveLength(1);
		});

		test("a pulse in between resets the missed count", async () => {
			lastPulse("db", 90);
			await check();

			lastPulse("db", 1);
			await check();
			expect(detector.getStatus().monitorsWithMissingPulses).toEqual([]);

			lastPulse("db", 90);
			await check();
			expect(cache.getStatus("db")?.status).toBe("up");
		});
	});

	describe("ongoing outages", () => {
		test("counts consecutive down checks without announcing them again", async () => {
			lastPulse("api", 31);
			await check();
			advance(5);
			await check();
			advance(5);
			await check();

			expect(detector.getStatus().monitorsWithMissingPulses[0]).toMatchObject({ consecutiveDownCount: 3, actualDowntime: 11 * SECOND });
			expect(published("monitor-down", "api")).toHaveLength(2); // one per status page
			expect(published("monitor-still-down", "api")).toEqual([]);
		});

		test("repeats the announcement every resendNotification checks", async () => {
			loadConfig((raw) => (raw.monitors[0].resendNotification = 2));
			lastPulse("api", 31);
			for (let i = 0; i < 5; i++) {
				await check();
				advance(5);
			}

			const stillDown = published("monitor-still-down", "api").filter((e) => e.channel === "slug-main");
			expect(stillDown.map((e) => e.message.data.consecutiveDownCount)).toEqual([3, 5]);
		});
	});

	describe("recovery", () => {
		test("announces the recovery with the total downtime and clears the state", async () => {
			lastPulse("api", 31);
			await check();
			advance(60);
			await check();
			fakeServer.reset();

			detector.recordPulse("api", new Date());
			detector.resetMonitor("api");

			const events = published("monitor-recovered", "api");
			expect(events.map((e) => e.channel).sort()).toEqual(["slug-main", "slug-private"]);
			expect(events[0]!.message.data).toMatchObject({ previousConsecutiveDownCount: 2, downtime: 61 * SECOND });
			expect(detector.getStatus().monitorsWithMissingPulses).toEqual([]);
		});

		test("a pulse for a healthy monitor announces nothing", () => {
			lastPulse("api", 5);
			detector.resetMonitor("api");
			expect(published("monitor-recovered", "api")).toEqual([]);
		});

		test("a pulse during the retry window announces nothing", async () => {
			lastPulse("db", 90);
			await check();
			detector.resetMonitor("db");

			expect(published("monitor-recovered", "db")).toEqual([]);
			expect(detector.getStatus().monitorsWithMissingPulses).toEqual([]);
		});
	});

	describe("notifications", () => {
		test("sends nothing for monitors without channels", async () => {
			lastPulse("api", 31);
			await check();
			detector.resetMonitor("api");
			expect(notifications()).toEqual([]);
		});

		test("sends down, still-down and recovered notifications", async () => {
			enableNotifications((raw) => (raw.monitors[0].resendNotification = 1));
			lastPulse("api", 31);
			await check();
			advance(5);
			await check();
			detector.resetMonitor("api");

			expect(notifications()).toEqual([
				{ type: "down", id: "api" },
				{ type: "still-down", id: "api" },
				{ type: "recovered", id: "api" },
			]);
			expect(send.mock.calls[0]![0]).toEqual(["critical"]);
			expect(send.mock.calls[0]![1]).toMatchObject({ sourceType: "monitor", monitorName: "API", downtime: 1 * SECOND });
			expect(send.mock.calls[2]![1]).toMatchObject({ previousConsecutiveDownCount: 2, downtime: 6 * SECOND });
		});

		test("suppresses down and recovery during an active maintenance", async () => {
			enableNotifications();
			cache.setActiveMaintenanceMonitors(new Map([["api", ["mnt-1"]]]));
			lastPulse("api", 31);
			await check();
			expect(cache.getStatus("api")?.status).toBe("down");

			detector.resetMonitor("api");
			expect(notifications()).toEqual([]);
		});

		test("suppresses down and recovery during an active incident", async () => {
			enableNotifications();
			cache.setActiveIncidentMonitors(new Map([["api", ["inc-1"]]]));
			lastPulse("api", 31);
			await check();

			detector.resetMonitor("api");
			expect(notifications()).toEqual([]);
		});

		test("suppresses a dependent monitor when its dependency went down in the same cycle", async () => {
			enableNotifications((raw) => (raw.monitors[1].maxRetries = 0));
			lastPulse("db", 200);
			lastPulse("worker", 200); // depends on db
			await check();

			expect(cache.getStatus("db")?.status).toBe("down");
			expect(cache.getStatus("worker")?.status).toBe("down");
			expect(notifications()).toEqual([{ type: "down", id: "db" }]);

			detector.resetMonitor("worker");
			expect(notifications().filter((n: any) => n.id === "worker")).toEqual([]);
		});

		test("holds back a dependent monitor's notification while its dependency is still up", async () => {
			enableNotifications();
			lastPulse("db", 1);
			lastPulse("worker", 200);
			await check();

			expect(cache.getStatus("worker")?.status).toBe("down");
			// Deferred for a recheck instead of being sent straight away
			expect(notifications()).toEqual([]);
		});

		test("does not announce a recovery when the held back down notification was never sent", async () => {
			enableNotifications();
			lastPulse("db", 1);
			lastPulse("worker", 200);
			await check();

			detector.resetMonitor("worker");
			expect(notifications()).toEqual([]);
		});
	});
});
