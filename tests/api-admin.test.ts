import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { cache } from "../src/cache";
import { config } from "../src/config";
import { getIncidentById } from "../src/incidents";
import { getMaintenanceById } from "../src/maintenances";
import { createApp, request } from "./helpers/app";
import { ADMIN_TOKEN, loadConfig, readConfigFile, restoreConfig } from "./helpers/config";
import { useDatabase } from "./helpers/database";
import { fakeClickHouse, fakeServer } from "./helpers/fakes";
import { resetState, settle } from "./helpers/status";

useDatabase();

const app = createApp();
const admin = (method: string, path: string, body?: unknown) => request(app, method, path, { token: ADMIN_TOKEN, body });

const newMonitor = (overrides: Record<string, unknown> = {}) => ({
	id: "cron",
	name: "Cron",
	token: "tk_cron",
	interval: 60,
	maxRetries: 0,
	resendNotification: 0,
	...overrides,
});

beforeEach(() => {
	restoreConfig();
	resetState();
});

afterAll(async () => {
	await settle();
	restoreConfig();
	resetState();
});

describe("admin authentication", () => {
	const routes: [string, string][] = [
		["GET", "/v1/admin/config"],
		["POST", "/v1/admin/config"],
		["GET", "/v1/admin/monitors"],
		["POST", "/v1/admin/monitors"],
		["PUT", "/v1/admin/monitors/api"],
		["DELETE", "/v1/admin/monitors/api"],
		["GET", "/v1/admin/groups"],
		["DELETE", "/v1/admin/groups/backend"],
		["GET", "/v1/admin/status-pages"],
		["DELETE", "/v1/admin/status-pages/main"],
		["GET", "/v1/admin/pulse-monitors"],
		["GET", "/v1/admin/notifications"],
		["GET", "/v1/admin/incidents"],
		["POST", "/v1/admin/incidents"],
		["GET", "/v1/admin/maintenances"],
		["POST", "/v1/admin/maintenances"],
		["GET", "/v1/admin/monitors/api/reports"],
		["GET", "/v1/admin/groups/backend/reports"],
	];

	test.each(routes)("%s %s requires a token", async (method, path) => {
		const res = await request(app, method, path, { body: method === "GET" || method === "DELETE" ? undefined : {} });
		expect(res.status).toBe(401);
	});

	test.each(routes)("%s %s rejects a wrong token", async (method, path) => {
		for (const token of ["wrong", "x".repeat(ADMIN_TOKEN.length), "tk_api", "test-reload-token"]) {
			const res = await request(app, method, path, { token, body: method === "GET" || method === "DELETE" ? undefined : {} });
			expect(res.status).toBeGreaterThanOrEqual(401);
			expect(res.status).toBeLessThanOrEqual(403);
		}
	});

	test("nothing changes without a valid token", async () => {
		await request(app, "DELETE", "/v1/admin/monitors/api", { token: "wrong" });
		await request(app, "POST", "/v1/admin/monitors", { token: "wrong", body: newMonitor() });
		expect(cache.getMonitor("api")).toBeDefined();
		expect(cache.getMonitor("cron")).toBeUndefined();
		expect(readConfigFile().monitors).toHaveLength(4);
	});

	test("the correct token is rejected while the admin API is disabled", async () => {
		loadConfig((raw) => (raw.adminAPI.enabled = false));
		const res = await admin("GET", "/v1/admin/monitors");
		expect(res.status).toBeGreaterThanOrEqual(401);
		expect(res.status).toBeLessThanOrEqual(403);
	});
});

