import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { cache } from "../src/cache";
import { createIncident } from "../src/incidents";
import { createMaintenance } from "../src/maintenances";
import { pulseBuffer } from "../src/pulse-buffer";
import { getCurrentMonth } from "../src/times";
import { createApp, request } from "./helpers/app";
import { loadConfig, restoreConfig } from "./helpers/config";
import { useDatabase } from "./helpers/database";
import { fakeClickHouse, fakeServer } from "./helpers/fakes";
import { resetState, setStatus, settle } from "./helpers/status";

useDatabase();

const app = createApp();
const get = (path: string, token?: string) => request(app, "GET", path, { token });

/** The token a status page visitor sends: the BLAKE2b-512 hash of the page password. */
const PRIVATE_TOKEN = new Bun.CryptoHasher("blake2b512").update("correct-horse-battery").digest("hex");

/** Every request gets its own URL so the 30 second response cache never serves a previous test's answer. */
let counter = 0;
const unique = (path: string) => `${path}${path.includes("?") ? "&" : "?"}_=${++counter}`;

/** Pulses the server has written to ClickHouse so far. */
async function storedPulses(): Promise<Record<string, any>[]> {
	await pulseBuffer.flush();
	return fakeClickHouse.rows("pulses");
}

beforeEach(async () => {
	restoreConfig();
	await pulseBuffer.flush();
	resetState();
});

afterAll(async () => {
	await settle();
	resetState();
});

