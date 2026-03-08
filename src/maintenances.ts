import { Logger } from "./logger";
import { server } from ".";
import type { Maintenance, MaintenanceStatus, MaintenanceUpdate, MaintenanceWithUpdates } from "./types";
import { db } from "./database";

function parseAffectedMonitors(value: unknown): string[] {
	if (Array.isArray(value)) return value as string[];
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	return [];
}

function rowToMaintenance(row: Record<string, any>): Maintenance {
	return {
		id: row.id,
		status_page_id: row.status_page_id,
		title: row.title,
		status: row.status as MaintenanceStatus,
		scheduled_start: row.scheduled_start,
		scheduled_end: row.scheduled_end,
		affected_monitors: parseAffectedMonitors(row.affected_monitors),
		suppress_notifications: row.suppress_notifications === true || row.suppress_notifications === 1,
		created_at: row.created_at,
		updated_at: row.updated_at,
		completed_at: row.completed_at || null,
	};
}

function rowToUpdate(row: Record<string, any>): MaintenanceUpdate {
	return {
		id: row.id,
		maintenance_id: row.maintenance_id,
		status: row.status as MaintenanceStatus,
		message: row.message,
		created_at: row.created_at,
	};
}

/**
 * Get all maintenances for a status page in a given month, with all updates inlined.
 * Month format: "YYYY-MM" (defaults to current month)
 */
export async function getMaintenancesByMonth(statusPageId: string, month?: string): Promise<MaintenanceWithUpdates[]> {
	const now = new Date();
	const targetMonth = month || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

	const [yearStr, monthStr] = targetMonth.split("-");
	const year = parseInt(yearStr!, 10);
	const mon = parseInt(monthStr!, 10);

	if (isNaN(year) || isNaN(mon) || mon < 1 || mon > 12) {
		return [];
	}

	const startDate = new Date(Date.UTC(year, mon - 1, 1)).toISOString();
	const nextYear = mon === 12 ? year + 1 : year;
	const nextMonth = mon === 12 ? 1 : mon + 1;
	const endDate = new Date(Date.UTC(nextYear, nextMonth - 1, 1)).toISOString();

	try {
		const maintenanceRows = await db`
			SELECT * FROM maintenances
			WHERE status_page_id = ${statusPageId}
				AND scheduled_start >= ${startDate}
				AND scheduled_start < ${endDate}
			ORDER BY scheduled_start DESC
		`;

		if (maintenanceRows.length === 0) return [];

		const maintenanceIds = maintenanceRows.map((r: any) => r.id);

		const updateRows = await db`
			SELECT * FROM maintenance_updates
			WHERE maintenance_id IN ${db(maintenanceIds)}
			ORDER BY created_at ASC
		`;

		// Group updates by maintenance_id
		const updatesByMaintenance = new Map<string, MaintenanceUpdate[]>();
		for (const row of updateRows) {
			const list = updatesByMaintenance.get(row.maintenance_id) || [];
			list.push(rowToUpdate(row));
			updatesByMaintenance.set(row.maintenance_id, list);
		}

		return maintenanceRows.map((row: any) => ({
			...rowToMaintenance(row),
			updates: updatesByMaintenance.get(row.id) || [],
		}));
	} catch (err: any) {
		Logger.error("getMaintenancesByMonth failed", { statusPageId, month: targetMonth, "error.message": err?.message });
		return [];
	}
}

/**
 * Get a single maintenance by ID with all updates.
 */
export async function getMaintenanceById(maintenanceId: string): Promise<MaintenanceWithUpdates | null> {
	try {
		const maintenanceRows = await db`
			SELECT * FROM maintenances
			WHERE id = ${maintenanceId}
			LIMIT 1
		`;

		if (maintenanceRows.length === 0) return null;

		const maintenance = rowToMaintenance(maintenanceRows[0]!);

		const updateRows = await db`
			SELECT * FROM maintenance_updates
			WHERE maintenance_id = ${maintenanceId}
			ORDER BY created_at ASC
		`;

		return {
			...maintenance,
			updates: updateRows.map(rowToUpdate),
		};
	} catch (err: any) {
		Logger.error("getMaintenanceById failed", { maintenanceId, "error.message": err?.message });
		return null;
	}
}

