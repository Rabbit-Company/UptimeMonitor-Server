export const adminMaintenancePaths = {
	"/v1/admin/maintenances": {
		get: {
			tags: ["Admin: Maintenances"],
			summary: "List all maintenances",
			description: "Returns all maintenances. Optionally filter by status_page_id query parameter.",
			operationId: "adminListMaintenances",
			security: [{ adminBearerAuth: [] }],
			parameters: [
				{
					name: "status_page_id",
					in: "query",
					required: false,
					description: "Filter maintenances by status page ID",
					schema: { type: "string" },
				},
			],
			responses: {
				"200": {
					description: "List of maintenances",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["maintenances"],
								properties: {
									maintenances: {
										type: "array",
										items: { $ref: "#/components/schemas/Maintenance" },
									},
								},
							},
						},
					},
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
		post: {
			tags: ["Admin: Maintenances"],
			summary: "Create a maintenance",
			description:
				"Create a new maintenance with an initial timeline update message. The maintenance is associated with a status page and optionally linked to affected monitors. Maintenances support automatic status transitions — the scheduler moves scheduled maintenances to in_progress when their start time arrives, and in_progress maintenances to completed when their end time passes.",
			operationId: "adminCreateMaintenance",
			security: [{ adminBearerAuth: [] }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/AdminMaintenanceCreate" },
					},
				},
			},
			responses: {
				"201": {
					description: "Maintenance created",
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									success: { type: "boolean", enum: [true] },
									message: { type: "string" },
									id: { type: "string" },
									maintenance: { $ref: "#/components/schemas/MaintenanceWithUpdates" },
								},
							},
						},
					},
				},
				"400": {
					description: "Validation failed",
					content: { "application/json": { schema: { $ref: "#/components/schemas/AdminValidationError" } } },
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Status page not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
	"/v1/admin/maintenances/{id}": {
		get: {
			tags: ["Admin: Maintenances"],
			summary: "Get a maintenance",
			description: "Returns a single maintenance with all its timeline updates.",
			operationId: "adminGetMaintenance",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Maintenance ID", schema: { type: "string" } }],
			responses: {
				"200": {
					description: "Maintenance details with updates",
					content: { "application/json": { schema: { $ref: "#/components/schemas/MaintenanceWithUpdates" } } },
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Maintenance not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
		put: {
			tags: ["Admin: Maintenances"],
			summary: "Update a maintenance",
			description:
				"Update maintenance metadata (title, scheduled_start, scheduled_end, affected_monitors, suppress_notifications). Status cannot be changed directly — use the updates endpoint to post a new timeline entry which changes the status.",
			operationId: "adminUpdateMaintenance",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Maintenance ID", schema: { type: "string" } }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/AdminMaintenanceUpdate" },
					},
				},
			},
			responses: {
				"200": {
					description: "Maintenance updated",
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									success: { type: "boolean", enum: [true] },
									message: { type: "string" },
									maintenance: { $ref: "#/components/schemas/MaintenanceWithUpdates" },
								},
							},
						},
					},
				},
				"400": {
					description: "Validation failed",
					content: { "application/json": { schema: { $ref: "#/components/schemas/AdminValidationError" } } },
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Maintenance not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
		delete: {
			tags: ["Admin: Maintenances"],
			summary: "Delete a maintenance",
			description: "Delete a maintenance and all its timeline updates.",
			operationId: "adminDeleteMaintenance",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Maintenance ID", schema: { type: "string" } }],
			responses: {
				"200": {
					description: "Maintenance deleted",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccess" },
							example: { success: true, message: "Maintenance 'abc123' deleted" },
						},
					},
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Maintenance not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
	"/v1/admin/maintenances/{id}/updates": {
		post: {
			tags: ["Admin: Maintenances"],
			summary: "Add a timeline update",
			description:
				"Add a timeline update to a maintenance. This also updates the parent maintenance's status and updated_at timestamp. If the new status is 'completed' or 'cancelled', the maintenance's completed_at is set.",
			operationId: "adminAddMaintenanceUpdate",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Maintenance ID", schema: { type: "string" } }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: {
							type: "object",
							required: ["status", "message"],
							properties: {
								status: {
									type: "string",
									enum: ["scheduled", "in_progress", "completed", "cancelled"],
									description: "New status for the maintenance",
								},
								message: { type: "string", description: "Update message body" },
							},
						},
					},
				},
			},
			responses: {
				"201": {
					description: "Update added",
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									success: { type: "boolean", enum: [true] },
									message: { type: "string" },
									updateId: { type: "string" },
									maintenance: { $ref: "#/components/schemas/MaintenanceWithUpdates" },
								},
							},
						},
					},
				},
				"400": {
					description: "Validation failed",
					content: { "application/json": { schema: { $ref: "#/components/schemas/AdminValidationError" } } },
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Maintenance not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
	"/v1/admin/maintenances/{id}/updates/{updateId}": {
		delete: {
			tags: ["Admin: Maintenances"],
			summary: "Delete a timeline update",
			description:
				"Delete a specific timeline update from a maintenance. If the deleted update was the most recent one, the maintenance's status and completed_at are synced to match the new most-recent update.",
			operationId: "adminDeleteMaintenanceUpdate",
			security: [{ adminBearerAuth: [] }],
			parameters: [
				{ name: "id", in: "path", required: true, description: "Maintenance ID", schema: { type: "string" } },
				{ name: "updateId", in: "path", required: true, description: "Update ID to delete", schema: { type: "string" } },
			],
			responses: {
				"200": {
					description: "Update deleted",
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									success: { type: "boolean", enum: [true] },
									message: { type: "string" },
									maintenance: { $ref: "#/components/schemas/MaintenanceWithUpdates" },
								},
							},
						},
					},
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Maintenance or update not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
} as const;