describe("GET /v1/push/:token", () => {
	test("rejects an unknown token", async () => {
		const res = await get("/v1/push/nope");
		expect(res.status).toBe(401);
		expect(res.body).toEqual({ error: "Invalid token" });
		expect(await storedPulses()).toEqual([]);
	});

	test("stores a pulse and marks the monitor up", async () => {
		const before = Date.now();
		const res = await get("/v1/push/tk_db");

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ success: true, monitorId: "db" });
		expect(cache.getStatus("db")).toMatchObject({ id: "db", type: "monitor", name: "Database", status: "up", latency: 0 });

		const pulses = await storedPulses();
		expect(pulses).toHaveLength(1);
		expect(pulses[0]).toMatchObject({ monitor_id: "db", latency: null, synthetic: false, custom1: null, custom2: null, custom3: null });
		expect(new Date(pulses[0]!.timestamp).getTime()).toBeGreaterThanOrEqual(before);
	});

	test("a pulse brings a down monitor back up", async () => {
		setStatus("db", "down");
		await get("/v1/push/tk_db");
		expect(cache.getStatus("db")?.status).toBe("up");
	});

	test("broadcasts the pulse to the status pages showing the monitor", async () => {
		await get("/v1/push/tk_api?latency=25");

		const events = fakeServer.byAction("pulse");
		expect(events.map((e) => e.channel).sort()).toEqual(["slug-main", "slug-private"]);
		expect(events[0]!.message.data).toMatchObject({ monitorId: "api", status: "up", latency: 25 });
	});

	describe("latency", () => {
		test("stores the reported latency", async () => {
			await get("/v1/push/tk_db?latency=123.5");
			expect((await storedPulses())[0]!.latency).toBe(123.5);
			expect(cache.getStatus("db")?.latency).toBe(123.5);
		});

		test("caps latency at 10 minutes", async () => {
			await get("/v1/push/tk_db?latency=9999999");
			expect((await storedPulses())[0]!.latency).toBe(600_000);
		});

		test.each(["abc", "0", "-5"])("rejects latency %p", async (latency) => {
			const res = await get(`/v1/push/tk_db?latency=${latency}`);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "Invalid latency" });
			expect(await storedPulses()).toEqual([]);
		});

		test("the pulse is timed at the start of the measured request", async () => {
			const before = Date.now();
			await get("/v1/push/tk_db?latency=5000");
			const timestamp = new Date((await storedPulses())[0]!.timestamp).getTime();
			expect(timestamp).toBeGreaterThanOrEqual(before - 5000);
			expect(timestamp).toBeLessThanOrEqual(Date.now() - 5000);
		});
	});

	describe("custom metrics", () => {
		test("accepts a metric by slot name", async () => {
			await get("/v1/push/tk_api?custom1=42");
			expect((await storedPulses())[0]).toMatchObject({ custom1: 42, custom2: null, custom3: null });
			expect(cache.getStatus("api")?.custom1).toEqual({ config: { id: "connections", name: "Connections", unit: "conn" }, value: 42 });
		});

		test("stores a value of zero", async () => {
			await get("/v1/push/tk_api?custom1=0");
			expect((await storedPulses())[0]!.custom1).toBe(0);
			expect(cache.getStatus("api")?.custom1?.value).toBe(0);
		});

		test("accepts a metric by its configured id", async () => {
			await get("/v1/push/tk_api?connections=7.5");
			expect((await storedPulses())[0]!.custom1).toBe(7.5);
		});

		test("ignores non-numeric values", async () => {
			const res = await get("/v1/push/tk_api?custom1=lots");
			expect(res.status).toBe(200);
			expect((await storedPulses())[0]!.custom1).toBeNull();
		});

		test("ignores metrics the monitor does not define", async () => {
			await get("/v1/push/tk_api?custom2=5");
			await get("/v1/push/tk_db?custom1=5");
			const pulses = await storedPulses();
			expect(pulses[0]!.custom2).toBeNull();
			expect(pulses[1]!.custom1).toBeNull();
		});
	});

	describe("timestamps", () => {
		const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

		test("derives latency from startTime and endTime", async () => {
			const start = iso(-3000);
			const end = new Date(new Date(start).getTime() + 2000).toISOString();
			await get(`/v1/push/tk_db?startTime=${start}&endTime=${end}`);

			const pulse = (await storedPulses())[0]!;
			expect(pulse.latency).toBe(2000);
			expect(pulse.timestamp).toBe(start);
		});

		test("accepts unix millisecond timestamps", async () => {
			const start = Date.now() - 3000;
			await get(`/v1/push/tk_db?startTime=${start}&endTime=${start + 1000}`);

			const pulse = (await storedPulses())[0]!;
			expect(pulse.timestamp).toBe(new Date(start).toISOString());
			expect(pulse.latency).toBe(1000);
		});

		test("uses a startTime sent on its own", async () => {
			const start = iso(-5000);
			await get(`/v1/push/tk_db?startTime=${start}`);
			expect((await storedPulses())[0]!.timestamp).toBe(start);
		});

		test("uses an endTime sent on its own", async () => {
			const end = iso(-5000);
			await get(`/v1/push/tk_db?endTime=${end}`);
			expect((await storedPulses())[0]).toMatchObject({ timestamp: end, latency: null });
		});

		test("rejects an old startTime sent on its own", async () => {
			const res = await get(`/v1/push/tk_db?startTime=${iso(-660_000)}`);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "Timestamp too far in the past" });
		});

		test("an explicit latency wins over the derived one", async () => {
			await get(`/v1/push/tk_db?startTime=${iso(-3000)}&endTime=${iso(-1000)}&latency=50`);
			expect((await storedPulses())[0]!.latency).toBe(50);
		});

		test("derives the start from endTime and latency", async () => {
			const end = iso(-1000);
			await get(`/v1/push/tk_db?endTime=${end}&latency=500`);
			expect((await storedPulses())[0]!.timestamp).toBe(new Date(new Date(end).getTime() - 500).toISOString());
		});

		test.each([
			["startTime=yesterday", "Invalid startTime format"],
			["endTime=later", "Invalid endTime format"],
		])("rejects %s", async (query, error) => {
			const res = await get(`/v1/push/tk_db?${query}`);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error });
		});

		test("rejects an end before the start", async () => {
			const res = await get(`/v1/push/tk_db?startTime=${iso(-1000)}&endTime=${iso(-2000)}`);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "endTime must be after startTime" });
		});

		test("rejects timestamps more than a minute in the future", async () => {
			const res = await get(`/v1/push/tk_db?startTime=${iso(120_000)}&endTime=${iso(121_000)}`);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "Timestamp too far in the future" });
		});

		test("rejects timestamps more than ten minutes in the past", async () => {
			const res = await get(`/v1/push/tk_db?startTime=${iso(-660_000)}&endTime=${iso(-659_000)}`);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "Timestamp too far in the past" });
			expect(await storedPulses()).toEqual([]);
		});
	});

	test("rate limits a token after a burst of 60 requests", async () => {
		const statuses: number[] = [];
		for (let i = 0; i < 80; i++) statuses.push((await get("/v1/push/tk_web")).status);

		expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
		expect(statuses).toContain(429);
		expect((await get("/v1/push/tk_worker")).status).toBe(200);
	});
});