/**
 * Get all maintenances, optionally filtered by status_page_id.
 */
export async function getAllMaintenances(statusPageId?: string): Promise<Maintenance[]> {
	try {
		let rows: any[];

		if (statusPageId) {
			rows = await db`
				SELECT * FROM maintenances
				WHERE status_page_id = ${statusPageId}
				ORDER BY scheduled_start DESC
			`;
		} else {
			rows = await db`
				SELECT * FROM maintenances
				ORDER BY scheduled_start DESC
			`;
		}

		return rows.map(rowToMaintenance);
	} catch (err: any) {
		Logger.error("getAllMaintenances failed", { "error.message": err?.message });
		return [];
	}
}

/**
 * Create a new maintenance with an initial update message.
 */
export async function createMaintenance(params: {
	statusPageId: string;
	title: string;
	status: MaintenanceStatus;
	scheduledStart: string;
	scheduledEnd: string;
	message: string;
	affectedMonitors?: string[];
	suppressNotifications?: boolean;
}): Promise<MaintenanceWithUpdates> {
	const now = new Date().toISOString();
	const maintenanceId = Bun.randomUUIDv7();
	const updateId = Bun.randomUUIDv7();
	const completedAt = params.status === "completed" ? now : null;
	const suppressNotifications = params.suppressNotifications !== false;
	const affectedJson = JSON.stringify(params.affectedMonitors || []);
	const suppressInt = suppressNotifications ? 1 : 0;

	await db`
		INSERT INTO maintenances (id, status_page_id, title, status, scheduled_start, scheduled_end, affected_monitors, suppress_notifications, created_at, updated_at, completed_at)
		VALUES (${maintenanceId}, ${params.statusPageId}, ${params.title}, ${params.status}, ${params.scheduledStart}, ${params.scheduledEnd}, ${affectedJson}, ${suppressInt}, ${now}, ${now}, ${completedAt})
	`;

	await db`
		INSERT INTO maintenance_updates (id, maintenance_id, status, message, created_at)
		VALUES (${updateId}, ${maintenanceId}, ${params.status}, ${params.message}, ${now})
	`;

	return {
		id: maintenanceId,
		status_page_id: params.statusPageId,
		title: params.title,
		status: params.status,
		scheduled_start: params.scheduledStart,
		scheduled_end: params.scheduledEnd,
		affected_monitors: params.affectedMonitors || [],
		suppress_notifications: suppressNotifications,
		created_at: now,
		updated_at: now,
		completed_at: completedAt,
		updates: [
			{
				id: updateId,
				maintenance_id: maintenanceId,
				status: params.status,
				message: params.message,
				created_at: now,
			},
		],
	};
}

/**
 * Update maintenance metadata (title, scheduled_start/end, affected_monitors, suppress_notifications).
 */
export async function updateMaintenance(
	maintenanceId: string,
	updates: {
		title?: string;
		scheduledStart?: string;
		scheduledEnd?: string;
		affectedMonitors?: string[];
		suppressNotifications?: boolean;
	},
): Promise<MaintenanceWithUpdates | null> {
	const existing = await getMaintenanceById(maintenanceId);
	if (!existing) return null;

	const now = new Date().toISOString();
	const newTitle = updates.title ?? existing.title;
	const newScheduledStart = updates.scheduledStart ?? existing.scheduled_start;
	const newScheduledEnd = updates.scheduledEnd ?? existing.scheduled_end;
	const newAffected = updates.affectedMonitors ?? existing.affected_monitors;
	const newSuppress = updates.suppressNotifications ?? existing.suppress_notifications;
	const affectedJson = JSON.stringify(newAffected);
	const suppressInt = newSuppress ? 1 : 0;

	await db`
		UPDATE maintenances
		SET title = ${newTitle},
			scheduled_start = ${newScheduledStart},
			scheduled_end = ${newScheduledEnd},
			affected_monitors = ${affectedJson},
			suppress_notifications = ${suppressInt},
			updated_at = ${now}
		WHERE id = ${maintenanceId}
	`;

	return {
		...existing,
		title: newTitle,
		scheduled_start: newScheduledStart,
		scheduled_end: newScheduledEnd,
		affected_monitors: newAffected,
		suppress_notifications: newSuppress,
		updated_at: now,
		updates: existing.updates,
	};
}