describe("admin monitors", () => {
	test("lists monitors", async () => {
		const res = await admin("GET", "/v1/admin/monitors");
		expect(res.status).toBe(200);
		expect(res.body.monitors.map((m: any) => m.id)).toEqual(["api", "db", "worker", "web"]);
		expect(res.body.monitors[0]).toMatchObject({
			id: "api",
			name: "API",
			token: "tk_api",
			interval: 30,
			maxRetries: 0,
			resendNotification: 0,
			children: [],
			dependencies: [],
			notificationChannels: [],
			pulseMonitors: ["pm-eu"],
			custom1: { id: "connections", name: "Connections", unit: "conn" },
		});
	});

	test("returns one monitor, or 404", async () => {
		expect((await admin("GET", "/v1/admin/monitors/worker")).body).toMatchObject({ id: "worker", dependencies: ["db"] });
		expect((await admin("GET", "/v1/admin/monitors/ghost")).status).toBe(404);
		expect((await admin("GET", "/v1/admin/monitors/backend")).status).toBe(404);
	});

	test("creates a monitor, persists it and makes it usable immediately", async () => {
		const res = await admin("POST", "/v1/admin/monitors", newMonitor({ dependencies: ["db"], custom1: { id: "jobs", name: "Jobs" } }));
		expect(res.status).toBe(201);
		expect(res.body).toMatchObject({ success: true, id: "cron" });

		expect(cache.getMonitorByToken("tk_cron")).toMatchObject({ id: "cron", interval: 60, dependencies: ["db"], custom1: { id: "jobs", name: "Jobs" } });
		expect(config.monitors.map((m) => m.id)).toContain("cron");
		expect(readConfigFile().monitors.at(-1)).toMatchObject({ id: "cron", name: "Cron", token: "tk_cron", dependencies: ["db"] });

		expect((await request(app, "GET", "/v1/push/tk_cron")).status).toBe(200);
	});

	test("tells connected PulseMonitors about the change", async () => {
		await admin("POST", "/v1/admin/monitors", newMonitor());
		expect(fakeServer.byAction("config-update").length).toBeGreaterThan(0);
	});

	test.each([
		[{ id: "has space" }, "id is required (alphanumeric, hyphens, underscores)"],
		[{ id: undefined }, "id is required (alphanumeric, hyphens, underscores)"],
		[{ name: "" }, "name is required"],
		[{ token: " " }, "token is required"],
		[{ interval: 0 }, "interval must be a positive number"],
		[{ interval: "60" }, "interval must be a positive number"],
		[{ maxRetries: -1 }, "maxRetries must be a non-negative number"],
		[{ resendNotification: undefined }, "resendNotification must be a non-negative number"],
		[{ children: "api" }, "children must be an array"],
		[{ dependencies: "api" }, "dependencies must be an array"],
		[{ custom1: { id: "x" } }, "custom1.name must be a non-empty string"],
		[{ custom2: "players" }, "custom2 must be an object with id and name"],
		[{ pulse: "http" }, "pulse must be an object"],
	])("rejects %p", async (overrides, message) => {
		const res = await admin("POST", "/v1/admin/monitors", newMonitor(overrides));
		expect(res.status).toBe(400);
		expect(res.body.error).toBe("Validation failed");
		expect(res.body.details).toContain(message);
		expect(readConfigFile().monitors).toHaveLength(4);
	});

	test("rejects a body that is not JSON", async () => {
		const res = await admin("POST", "/v1/admin/monitors", "not json");
		expect(res.status).toBe(400);
	});

	test.each([
		[{ id: "api" }, "Monitor 'api' already exists"],
		[{ id: "backend" }, "A group with id 'backend' already exists"],
		[{ token: "tk_api" }, "A monitor with this token already exists"],
	])("rejects the conflict %p", async (overrides, error) => {
		const res = await admin("POST", "/v1/admin/monitors", newMonitor(overrides));
		expect(res.status).toBe(409);
		expect(res.body).toEqual({ error });
	});

	test("rolls back when the resulting configuration is invalid", async () => {
		const res = await admin("POST", "/v1/admin/monitors", newMonitor({ dependencies: ["ghost"] }));
		expect(res.status).toBeGreaterThanOrEqual(400);

		expect(cache.getMonitor("cron")).toBeUndefined();
		expect(config.monitors).toHaveLength(4);
		expect(readConfigFile().monitors.map((m: any) => m.id)).toEqual(["api", "db", "worker", "web"]);
	});

	test("updates only the provided fields", async () => {
		const res = await admin("PUT", "/v1/admin/monitors/db", { name: "Postgres", interval: 15 });
		expect(res.status).toBe(200);

		expect(cache.getMonitor("db")).toMatchObject({ name: "Postgres", interval: 15, token: "tk_db", maxRetries: 1 });
		expect(readConfigFile().monitors[1]).toMatchObject({ id: "db", name: "Postgres", interval: 15, token: "tk_db" });
	});

	test("changing the token invalidates the old one", async () => {
		await admin("PUT", "/v1/admin/monitors/db", { token: "tk_db_new" });
		expect((await request(app, "GET", "/v1/push/tk_db")).status).toBe(401);
		expect((await request(app, "GET", "/v1/push/tk_db_new")).status).toBe(200);
	});

	test("null removes a custom metric and an empty array clears dependencies", async () => {
		expect((await admin("PUT", "/v1/admin/monitors/api", { custom1: null })).status).toBe(200);
		expect(cache.getMonitor("api")!.custom1).toBeUndefined();
		expect(readConfigFile().monitors[0].custom1).toBeUndefined();

		expect((await admin("PUT", "/v1/admin/monitors/worker", { dependencies: [] })).status).toBe(200);
		expect(cache.getDependencies("worker")).toEqual([]);
	});

	test("update validation", async () => {
		expect((await admin("PUT", "/v1/admin/monitors/ghost", { name: "x" })).status).toBe(404);
		expect((await admin("PUT", "/v1/admin/monitors/db", { id: "other" })).body.details).toEqual(["id cannot be changed"]);
		expect((await admin("PUT", "/v1/admin/monitors/db", { interval: -1 })).status).toBe(400);
		expect((await admin("PUT", "/v1/admin/monitors/db", { token: "tk_api" })).status).toBe(409);
		expect((await admin("PUT", "/v1/admin/monitors/db", { token: "tk_db" })).status).toBe(200);
	});

	test("deletes a monitor and removes it from groups and status pages", async () => {
		loadConfig((raw) => (raw.status_pages[2].items = ["api", "web"]));
		const res = await admin("DELETE", "/v1/admin/monitors/web");
		expect(res.status).toBe(200);

		expect(cache.getMonitor("web")).toBeUndefined();
		expect(cache.getDirectChildIds("everything")).toEqual(["backend"]);
		const file = readConfigFile();
		expect(file.monitors.map((m: any) => m.id)).toEqual(["api", "db", "worker"]);
		expect(file.groups[1].children).toEqual(["backend"]);
		expect(file.status_pages[2].items).toEqual(["api"]);
		expect((await request(app, "GET", "/v1/push/tk_web")).status).toBe(401);
	});

	test("deleting an unknown monitor returns 404", async () => {
		expect((await admin("DELETE", "/v1/admin/monitors/ghost")).status).toBe(404);
	});

	test("a delete that would break the configuration changes nothing", async () => {
		// worker depends on db, and "private" would be left without items if api was removed
		for (const id of ["db", "api"]) {
			const res = await admin("DELETE", `/v1/admin/monitors/${id}`);
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(cache.getMonitor(id)).toBeDefined();
		}
		expect(readConfigFile().monitors.map((m: any) => m.id)).toEqual(["api", "db", "worker", "web"]);
		expect(config.monitors).toHaveLength(4);
	});
});