describe("GET /v1/status/:slug", () => {
	test("returns 404 for an unknown page", async () => {
		const res = await get(unique("/v1/status/ghost"));
		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: "Status page not found" });
	});

	test("returns the status tree", async () => {
		for (const id of ["everything", "backend", "web", "api", "db", "worker"]) setStatus(id, "up");
		setStatus("db", "down");

		const res = await get(unique("/v1/status/main"));
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ name: "Main", slug: "main", reports: false });
		expect(new Date(res.body.lastUpdated).getTime()).not.toBeNaN();

		const [everything] = res.body.items;
		expect(everything.id).toBe("everything");
		expect(everything.children.map((c: any) => c.id)).toEqual(["backend", "web"]);
		expect(everything.children[0].children.map((c: any) => [c.id, c.status])).toEqual([
			["api", "up"],
			["db", "down"],
			["worker", "up"],
		]);
	});

	test("collapses leaf items", async () => {
		for (const id of ["everything", "backend", "web", "api"]) setStatus(id, "up");
		const res = await get(unique("/v1/status/collapsed"));
		const backend = res.body.items[0].children.find((c: any) => c.id === "backend");
		expect(backend.children).toBeUndefined();
	});

	test("never exposes monitor tokens or the page password", async () => {
		for (const id of ["everything", "backend", "web", "api", "db", "worker"]) setStatus(id, "up");
		const main = await get(unique("/v1/status/main"));
		const priv = await get(unique("/v1/status/private"), PRIVATE_TOKEN);

		const text = JSON.stringify([main.body, priv.body]);
		expect(text).not.toContain("tk_");
		expect(text).not.toContain("correct-horse-battery");
		expect(text).not.toContain(PRIVATE_TOKEN);
	});

	test("serves repeated requests from the response cache", async () => {
		setStatus("everything", "up");
		const url = unique("/v1/status/main");
		const first = await get(url);

		setStatus("everything", "down");
		const second = await get(url);

		expect(second.headers.get("x-cache-status")).toBe("HIT");
		expect(second.body).toEqual(first.body);
	});

	describe("password protected pages", () => {
		test("require a token", async () => {
			const res = await get(unique("/v1/status/private"));
			expect(res.status).toBe(401);
		});

		test.each([["wrong"], ["correct-horse-battery"], ["0".repeat(128)]])("reject the token %p", async (token) => {
			const res = await get(unique("/v1/status/private"), token);
			expect(res.status).toBeGreaterThanOrEqual(401);
			expect(res.status).toBeLessThanOrEqual(403);
			expect(JSON.stringify(res.body)).not.toContain("Private");
		});

		test("accept the hashed password", async () => {
			setStatus("api", "up");
			const res = await get(unique("/v1/status/private"), PRIVATE_TOKEN);
			expect(res.status).toBe(200);
			expect(res.body).toMatchObject({ name: "Private", slug: "private", reports: true });
			expect(res.body.items.map((i: any) => i.id)).toEqual(["api"]);
		});

		test("are never served from the response cache", async () => {
			const url = unique("/v1/status/private");
			expect((await get(url, PRIVATE_TOKEN)).status).toBe(200);
			expect((await get(url)).status).toBe(401);

			setStatus("api", "down");
			const again = await get(url, PRIVATE_TOKEN);
			expect(again.headers.get("x-cache-status")).not.toBe("HIT");
			expect(again.body.items[0].status).toBe("down");
		});

		test("protect every route below the page", async () => {
			for (const path of ["/summary", "/incidents", "/maintenances", "/monitors/api/history", "/monitors/api/reports"]) {
				expect((await get(unique(`/v1/status/private${path}`))).status).toBe(401);
			}
		});
	});
});

