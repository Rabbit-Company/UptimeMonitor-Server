import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { cache } from "../src/cache";
import {
	addIncidentUpdate,
	broadcastIncidentEvent,
	createIncident,
	deleteIncident,
	deleteIncidentUpdate,
	getActiveIncidents,
	getAllIncidents,
	getIncidentById,
	getIncidentsByMonth,
	updateIncident,
} from "../src/incidents";
import { incidentScheduler } from "../src/schedulers/incident";
import { useDatabase } from "./helpers/database";
import { fakeServer } from "./helpers/fakes";
import { resetState } from "./helpers/status";

useDatabase();

const at = (iso: string) => setSystemTime(new Date(iso));

function create(overrides: Partial<Parameters<typeof createIncident>[0]> = {}) {
	return createIncident({
		statusPageId: "main",
		title: "API errors",
		status: "investigating",
		severity: "major",
		message: "We are looking into it.",
		...overrides,
	});
}

beforeEach(() => {
	resetState();
	at("2026-03-10T12:00:00.000Z");
});

afterEach(() => {
	setSystemTime();
	resetState();
});

describe("incidents", () => {
	describe("createIncident", () => {
		test("stores the incident with its first update", async () => {
			const created = await create({ affectedMonitors: ["api", "db"] });
			const stored = await getIncidentById(created.id);

			expect(stored).toEqual(created);
			expect(stored).toMatchObject({
				status_page_id: "main",
				title: "API errors",
				status: "investigating",
				severity: "major",
				affected_monitors: ["api", "db"],
				suppress_notifications: true,
				created_at: "2026-03-10T12:00:00.000Z",
				updated_at: "2026-03-10T12:00:00.000Z",
				resolved_at: null,
			});
			expect(stored!.updates).toEqual([
				{
					id: expect.any(String),
					incident_id: created.id,
					status: "investigating",
					message: "We are looking into it.",
					created_at: "2026-03-10T12:00:00.000Z",
				},
			]);
		});

		test("defaults to no affected monitors and suppressed notifications", async () => {
			const stored = await getIncidentById((await create()).id);
			expect(stored!.affected_monitors).toEqual([]);
			expect(stored!.suppress_notifications).toBe(true);
		});

		test("can leave notifications enabled", async () => {
			const stored = await getIncidentById((await create({ suppressNotifications: false })).id);
			expect(stored!.suppress_notifications).toBe(false);
		});

		test("an incident created as resolved is resolved immediately", async () => {
			const stored = await getIncidentById((await create({ status: "resolved" })).id);
			expect(stored!.resolved_at).toBe("2026-03-10T12:00:00.000Z");
		});

		test("gives every incident its own id", async () => {
			const a = await create();
			const b = await create();
			expect(a.id).not.toBe(b.id);
		});
	});

	describe("getIncidentById", () => {
		test("returns null for an unknown incident", async () => {
			expect(await getIncidentById("ghost")).toBeNull();
		});

		test("returns updates oldest first", async () => {
			const created = await create();
			at("2026-03-10T12:10:00.000Z");
			await addIncidentUpdate(created.id, { status: "identified", message: "Found it." });
			at("2026-03-10T12:20:00.000Z");
			await addIncidentUpdate(created.id, { status: "monitoring", message: "Fix deployed." });

			const stored = await getIncidentById(created.id);
			expect(stored!.updates.map((u) => u.status)).toEqual(["investigating", "identified", "monitoring"]);
		});
	});

	describe("updateIncident", () => {
		test("changes only the provided fields", async () => {
			const created = await create({ affectedMonitors: ["api"] });
			at("2026-03-10T13:00:00.000Z");
			const updated = await updateIncident(created.id, { title: "API outage", severity: "critical" });

			expect(updated).toMatchObject({ title: "API outage", severity: "critical", affected_monitors: ["api"], suppress_notifications: true });
			expect(await getIncidentById(created.id)).toMatchObject({
				title: "API outage",
				severity: "critical",
				affected_monitors: ["api"],
				status: "investigating",
				created_at: "2026-03-10T12:00:00.000Z",
				updated_at: "2026-03-10T13:00:00.000Z",
			});
		});

		test("can clear affected monitors and turn suppression off", async () => {
			const created = await create({ affectedMonitors: ["api"] });
			await updateIncident(created.id, { affectedMonitors: [], suppressNotifications: false });

			expect(await getIncidentById(created.id)).toMatchObject({ affected_monitors: [], suppress_notifications: false });
		});

		test("returns null for an unknown incident", async () => {
			expect(await updateIncident("ghost", { title: "x" })).toBeNull();
		});
	});

	describe("addIncidentUpdate", () => {
		test("appends the update and moves the incident to its status", async () => {
			const created = await create();
			at("2026-03-10T12:30:00.000Z");
			const result = await addIncidentUpdate(created.id, { status: "identified", message: "Bad deploy." });

			expect(result!.update).toMatchObject({ incident_id: created.id, status: "identified", message: "Bad deploy.", created_at: "2026-03-10T12:30:00.000Z" });
			expect(result!.incident.updates).toHaveLength(2);

			const stored = await getIncidentById(created.id);
			expect(stored).toMatchObject({ status: "identified", updated_at: "2026-03-10T12:30:00.000Z", resolved_at: null });
			expect(stored!.updates).toHaveLength(2);
		});

		test("resolving sets resolved_at", async () => {
			const created = await create();
			at("2026-03-10T14:00:00.000Z");
			await addIncidentUpdate(created.id, { status: "resolved", message: "Done." });

			expect(await getIncidentById(created.id)).toMatchObject({ status: "resolved", resolved_at: "2026-03-10T14:00:00.000Z" });
		});

		test("reopening a resolved incident clears resolved_at", async () => {
			const created = await create({ status: "resolved" });
			at("2026-03-10T14:00:00.000Z");
			await addIncidentUpdate(created.id, { status: "investigating", message: "It is back." });

			expect((await getIncidentById(created.id))!.resolved_at).toBeNull();
		});

		test("returns null for an unknown incident", async () => {
			expect(await addIncidentUpdate("ghost", { status: "resolved", message: "x" })).toBeNull();
		});
	});

	describe("deleteIncidentUpdate", () => {
		test("deleting the latest update rolls the status back", async () => {
			const created = await create();
			at("2026-03-10T12:30:00.000Z");
			const resolved = await addIncidentUpdate(created.id, { status: "resolved", message: "Done." });
			at("2026-03-10T12:40:00.000Z");

			const result = await deleteIncidentUpdate(created.id, resolved!.update.id);
			expect(result).toMatchObject({ status: "investigating", resolved_at: null });
			expect(result!.updates).toHaveLength(1);

			expect(await getIncidentById(created.id)).toMatchObject({ status: "investigating", resolved_at: null, updated_at: "2026-03-10T12:40:00.000Z" });
		});

		test("deleting an older update keeps the status", async () => {
			const created = await create();
			at("2026-03-10T12:30:00.000Z");
			await addIncidentUpdate(created.id, { status: "resolved", message: "Done." });

			const result = await deleteIncidentUpdate(created.id, created.updates[0]!.id);
			expect(result!.updates.map((u) => u.status)).toEqual(["resolved"]);
			expect(await getIncidentById(created.id)).toMatchObject({ status: "resolved", resolved_at: "2026-03-10T12:30:00.000Z" });
		});

		test("deleting the only update keeps the incident and its status", async () => {
			const created = await create({ status: "identified" });
			const result = await deleteIncidentUpdate(created.id, created.updates[0]!.id);

			expect(result).toMatchObject({ status: "identified", updates: [] });
			expect(await getIncidentById(created.id)).toMatchObject({ status: "identified", updates: [] });
		});

		test("returns null for an unknown incident or update", async () => {
			const created = await create();
			expect(await deleteIncidentUpdate("ghost", created.updates[0]!.id)).toBeNull();
			expect(await deleteIncidentUpdate(created.id, "ghost")).toBeNull();
		});

		test("does not delete an update that belongs to another incident", async () => {
			const a = await create();
			const b = await create();
			expect(await deleteIncidentUpdate(a.id, b.updates[0]!.id)).toBeNull();
			expect((await getIncidentById(b.id))!.updates).toHaveLength(1);
		});
	});

	describe("deleteIncident", () => {
		test("removes the incident and its updates only", async () => {
			const a = await create();
			const b = await create();

			expect(await deleteIncident(a.id)).toBe(true);
			expect(await getIncidentById(a.id)).toBeNull();
			expect((await getIncidentById(b.id))!.updates).toHaveLength(1);
		});
	});

	describe("getAllIncidents", () => {
		test("lists newest first, optionally per status page", async () => {
			const first = await create({ title: "first" });
			at("2026-03-11T12:00:00.000Z");
			const second = await create({ title: "second", statusPageId: "private" });
			at("2026-03-12T12:00:00.000Z");
			const third = await create({ title: "third" });

			expect((await getAllIncidents()).map((i) => i.id)).toEqual([third.id, second.id, first.id]);
			expect((await getAllIncidents("main")).map((i) => i.id)).toEqual([third.id, first.id]);
			expect(await getAllIncidents("ghost")).toEqual([]);
		});
	});

	describe("getIncidentsByMonth", () => {
		test("returns the incidents created in that month with their updates", async () => {
			at("2026-02-28T23:59:59.999Z");
			const feb = await create({ title: "feb" });
			at("2026-03-01T00:00:00.000Z");
			const marStart = await create({ title: "march start" });
			at("2026-03-31T23:59:59.999Z");
			const marEnd = await create({ title: "march end" });
			await addIncidentUpdate(marEnd.id, { status: "resolved", message: "Done." });
			at("2026-04-01T00:00:00.000Z");
			await create({ title: "april" });

			const march = await getIncidentsByMonth("main", "2026-03");
			expect(march.map((i) => i.id)).toEqual([marEnd.id, marStart.id]);
			expect(march[0]!.updates).toHaveLength(2);
			expect(march[1]!.updates).toHaveLength(1);

			expect((await getIncidentsByMonth("main", "2026-02")).map((i) => i.id)).toEqual([feb.id]);
		});

		test("handles December", async () => {
			at("2026-12-31T23:00:00.000Z");
			const dec = await create();
			at("2027-01-01T00:00:00.000Z");
			await create();

			expect((await getIncidentsByMonth("main", "2026-12")).map((i) => i.id)).toEqual([dec.id]);
		});

		test("defaults to the current month", async () => {
			const created = await create();
			expect((await getIncidentsByMonth("main")).map((i) => i.id)).toEqual([created.id]);

			at("2026-04-15T00:00:00.000Z");
			expect(await getIncidentsByMonth("main")).toEqual([]);
		});

		test("only returns incidents of the requested status page", async () => {
			await create({ statusPageId: "private" });
			expect(await getIncidentsByMonth("main", "2026-03")).toEqual([]);
		});

		test.each(["2026-13", "2026-00", "garbage", "2026"])("returns nothing for the invalid month %p", async (month) => {
			await create();
			expect(await getIncidentsByMonth("main", month)).toEqual([]);
		});
	});

	describe("getActiveIncidents", () => {
		test("returns unresolved incidents that suppress notifications", async () => {
			const investigating = await create({ status: "investigating" });
			const identified = await create({ status: "identified" });
			const monitoring = await create({ status: "monitoring" });
			await create({ status: "resolved" });
			await create({ status: "investigating", suppressNotifications: false });

			const active = await getActiveIncidents();
			expect(active.map((i) => i.id).sort()).toEqual([investigating.id, identified.id, monitoring.id].sort());
		});
	});

	describe("incident scheduler", () => {
		test("marks the monitors of active incidents as suppressed", async () => {
			const a = await create({ affectedMonitors: ["api", "db"] });
			const b = await create({ affectedMonitors: ["api"] });
			await create({ affectedMonitors: ["web"], status: "resolved" });
			await create({ affectedMonitors: ["worker"], suppressNotifications: false });

			await incidentScheduler.refreshCache();

			expect([a.id, b.id]).toContain(cache.isUnderActiveIncident("api")!);
			expect(cache.isUnderActiveIncident("db")).toBe(a.id);
			expect(cache.isUnderActiveIncident("web")).toBeUndefined();
			expect(cache.isUnderActiveIncident("worker")).toBeUndefined();
		});

		test("lifts the suppression once the incident is resolved", async () => {
			const created = await create({ affectedMonitors: ["api"] });
			await incidentScheduler.refreshCache();
			expect(cache.isUnderActiveIncident("api")).toBe(created.id);

			await addIncidentUpdate(created.id, { status: "resolved", message: "Done." });
			await incidentScheduler.refreshCache();
			expect(cache.isUnderActiveIncident("api")).toBeUndefined();
		});
	});

	describe("broadcastIncidentEvent", () => {
		test("publishes to the status page channel", () => {
			broadcastIncidentEvent("main", "incident-created", { incident: { id: "x" } });
			expect(fakeServer.published).toEqual([
				{ channel: "slug-main", message: { action: "incident-created", data: { slug: "main", incident: { id: "x" } }, timestamp: expect.any(String) } },
			]);
		});
	});
});
