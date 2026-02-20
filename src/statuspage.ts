import { cache } from "./cache";
import type { StatusData } from "./types";

export function buildStatusTree(itemIds: string[], leafItems?: Set<string>): StatusData[] {
	const result: StatusData[] = [];

	for (const id of itemIds) {
		const cached = cache.getStatus(id);
		if (!cached) continue;

		const item: StatusData = { ...cached };

		if (!leafItems?.has(id)) {
			const childIds = cache.getDirectChildIds(id);
			if (childIds.length > 0) {
				item.children = buildStatusTree(childIds, leafItems);
			}
		}

		result.push(item);
	}

	return result;
}