describe("GET /v1/status/:slug/summary", () => {
	test("counts the top level items by status", async () => {
		setStatus("everything", "degraded");
		const res = await get(unique("/v1/status/main/summary"));
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ status: "degraded", monitors: { up: 0, degraded: 1, down: 0, total: 1 } });
	});

	test("down wins over degraded", async () => {
		loadTopLevelItems();
		setStatus("api", "up");
		setStatus("db", "degraded");
		setStatus("web", "down");

		const res = await get(unique("/v1/status/main/summary"));
		expect(res.body).toEqual({ status: "down", monitors: { up: 1, degraded: 1, down: 1, total: 3 } });
	});

	test("items without a status are not counted", async () => {
		loadTopLevelItems();
		setStatus("api", "up");
		const res = await get(unique("/v1/status/main/summary"));
		expect(res.body).toEqual({ status: "up", monitors: { up: 1, degraded: 0, down: 0, total: 1 } });
	});

	test("returns 404 for an unknown page", async () => {
		expect((await get(unique("/v1/status/ghost/summary"))).status).toBe(404);
	});

	function loadTopLevelItems(): void {
		loadConfig((raw) => (raw.status_pages[0].items = ["api", "db", "web", "worker"]));
	}
});

describe("GET /v1/status/:slug/incidents and /maintenances", () => {
	test("list the current month by default", async () => {
		const incident = await createIncident({ statusPageId: "main", title: "Outage", status: "investigating", severity: "major", message: "Looking." });
		const maintenance = await createMaintenance({
			statusPageId: "main",
			title: "Upgrade",
			status: "scheduled",
			scheduledStart: new Date().toISOString(),
			scheduledEnd: new Date(Date.now() + 3_600_000).toISOString(),
			message: "Soon.",
		});

		const incidents = await get(unique("/v1/status/main/incidents"));
		expect(incidents.status).toBe(200);
		expect(incidents.body).toMatchObject({ statusPageId: "main", month: getCurrentMonth() });
		expect(incidents.body.incidents.map((i: any) => i.id)).toEqual([incident.id]);
		expect(incidents.body.incidents[0].updates).toHaveLength(1);

		const maintenances = await get(unique("/v1/status/main/maintenances"));
		expect(maintenances.status).toBe(200);
		expect(maintenances.body.maintenances.map((m: any) => m.id)).toEqual([maintenance.id]);
	});

	test("only list entries of the requested page and month", async () => {
		await createIncident({ statusPageId: "private", title: "Other page", status: "investigating", severity: "minor", message: "x" });

		expect((await get(unique("/v1/status/main/incidents"))).body.incidents).toEqual([]);
		expect((await get(unique("/v1/status/private/incidents?month=2001-01"), PRIVATE_TOKEN)).body).toMatchObject({ month: "2001-01", incidents: [] });
		expect((await get(unique("/v1/status/private/incidents"), PRIVATE_TOKEN)).body.incidents).toHaveLength(1);
	});

	test.each(["2026-13", "2026-1", "26-01", "january"])("reject the month %p", async (month) => {
		for (const kind of ["incidents", "maintenances"]) {
			const res = await get(unique(`/v1/status/main/${kind}?month=${month}`));
			expect(res.status).toBe(400);
		}
	});

	test("return 404 for an unknown page", async () => {
		expect((await get(unique("/v1/status/ghost/incidents"))).status).toBe(404);
		expect((await get(unique("/v1/status/ghost/maintenances"))).status).toBe(404);
	});
});