/**
 * Add a timeline update to a maintenance. Also updates the parent maintenance's status/updated_at.
 */
export async function addMaintenanceUpdate(
	maintenanceId: string,
	params: { status: MaintenanceStatus; message: string },
): Promise<{ maintenance: MaintenanceWithUpdates; update: MaintenanceUpdate } | null> {
	const existing = await getMaintenanceById(maintenanceId);
	if (!existing) return null;

	const now = new Date().toISOString();
	const updateId = Bun.randomUUIDv7();
	const completedAt = params.status === "completed" || params.status === "cancelled" ? now : existing.completed_at;

	await db`
		INSERT INTO maintenance_updates (id, maintenance_id, status, message, created_at)
		VALUES (${updateId}, ${maintenanceId}, ${params.status}, ${params.message}, ${now})
	`;

	await db`
		UPDATE maintenances
		SET status = ${params.status},
			updated_at = ${now},
			completed_at = ${completedAt}
		WHERE id = ${maintenanceId}
	`;

	const update: MaintenanceUpdate = {
		id: updateId,
		maintenance_id: maintenanceId,
		status: params.status,
		message: params.message,
		created_at: now,
	};

	const updatedMaintenance: MaintenanceWithUpdates = {
		...existing,
		status: params.status,
		updated_at: now,
		completed_at: completedAt,
		updates: [...existing.updates, update],
	};

	return { maintenance: updatedMaintenance, update };
}

/**
 * Delete a maintenance and all its updates.
 */
export async function deleteMaintenance(maintenanceId: string): Promise<boolean> {
	try {
		await db`DELETE FROM maintenance_updates WHERE maintenance_id = ${maintenanceId}`;
		await db`DELETE FROM maintenances WHERE id = ${maintenanceId}`;

		return true;
	} catch (err: any) {
		Logger.error("deleteMaintenance failed", { maintenanceId, "error.message": err?.message });
		return false;
	}
}

/**
 * Delete a specific maintenance update.
 * If the deleted update was the most recent one, the maintenance's status and completed_at
 * are synced to match the new most-recent update.
 * Returns the updated maintenance on success, or null on failure.
 */
export async function deleteMaintenanceUpdate(maintenanceId: string, updateId: string): Promise<MaintenanceWithUpdates | null> {
	try {
		const existing = await getMaintenanceById(maintenanceId);
		if (!existing) return null;

		const deletedUpdate = existing.updates.find((u) => u.id === updateId);
		if (!deletedUpdate) return null;

		const isLatestUpdate = existing.updates.length > 0 && existing.updates[existing.updates.length - 1]!.id === updateId;

		await db`DELETE FROM maintenance_updates WHERE id = ${updateId} AND maintenance_id = ${maintenanceId}`;

		const remainingUpdates = existing.updates.filter((u) => u.id !== updateId);

		if (isLatestUpdate) {
			const newLatest = remainingUpdates.length > 0 ? remainingUpdates[remainingUpdates.length - 1]! : null;
			const newStatus: MaintenanceStatus = newLatest ? (newLatest.status as MaintenanceStatus) : existing.status;
			const now = new Date().toISOString();
			const newCompletedAt = newStatus === "completed" || newStatus === "cancelled" ? (existing.completed_at ?? now) : null;

			await db`
				UPDATE maintenances
				SET status = ${newStatus},
					updated_at = ${now},
					completed_at = ${newCompletedAt}
				WHERE id = ${maintenanceId}
			`;

			return {
				...existing,
				status: newStatus,
				updated_at: now,
				completed_at: newCompletedAt,
				updates: remainingUpdates,
			};
		}

		return {
			...existing,
			updates: remainingUpdates,
		};
	} catch (err: any) {
		Logger.error("deleteMaintenanceUpdate failed", { maintenanceId, updateId, "error.message": err?.message });
		return null;
	}
}

