import { cache } from "../../src/cache";
import { groupStateTracker } from "../../src/group-state-tracker";
import type { StatusData } from "../../src/types";
import { fakeClickHouse, fakeServer } from "./fakes";

/** Store a status for a monitor or group, with sensible defaults for everything else. */
export function setStatus(id: string, status: StatusData["status"], extra: Partial<StatusData> = {}): StatusData {
	const data: StatusData = {
		id,
		type: cache.hasGroup(id) ? "group" : "monitor",
		name: cache.getMonitor(id)?.name ?? cache.getGroup(id)?.name ?? id,
		status,
		latency: 0,
		uptime1h: 100,
		uptime24h: 100,
		uptime7d: 100,
		uptime30d: 100,
		uptime90d: 100,
		uptime365d: 100,
		...extra,
	};
	cache.setStatus(id, data);
	return data;
}

/** Forget every stored status, tracked group state and recorded fake activity. */
export function resetState(): void {
	cache.statusCache.clear();
	cache.setActiveIncidentMonitors(new Map());
	cache.setActiveMaintenanceMonitors(new Map());
	for (const group of cache.getAllGroups()) groupStateTracker.clearState(group.id);
	fakeClickHouse.reset();
	fakeServer.reset();
}

/** Wait for debounced background group updates (100ms) to finish. */
export async function settle(): Promise<void> {
	await Bun.sleep(160);
}
