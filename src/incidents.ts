import { clickhouse } from "./clickhouse";
import { Logger } from "./logger";
import { server } from ".";
import type { Incident, IncidentSeverity, IncidentStatus, IncidentUpdate, IncidentWithUpdates } from "./types";

type IncidentRow = Omit<Incident, "resolved_at"> & {
	created_at: string;
	updated_at: string;
	resolved_at: "" | string;
};

export async function initIncidentTables(): Promise<void> {
	try {
		await clickhouse.command({
			query: `
				CREATE TABLE IF NOT EXISTS incidents (
					id String,
					status_page_id LowCardinality(String),
					title String,
					status LowCardinality(String),
					severity LowCardinality(String),
					affected_monitors Array(String),
					created_at DateTime64(3),
					updated_at DateTime64(3),
					resolved_at Nullable(DateTime64(3))
				) ENGINE = ReplacingMergeTree(updated_at)
				ORDER BY (status_page_id, created_at, id)
				PARTITION BY toYYYYMM(created_at)
				SETTINGS index_granularity = 8192
			`,
		});

		await clickhouse.command({
			query: `
				CREATE TABLE IF NOT EXISTS incident_updates (
					id String,
					incident_id String,
					status LowCardinality(String),
					message String,
					created_at DateTime64(3)
				) ENGINE = MergeTree()
				ORDER BY (incident_id, created_at, id)
				PARTITION BY toYYYYMM(created_at)
				SETTINGS index_granularity = 8192
			`,
		});

		Logger.info("Incident tables initialized");
	} catch (err: any) {
		Logger.error("Incident tables initialization failed", { "error.message": err?.message });
	}
}

/**
 * Get all incidents for a status page in a given month, with all updates inlined.
 * Month format: "YYYY-MM" (defaults to current month)
 */
