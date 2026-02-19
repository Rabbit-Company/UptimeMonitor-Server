import { cache } from "./cache";
import type { StatusData } from "./types";

export function buildStatusTree(itemIds: string[]): StatusData[] {
	const result: StatusData[] = [];

	for (const id of itemIds) {
		const cached = cache.getStatus(id);
		if (!cached) continue;

		const item: StatusData = { ...cached };

		const childIds = cache.getDirectChildIds(id);
		if (childIds.length > 0) {
			item.children = buildStatusTree(childIds);
		}

		result.push(item);
	}

	return result;
}
