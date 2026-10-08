import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { cache } from "../src/cache";
import {
	addMaintenanceUpdate,
	createMaintenance,
	deleteMaintenance,
	deleteMaintenanceUpdate,
	getActiveMaintenances,
	getAllMaintenances,
	getInProgressMaintenancesExpired,
	getMaintenanceById,
	getMaintenancesByMonth,
	getScheduledMaintenancesDue,
	transitionMaintenanceStatus,
	updateMaintenance,
} from "../src/maintenances";
import { maintenanceScheduler } from "../src/schedulers/maintenance";
import { useDatabase } from "./helpers/database";
import { fakeServer } from "./helpers/fakes";
import { resetState } from "./helpers/status";

useDatabase();

const at = (iso: string) => setSystemTime(new Date(iso));

function create(overrides: Partial<Parameters<typeof createMaintenance>[0]> = {}) {
	return createMaintenance({
		statusPageId: "main",
		title: "Database upgrade",
		status: "scheduled",
		scheduledStart: "2026-03-15T02:00:00.000Z",
		scheduledEnd: "2026-03-15T04:00:00.000Z",
		message: "We will upgrade the database.",
		...overrides,
	});
}

/** Run one scheduler cycle, the same thing the scheduler does every 30 seconds. */
async function tick(): Promise<void> {
	await (maintenanceScheduler as any).tick();
}

beforeEach(() => {
	resetState();
	at("2026-03-10T12:00:00.000Z");
});

afterEach(() => {
	setSystemTime();
	resetState();
});