/**
 * Get all currently active maintenances (in_progress with suppress_notifications=true).
 * Used by the maintenance scheduler to rebuild the in-memory cache.
 */
export async function getActiveMaintenances(): Promise<Maintenance[]> {
	try {
		const rows = await db`
			SELECT * FROM maintenances
			WHERE status = ${"in_progress"} AND suppress_notifications = ${1}
		`;

		return rows.map(rowToMaintenance);
	} catch (err: any) {
		Logger.error("getActiveMaintenances failed", { "error.message": err?.message });
		return [];
	}
}

/**
 * Get all scheduled maintenances that should have started by now.
 */
export async function getScheduledMaintenancesDue(): Promise<Maintenance[]> {
	try {
		const now = new Date().toISOString();

		const rows = await db`
			SELECT * FROM maintenances
			WHERE status = ${"scheduled"} AND scheduled_start <= ${now}
		`;

		return rows.map(rowToMaintenance);
	} catch (err: any) {
		Logger.error("getScheduledMaintenancesDue failed", { "error.message": err?.message });
		return [];
	}
}

/**
 * Get all in-progress maintenances that should have ended by now.
 */
export async function getInProgressMaintenancesExpired(): Promise<Maintenance[]> {
	try {
		const now = new Date().toISOString();

		const rows = await db`
			SELECT * FROM maintenances
			WHERE status = ${"in_progress"} AND scheduled_end <= ${now}
		`;

		return rows.map(rowToMaintenance);
	} catch (err: any) {
		Logger.error("getInProgressMaintenancesExpired failed", { "error.message": err?.message });
		return [];
	}
}

/**
 * Transition a maintenance status directly (used by the scheduler for auto-transitions).
 * Updates the row and inserts an auto-generated timeline update.
 */
export async function transitionMaintenanceStatus(
	maintenanceId: string,
	newStatus: MaintenanceStatus,
	message: string,
): Promise<MaintenanceWithUpdates | null> {
	const existing = await getMaintenanceById(maintenanceId);
	if (!existing) return null;

	const now = new Date().toISOString();
	const updateId = Bun.randomUUIDv7();
	const completedAt = newStatus === "completed" || newStatus === "cancelled" ? now : existing.completed_at;

	await db`
		INSERT INTO maintenance_updates (id, maintenance_id, status, message, created_at)
		VALUES (${updateId}, ${maintenanceId}, ${newStatus}, ${message}, ${now})
	`;

	await db`
		UPDATE maintenances
		SET status = ${newStatus},
			updated_at = ${now},
			completed_at = ${completedAt}
		WHERE id = ${maintenanceId}
	`;

	return {
		...existing,
		status: newStatus,
		updated_at: now,
		completed_at: completedAt,
		updates: [
			...existing.updates,
			{
				id: updateId,
				maintenance_id: maintenanceId,
				status: newStatus,
				message,
				created_at: now,
			},
		],
	};
}

/**
 * Broadcast a maintenance event to all subscribers of the relevant status page slugs.
 */
export function broadcastMaintenanceEvent(
	statusPageSlug: string,
	action:
		| "maintenance-created"
		| "maintenance-updated"
		| "maintenance-update-added"
		| "maintenance-update-deleted"
		| "maintenance-deleted"
		| "maintenance-started"
		| "maintenance-completed",
	data: any,
): void {
	try {
		server.publish(
			`slug-${statusPageSlug}`,
			JSON.stringify({
				action,
				data: { slug: statusPageSlug, ...data },
				timestamp: new Date().toISOString(),
			}),
		);
	} catch (err: any) {
		Logger.error("broadcastMaintenanceEvent failed", { action, "error.message": err?.message });
	}
}
