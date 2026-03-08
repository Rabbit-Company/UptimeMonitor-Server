export const adminIncidentPaths = {
	"/v1/admin/incidents": {
		get: {
			tags: ["Admin: Incidents"],
			summary: "List all incidents",
			description: "Returns all incidents. Optionally filter by status_page_id query parameter.",
			operationId: "adminListIncidents",
			security: [{ adminBearerAuth: [] }],
			parameters: [
				{
					name: "status_page_id",
					in: "query",
					required: false,
					description: "Filter incidents by status page ID",
					schema: { type: "string" },
				},
			],
			responses: {
				"200": {
					description: "List of incidents",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["incidents"],
								properties: {
									incidents: {
										type: "array",
										items: { $ref: "#/components/schemas/Incident" },
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
			tags: ["Admin: Incidents"],
			summary: "Create an incident",
			description:
				"Create a new incident with an initial timeline update message. The incident is associated with a status page and optionally linked to affected monitors.",
			operationId: "adminCreateIncident",
			security: [{ adminBearerAuth: [] }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/AdminIncidentCreate" },
					},
				},
			},
			responses: {
				"201": {
					description: "Incident created",
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									success: { type: "boolean", enum: [true] },
									message: { type: "string" },
									id: { type: "string" },
									incident: { $ref: "#/components/schemas/IncidentWithUpdates" },
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
	"/v1/admin/incidents/{id}": {
		get: {
			tags: ["Admin: Incidents"],
			summary: "Get an incident",
			description: "Returns a single incident with all its timeline updates.",
			operationId: "adminGetIncident",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Incident ID", schema: { type: "string" } }],
			responses: {
				"200": {
					description: "Incident details with updates",
					content: { "application/json": { schema: { $ref: "#/components/schemas/IncidentWithUpdates" } } },
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Incident not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
		put: {
			tags: ["Admin: Incidents"],
			summary: "Update an incident",
			description:
				"Update incident metadata (title, severity, affected_monitors). Status cannot be changed directly - use the updates endpoint to post a new timeline entry which changes the status.",
			operationId: "adminUpdateIncident",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Incident ID", schema: { type: "string" } }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/AdminIncidentUpdate" },
					},
				},
			},
			responses: {
				"200": {
					description: "Incident updated",
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									success: { type: "boolean", enum: [true] },
									message: { type: "string" },
									incident: { $ref: "#/components/schemas/IncidentWithUpdates" },
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
					description: "Incident not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
		delete: {
			tags: ["Admin: Incidents"],
			summary: "Delete an incident",
			description: "Delete an incident and all its timeline updates.",
			operationId: "adminDeleteIncident",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Incident ID", schema: { type: "string" } }],
			responses: {
				"200": {
					description: "Incident deleted",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccess" },
							example: { success: true, message: "Incident 'abc123' deleted" },
						},
					},
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Incident not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
	"/v1/admin/incidents/{id}/updates": {
		post: {
			tags: ["Admin: Incidents"],
			summary: "Add a timeline update",
			description:
				"Add a timeline update to an incident. This also updates the parent incident's status and updated_at timestamp. If the new status is 'resolved', the incident's resolved_at is set.",
			operationId: "adminAddIncidentUpdate",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Incident ID", schema: { type: "string" } }],
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
									enum: ["investigating", "identified", "monitoring", "resolved"],
									description: "New status for the incident",
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
									incident: { $ref: "#/components/schemas/IncidentWithUpdates" },
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
					description: "Incident not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
	"/v1/admin/incidents/{id}/updates/{updateId}": {
		delete: {
			tags: ["Admin: Incidents"],
			summary: "Delete a timeline update",
			description: "Delete a specific timeline update from an incident.",
			operationId: "adminDeleteIncidentUpdate",
			security: [{ adminBearerAuth: [] }],
			parameters: [
				{ name: "id", in: "path", required: true, description: "Incident ID", schema: { type: "string" } },
				{ name: "updateId", in: "path", required: true, description: "Update ID", schema: { type: "string" } },
			],
			responses: {
				"200": {
					description: "Update deleted",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccess" },
							example: { success: true, message: "Update 'xyz789' deleted from incident 'abc123'" },
						},
					},
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Incident update not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
} as const;