describe("admin groups", () => {
	const newGroup = (overrides: Record<string, unknown> = {}) => ({
		id: "frontend",
		name: "Frontend",
		strategy: "any-up",
		degradedThreshold: 50,
		interval: 60,
		children: ["web"],
		...overrides,
	});

	test("lists and returns groups", async () => {
		const list = await admin("GET", "/v1/admin/groups");
		expect(list.body.groups.map((g: any) => g.id)).toEqual(["backend", "everything"]);
		expect((await admin("GET", "/v1/admin/groups/backend")).body).toMatchObject({
			id: "backend",
			strategy: "percentage",
			degradedThreshold: 50,
			children: ["api", "db", "worker"],
		});
		expect((await admin("GET", "/v1/admin/groups/api")).status).toBe(404);
	});

	test("creates a group", async () => {
		const res = await admin("POST", "/v1/admin/groups", newGroup());
		expect(res.status).toBe(201);
		expect(cache.getGroup("frontend")).toMatchObject({ strategy: "any-up", children: ["web"] });
		expect(cache.getParentIds("web").sort()).toEqual(["everything", "frontend"]);
		expect(readConfigFile().groups.at(-1)).toMatchObject({ id: "frontend", strategy: "any-up" });
	});

	test("rejects invalid input and conflicts", async () => {
		expect((await admin("POST", "/v1/admin/groups", newGroup({ strategy: "most-up" }))).status).toBe(400);
		expect((await admin("POST", "/v1/admin/groups", newGroup({ degradedThreshold: 101 }))).status).toBe(400);
		expect((await admin("POST", "/v1/admin/groups", newGroup({ id: "backend" }))).status).toBe(409);
		expect((await admin("POST", "/v1/admin/groups", newGroup({ id: "api" }))).status).toBe(409);
		expect(readConfigFile().groups).toHaveLength(2);
	});

	test("updates a group", async () => {
		const res = await admin("PUT", "/v1/admin/groups/backend", { strategy: "all-up", children: ["api", "db"] });
		expect(res.status).toBe(200);
		expect(cache.getGroup("backend")).toMatchObject({ strategy: "all-up", children: ["api", "db"], name: "Backend" });
		expect((await admin("PUT", "/v1/admin/groups/ghost", { name: "x" })).status).toBe(404);
	});

	test("deletes a group and removes it from parents and status pages", async () => {
		loadConfig((raw) => {
			raw.monitors[3].dependencies = [];
			raw.status_pages[1].leafItems = [];
			raw.status_pages[0].items = ["everything", "backend"];
		});
		const res = await admin("DELETE", "/v1/admin/groups/backend");
		expect(res.status).toBe(200);

		expect(cache.getGroup("backend")).toBeUndefined();
		const file = readConfigFile();
		expect(file.groups.map((g: any) => g.id)).toEqual(["everything"]);
		expect(file.groups[0].children).toEqual(["web"]);
		expect(file.status_pages[0].items).toEqual(["everything"]);
		expect(cache.getMonitor("api")).toBeDefined();
	});
});