describe("history and reports", () => {
	const hourlyRow = {
		timestamp: "2026-03-10T12:00:00Z",
		uptime: 99.5,
		latency_min: 10,
		latency_max: 30,
		latency_avg: 20,
		custom1_min: 1,
		custom1_max: 3,
		custom1_avg: 2,
		custom2_min: null,
		custom2_max: null,
		custom2_avg: null,
		custom3_min: null,
		custom3_max: null,
		custom3_avg: null,
	};

	beforeEach(() => {
		fakeClickHouse.onQuery((query) => (query.includes("FROM pulses_hourly") ? [hourlyRow] : []));
	});

	test("returns hourly history without empty metric columns", async () => {
		const res = await get(unique("/v1/status/main/monitors/api/history/hourly"));
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ monitorId: "api", type: "hourly", customMetrics: { custom1: { id: "connections" } } });
		expect(res.body.data).toEqual([
			{ timestamp: "2026-03-10T12:00:00Z", uptime: 99.5, latency_min: 10, latency_max: 30, latency_avg: 20, custom1_min: 1, custom1_max: 3, custom1_avg: 2 },
		]);
		expect(fakeClickHouse.queries.at(-1)!.query_params).toEqual({ monitorId: "api" });
	});

	test("returns an empty history when ClickHouse is unavailable", async () => {
		fakeClickHouse.failWith(new Error("connection refused"));
		const res = await get(unique("/v1/status/main/monitors/api/history/hourly"));
		expect(res.status).toBe(200);
		expect(res.body.data).toEqual([]);
	});

	test("hides monitors that are not on the page", async () => {
		for (const path of ["history", "history/hourly", "history/daily"]) {
			const res = await get(unique(`/v1/status/private/monitors/db/${path}`), PRIVATE_TOKEN);
			expect(res.status).toBe(404);
			expect(res.body).toEqual({ error: "Monitor not found" });
		}
		expect((await get(unique("/v1/status/collapsed/monitors/api/history"))).status).toBe(404);
		expect((await get(unique("/v1/status/main/monitors/ghost/history"))).status).toBe(404);
		expect(fakeClickHouse.queries).toEqual([]);
	});

	test("group history is only available for groups on the page", async () => {
		expect((await get(unique("/v1/status/main/groups/backend/history/hourly"))).status).toBe(200);
		expect((await get(unique("/v1/status/main/groups/api/history/hourly"))).status).toBe(404);
		expect((await get(unique("/v1/status/private/groups/backend/history/hourly"), PRIVATE_TOKEN)).status).toBe(404);
	});

	test("reports are unavailable unless the page enables them", async () => {
		const res = await get(unique("/v1/status/main/monitors/api/reports/hourly"));
		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: "Reports are not enabled for this status page" });
		expect((await get(unique("/v1/status/main/groups/backend/reports/hourly"))).status).toBe(404);
	});

	test("exports a report as JSON or CSV", async () => {
		const json = await get(unique("/v1/status/private/monitors/api/reports/hourly"), PRIVATE_TOKEN);
		expect(json.status).toBe(200);
		expect(json.body.data).toHaveLength(1);

		const csv = await get(unique("/v1/status/private/monitors/api/reports/hourly?format=csv"), PRIVATE_TOKEN);
		expect(csv.status).toBe(200);
		expect(csv.headers.get("content-type")).toContain("text/csv");
		expect(csv.headers.get("content-disposition")).toContain("attachment");
		expect(csv.body.split("\n")).toEqual([
			"Timestamp,Uptime (%),Latency Min (ms),Latency Max (ms),Latency Avg (ms),Connections Min (conn),Connections Max (conn),Connections Avg (conn)",
			"2026-03-10T12:00:00Z,99.5,10,30,20,1,3,2",
		]);
	});
});
