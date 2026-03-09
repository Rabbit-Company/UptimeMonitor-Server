import { Logger } from "./logger";
import { server } from ".";
import type { Incident, IncidentSeverity, IncidentStatus, IncidentUpdate, IncidentWithUpdates } from "./types";
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

function rowToIncident(row: Record<string, any>): Incident {
	return {
		id: row.id,
		status_page_id: row.status_page_id,
		title: row.title,
		status: row.status as IncidentStatus,
		severity: row.severity as IncidentSeverity,
		affected_monitors: parseAffectedMonitors(row.affected_monitors),
		suppress_notifications: row.suppress_notifications === true || row.suppress_notifications === 1,
		created_at: row.created_at,
		updated_at: row.updated_at,
		resolved_at: row.resolved_at || null,
	};
}

function rowToUpdate(row: Record<string, any>): IncidentUpdate {
	return {
		id: row.id,
		incident_id: row.incident_id,
		status: row.status as IncidentStatus,
		message: row.message,
		created_at: row.created_at,
	};
}

/**
 * Get all incidents for a status page in a given month, with all updates inlined.
 * Month format: "YYYY-MM" (defaults to current month)
 */
export async function getIncidentsByMonth(statusPageId: string, month?: string): Promise<IncidentWithUpdates[]> {
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
		const incidentRows = await db`
			SELECT * FROM incidents
			WHERE status_page_id = ${statusPageId}
				AND created_at >= ${startDate}
				AND created_at < ${endDate}
			ORDER BY created_at DESC
		`;

		if (incidentRows.length === 0) return [];

		const incidentIds = incidentRows.map((r: any) => r.id);

		const updateRows = await db`
			SELECT * FROM incident_updates
			WHERE incident_id IN ${db(incidentIds)}
			ORDER BY created_at ASC
		`;

		// Group updates by incident_id
		const updatesByIncident = new Map<string, IncidentUpdate[]>();
		for (const row of updateRows) {
			const list = updatesByIncident.get(row.incident_id) || [];
			list.push(rowToUpdate(row));
			updatesByIncident.set(row.incident_id, list);
		}

		return incidentRows.map((row: any) => ({
			...rowToIncident(row),
			updates: updatesByIncident.get(row.id) || [],
		}));
	} catch (err: any) {
		Logger.error("getIncidentsByMonth failed", { statusPageId, month: targetMonth, "error.message": err?.message });
		return [];
	}
}

/**
 * Get a single incident by ID with all updates.
 */
export async function getIncidentById(incidentId: string): Promise<IncidentWithUpdates | null> {
	try {
		const incidentRows = await db`
			SELECT * FROM incidents
			WHERE id = ${incidentId}
			LIMIT 1
		`;

		if (incidentRows.length === 0) return null;

		const incident = rowToIncident(incidentRows[0]!);

		const updateRows = await db`
			SELECT * FROM incident_updates
			WHERE incident_id = ${incidentId}
			ORDER BY created_at ASC
		`;

		return {
			...incident,
			updates: updateRows.map(rowToUpdate),
		};
	} catch (err: any) {
		Logger.error("getIncidentById failed", { incidentId, "error.message": err?.message });
		return null;
	}
}

/**
 * Get all incidents, optionally filtered by status_page_id.
 */
export async function getAllIncidents(statusPageId?: string): Promise<Incident[]> {
	try {
		let rows: any[];

		if (statusPageId) {
			rows = await db`
				SELECT * FROM incidents
				WHERE status_page_id = ${statusPageId}
				ORDER BY created_at DESC
			`;
		} else {
			rows = await db`
				SELECT * FROM incidents
				ORDER BY created_at DESC
			`;
		}

		return rows.map(rowToIncident);
	} catch (err: any) {
		Logger.error("getAllIncidents failed", { "error.message": err?.message });
		return [];
	}
}

/**
 * Create a new incident with an initial update message.
 */
export async function createIncident(params: {
	statusPageId: string;
	title: string;
	status: IncidentStatus;
	severity: IncidentSeverity;
	message: string;
	affectedMonitors?: string[];
	suppressNotifications?: boolean;
}): Promise<IncidentWithUpdates> {
	const now = new Date().toISOString();
	const incidentId = Bun.randomUUIDv7();
	const updateId = Bun.randomUUIDv7();
	const resolvedAt = params.status === "resolved" ? now : null;
	const affectedJson = JSON.stringify(params.affectedMonitors || []);
	const suppressNotifications = params.suppressNotifications !== false;
	const suppressInt = suppressNotifications ? 1 : 0;

	await db`
		INSERT INTO incidents (id, status_page_id, title, status, severity, affected_monitors, suppress_notifications, created_at, updated_at, resolved_at)
		VALUES (${incidentId}, ${params.statusPageId}, ${params.title}, ${params.status}, ${params.severity}, ${affectedJson}, ${suppressInt}, ${now}, ${now}, ${resolvedAt})
	`;

	await db`
		INSERT INTO incident_updates (id, incident_id, status, message, created_at)
		VALUES (${updateId}, ${incidentId}, ${params.status}, ${params.message}, ${now})
	`;

	return {
		id: incidentId,
		status_page_id: params.statusPageId,
		title: params.title,
		status: params.status,
		severity: params.severity,
		affected_monitors: params.affectedMonitors || [],
		suppress_notifications: suppressNotifications,
		created_at: now,
		updated_at: now,
		resolved_at: resolvedAt,
		updates: [
			{
				id: updateId,
				incident_id: incidentId,
				status: params.status,
				message: params.message,
				created_at: now,
			},
		],
	};
}