describe("admin status pages", () => {
	const newPage = (overrides: Record<string, unknown> = {}) => ({ id: "public", name: "Public", slug: "public", items: ["web"], ...overrides });

	test("lists and returns status pages", async () => {
		const list = await admin("GET", "/v1/admin/status-pages");
		expect(list.body.statusPages?.length ?? list.body.status_pages?.length ?? list.body.pages?.length).toBe(3);
		expect((await admin("GET", "/v1/admin/status-pages/collapsed")).body).toMatchObject({
			id: "collapsed",
			slug: "collapsed",
			items: ["everything"],
			leafItems: ["backend"],
			reports: false,
		});
		expect((await admin("GET", "/v1/admin/status-pages/ghost")).status).toBe(404);
	});

	test("creates a page that is served immediately", async () => {
		const res = await admin("POST", "/v1/admin/status-pages", newPage());
		expect(res.status).toBe(201);
		expect(cache.getStatusPageBySlug("public")).toMatchObject({ id: "public", items: ["web"] });
		expect((await request(app, "GET", "/v1/status/public")).status).toBe(200);
	});

	test("creates a password protected page", async () => {
		await admin("POST", "/v1/admin/status-pages", newPage({ password: "super-secret-pw" }));
		expect(cache.isStatusPageProtected("public")).toBe(true);
		expect((await request(app, "GET", "/v1/status/public")).status).toBe(401);

		const token = new Bun.CryptoHasher("blake2b512").update("super-secret-pw").digest("hex");
		expect((await request(app, "GET", "/v1/status/public", { token })).status).toBe(200);
	});

	test.each([
		[{ slug: "Not Valid" }, "slug must contain only lowercase letters, numbers, and hyphens"],
		[{ items: [] }, "items must be a non-empty array"],
		[{ password: "short" }, "password must be at least 8 characters"],
		[{ reports: "yes" }, "reports must be a boolean if provided"],
		[{ leafItems: "backend" }, "leafItems must be an array"],
	])("rejects %p", async (overrides, message) => {
		const res = await admin("POST", "/v1/admin/status-pages", newPage(overrides));
		expect(res.status).toBe(400);
		expect(res.body.details).toContain(message);
	});

	test("rejects duplicate ids and slugs", async () => {
		expect((await admin("POST", "/v1/admin/status-pages", newPage({ id: "main" }))).status).toBe(409);
		expect((await admin("POST", "/v1/admin/status-pages", newPage({ slug: "main" }))).status).toBe(409);
		expect(readConfigFile().status_pages).toHaveLength(3);
	});

	test("updates and deletes a page", async () => {
		expect((await admin("PUT", "/v1/admin/status-pages/main", { name: "Renamed", reports: true })).status).toBe(200);
		expect(cache.getStatusPage("main")).toMatchObject({ name: "Renamed", reports: true, slug: "main" });

		expect((await admin("DELETE", "/v1/admin/status-pages/collapsed")).status).toBe(200);
		expect(cache.getStatusPageBySlug("collapsed")).toBeUndefined();
		expect(readConfigFile().status_pages.map((p: any) => p.id)).toEqual(["main", "private"]);
		expect((await admin("DELETE", "/v1/admin/status-pages/ghost")).status).toBe(404);
	});
});

