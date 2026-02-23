import type { Web, Server } from "@rabbit-company/web";
import { cache } from "../cache";
import { Logger } from "../logger";
import { adminBearerAuth } from "./helpers";
import {
	getAllIncidents,
	getIncidentById,
	createIncident,
	updateIncident,
	addIncidentUpdate,
	deleteIncident,
	deleteIncidentUpdate,
	broadcastIncidentEvent,
} from "../incidents";
import { VALID_SEVERITIES, VALID_STATUSES } from "../types";

export function registerIncidentRoutes(app: Web, getServer: () => Server): void {
	/**
	 * GET /v1/admin/incidents
	 * List all incidents. Optionally filter by ?status_page_id=
	 */
	app.get("/v1/admin/incidents", adminBearerAuth(), async (ctx) => {
		const statusPageId = ctx.query().get("status_page_id") || undefined;

		const incidents = await getAllIncidents(statusPageId);
		return ctx.json({ incidents });
	});

	/**
	 * GET /v1/admin/incidents/:id
	 * Get a single incident with all updates.
	 */
	app.get("/v1/admin/incidents/:id", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;
		const incident = await getIncidentById(id);
		if (!incident) return ctx.json({ error: "Incident not found" }, 404);
		return ctx.json(incident);
	});

	/**
	 * POST /v1/admin/incidents
	 * Create a new incident with an initial update message.
	 */
	app.post("/v1/admin/incidents", adminBearerAuth(), async (ctx) => {
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
			const incident = await createIncident({
				statusPageId: body.status_page_id,
				title: body.title,
				status: body.status,
				severity: body.severity,
				message: body.message,
				affectedMonitors: body.affected_monitors,
			});

			Logger.audit("Admin API: Incident created", { incidentId: incident.id, statusPageId: body.status_page_id });

			// Broadcast to WebSocket subscribers
			broadcastIncidentEvent(statusPage.slug, "incident-created", { incident });

			return ctx.json({ success: true, message: `Incident '${incident.id}' created`, id: incident.id, incident }, 201);
		} catch (e: any) {
			Logger.error("Admin API: Failed to create incident", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	/**
	 * PUT /v1/admin/incidents/:id
	 * Update incident metadata (title, severity, affected_monitors).
	 */
	app.put("/v1/admin/incidents/:id", adminBearerAuth(), async (ctx) => {
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
			const existing = await getIncidentById(id);
			if (!existing) return ctx.json({ error: "Incident not found" }, 404);

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
			const incident = await updateIncident(id, {
				title: body.title,
				severity: body.severity,
				affectedMonitors: body.affected_monitors,
			});

			if (!incident) return ctx.json({ error: "Incident not found" }, 404);

			Logger.audit("Admin API: Incident updated", { incidentId: id });

			// Broadcast
			const statusPage = cache.getStatusPage(incident.status_page_id);
			if (statusPage) {
				broadcastIncidentEvent(statusPage.slug, "incident-updated", { incident });
			}

			return ctx.json({ success: true, message: `Incident '${id}' updated`, incident });
		} catch (e: any) {
			Logger.error("Admin API: Failed to update incident", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	/**
	 * DELETE /v1/admin/incidents/:id
	 * Delete an incident and all its updates.
	 */
	app.delete("/v1/admin/incidents/:id", adminBearerAuth(), async (ctx) => {
		const id = ctx.params["id"]!;

		const existing = await getIncidentById(id);
		if (!existing) return ctx.json({ error: "Incident not found" }, 404);

		try {
			const deleted = await deleteIncident(id);
			if (!deleted) return ctx.json({ error: "Failed to delete incident" }, 500);

			Logger.audit("Admin API: Incident deleted", { incidentId: id });

			// Broadcast
			const statusPage = cache.getStatusPage(existing.status_page_id);
			if (statusPage) {
				broadcastIncidentEvent(statusPage.slug, "incident-deleted", { incidentId: id });
			}

			return ctx.json({ success: true, message: `Incident '${id}' deleted` });
		} catch (e: any) {
			Logger.error("Admin API: Failed to delete incident", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	/**
	 * POST /v1/admin/incidents/:id/updates
	 * Add a timeline update. Also updates the parent incident's status.
	 */
	app.post("/v1/admin/incidents/:id/updates", adminBearerAuth(), async (ctx) => {
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
			const result = await addIncidentUpdate(id, {
				status: body.status,
				message: body.message,
			});

			if (!result) return ctx.json({ error: "Incident not found" }, 404);

			Logger.audit("Admin API: Incident update added", { incidentId: id, updateId: result.update.id, status: body.status });

			// Broadcast
			const statusPage = cache.getStatusPage(result.incident.status_page_id);
			if (statusPage) {
				broadcastIncidentEvent(statusPage.slug, "incident-update-added", {
					incident: result.incident,
					update: result.update,
				});
			}

			return ctx.json(
				{
					success: true,
					message: `Update added to incident '${id}'`,
					updateId: result.update.id,
					incident: result.incident,
				},
				201,
			);
		} catch (e: any) {
			Logger.error("Admin API: Failed to add incident update", { error: e.message });
			return ctx.json({ error: e.message }, 500);
		}
	});

	/**
	 * DELETE /v1/admin/incidents/:id/updates/:updateId
	 * Delete a specific timeline update.
	 */
	app.delete("/v1/admin/incidents/:id/updates/:updateId", adminBearerAuth(), async (ctx) => {
		const incidentId = ctx.params["id"]!;
		const updateId = ctx.params["updateId"]!;

		try {
			const updatedIncident = await deleteIncidentUpdate(incidentId, updateId);
			if (!updatedIncident) return ctx.json({ error: "Incident or update not found" }, 404);

			Logger.audit("Admin API: Incident update deleted", { incidentId, updateId });

			// Broadcast
			const statusPage = cache.getStatusPage(updatedIncident.status_page_id);
			if (statusPage) {
				broadcastIncidentEvent(statusPage.slug, "incident-update-deleted", {
					incidentId,
					updateId,
					incident: updatedIncident,
				});
			}

			return ctx.json({ success: true, message: `Update '${updateId}' deleted from incident '${incidentId}'`, incident: updatedIncident });
		} catch (e: any) {
			Logger.error("Admin API: Failed to delete incident update", { error: e.message });
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
	if (!input.status || !VALID_STATUSES.includes(input.status)) {
		e.push(`status must be one of: ${VALID_STATUSES.join(", ")}`);
	}
	if (!input.severity || !VALID_SEVERITIES.includes(input.severity)) {
		e.push(`severity must be one of: ${VALID_SEVERITIES.join(", ")}`);
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
	return e;
}

function validateUpdate(input: any): string[] {
	const e: string[] = [];
	if (input.title !== undefined && (typeof input.title !== "string" || !input.title.trim())) {
		e.push("title must be a non-empty string");
	}
	if (input.severity !== undefined && !VALID_SEVERITIES.includes(input.severity)) {
		e.push(`severity must be one of: ${VALID_SEVERITIES.join(", ")}`);
	}
	if (input.status !== undefined) {
		e.push("status cannot be changed directly; add an update via POST /v1/admin/incidents/:id/updates");
	}
	if (input.affected_monitors !== undefined) {
		if (!Array.isArray(input.affected_monitors)) {
			e.push("affected_monitors must be an array of strings");
		} else if (input.affected_monitors.some((m: any) => typeof m !== "string")) {
			e.push("affected_monitors must be an array of strings");
		}
	}
	return e;
}

function validateAddUpdate(input: any): string[] {
	const e: string[] = [];
	if (!input.status || !VALID_STATUSES.includes(input.status)) {
		e.push(`status must be one of: ${VALID_STATUSES.join(", ")}`);
	}
	if (!input.message || typeof input.message !== "string" || !input.message.trim()) {
		e.push("message is required");
	}
	return e;
}