/**
 * Update incident metadata (title, severity, affected_monitors, suppress_notifications).
 */
export async function updateIncident(
	incidentId: string,
	updates: {
		title?: string;
		severity?: IncidentSeverity;
		affectedMonitors?: string[];
		suppressNotifications?: boolean;
	},
): Promise<IncidentWithUpdates | null> {
	const existing = await getIncidentById(incidentId);
	if (!existing) return null;

	const now = new Date().toISOString();
	const newTitle = updates.title ?? existing.title;
	const newSeverity = updates.severity ?? existing.severity;
	const newAffected = updates.affectedMonitors ?? existing.affected_monitors;
	const newSuppress = updates.suppressNotifications ?? existing.suppress_notifications;
	const affectedJson = JSON.stringify(newAffected);
	const suppressInt = newSuppress ? 1 : 0;

	await db`
		UPDATE incidents
		SET title = ${newTitle},
			severity = ${newSeverity},
			affected_monitors = ${affectedJson},
			suppress_notifications = ${suppressInt},
			updated_at = ${now}
		WHERE id = ${incidentId}
	`;

	return {
		...existing,
		title: newTitle,
		severity: newSeverity,
		affected_monitors: newAffected,
		suppress_notifications: newSuppress,
		updated_at: now,
	};
}

/**
 * Add a timeline update to an incident. Also updates the parent incident's status/updated_at.
 */
export async function addIncidentUpdate(
	incidentId: string,
	params: { status: IncidentStatus; message: string },
): Promise<{ incident: IncidentWithUpdates; update: IncidentUpdate } | null> {
	const existing = await getIncidentById(incidentId);
	if (!existing) return null;

	const now = new Date().toISOString();
	const updateId = Bun.randomUUIDv7();
	const resolvedAt = params.status === "resolved" ? now : existing.resolved_at;

	await db`
		INSERT INTO incident_updates (id, incident_id, status, message, created_at)
		VALUES (${updateId}, ${incidentId}, ${params.status}, ${params.message}, ${now})
	`;

	await db`
		UPDATE incidents
		SET status = ${params.status},
			updated_at = ${now},
			resolved_at = ${resolvedAt}
		WHERE id = ${incidentId}
	`;

	const update: IncidentUpdate = {
		id: updateId,
		incident_id: incidentId,
		status: params.status,
		message: params.message,
		created_at: now,
	};

	const updatedIncident: IncidentWithUpdates = {
		...existing,
		status: params.status,
		updated_at: now,
		resolved_at: resolvedAt,
		updates: [...existing.updates, update],
	};

	return { incident: updatedIncident, update };
}

/**
 * Delete an incident and all its updates.
 */
export async function deleteIncident(incidentId: string): Promise<boolean> {
	try {
		await db`DELETE FROM incident_updates WHERE incident_id = ${incidentId}`;
		await db`DELETE FROM incidents WHERE id = ${incidentId}`;

		return true;
	} catch (err: any) {
		Logger.error("deleteIncident failed", { incidentId, "error.message": err?.message });
		return false;
	}
}

/**
 * Delete a specific incident update.
 * If the deleted update was the most recent one, the incident's status and resolved_at
 * are synced to match the new most-recent update.
 * Returns the updated incident on success, or null on failure.
 */
export async function deleteIncidentUpdate(incidentId: string, updateId: string): Promise<IncidentWithUpdates | null> {
	try {
		const existing = await getIncidentById(incidentId);
		if (!existing) return null;

		const deletedUpdate = existing.updates.find((u) => u.id === updateId);
		if (!deletedUpdate) return null;

		const isLatestUpdate = existing.updates.length > 0 && existing.updates[existing.updates.length - 1]!.id === updateId;

		await db`DELETE FROM incident_updates WHERE id = ${updateId} AND incident_id = ${incidentId}`;

		const remainingUpdates = existing.updates.filter((u) => u.id !== updateId);

		if (isLatestUpdate) {
			const newLatest = remainingUpdates.length > 0 ? remainingUpdates[remainingUpdates.length - 1]! : null;
			const newStatus: IncidentStatus = newLatest ? (newLatest.status as IncidentStatus) : existing.status;
			const now = new Date().toISOString();
			const newResolvedAt = newStatus === "resolved" ? (existing.resolved_at ?? now) : null;

			await db`
				UPDATE incidents
				SET status = ${newStatus},
					updated_at = ${now},
					resolved_at = ${newResolvedAt}
				WHERE id = ${incidentId}
			`;

			return {
				...existing,
				status: newStatus,
				updated_at: now,
				resolved_at: newResolvedAt,
				updates: remainingUpdates,
			};
		}

		return {
			...existing,
			updates: remainingUpdates,
		};
	} catch (err: any) {
		Logger.error("deleteIncidentUpdate failed", { incidentId, updateId, "error.message": err?.message });
		return null;
	}
}

export async function getActiveIncidents(): Promise<Incident[]> {
	try {
		const rows = await db`
			SELECT * FROM incidents
			WHERE status IN ('investigating', 'identified', 'monitoring') AND suppress_notifications = ${1}
		`;

		return rows.map(rowToIncident);
	} catch (err: any) {
		Logger.error("getActiveIncidents failed", { "error.message": err?.message });
		return [];
	}
}

/**
 * Broadcast an incident event to all subscribers of the relevant status page slugs.
 */
export function broadcastIncidentEvent(
	statusPageSlug: string,
	action: "incident-created" | "incident-updated" | "incident-update-added" | "incident-update-deleted" | "incident-deleted",
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
		Logger.error("broadcastIncidentEvent failed", { action, "error.message": err?.message });
	}
}