describe("admin config", () => {
	test("returns the configuration as JSON or TOML", async () => {
		const json = await admin("GET", "/v1/admin/config");
		expect(json.status).toBe(200);
		expect(json.body.monitors).toHaveLength(4);
		expect(json.body.server.port).toBe(3999);

		const toml = await admin("GET", "/v1/admin/config?format=toml");
		expect(toml.headers.get("content-type")).toContain("application/toml");
		expect(Bun.TOML.parse(toml.body)).toEqual(json.body);
	});

	test("replaces the whole configuration", async () => {
		const next = readConfigFile();
		next.monitors.push(newMonitor());

		const res = await admin("POST", "/v1/admin/config", next);
		expect(res.status).toBe(200);
		expect(cache.getMonitor("cron")).toBeDefined();
		expect(readConfigFile().monitors).toHaveLength(5);
	});

	test("keeps the current configuration when the new one is invalid", async () => {
		const next = readConfigFile();
		next.monitors = [];

		const res = await admin("POST", "/v1/admin/config", next);
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(config.monitors).toHaveLength(4);
		expect(cache.getAllMonitors()).toHaveLength(4);
		expect(readConfigFile().monitors).toHaveLength(4);
	});
});

describe("admin incidents", () => {
	const newIncident = (overrides: Record<string, unknown> = {}) => ({
		status_page_id: "main",
		title: "API errors",
		status: "investigating",
		severity: "major",
		message: "Looking into it.",
		affected_monitors: ["api"],
		...overrides,
	});

	test("full lifecycle", async () => {
		const created = await admin("POST", "/v1/admin/incidents", newIncident());
		expect(created.status).toBe(201);
		const id = created.body.id;
		expect(created.body.incident).toMatchObject({ id, status: "investigating", affected_monitors: ["api"], suppress_notifications: true });
		expect(fakeServer.byAction("incident-created").map((e) => e.channel)).toEqual(["slug-main"]);

		await Bun.sleep(5);
		expect(cache.isUnderActiveIncident("api")).toBe(id);

		expect((await admin("GET", "/v1/admin/incidents")).body.incidents.map((i: any) => i.id)).toEqual([id]);
		expect((await admin("GET", "/v1/admin/incidents?status_page_id=private")).body.incidents).toEqual([]);
		expect((await admin("GET", `/v1/admin/incidents/${id}`)).body.updates).toHaveLength(1);

		expect((await admin("PUT", `/v1/admin/incidents/${id}`, { severity: "critical" })).status).toBe(200);
		expect((await getIncidentById(id))!.severity).toBe("critical");

		await Bun.sleep(2);
		const update = await admin("POST", `/v1/admin/incidents/${id}/updates`, { status: "resolved", message: "Fixed." });
		expect(update.status).toBeLessThan(300);
		expect((await getIncidentById(id))!.status).toBe("resolved");
		await Bun.sleep(5);
		expect(cache.isUnderActiveIncident("api")).toBeUndefined();

		const updateId = (await getIncidentById(id))!.updates[1]!.id;
		expect((await admin("DELETE", `/v1/admin/incidents/${id}/updates/${updateId}`)).status).toBe(200);
		expect((await getIncidentById(id))!.status).toBe("investigating");

		expect((await admin("DELETE", `/v1/admin/incidents/${id}`)).status).toBe(200);
		expect(await getIncidentById(id)).toBeNull();
		expect(fakeServer.byAction("incident-deleted")).toHaveLength(1);
	});

	test.each([
		[{ title: "" }, "title is required"],
		[{ status: "broken" }, "status must be one of: investigating, identified, monitoring, resolved"],
		[{ severity: "huge" }, "severity must be one of: minor, major, critical"],
		[{ message: " " }, "message is required (initial update message)"],
		[{ affected_monitors: "api" }, "affected_monitors must be an array of strings"],
		[{ suppress_notifications: "no" }, "suppress_notifications must be a boolean"],
	])("rejects %p", async (overrides, message) => {
		const res = await admin("POST", "/v1/admin/incidents", newIncident(overrides));
		expect(res.status).toBe(400);
		expect(res.body.details).toContain(message);
		expect((await admin("GET", "/v1/admin/incidents")).body.incidents).toEqual([]);
	});

	test("rejects unknown pages and monitors that are not on the page", async () => {
		expect((await admin("POST", "/v1/admin/incidents", newIncident({ status_page_id: "ghost" }))).status).toBe(404);

		const res = await admin("POST", "/v1/admin/incidents", newIncident({ status_page_id: "private", affected_monitors: ["db"] }));
		expect(res.status).toBe(400);
		expect(res.body.error).toBe("Monitor or group 'db' is not on status page 'private'");
	});

	test("status cannot be changed through PUT", async () => {
		const id = (await admin("POST", "/v1/admin/incidents", newIncident())).body.id;
		const res = await admin("PUT", `/v1/admin/incidents/${id}`, { status: "resolved" });
		expect(res.status).toBe(400);
		expect((await getIncidentById(id))!.status).toBe("investigating");
	});

	test("unknown incidents return 404", async () => {
		expect((await admin("GET", "/v1/admin/incidents/ghost")).status).toBe(404);
		expect((await admin("PUT", "/v1/admin/incidents/ghost", { title: "x" })).status).toBe(404);
		expect((await admin("POST", "/v1/admin/incidents/ghost/updates", { status: "resolved", message: "x" })).status).toBe(404);
		expect((await admin("DELETE", "/v1/admin/incidents/ghost")).status).toBe(404);
	});
});

