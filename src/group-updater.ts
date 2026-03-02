import { cache } from "./cache";
import { updateGroupStatus } from "./clickhouse";
import { Logger } from "./logger";

const DEBOUNCE_MS = 100;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Set<string>();
const dirty = new Set<string>(); // changes came in while inFlight

export function propagateGroupStatus(monitorId: string): void {
	const parentIds = cache.getParentIds(monitorId);

	for (const groupId of parentIds) {
		if (!cache.hasGroup(groupId)) continue;
		if (inFlight.has(groupId)) dirty.add(groupId);

		const existing = timers.get(groupId);
		if (existing) clearTimeout(existing);

		timers.set(
			groupId,
			setTimeout(() => {
				timers.delete(groupId);
				void runGroupUpdate(groupId, monitorId);
			}, DEBOUNCE_MS),
		);
	}
}

async function runGroupUpdate(groupId: string, triggeredBy: string) {
	if (inFlight.has(groupId)) {
		dirty.add(groupId);
		return;
	}

	inFlight.add(groupId);
	try {
		await updateGroupStatus(groupId);
	} catch (err) {
		Logger.error("Background group status update failed", {
			groupId,
			triggeredBy,
			error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
		});
	} finally {
		inFlight.delete(groupId);

		// if changes arrived while running, run once more (debounced-ish)
		if (dirty.delete(groupId)) {
			// schedule next tick so we don't recurse tightly
			setTimeout(() => void runGroupUpdate(groupId, triggeredBy), 0);
		}
	}
}
