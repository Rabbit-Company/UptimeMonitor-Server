export const adminMonitorPaths = {
	"/v1/admin/monitors": {
		get: {
			tags: ["Admin: Monitors"],
			summary: "List all monitors",
			description: "Returns all configured monitors.",
			operationId: "adminListMonitors",
			security: [{ adminBearerAuth: [] }],
			responses: {
				"200": {
					description: "List of monitors",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["monitors"],
								properties: {
									monitors: {
										type: "array",
										items: { $ref: "#/components/schemas/AdminMonitor" },
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
			tags: ["Admin: Monitors"],
			summary: "Create a monitor",
			description: "Create a new monitor. The configuration is validated, written to config.toml, and hot-reloaded.",
			operationId: "adminCreateMonitor",
			security: [{ adminBearerAuth: [] }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/AdminMonitorCreate" },
					},
				},
			},
			responses: {
				"201": {
					description: "Monitor created",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccessWithId" },
							example: { success: true, message: "Monitor 'api-staging' created", id: "api-staging" },
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
				"409": {
					description: "Conflict - duplicate monitor ID, group ID collision, or duplicate token",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"500": {
					description: "Internal error - config write or reload failed",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
	"/v1/admin/monitors/{id}": {
		get: {
			tags: ["Admin: Monitors"],
			summary: "Get a monitor",
			description: "Returns a single monitor by ID.",
			operationId: "adminGetMonitor",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Monitor ID", schema: { type: "string" } }],
			responses: {
				"200": {
					description: "Monitor details",
					content: { "application/json": { schema: { $ref: "#/components/schemas/AdminMonitor" } } },
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Monitor not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Monitor not found" } } },
				},
			},
		},
		put: {
			tags: ["Admin: Monitors"],
			summary: "Update a monitor",
			description: "Partially update a monitor. Send only the fields to change. Set a field to null to remove it. The id field cannot be changed.",
			operationId: "adminUpdateMonitor",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Monitor ID", schema: { type: "string" } }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/AdminMonitorUpdate" },
					},
				},
			},
			responses: {
				"200": {
					description: "Monitor updated",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccess" },
							example: { success: true, message: "Monitor 'api-staging' updated" },
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
					description: "Monitor not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"409": {
					description: "Conflict - duplicate token",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"500": {
					description: "Internal error",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
		delete: {
			tags: ["Admin: Monitors"],
			summary: "Delete a monitor",
			description: "Delete a monitor. References in status page items are automatically cleaned up.",
			operationId: "adminDeleteMonitor",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Monitor ID", schema: { type: "string" } }],
			responses: {
				"200": {
					description: "Monitor deleted",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccess" },
							example: { success: true, message: "Monitor 'api-staging' deleted" },
						},
					},
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Monitor not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"500": {
					description: "Internal error",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
	"/v1/admin/groups": {
		get: {
			tags: ["Admin: Groups"],
			summary: "List all groups",
			description: "Returns all configured groups.",
			operationId: "adminListGroups",
			security: [{ adminBearerAuth: [] }],
			responses: {
				"200": {
					description: "List of groups",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["groups"],
								properties: {
									groups: {
										type: "array",
										items: { $ref: "#/components/schemas/AdminGroup" },
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
			tags: ["Admin: Groups"],
			summary: "Create a group",
			description: "Create a new group. The configuration is validated, written to config.toml, and hot-reloaded.",
			operationId: "adminCreateGroup",
			security: [{ adminBearerAuth: [] }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/AdminGroupCreate" },
					},
				},
			},
			responses: {
				"201": {
					description: "Group created",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccessWithId" },
							example: { success: true, message: "Group 'eu-services' created", id: "eu-services" },
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
				"409": {
					description: "Conflict - duplicate group ID or monitor ID collision",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"500": {
					description: "Internal error",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
	"/v1/admin/groups/{id}": {
		get: {
			tags: ["Admin: Groups"],
			summary: "Get a group",
			description: "Returns a single group by ID.",
			operationId: "adminGetGroup",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Group ID", schema: { type: "string" } }],
			responses: {
				"200": {
					description: "Group details",
					content: { "application/json": { schema: { $ref: "#/components/schemas/AdminGroup" } } },
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Group not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Group not found" } } },
				},
			},
		},
		put: {
			tags: ["Admin: Groups"],
			summary: "Update a group",
			description: "Partially update a group. Send only the fields to change. Set a field to null to remove it. The id field cannot be changed.",
			operationId: "adminUpdateGroup",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Group ID", schema: { type: "string" } }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/AdminGroupUpdate" },
					},
				},
			},
			responses: {
				"200": {
					description: "Group updated",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccess" },
							example: { success: true, message: "Group 'eu-services' updated" },
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
					description: "Group not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"500": {
					description: "Internal error",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
		delete: {
			tags: ["Admin: Groups"],
			summary: "Delete a group",
			description: "Delete a group. References are automatically cleaned up.",
			operationId: "adminDeleteGroup",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Group ID", schema: { type: "string" } }],
			responses: {
				"200": {
					description: "Group deleted",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccess" },
							example: { success: true, message: "Group 'eu-services' deleted" },
						},
					},
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Group not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"500": {
					description: "Internal error",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
} as const;