describe("admin maintenances", () => {
	const newMaintenance = (overrides: Record<string, unknown> = {}) => ({
		status_page_id: "main",
		title: "Database upgrade",
		status: "scheduled",
		scheduled_start: "2030-01-01T02:00:00.000Z",
		scheduled_end: "2030-01-01T04:00:00.000Z",
		message: "Planned work.",
		affected_monitors: ["db"],
		...overrides,
	});

	test("full lifecycle", async () => {
		const created = await admin("POST", "/v1/admin/maintenances", newMaintenance());
		expect(created.status).toBe(201);
		const id = created.body.id;
		expect(created.body.maintenance).toMatchObject({ id, status: "scheduled", affected_monitors: ["db"] });
		expect(fakeServer.byAction("maintenance-created").map((e) => e.channel)).toEqual(["slug-main"]);

		await Bun.sleep(5);
		expect(cache.isUnderActiveMaintenance("db")).toBeUndefined();

		expect((await admin("GET", "/v1/admin/maintenances")).body.maintenances.map((m: any) => m.id)).toEqual([id]);
		expect((await admin("PUT", `/v1/admin/maintenances/${id}`, { title: "DB upgrade" })).status).toBe(200);
		expect((await getMaintenanceById(id))!.title).toBe("DB upgrade");

		await Bun.sleep(2);
		expect((await admin("POST", `/v1/admin/maintenances/${id}/updates`, { status: "in_progress", message: "Starting." })).status).toBeLessThan(300);
		await Bun.sleep(5);
		expect(cache.isUnderActiveMaintenance("db")).toBe(id);

		await Bun.sleep(2);
		expect((await admin("POST", `/v1/admin/maintenances/${id}/updates`, { status: "completed", message: "Done." })).status).toBeLessThan(300);
		await Bun.sleep(5);
		expect(cache.isUnderActiveMaintenance("db")).toBeUndefined();
		expect((await getMaintenanceById(id))!.completed_at).not.toBeNull();

		expect((await admin("DELETE", `/v1/admin/maintenances/${id}`)).status).toBe(200);
		expect(await getMaintenanceById(id)).toBeNull();
	});

	test.each([
		[{ title: "" }, "title is required"],
		[{ status: "paused" }, "status must be one of: scheduled, in_progress, completed, cancelled"],
		[{ scheduled_start: "tomorrow" }, "scheduled_start must be a valid ISO 8601 date"],
		[{ scheduled_end: "2029-01-01T00:00:00.000Z" }, "scheduled_end must be after scheduled_start"],
		[{ scheduled_end: "2030-01-01T02:00:00.000Z" }, "scheduled_end must be after scheduled_start"],
		[{ message: "" }, "message is required (initial update message)"],
	])("rejects %p", async (overrides, message) => {
		const res = await admin("POST", "/v1/admin/maintenances", newMaintenance(overrides));
		expect(res.status).toBe(400);
		expect(res.body.details).toContain(message);
	});

	test("rejects unknown pages and monitors that are not on the page", async () => {
		expect((await admin("POST", "/v1/admin/maintenances", newMaintenance({ status_page_id: "ghost" }))).status).toBe(404);
		expect((await admin("POST", "/v1/admin/maintenances", newMaintenance({ status_page_id: "private" }))).status).toBe(400);
	});

	test("stores scheduled times in UTC so the scheduler can compare them", async () => {
		const res = await admin(
			"POST",
			"/v1/admin/maintenances",
			newMaintenance({ scheduled_start: "2030-01-01T04:00:00+02:00", scheduled_end: "2030-01-01T06:00:00+02:00" }),
		);
		expect(res.status).toBe(201);
		expect(await getMaintenanceById(res.body.id)).toMatchObject({ scheduled_start: "2030-01-01T02:00:00.000Z", scheduled_end: "2030-01-01T04:00:00.000Z" });
	});
});