export async function getIncidentsByMonth(statusPageId: string, month?: string): Promise<IncidentWithUpdates[]> {
	const now = new Date();
	const targetMonth = month || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

	// Parse month to get date range
	const [yearStr, monthStr] = targetMonth.split("-");
	const year = parseInt(yearStr!, 10);
	const mon = parseInt(monthStr!, 10);

	if (isNaN(year) || isNaN(mon) || mon < 1 || mon > 12) {
		return [];
	}

	const startDate = `${year}-${String(mon).padStart(2, "0")}-01 00:00:00.000`;
	// Next month start
	const nextYear = mon === 12 ? year + 1 : year;
	const nextMonth = mon === 12 ? 1 : mon + 1;
	const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01 00:00:00.000`;

	try {
		const incidentResult = await clickhouse.query({
			query: `
				SELECT
					id,
					status_page_id,
					title,
					status,
					severity,
					affected_monitors,
					created_at,
					updated_at,
					resolved_at
				FROM incidents FINAL
				WHERE status_page_id = {statusPageId:String}
					AND created_at >= {startDate:String}
					AND created_at < {endDate:String}
				ORDER BY created_at DESC
			`,
			query_params: { statusPageId, startDate, endDate },
			format: "JSONEachRow",
			clickhouse_settings: {
				date_time_output_format: "iso",
			},
		});

		const incidents = await incidentResult.json<IncidentRow>();

		if (incidents.length === 0) return [];

		// Get all updates for these incidents in one query
		const incidentIds = incidents.map((i) => i.id);
		const updateResult = await clickhouse.query({
			query: `
				SELECT
					id,
					incident_id,
					status,
					message,
					created_at
				FROM incident_updates
				WHERE incident_id IN ({incidentIds:Array(String)})
				ORDER BY created_at ASC
			`,
			query_params: { incidentIds },
			format: "JSONEachRow",
			clickhouse_settings: {
				date_time_output_format: "iso",
			},
		});

		const updates = await updateResult.json<IncidentUpdate>();

		// Group updates by incident_id
		const updatesByIncident = new Map<string, IncidentUpdate[]>();
		for (const update of updates) {
			const list = updatesByIncident.get(update.incident_id) || [];
			list.push(update);
			updatesByIncident.set(update.incident_id, list);
		}

		// Merge
		return incidents.map((incident) => ({
			...incident,
			affected_monitors: incident.affected_monitors || [],
			resolved_at: incident.resolved_at || null,
			updates: updatesByIncident.get(incident.id) || [],
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
		const incidentResult = await clickhouse.query({
			query: `
				SELECT
					id,
					status_page_id,
					title,
					status,
					severity,
					affected_monitors,
					created_at,
					updated_at,
					resolved_at
				FROM incidents FINAL
				WHERE id = {incidentId:String}
				LIMIT 1
			`,
			query_params: { incidentId },
			format: "JSONEachRow",
			clickhouse_settings: {
				date_time_output_format: "iso",
			},
		});

		const incidents = await incidentResult.json<IncidentRow>();
		if (incidents.length === 0) return null;

		const incident = incidents[0]!;

		const updateResult = await clickhouse.query({
			query: `
				SELECT
					id,
					incident_id,
					status,
					message,
					created_at
				FROM incident_updates
				WHERE incident_id = {incidentId:String}
				ORDER BY created_at ASC
			`,
			query_params: { incidentId },
			format: "JSONEachRow",
			clickhouse_settings: {
				date_time_output_format: "iso",
			},
		});

		const updates = await updateResult.json<IncidentUpdate>();

		return {
			...incident,
			affected_monitors: incident.affected_monitors || [],
			resolved_at: incident.resolved_at || null,
			updates,
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
		const whereClause = statusPageId ? "WHERE status_page_id = {statusPageId:String}" : "";
		const result = await clickhouse.query({
			query: `
				SELECT
					id,
					status_page_id,
					title,
					status,
					severity,
					affected_monitors,
					created_at,
					updated_at,
					resolved_at
				FROM incidents FINAL
				${whereClause}
				ORDER BY created_at DESC
			`,
			query_params: { statusPageId: statusPageId || "" },
			format: "JSONEachRow",
			clickhouse_settings: {
				date_time_output_format: "iso",
			},
		});

		const incidents = await result.json<IncidentRow>();
		return incidents.map((i) => ({
			...i,
			affected_monitors: i.affected_monitors || [],
			resolved_at: i.resolved_at || null,
		}));
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
}): Promise<IncidentWithUpdates> {
	const now = new Date().toISOString();
	const incidentId = crypto.randomUUID();
	const updateId = crypto.randomUUID();

	const resolvedAt = params.status === "resolved" ? now : null;

	await clickhouse.insert({
		table: "incidents",
		values: [
			{
				id: incidentId,
				status_page_id: params.statusPageId,
				title: params.title,
				status: params.status,
				severity: params.severity,
				affected_monitors: params.affectedMonitors || [],
				created_at: now,
				updated_at: now,
				resolved_at: resolvedAt,
			},
		],
		format: "JSONEachRow",
		clickhouse_settings: {
			date_time_input_format: "best_effort",
		},
	});

	await clickhouse.insert({
		table: "incident_updates",
		values: [
			{
				id: updateId,
				incident_id: incidentId,
				status: params.status,
				message: params.message,
				created_at: now,
			},
		],
		format: "JSONEachRow",
		clickhouse_settings: {
			date_time_input_format: "best_effort",
		},
	});

	const incident: IncidentWithUpdates = {
		id: incidentId,
		status_page_id: params.statusPageId,
		title: params.title,
		status: params.status,
		severity: params.severity,
		affected_monitors: params.affectedMonitors || [],
		created_at: now,
		updated_at: now,
		resolved_at: resolvedAt ? now : null,
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

	return incident;
}

/**
 * Update incident metadata (title, severity, affected_monitors).
 * Re-inserts a row with the same id - ReplacingMergeTree keeps the latest by updated_at.
 */
export async function updateIncident(
	incidentId: string,
	updates: { title?: string; severity?: IncidentSeverity; affectedMonitors?: string[] },
): Promise<IncidentWithUpdates | null> {
	const existing = await getIncidentById(incidentId);
	if (!existing) return null;

	const now = new Date().toISOString();

	const updated = {
		id: existing.id,
		status_page_id: existing.status_page_id,
		title: updates.title ?? existing.title,
		status: existing.status,
		severity: updates.severity ?? existing.severity,
		affected_monitors: updates.affectedMonitors ?? existing.affected_monitors,
		created_at: existing.created_at,
		updated_at: now,
		resolved_at: existing.resolved_at,
	};

	await clickhouse.insert({
		table: "incidents",
		values: [updated],
		format: "JSONEachRow",
		clickhouse_settings: {
			date_time_input_format: "best_effort",
		},
	});

	return {
		...existing,
		title: updated.title,
		severity: updated.severity,
		affected_monitors: updated.affected_monitors,
		updated_at: now,
		updates: existing.updates,
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
	const updateId = crypto.randomUUID();

	const update = {
		id: updateId,
		incident_id: incidentId,
		status: params.status,
		message: params.message,
		created_at: now,
	};

	await clickhouse.insert({
		table: "incident_updates",
		values: [update],
		format: "JSONEachRow",
		clickhouse_settings: {
			date_time_input_format: "best_effort",
		},
	});

	// Update the parent incident
	const resolvedAt = params.status === "resolved" ? now : existing.resolved_at;

	await clickhouse.insert({
		table: "incidents",
		values: [
			{
				id: existing.id,
				status_page_id: existing.status_page_id,
				title: existing.title,
				status: params.status,
				severity: existing.severity,
				affected_monitors: existing.affected_monitors,
				created_at: existing.created_at,
				updated_at: now,
				resolved_at: resolvedAt,
			},
		],
		format: "JSONEachRow",
		clickhouse_settings: {
			date_time_input_format: "best_effort",
		},
	});

	const updatedIncident: IncidentWithUpdates = {
		...existing,
		status: params.status,
		updated_at: now,
		resolved_at: resolvedAt,
		updates: [...existing.updates, update],
	};

	return { incident: updatedIncident, update: update };
}

/**
 * Delete an incident and all its updates.
 */
export async function deleteIncident(incidentId: string): Promise<boolean> {
	try {
		await clickhouse.command({
			query: `DELETE FROM incident_updates WHERE incident_id = {incidentId:String}`,
			query_params: { incidentId },
		});

		await clickhouse.command({
			query: `DELETE FROM incidents WHERE id = {incidentId:String}`,
			query_params: { incidentId },
		});

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

		// Find the update being deleted
		const deletedUpdate = existing.updates.find((u) => u.id === updateId);
		if (!deletedUpdate) return null;

		// Determine if this is the latest update (last in chronological order)
		const isLatestUpdate = existing.updates.length > 0 && existing.updates[existing.updates.length - 1]!.id === updateId;

		// Delete the update
		await clickhouse.command({
			query: `DELETE FROM incident_updates WHERE id = {updateId:String} AND incident_id = {incidentId:String}`,
			query_params: { updateId, incidentId },
		});

		const remainingUpdates = existing.updates.filter((u) => u.id !== updateId);

		// If we deleted the latest update, sync the incident's status to the new latest update
		if (isLatestUpdate) {
			const newLatest = remainingUpdates.length > 0 ? remainingUpdates[remainingUpdates.length - 1]! : null;
			const newStatus: IncidentStatus = newLatest ? (newLatest.status as IncidentStatus) : existing.status;
			const now = new Date().toISOString();
			const newResolvedAt = newStatus === "resolved" ? (existing.resolved_at ?? now) : null;

			await clickhouse.insert({
				table: "incidents",
				values: [
					{
						id: existing.id,
						status_page_id: existing.status_page_id,
						title: existing.title,
						status: newStatus,
						severity: existing.severity,
						affected_monitors: existing.affected_monitors,
						created_at: existing.created_at,
						updated_at: now,
						resolved_at: newResolvedAt,
					},
				],
				format: "JSONEachRow",
				clickhouse_settings: {
					date_time_input_format: "best_effort",
				},
			});

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
