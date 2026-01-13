import { cache } from "./cache";
import type { StatusData } from "./types";

export function buildStatusTree(itemIds: string[]): StatusData[] {
	const result: StatusData[] = [];

	for (const id of itemIds) {
		const cached = cache.getStatus(id);
		if (!cached) continue;

		const item: StatusData = { ...cached };

		if (item.type === "group") {
			item.children = buildStatusTree(cache.getDirectChildIds(id));
		}

		result.push(item);
	}

	return result;
}
