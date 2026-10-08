import { describe, expect, test } from "bun:test";
import { buildGroupCsvHeaders, buildMonitorCsvHeaders, groupDataToCsv, monitorDataToCsv, parseFormat } from "../src/routes/helpers";
import { isValidId } from "../src/admin/helpers";

describe("route helpers", () => {
	describe("parseFormat", () => {
		test("only csv selects csv", () => {
			expect(parseFormat("csv")).toBe("csv");
			expect(parseFormat("json")).toBe("json");
			expect(parseFormat("CSV")).toBe("json");
			expect(parseFormat("xml")).toBe("json");
			expect(parseFormat(undefined)).toBe("json");
		});
	});

	describe("CSV headers", () => {
		const base = ["Timestamp", "Uptime (%)", "Latency Min (ms)", "Latency Max (ms)", "Latency Avg (ms)"];

		test("monitor headers without custom metrics", () => {
			expect(buildMonitorCsvHeaders()).toEqual(base);
		});

		test("group headers", () => {
			expect(buildGroupCsvHeaders()).toEqual(base);
		});

		test("adds min/max/avg columns per custom metric, with the unit", () => {
			expect(buildMonitorCsvHeaders({ id: "players", name: "Players", unit: "online" })).toEqual([
				...base,
				"Players Min (online)",
				"Players Max (online)",
				"Players Avg (online)",
			]);
		});

		test("omits the unit when there is none and falls back to the id for the name", () => {
			expect(buildMonitorCsvHeaders({ id: "tps", name: "" })).toEqual([...base, "tps Min", "tps Max", "tps Avg"]);
		});

		test("skips unset metric slots", () => {
			expect(buildMonitorCsvHeaders(undefined, { id: "b", name: "B" }, undefined)).toEqual([...base, "B Min", "B Max", "B Avg"]);
		});
	});

	describe("monitorDataToCsv", () => {
		test("writes a header row and one row per record", () => {
			const csv = monitorDataToCsv([
				{ timestamp: "2026-01-01T00:00:00Z", uptime: 100, latency_min: 1, latency_max: 3, latency_avg: 2 },
				{ timestamp: "2026-01-01T01:00:00Z", uptime: 99.5, latency_min: 4, latency_max: 6, latency_avg: 5 },
			]);
			expect(csv.split("\n")).toEqual([
				"Timestamp,Uptime (%),Latency Min (ms),Latency Max (ms),Latency Avg (ms)",
				"2026-01-01T00:00:00Z,100,1,3,2",
				"2026-01-01T01:00:00Z,99.5,4,6,5",
			]);
		});

		test("leaves missing values empty but keeps zeros", () => {
			const csv = monitorDataToCsv([{ timestamp: "t", uptime: 0, latency_min: null, latency_avg: 0 }]);
			expect(csv.split("\n")[1]).toBe("t,0,,,0");
		});

		test("includes custom metric columns only for configured metrics", () => {
			const csv = monitorDataToCsv(
				[{ timestamp: "t", uptime: 100, latency_min: 1, latency_max: 1, latency_avg: 1, custom1_min: 7, custom1_max: 9, custom1_avg: 8, custom2_min: 99 }],
				{ id: "c", name: "C" },
			);
			expect(csv.split("\n")[1]).toBe("t,100,1,1,1,7,9,8");
		});

		test("keeps columns aligned when only a later metric is configured", () => {
			const csv = monitorDataToCsv([{ timestamp: "t", uptime: 100, custom3_min: 1, custom3_max: 2, custom3_avg: 3 }], undefined, undefined, {
				id: "c3",
				name: "C3",
			});
			const [header, row] = csv.split("\n");
			expect(header!.split(",")).toHaveLength(8);
			expect(row).toBe("t,100,,,,1,2,3");
		});

		test("escapes commas, quotes and newlines", () => {
			const csv = monitorDataToCsv([{ timestamp: 'a,"b"\nc', uptime: 100 }], { id: "m", name: "Rate, total", unit: 'req"s' });
			expect(csv).toContain('"Rate, total Min (req""s)"');
			expect(csv).toContain('"a,""b""\nc",100');
		});

		test("returns only the header for no data", () => {
			expect(monitorDataToCsv([])).toBe("Timestamp,Uptime (%),Latency Min (ms),Latency Max (ms),Latency Avg (ms)");
		});
	});

	describe("groupDataToCsv", () => {
		test("writes rows and ignores custom metrics", () => {
			const csv = groupDataToCsv([{ timestamp: "t", uptime: 50, latency_min: 1, latency_max: 2, latency_avg: 1.5, custom1_min: 9 }]);
			expect(csv.split("\n")).toEqual(["Timestamp,Uptime (%),Latency Min (ms),Latency Max (ms),Latency Avg (ms)", "t,50,1,2,1.5"]);
		});
	});

	describe("isValidId", () => {
		test.each(["api", "api-prod", "api_prod", "API1", "1"])("accepts %p", (id) => {
			expect(isValidId(id)).toBe(true);
		});

		test.each(["", " ", "api prod", "api/prod", "api.prod", "ünï", 1, null, undefined, {}])("rejects %p", (id) => {
			expect(isValidId(id)).toBe(false);
		});
	});
});
