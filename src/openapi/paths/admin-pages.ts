export const adminPagePaths = {
	"/v1/admin/status-pages": {
		get: {
			tags: ["Admin: Status Pages"],
			summary: "List all status pages",
			description: "Returns all configured status pages.",
			operationId: "adminListStatusPages",
			security: [{ adminBearerAuth: [] }],
			responses: {
				"200": {
					description: "List of status pages",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["statusPages"],
								properties: {
									statusPages: {
										type: "array",
										items: { $ref: "#/components/schemas/AdminStatusPage" },
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
			tags: ["Admin: Status Pages"],
			summary: "Create a status page",
			description: "Create a new status page. The slug must be unique across all status pages.",
			operationId: "adminCreateStatusPage",
			security: [{ adminBearerAuth: [] }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/AdminStatusPageCreate" },
					},
				},
			},
			responses: {
				"201": {
					description: "Status page created",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccessWithId" },
							example: { success: true, message: "Status page 'partners' created", id: "partners" },
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
					description: "Conflict - duplicate status page ID or slug already in use",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"500": {
					description: "Internal error",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
	"/v1/admin/status-pages/{id}": {
		get: {
			tags: ["Admin: Status Pages"],
			summary: "Get a status page",
			description: "Returns a single status page by ID.",
			operationId: "adminGetStatusPage",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Status page ID", schema: { type: "string" } }],
			responses: {
				"200": {
					description: "Status page details",
					content: { "application/json": { schema: { $ref: "#/components/schemas/AdminStatusPage" } } },
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Status page not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Status page not found" } } },
				},
			},
		},
		put: {
			tags: ["Admin: Status Pages"],
			summary: "Update a status page",
			description: "Partially update a status page. The id field cannot be changed. If changing the slug, it must not conflict with another status page.",
			operationId: "adminUpdateStatusPage",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Status page ID", schema: { type: "string" } }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/AdminStatusPageUpdate" },
					},
				},
			},
			responses: {
				"200": {
					description: "Status page updated",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccess" },
							example: { success: true, message: "Status page 'partners' updated" },
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
				"409": {
					description: "Conflict - slug already in use",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"500": {
					description: "Internal error",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
		delete: {
			tags: ["Admin: Status Pages"],
			summary: "Delete a status page",
			description: "Delete a status page.",
			operationId: "adminDeleteStatusPage",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Status page ID", schema: { type: "string" } }],
			responses: {
				"200": {
					description: "Status page deleted",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccess" },
							example: { success: true, message: "Status page 'partners' deleted" },
						},
					},
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Status page not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"500": {
					description: "Internal error",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
	"/v1/admin/notifications": {
		get: {
			tags: ["Admin: Notifications"],
			summary: "List all notification channels",
			description: "Returns all configured notification channels.",
			operationId: "adminListNotifications",
			security: [{ adminBearerAuth: [] }],
			responses: {
				"200": {
					description: "List of notification channels",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["notificationChannels"],
								properties: {
									notificationChannels: {
										type: "array",
										items: { $ref: "#/components/schemas/AdminNotificationChannel" },
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
			tags: ["Admin: Notifications"],
			summary: "Create a notification channel",
			description:
				"Create a new notification channel with one or more providers (Discord, Email, Ntfy, Telegram, Webhook). At least one provider should be configured.",
			operationId: "adminCreateNotification",
			security: [{ adminBearerAuth: [] }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/AdminNotificationChannelCreate" },
					},
				},
			},
			responses: {
				"201": {
					description: "Notification channel created",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccessWithId" },
							example: { success: true, message: "Channel 'ops-alerts' created", id: "ops-alerts" },
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
					description: "Conflict - duplicate channel ID",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"500": {
					description: "Internal error",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
	"/v1/admin/notifications/{id}": {
		get: {
			tags: ["Admin: Notifications"],
			summary: "Get a notification channel",
			description: "Returns a single notification channel by ID.",
			operationId: "adminGetNotification",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Notification channel ID", schema: { type: "string" } }],
			responses: {
				"200": {
					description: "Notification channel details",
					content: { "application/json": { schema: { $ref: "#/components/schemas/AdminNotificationChannel" } } },
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Notification channel not found",
					content: {
						"application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "Notification channel not found" } },
					},
				},
			},
		},
		put: {
			tags: ["Admin: Notifications"],
			summary: "Update a notification channel",
			description: "Partially update a notification channel. Set a provider to null to remove it. The id field cannot be changed.",
			operationId: "adminUpdateNotification",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Notification channel ID", schema: { type: "string" } }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/AdminNotificationChannelUpdate" },
					},
				},
			},
			responses: {
				"200": {
					description: "Notification channel updated",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccess" },
							example: { success: true, message: "Channel 'ops-alerts' updated" },
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
					description: "Notification channel not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"500": {
					description: "Internal error",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
		delete: {
			tags: ["Admin: Notifications"],
			summary: "Delete a notification channel",
			description: "Delete a notification channel. References in monitor and group notificationChannels arrays are automatically cleaned up.",
			operationId: "adminDeleteNotification",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "Notification channel ID", schema: { type: "string" } }],
			responses: {
				"200": {
					description: "Notification channel deleted",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccess" },
							example: { success: true, message: "Channel 'ops-alerts' deleted" },
						},
					},
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "Notification channel not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"500": {
					description: "Internal error",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
	"/v1/admin/pulse-monitors": {
		get: {
			tags: ["Admin: Pulse Monitors"],
			summary: "List all PulseMonitors",
			description: "Returns all configured PulseMonitor instances.",
			operationId: "adminListPulseMonitors",
			security: [{ adminBearerAuth: [] }],
			responses: {
				"200": {
					description: "List of PulseMonitors",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["pulseMonitors"],
								properties: {
									pulseMonitors: {
										type: "array",
										items: { $ref: "#/components/schemas/AdminPulseMonitor" },
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
			tags: ["Admin: Pulse Monitors"],
			summary: "Create a PulseMonitor",
			description: "Create a new PulseMonitor instance. Both the ID and token must be unique.",
			operationId: "adminCreatePulseMonitor",
			security: [{ adminBearerAuth: [] }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/AdminPulseMonitorCreate" },
					},
				},
			},
			responses: {
				"201": {
					description: "PulseMonitor created",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccessWithId" },
							example: { success: true, message: "PulseMonitor 'AP-EAST-1' created", id: "AP-EAST-1" },
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
					description: "Conflict - duplicate PulseMonitor ID or token",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"500": {
					description: "Internal error",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
			},
		},
	},
	"/v1/admin/pulse-monitors/{id}": {
		get: {
			tags: ["Admin: Pulse Monitors"],
			summary: "Get a PulseMonitor",
			description: "Returns a single PulseMonitor by ID.",
			operationId: "adminGetPulseMonitor",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "PulseMonitor ID", schema: { type: "string" } }],
			responses: {
				"200": {
					description: "PulseMonitor details",
					content: { "application/json": { schema: { $ref: "#/components/schemas/AdminPulseMonitor" } } },
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "PulseMonitor not found",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" }, example: { error: "PulseMonitor not found" } } },
				},
			},
		},
		put: {
			tags: ["Admin: Pulse Monitors"],
			summary: "Update a PulseMonitor",
			description: "Partially update a PulseMonitor. The id field cannot be changed. If changing the token, it must not conflict with another PulseMonitor.",
			operationId: "adminUpdatePulseMonitor",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "PulseMonitor ID", schema: { type: "string" } }],
			requestBody: {
				required: true,
				content: {
					"application/json": {
						schema: { $ref: "#/components/schemas/AdminPulseMonitorUpdate" },
					},
				},
			},
			responses: {
				"200": {
					description: "PulseMonitor updated",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccess" },
							example: { success: true, message: "PulseMonitor 'AP-EAST-1' updated" },
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
					description: "PulseMonitor not found",
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
			tags: ["Admin: Pulse Monitors"],
			summary: "Delete a PulseMonitor",
			description: "Delete a PulseMonitor. References in monitor pulseMonitors arrays are automatically cleaned up.",
			operationId: "adminDeletePulseMonitor",
			security: [{ adminBearerAuth: [] }],
			parameters: [{ name: "id", in: "path", required: true, description: "PulseMonitor ID", schema: { type: "string" } }],
			responses: {
				"200": {
					description: "PulseMonitor deleted",
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/AdminSuccess" },
							example: { success: true, message: "PulseMonitor 'AP-EAST-1' deleted" },
						},
					},
				},
				"401": {
					description: "Unauthorized",
					content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
				},
				"404": {
					description: "PulseMonitor not found",
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
