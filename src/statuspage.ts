import { statusCache } from "./clickhouse";
import { config } from "./config";
import type { Group, Monitor, StatusData } from "./types";

export function buildStatusTree(itemIds: string[]): StatusData[] {
	const result: StatusData[] = [];

	for (const id of itemIds) {
		const cached = statusCache.get(id);
		if (!cached) continue;

		const item: StatusData = { ...cached };

		if (item.type === "group") {
			// Get children
			const childMonitors: Monitor[] = config.monitors?.filter((m: Monitor) => m.groupId === id);
			const childGroups: Group[] = config.groups?.filter((g: Group) => g.parentId === id);

			item.children = buildStatusTree([...childMonitors.map((m: Monitor) => m.id), ...childGroups.map((g: Group) => g.id)]);
		}

		result.push(item);
	}

	return result;
}
