import { beforeEach, describe, expect, test } from "bun:test";
import { buildStatusTree } from "../src/statuspage";
import { restoreConfig } from "./helpers/config";
import { resetState, setStatus } from "./helpers/status";

beforeEach(() => {
	restoreConfig();
	resetState();
});

function setAll(): void {
	for (const id of ["api", "db", "worker", "web", "backend", "everything"]) setStatus(id, "up");
}

describe("buildStatusTree", () => {
	test("nests children under groups", () => {
		setAll();
		const tree = buildStatusTree(["everything"]);

		expect(tree).toHaveLength(1);
		expect(tree[0]!.id).toBe("everything");
		expect(tree[0]!.children!.map((c) => c.id)).toEqual(["backend", "web"]);
		expect(tree[0]!.children![0]!.children!.map((c) => c.id)).toEqual(["api", "db", "worker"]);
		expect(tree[0]!.children![1]!.children).toBeUndefined();
	});

	test("does not expand leaf items", () => {
		setAll();
		const tree = buildStatusTree(["everything"], new Set(["backend"]));
		const backend = tree[0]!.children!.find((c) => c.id === "backend")!;
		expect(backend.status).toBe("up");
		expect(backend.children).toBeUndefined();
	});

	test("skips items without a status", () => {
		setStatus("everything", "up");
		setStatus("backend", "degraded");
		setStatus("api", "up");

		const tree = buildStatusTree(["everything", "ghost"]);
		expect(tree).toHaveLength(1);
		expect(tree[0]!.children!.map((c) => c.id)).toEqual(["backend"]);
		expect(tree[0]!.children![0]!.children!.map((c) => c.id)).toEqual(["api"]);
	});

	test("returns an empty list when nothing has a status", () => {
		expect(buildStatusTree(["everything"])).toEqual([]);
	});

	test("does not modify the cached statuses", () => {
		setAll();
		const cached = setStatus("everything", "up");
		buildStatusTree(["everything"]);
		expect(cached.children).toBeUndefined();
	});
});