describe("maintenances", () => {
	describe("createMaintenance", () => {
		test("stores the maintenance with its first update", async () => {
			const created = await create({ affectedMonitors: ["db"] });
			const stored = await getMaintenanceById(created.id);

			expect(stored).toEqual(created);
			expect(stored).toMatchObject({
				status_page_id: "main",
				title: "Database upgrade",
				status: "scheduled",
				scheduled_start: "2026-03-15T02:00:00.000Z",
				scheduled_end: "2026-03-15T04:00:00.000Z",
				affected_monitors: ["db"],
				suppress_notifications: true,
				created_at: "2026-03-10T12:00:00.000Z",
				completed_at: null,
			});
			expect(stored!.updates).toEqual([
				{
					id: expect.any(String),
					maintenance_id: created.id,
					status: "scheduled",
					message: "We will upgrade the database.",
					created_at: "2026-03-10T12:00:00.000Z",
				},
			]);
		});

		test("can leave notifications enabled", async () => {
			const stored = await getMaintenanceById((await create({ suppressNotifications: false })).id);
			expect(stored!.suppress_notifications).toBe(false);
		});

		test("a maintenance created as completed has completed_at set", async () => {
			const stored = await getMaintenanceById((await create({ status: "completed" })).id);
			expect(stored!.completed_at).toBe("2026-03-10T12:00:00.000Z");
		});

		test("returns null for an unknown maintenance", async () => {
			expect(await getMaintenanceById("ghost")).toBeNull();
		});
	});

	describe("updateMaintenance", () => {
		test("changes only the provided fields", async () => {
			const created = await create({ affectedMonitors: ["db"] });
			at("2026-03-11T00:00:00.000Z");
			await updateMaintenance(created.id, { title: "DB upgrade", scheduledEnd: "2026-03-15T05:00:00.000Z" });

			expect(await getMaintenanceById(created.id)).toMatchObject({
				title: "DB upgrade",
				scheduled_start: "2026-03-15T02:00:00.000Z",
				scheduled_end: "2026-03-15T05:00:00.000Z",
				affected_monitors: ["db"],
				suppress_notifications: true,
				status: "scheduled",
				updated_at: "2026-03-11T00:00:00.000Z",
			});
		});

		test("can clear affected monitors and turn suppression off", async () => {
			const created = await create({ affectedMonitors: ["db"] });
			await updateMaintenance(created.id, { affectedMonitors: [], suppressNotifications: false });
			expect(await getMaintenanceById(created.id)).toMatchObject({ affected_monitors: [], suppress_notifications: false });
		});

		test("returns null for an unknown maintenance", async () => {
			expect(await updateMaintenance("ghost", { title: "x" })).toBeNull();
		});
	});

	describe("addMaintenanceUpdate", () => {
		test("appends the update and moves the maintenance to its status", async () => {
			const created = await create();
			at("2026-03-15T02:00:00.000Z");
			const result = await addMaintenanceUpdate(created.id, { status: "in_progress", message: "Starting." });

			expect(result!.update).toMatchObject({ maintenance_id: created.id, status: "in_progress", message: "Starting." });
			expect(await getMaintenanceById(created.id)).toMatchObject({ status: "in_progress", completed_at: null, updated_at: "2026-03-15T02:00:00.000Z" });
		});

		test.each(["completed", "cancelled"] as const)("%s sets completed_at", async (status) => {
			const created = await create();
			at("2026-03-15T03:00:00.000Z");
			await addMaintenanceUpdate(created.id, { status, message: "Done." });
			expect(await getMaintenanceById(created.id)).toMatchObject({ status, completed_at: "2026-03-15T03:00:00.000Z" });
		});

		test("reopening a completed maintenance clears completed_at", async () => {
			const created = await create({ status: "completed" });
			await addMaintenanceUpdate(created.id, { status: "in_progress", message: "Not done after all." });
			expect(await getMaintenanceById(created.id)).toMatchObject({ status: "in_progress", completed_at: null });
		});

		test("returns null for an unknown maintenance", async () => {
			expect(await addMaintenanceUpdate("ghost", { status: "completed", message: "x" })).toBeNull();
		});
	});

	describe("deleteMaintenanceUpdate", () => {
		test("deleting the latest update rolls the status back", async () => {
			const created = await create();
			at("2026-03-15T03:00:00.000Z");
			const completed = await addMaintenanceUpdate(created.id, { status: "completed", message: "Done." });

			const result = await deleteMaintenanceUpdate(created.id, completed!.update.id);
			expect(result).toMatchObject({ status: "scheduled", completed_at: null });
			expect(await getMaintenanceById(created.id)).toMatchObject({ status: "scheduled", completed_at: null });
		});

		test("deleting an older update keeps the status", async () => {
			const created = await create();
			at("2026-03-15T03:00:00.000Z");
			await addMaintenanceUpdate(created.id, { status: "completed", message: "Done." });

			await deleteMaintenanceUpdate(created.id, created.updates[0]!.id);
			const stored = await getMaintenanceById(created.id);
			expect(stored).toMatchObject({ status: "completed", completed_at: "2026-03-15T03:00:00.000Z" });
			expect(stored!.updates).toHaveLength(1);
		});

		test("returns null for an unknown maintenance or update", async () => {
			const created = await create();
			expect(await deleteMaintenanceUpdate("ghost", created.updates[0]!.id)).toBeNull();
			expect(await deleteMaintenanceUpdate(created.id, "ghost")).toBeNull();
		});
	});

	describe("deleteMaintenance", () => {
		test("removes the maintenance and its updates only", async () => {
			const a = await create();
			const b = await create();

			expect(await deleteMaintenance(a.id)).toBe(true);
			expect(await getMaintenanceById(a.id)).toBeNull();
			expect((await getMaintenanceById(b.id))!.updates).toHaveLength(1);
		});
	});

	describe("listing", () => {
		test("getAllMaintenances lists the latest start first, optionally per status page", async () => {
			const early = await create({ scheduledStart: "2026-03-01T00:00:00.000Z" });
			const late = await create({ scheduledStart: "2026-03-20T00:00:00.000Z" });
			const other = await create({ scheduledStart: "2026-03-10T00:00:00.000Z", statusPageId: "private" });

			expect((await getAllMaintenances()).map((m) => m.id)).toEqual([late.id, other.id, early.id]);
			expect((await getAllMaintenances("main")).map((m) => m.id)).toEqual([late.id, early.id]);
		});

		test("getMaintenancesByMonth selects by scheduled start", async () => {
			const feb = await create({ scheduledStart: "2026-02-28T23:59:59.999Z", scheduledEnd: "2026-03-01T01:00:00.000Z" });
			const marStart = await create({ scheduledStart: "2026-03-01T00:00:00.000Z" });
			const marEnd = await create({ scheduledStart: "2026-03-31T23:59:59.999Z", scheduledEnd: "2026-04-01T01:00:00.000Z" });
			await create({ scheduledStart: "2026-04-01T00:00:00.000Z", scheduledEnd: "2026-04-01T01:00:00.000Z" });

			const march = await getMaintenancesByMonth("main", "2026-03");
			expect(march.map((m) => m.id)).toEqual([marEnd.id, marStart.id]);
			expect(march[0]!.updates).toHaveLength(1);
			expect((await getMaintenancesByMonth("main", "2026-02")).map((m) => m.id)).toEqual([feb.id]);
			expect(await getMaintenancesByMonth("private", "2026-03")).toEqual([]);
			expect(await getMaintenancesByMonth("main", "nonsense")).toEqual([]);
		});

		test("getMaintenancesByMonth defaults to the current month", async () => {
			const created = await create();
			expect((await getMaintenancesByMonth("main")).map((m) => m.id)).toEqual([created.id]);
		});
	});

	describe("scheduler queries", () => {
		test("getScheduledMaintenancesDue returns scheduled maintenances whose start has passed", async () => {
			const due = await create({ scheduledStart: "2026-03-10T11:00:00.000Z" });
			const dueNow = await create({ scheduledStart: "2026-03-10T12:00:00.000Z" });
			await create({ scheduledStart: "2026-03-10T12:00:00.001Z" });
			await create({ scheduledStart: "2026-03-10T11:00:00.000Z", status: "in_progress" });
			await create({ scheduledStart: "2026-03-10T11:00:00.000Z", status: "cancelled" });

			expect((await getScheduledMaintenancesDue()).map((m) => m.id).sort()).toEqual([due.id, dueNow.id].sort());
		});

		test("getInProgressMaintenancesExpired returns running maintenances whose end has passed", async () => {
			const expired = await create({ status: "in_progress", scheduledStart: "2026-03-10T10:00:00.000Z", scheduledEnd: "2026-03-10T11:00:00.000Z" });
			await create({ status: "in_progress", scheduledStart: "2026-03-10T10:00:00.000Z", scheduledEnd: "2026-03-10T13:00:00.000Z" });
			await create({ status: "scheduled", scheduledStart: "2026-03-10T10:00:00.000Z", scheduledEnd: "2026-03-10T11:00:00.000Z" });

			expect((await getInProgressMaintenancesExpired()).map((m) => m.id)).toEqual([expired.id]);
		});

		test("getActiveMaintenances returns running maintenances that suppress notifications", async () => {
			const active = await create({ status: "in_progress" });
			await create({ status: "in_progress", suppressNotifications: false });
			await create({ status: "scheduled" });
			await create({ status: "completed" });

			expect((await getActiveMaintenances()).map((m) => m.id)).toEqual([active.id]);
		});
	});

	describe("transitionMaintenanceStatus", () => {
		test("changes the status and adds a timeline update", async () => {
			const created = await create();
			at("2026-03-15T02:00:00.000Z");
			const result = await transitionMaintenanceStatus(created.id, "in_progress", "Started automatically.");

			expect(result!.updates.map((u) => u.status)).toEqual(["scheduled", "in_progress"]);
			const stored = await getMaintenanceById(created.id);
			expect(stored).toMatchObject({ status: "in_progress", completed_at: null, updated_at: "2026-03-15T02:00:00.000Z" });
			expect(stored!.updates[1]).toMatchObject({ status: "in_progress", message: "Started automatically." });
		});

		test("completing sets completed_at", async () => {
			const created = await create({ status: "in_progress" });
			at("2026-03-15T04:00:00.000Z");
			await transitionMaintenanceStatus(created.id, "completed", "Ended.");
			expect(await getMaintenanceById(created.id)).toMatchObject({ status: "completed", completed_at: "2026-03-15T04:00:00.000Z" });
		});

		test("returns null for an unknown maintenance", async () => {
			expect(await transitionMaintenanceStatus("ghost", "completed", "x")).toBeNull();
		});
	});

	describe("maintenance scheduler", () => {
		test("starts a scheduled maintenance once its window opens", async () => {
			const created = await create({ affectedMonitors: ["db", "worker"] });

			await tick();
			expect((await getMaintenanceById(created.id))!.status).toBe("scheduled");
			expect(cache.isUnderActiveMaintenance("db")).toBeUndefined();

			at("2026-03-15T02:00:30.000Z");
			await tick();

			const started = await getMaintenanceById(created.id);
			expect(started!.status).toBe("in_progress");
			expect(started!.updates).toHaveLength(2);
			expect(cache.isUnderActiveMaintenance("db")).toBe(created.id);
			expect(cache.isUnderActiveMaintenance("worker")).toBe(created.id);
			expect(cache.isUnderActiveMaintenance("api")).toBeUndefined();

			const events = fakeServer.byAction("maintenance-update-added");
			expect(events).toHaveLength(1);
			expect(events[0]!.channel).toBe("slug-main");
			expect(events[0]!.message.data.maintenance).toMatchObject({ id: created.id, status: "in_progress" });
		});

		test("completes a running maintenance once its window closes and lifts the suppression", async () => {
			const created = await create({ affectedMonitors: ["db"] });
			at("2026-03-15T02:00:30.000Z");
			await tick();
			fakeServer.reset();

			at("2026-03-15T04:00:30.000Z");
			await tick();

			expect(await getMaintenanceById(created.id)).toMatchObject({ status: "completed", completed_at: "2026-03-15T04:00:30.000Z" });
			expect(cache.isUnderActiveMaintenance("db")).toBeUndefined();
			expect(fakeServer.byAction("maintenance-update-added")).toHaveLength(1);
		});

		test("a window that already ended is started and completed in one cycle", async () => {
			const created = await create();
			at("2026-03-16T00:00:00.000Z");
			await tick();

			const stored = await getMaintenanceById(created.id);
			expect(stored!.status).toBe("completed");
			expect(stored!.updates.map((u) => u.status)).toEqual(["scheduled", "in_progress", "completed"]);
		});

		test("does not touch cancelled or completed maintenances", async () => {
			const cancelled = await create({ status: "cancelled" });
			const completed = await create({ status: "completed" });
			at("2026-03-16T00:00:00.000Z");
			await tick();

			expect((await getMaintenanceById(cancelled.id))!.updates).toHaveLength(1);
			expect((await getMaintenanceById(completed.id))!.updates).toHaveLength(1);
		});

		test("does not suppress notifications when the maintenance opted out", async () => {
			await create({ affectedMonitors: ["db"], suppressNotifications: false });
			at("2026-03-15T02:00:30.000Z");
			await tick();
			expect(cache.isUnderActiveMaintenance("db")).toBeUndefined();
		});

		test("refreshCache picks up manual status changes", async () => {
			const created = await create({ affectedMonitors: ["db"], status: "in_progress" });
			await maintenanceScheduler.refreshCache();
			expect(cache.isUnderActiveMaintenance("db")).toBe(created.id);

			await addMaintenanceUpdate(created.id, { status: "cancelled", message: "Called off." });
			await maintenanceScheduler.refreshCache();
			expect(cache.isUnderActiveMaintenance("db")).toBeUndefined();
		});
	});
});
