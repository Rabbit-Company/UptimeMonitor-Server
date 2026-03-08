import type { Web, Server } from "@rabbit-company/web";
import { cache } from "../cache";
import { Logger } from "../logger";
import { adminBearerAuth } from "./helpers";
import {
	getAllMaintenances,
	getMaintenanceById,
	createMaintenance,
	updateMaintenance,
	addMaintenanceUpdate,
	deleteMaintenance,
	deleteMaintenanceUpdate,
	broadcastMaintenanceEvent,
} from "../maintenances";
import { maintenanceScheduler } from "../schedulers/maintenance";
import { VALID_MAINTENANCE_STATUSES } from "../types";

export function registerMaintenanceRoutes(app: Web, getServer: () => Server): void {
	/**
	 * GET /v1/admin/maintenances
	 * List all maintenances. Optionally filter by ?status_page_id=
	 */
	app.get("/v1/admin/maintenances", adminBearerAuth(), async (ctx) => {
		const statusPageId = ctx.query().get("status_page_id") || undefined;
		const maintenances = await getAllMaintenances(statusPageId);
		return ctx.json({ maintenances });
	});

	/**
	 * GET /v1/admin/maintenances/:id
	 * Get a single maintenance with all updates.
	 */
	app.get("/v1/admin/maintenances/:id", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;
		const maintenance = await getMaintenanceById(id);
		if (!maintenance) return ctx.json({ error: "Maintenance not found" }, 404);
		return ctx.json(maintenance);
	});

	/**
	 * POST /v1/admin/maintenances
	 * Create a new maintenance with an initial update message.
	 */
	app.post("/v1/admin/maintenances", adminBearerAuth(), async (ctx) => {
		let body: any;
		try {
			body = await ctx.req.json();
		} catch (e: any) {
			return ctx.json({ error: e.message }, 400);
		}

		const errors = validateCreate(body);
		if (errors.length) return ctx.json({ error: "Validation failed", details: errors }, 400);

		// Verify status page exists
		const statusPage = cache.getStatusPage(body.status_page_id);
		if (!statusPage) return ctx.json({ error: `Status page '${body.status_page_id}' not found` }, 404);

		// Validate affected monitors if provided
		if (body.affected_monitors?.length) {
			for (const monitorId of body.affected_monitors) {
				if (!cache.isItemOnStatusPage(statusPage.slug, monitorId)) {
					return ctx.json({ error: `Monitor or group '${monitorId}' is not on status page '${body.status_page_id}'` }, 400);
				}
			}
		}

		try {
			const maintenance = await createMaintenance({
				statusPageId: body.status_page_id,
				title: body.title,
				status: body.status,
				scheduledStart: body.scheduled_start,
				scheduledEnd: body.scheduled_end,
				message: body.message,
				affectedMonitors: body.affected_monitors,
				suppressNotifications: body.suppress_notifications,
			});

			Logger.audit("Admin API: Maintenance created", { maintenanceId: maintenance.id, statusPageId: body.status_page_id });

			maintenanceScheduler.refreshCache();

			broadcastMaintenanceEvent(statusPage.slug, "maintenance-created", { maintenance });

			return ctx.json({ success: true, message: `Maintenance '${maintenance.id}' created`, id: maintenance.id, maintenance }, 201);
		} catch (e: any) {
			Logger.error("Admin API: Failed to create maintenance", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	/**
	 * PUT /v1/admin/maintenances/:id
	 * Update maintenance metadata (title, scheduled_start/end, affected_monitors, suppress_notifications).
	 */
	app.put("/v1/admin/maintenances/:id", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;

		let body: any;
		try {
			body = await ctx.req.json();
		} catch (e: any) {
			return ctx.json({ error: e.message }, 400);
		}

		const errors = validateUpdate(body);
		if (errors.length) return ctx.json({ error: "Validation failed", details: errors }, 400);

		// Validate affected monitors if provided
		if (body.affected_monitors?.length) {
			const existing = await getMaintenanceById(id);
			if (!existing) return ctx.json({ error: "Maintenance not found" }, 404);

			const statusPage = cache.getStatusPage(existing.status_page_id);
			if (statusPage) {
				for (const monitorId of body.affected_monitors) {
					if (!cache.isItemOnStatusPage(statusPage.slug, monitorId)) {
						return ctx.json({ error: `Monitor or group '${monitorId}' is not on status page '${existing.status_page_id}'` }, 400);
					}
				}
			}
		}

		try {
			const maintenance = await updateMaintenance(id, {
				title: body.title,
				scheduledStart: body.scheduled_start,
				scheduledEnd: body.scheduled_end,
				affectedMonitors: body.affected_monitors,
				suppressNotifications: body.suppress_notifications,
			});

			if (!maintenance) return ctx.json({ error: "Maintenance not found" }, 404);

			Logger.audit("Admin API: Maintenance updated", { maintenanceId: id });

			maintenanceScheduler.refreshCache();

			const statusPage = cache.getStatusPage(maintenance.status_page_id);
			if (statusPage) {
				broadcastMaintenanceEvent(statusPage.slug, "maintenance-updated", { maintenance });
			}

			return ctx.json({ success: true, message: `Maintenance '${id}' updated`, maintenance });
		} catch (e: any) {
			Logger.error("Admin API: Failed to update maintenance", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	/**
	 * DELETE /v1/admin/maintenances/:id
	 * Delete a maintenance and all its updates.
	 */
	app.delete("/v1/admin/maintenances/:id", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;

		const existing = await getMaintenanceById(id);
		if (!existing) return ctx.json({ error: "Maintenance not found" }, 404);

		try {
			const deleted = await deleteMaintenance(id);
			if (!deleted) return ctx.json({ error: "Failed to delete maintenance" }, 500);

			Logger.audit("Admin API: Maintenance deleted", { maintenanceId: id });

			maintenanceScheduler.refreshCache();

			const statusPage = cache.getStatusPage(existing.status_page_id);
			if (statusPage) {
				broadcastMaintenanceEvent(statusPage.slug, "maintenance-deleted", { maintenanceId: id });
			}

			return ctx.json({ success: true, message: `Maintenance '${id}' deleted` });
		} catch (e: any) {
			Logger.error("Admin API: Failed to delete maintenance", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	/**
	 * POST /v1/admin/maintenances/:id/updates
	 * Add a timeline update. Also updates the parent maintenance's status.
	 */
	app.post("/v1/admin/maintenances/:id/updates", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;

		let body: any;
		try {
			body = await ctx.req.json();
		} catch (e: any) {
			return ctx.json({ error: e.message }, 400);
		}

		const errors = validateAddUpdate(body);
		if (errors.length) return ctx.json({ error: "Validation failed", details: errors }, 400);

		try {
			const result = await addMaintenanceUpdate(id, {
				status: body.status,
				message: body.message,
			});

			if (!result) return ctx.json({ error: "Maintenance not found" }, 404);

			Logger.audit("Admin API: Maintenance update added", { maintenanceId: id, updateId: result.update.id, status: body.status });

			maintenanceScheduler.refreshCache();

			const statusPage = cache.getStatusPage(result.maintenance.status_page_id);
			if (statusPage) {
				broadcastMaintenanceEvent(statusPage.slug, "maintenance-update-added", {
					maintenance: result.maintenance,
					update: result.update,
				});
			}

			return ctx.json(
				{
					success: true,
					message: `Update added to maintenance '${id}'`,
					updateId: result.update.id,
					maintenance: result.maintenance,
				},
				201,
			);
		} catch (e: any) {
			Logger.error("Admin API: Failed to add maintenance update", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	/**
	 * DELETE /v1/admin/maintenances/:id/updates/:updateId
	 * Delete a specific timeline update.
	 */
	app.delete("/v1/admin/maintenances/:id/updates/:updateId", adminBearerAuth(), async (ctx) => {
		const maintenanceId = ctx.params["id"]!;
		const updateId = ctx.params["updateId"]!;

		try {
			const updatedMaintenance = await deleteMaintenanceUpdate(maintenanceId, updateId);
			if (!updatedMaintenance) return ctx.json({ error: "Maintenance or update not found" }, 404);

			Logger.audit("Admin API: Maintenance update deleted", { maintenanceId, updateId });

			maintenanceScheduler.refreshCache();

			const statusPage = cache.getStatusPage(updatedMaintenance.status_page_id);
			if (statusPage) {
				broadcastMaintenanceEvent(statusPage.slug, "maintenance-update-deleted", {
					maintenanceId,
					updateId,
					maintenance: updatedMaintenance,
				});
			}

			return ctx.json({ success: true, message: `Update '${updateId}' deleted from maintenance '${maintenanceId}'`, maintenance: updatedMaintenance });
		} catch (e: any) {
			Logger.error("Admin API: Failed to delete maintenance update", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});
}

function validateCreate(input: any): string[] {
	const e: string[] = [];
	if (!input.status_page_id || typeof input.status_page_id !== "string" || !input.status_page_id.trim()) {
		e.push("status_page_id is required");
	}
	if (!input.title || typeof input.title !== "string" || !input.title.trim()) {
		e.push("title is required");
	}
	if (!input.status || !VALID_MAINTENANCE_STATUSES.includes(input.status)) {
		e.push(`status must be one of: ${VALID_MAINTENANCE_STATUSES.join(", ")}`);
	}
	if (!input.scheduled_start || typeof input.scheduled_start !== "string" || !input.scheduled_start.trim()) {
		e.push("scheduled_start is required (ISO 8601 format)");
	}
	if (!input.scheduled_end || typeof input.scheduled_end !== "string" || !input.scheduled_end.trim()) {
		e.push("scheduled_end is required (ISO 8601 format)");
	}
	if (input.scheduled_start && input.scheduled_end) {
		const start = new Date(input.scheduled_start);
		const end = new Date(input.scheduled_end);
		if (isNaN(start.getTime())) {
			e.push("scheduled_start must be a valid ISO 8601 date");
		}
		if (isNaN(end.getTime())) {
			e.push("scheduled_end must be a valid ISO 8601 date");
		}
		if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end <= start) {
			e.push("scheduled_end must be after scheduled_start");
		}
	}
	if (!input.message || typeof input.message !== "string" || !input.message.trim()) {
		e.push("message is required (initial update message)");
	}
	if (input.affected_monitors !== undefined) {
		if (!Array.isArray(input.affected_monitors)) {
			e.push("affected_monitors must be an array of strings");
		} else if (input.affected_monitors.some((m: any) => typeof m !== "string")) {
			e.push("affected_monitors must be an array of strings");
		}
	}
	if (input.suppress_notifications !== undefined && typeof input.suppress_notifications !== "boolean") {
		e.push("suppress_notifications must be a boolean");
	}
	return e;
}

function validateUpdate(input: any): string[] {
	const e: string[] = [];
	if (input.title !== undefined && (typeof input.title !== "string" || !input.title.trim())) {
		e.push("title must be a non-empty string");
	}
	if (input.status !== undefined) {
		e.push("status cannot be changed directly; add an update via POST /v1/admin/maintenances/:id/updates");
	}
	if (input.scheduled_start !== undefined) {
		const start = new Date(input.scheduled_start);
		if (isNaN(start.getTime())) {
			e.push("scheduled_start must be a valid ISO 8601 date");
		}
	}
	if (input.scheduled_end !== undefined) {
		const end = new Date(input.scheduled_end);
		if (isNaN(end.getTime())) {
			e.push("scheduled_end must be a valid ISO 8601 date");
		}
	}
	if (input.scheduled_start !== undefined && input.scheduled_end !== undefined) {
		const start = new Date(input.scheduled_start);
		const end = new Date(input.scheduled_end);
		if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end <= start) {
			e.push("scheduled_end must be after scheduled_start");
		}
	}
	if (input.affected_monitors !== undefined) {
		if (!Array.isArray(input.affected_monitors)) {
			e.push("affected_monitors must be an array of strings");
		} else if (input.affected_monitors.some((m: any) => typeof m !== "string")) {
			e.push("affected_monitors must be an array of strings");
		}
	}
	if (input.suppress_notifications !== undefined && typeof input.suppress_notifications !== "boolean") {
		e.push("suppress_notifications must be a boolean");
	}
	return e;
}

function validateAddUpdate(input: any): string[] {
	const e: string[] = [];
	if (!input.status || !VALID_MAINTENANCE_STATUSES.includes(input.status)) {
		e.push(`status must be one of: ${VALID_MAINTENANCE_STATUSES.join(", ")}`);
	}
	if (!input.message || typeof input.message !== "string" || !input.message.trim()) {
		e.push("message is required");
	}
	return e;
}