describe("admin maintenances (time zones)", () => {
	test("an update with a timezone offset is stored in UTC too", async () => {
		const created = await admin("POST", "/v1/admin/maintenances", {
			status_page_id: "main",
			title: "Database upgrade",
			status: "scheduled",
			scheduled_start: "2030-01-01T02:00:00.000Z",
			scheduled_end: "2030-01-01T04:00:00.000Z",
			message: "Planned work.",
		});

		const res = await admin("PUT", `/v1/admin/maintenances/${created.body.id}`, { scheduled_end: "2030-01-01T09:00:00+02:00", title: "Longer" });
		expect(res.status).toBe(200);
		expect(await getMaintenanceById(created.body.id)).toMatchObject({
			title: "Longer",
			scheduled_start: "2030-01-01T02:00:00.000Z",
			scheduled_end: "2030-01-01T07:00:00.000Z",
		});
	});
});

describe("admin reports", () => {
	beforeEach(() => {
		fakeClickHouse.onQuery((query) =>
			query.includes("FROM pulses_hourly")
				? [
						{
							timestamp: "2026-03-10T12:00:00Z",
							uptime: 100,
							latency_min: 1,
							latency_max: 3,
							latency_avg: 2,
							custom1_min: null,
							custom1_max: null,
							custom1_avg: null,
							custom2_min: null,
							custom2_max: null,
							custom2_avg: null,
							custom3_min: null,
							custom3_max: null,
							custom3_avg: null,
						},
					]
				: [],
		);
	});

	test("exports monitor data as JSON and CSV", async () => {
		const json = await admin("GET", "/v1/admin/monitors/db/reports/hourly");
		expect(json.status).toBe(200);
		expect(json.body).toMatchObject({ monitorId: "db", data: [{ uptime: 100, latency_avg: 2 }] });
		expect(json.headers.get("content-disposition")).toContain("db-hourly.json");

		const csv = await admin("GET", "/v1/admin/monitors/db/reports/hourly?format=csv");
		expect(csv.headers.get("content-type")).toContain("text/csv");
		expect(csv.body.split("\n")[1]).toBe("2026-03-10T12:00:00Z,100,1,3,2");
	});

	test("unknown monitors and groups return 404", async () => {
		expect((await admin("GET", "/v1/admin/monitors/ghost/reports")).status).toBe(404);
		expect((await admin("GET", "/v1/admin/monitors/backend/reports")).status).toBe(404);
		expect((await admin("GET", "/v1/admin/groups/api/reports")).status).toBe(404);
	});
});
