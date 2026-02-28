export const openapi = {
	openapi: "3.1.0",
	info: {
		title: "UptimeMonitor Server API",
		description: "API for UptimeMonitor Server - a push-based uptime monitoring system with status pages, history tracking, and real-time WebSocket updates.",
		version: "0.4.0",
		license: {
			name: "GPL-3.0",
			url: "https://github.com/Rabbit-Company/UptimeMonitor-Server/blob/main/LICENSE",
		},
		contact: {
			name: "Rabbit Company",
			url: "https://rabbit-company.com",
			email: "info@rabbit-company.com",
		},
	},
	tags: [
		{ name: "Health", description: "Server health check endpoints" },
		{ name: "Pulse", description: "Push heartbeat pulses for monitors" },
		{ name: "Status Pages", description: "Public-facing status page data" },
		{ name: "Monitor History", description: "Historical data for individual monitors" },
		{ name: "Group History", description: "Historical data for monitor groups" },
		{ name: "Monitor Reports", description: "Export monitor history data as CSV or JSON" },
		{ name: "Group Reports", description: "Export group history data as CSV or JSON" },
		{ name: "Incidents", description: "Incident reports for status pages" },
		{ name: "Configuration", description: "Server configuration management" },
		{ name: "Admin: Monitors", description: "Admin CRUD operations for monitors" },
		{ name: "Admin: Groups", description: "Admin CRUD operations for groups" },
		{ name: "Admin: Status Pages", description: "Admin CRUD operations for status pages" },
		{ name: "Admin: Notifications", description: "Admin CRUD operations for notification channels" },
		{ name: "Admin: Pulse Monitors", description: "Admin CRUD operations for PulseMonitor instances" },
		{ name: "Admin: Reports", description: "Admin export endpoints for monitor and group history data" },
		{ name: "Admin: Incidents", description: "Admin CRUD operations for incidents" },
		{ name: "Admin: Configuration", description: "Admin configuration access" },
	],
	paths: {
		"/health": {
			get: {
				tags: ["Health"],
				summary: "Health check",
				description: "Check if the server is running.",
				operationId: "getHealth",
				responses: {
					"200": {
						description: "Server is healthy",
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["status", "timestamp", "pendingWebSockets"],
									properties: {
										status: { type: "string", enum: ["ok"], example: "ok" },
										timestamp: { type: "string", format: "date-time", example: "2025-01-15T10:30:00.000Z" },
										pendingWebSockets: { type: "integer", description: "Number of pending WebSocket connections", example: 5 },
									},
								},
							},
						},
					},
				},
			},
		},
		"/v1/health/missing-pulse-detector": {
			get: {
				tags: ["Health"],
				summary: "Missing pulse detector status",
				description: "Get the current status of the missing pulse detector, including which monitors have missing pulses.",
				operationId: "getMissingPulseDetectorStatus",
				responses: {
					"200": {
						description: "Missing pulse detector status",
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["running", "checkInterval", "monitorsWithMissingPulses"],
									properties: {
										running: { type: "boolean", description: "Whether the detector is currently running", example: true },
										checkInterval: { type: "integer", description: "Check interval in milliseconds", example: 5000 },
										monitorsWithMissingPulses: {
											type: "array",
											items: {
												type: "object",
												required: ["monitorId", "monitorName", "missedCount", "maxRetries", "consecutiveDownCount", "resendNotification", "actualDowntime"],
												properties: {
													monitorId: { type: "string", example: "api-staging" },
													monitorName: { type: "string", example: "Staging API" },
													missedCount: { type: "integer", example: 3 },
													maxRetries: { type: "integer", example: 2 },
													consecutiveDownCount: { type: "integer", example: 1 },
													resendNotification: { type: "integer", example: 12 },
													actualDowntime: { type: "integer", description: "Downtime in milliseconds", example: 45000 },
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
		"/v1/push/{token}": {
			get: {
				tags: ["Pulse"],
				summary: "Send heartbeat pulse",
				description:
					"Send a heartbeat pulse for a monitor. Supports optional latency, timing parameters, and custom metrics. Rate limited to 60 requests per token with 12/sec refill.",
				operationId: "pushPulse",
				parameters: [
					{
						name: "token",
						in: "path",
						required: true,
						description: "Monitor's secret token",
						schema: { type: "string" },
					},
					{
						name: "latency",
						in: "query",
						required: false,
						description: "Response time in milliseconds (max: 600000)",
						schema: { type: "number", minimum: 0, maximum: 600000 },
					},
					{
						name: "startTime",
						in: "query",
						required: false,
						description: "Check start time (ISO 8601 string or Unix timestamp in milliseconds)",
						schema: { oneOf: [{ type: "string", format: "date-time" }, { type: "number" }] },
					},
					{
						name: "endTime",
						in: "query",
						required: false,
						description: "Check end time (ISO 8601 string or Unix timestamp in milliseconds)",
						schema: { oneOf: [{ type: "string", format: "date-time" }, { type: "number" }] },
					},
					{
						name: "custom1",
						in: "query",
						required: false,
						description: "Custom metric 1 value",
						schema: { type: "number" },
					},
					{
						name: "custom2",
						in: "query",
						required: false,
						description: "Custom metric 2 value",
						schema: { type: "number" },
					},
					{
						name: "custom3",
						in: "query",
						required: false,
						description: "Custom metric 3 value",
						schema: { type: "number" },
					},
				],
				responses: {
					"200": {
						description: "Pulse received successfully",
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["success", "monitorId"],
									properties: {
										success: { type: "boolean", enum: [true] },
										monitorId: { type: "string", example: "my-monitor" },
									},
								},
							},
						},
					},
					"400": {
						description: "Invalid parameters",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
								examples: {
									invalidLatency: { value: { error: "Invalid latency" } },
									invalidStartTime: { value: { error: "Invalid startTime format" } },
									timestampFuture: { value: { error: "Timestamp too far in the future" } },
									timestampPast: { value: { error: "Timestamp too far in the past" } },
								},
							},
						},
					},
					"401": {
						description: "Invalid token",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
								example: { error: "Invalid token" },
							},
						},
					},
					"429": {
						description: "Rate limit exceeded (60 requests per token, refills 12/sec)",
					},
					"503": {
						description: "Failed to store pulse",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
								example: { error: "Failed to store pulse" },
							},
						},
					},
				},
			},
		},
		"/v1/status/{slug}": {
			get: {
				tags: ["Status Pages"],
				summary: "Get full status page",
				description:
					"Get full status page data with all monitors and groups, including uptime percentages and custom metrics. Cached for 30 seconds. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
				operationId: "getStatusPage",
				security: [{ bearerAuth: [] }, {}],
				parameters: [
					{
						name: "slug",
						in: "path",
						required: true,
						description: "Status page URL slug",
						schema: { type: "string" },
					},
				],
				responses: {
					"200": {
						description: "Full status page data",
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["name", "slug", "items", "lastUpdated"],
									properties: {
										name: { type: "string", example: "Public Status" },
										slug: { type: "string", example: "status" },
										reports: { type: "boolean", example: false },
										items: {
											type: "array",
											items: { $ref: "#/components/schemas/StatusData" },
										},
										lastUpdated: { type: "string", format: "date-time" },
									},
								},
							},
						},
					},
					"401": {
						description: "Password required or invalid",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
					"404": {
						description: "Status page not found",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
								example: { error: "Status page not found" },
							},
						},
					},
				},
			},
		},
		"/v1/status/{slug}/summary": {
			get: {
				tags: ["Status Pages"],
				summary: "Get status page summary",
				description: "Get a quick overview of the status page without full monitor details. Cached for 30 seconds.",
				operationId: "getStatusPageSummary",
				security: [{ bearerAuth: [] }, {}],
				parameters: [
					{
						name: "slug",
						in: "path",
						required: true,
						description: "Status page URL slug",
						schema: { type: "string" },
					},
				],
				responses: {
					"200": {
						description: "Status page summary",
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["status", "monitors"],
									properties: {
										status: { type: "string", enum: ["up", "degraded", "down"], example: "up" },
										monitors: {
											type: "object",
											required: ["up", "degraded", "down", "total"],
											properties: {
												up: { type: "integer", example: 5 },
												degraded: { type: "integer", example: 1 },
												down: { type: "integer", example: 0 },
												total: { type: "integer", example: 6 },
											},
										},
									},
								},
							},
						},
					},
					"401": {
						description: "Password required or invalid",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
					"404": {
						description: "Status page not found",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
								example: { error: "Status page not found" },
							},
						},
					},
				},
			},
		},
		"/v1/status/{slug}/monitors/{id}/history": {
			get: {
				tags: ["Monitor History"],
				summary: "Get raw monitor history",
				description:
					"Returns all raw pulse data for a monitor within a status page. Data is retained for approximately 24 hours due to TTL. Cached for 30 seconds. The monitor must belong to the specified status page. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
				operationId: "getMonitorHistoryRaw",
				security: [{ bearerAuth: [] }, {}],
				parameters: [
					{
						name: "slug",
						in: "path",
						required: true,
						description: "Status page URL slug",
						schema: { type: "string" },
					},
					{
						name: "id",
						in: "path",
						required: true,
						description: "Monitor ID",
						schema: { type: "string" },
					},
				],
				responses: {
					"200": {
						description: "Raw monitor history data",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/MonitorHistory" },
							},
						},
					},
					"401": {
						description: "Password required or invalid",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
					"404": {
						description: "Status page not found or monitor not on this status page",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
				},
			},
		},
		"/v1/status/{slug}/monitors/{id}/history/hourly": {
			get: {
				tags: ["Monitor History"],
				summary: "Get hourly monitor history",
				description:
					"Returns hourly aggregated data for a monitor within a status page. Data is retained for approximately 90 days. Cached for 5 minutes. The monitor must belong to the specified status page. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
				operationId: "getMonitorHistoryHourly",
				security: [{ bearerAuth: [] }, {}],
				parameters: [
					{
						name: "slug",
						in: "path",
						required: true,
						description: "Status page URL slug",
						schema: { type: "string" },
					},
					{
						name: "id",
						in: "path",
						required: true,
						description: "Monitor ID",
						schema: { type: "string" },
					},
				],
				responses: {
					"200": {
						description: "Hourly aggregated monitor history",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/MonitorHistory" },
							},
						},
					},
					"401": {
						description: "Password required or invalid",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
					"404": {
						description: "Status page not found or monitor not on this status page",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
				},
			},
		},
		"/v1/status/{slug}/monitors/{id}/history/daily": {
			get: {
				tags: ["Monitor History"],
				summary: "Get daily monitor history",
				description:
					"Returns daily aggregated data for a monitor within a status page. Data is kept forever. Cached for 15 minutes. The monitor must belong to the specified status page. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
				operationId: "getMonitorHistoryDaily",
				security: [{ bearerAuth: [] }, {}],
				parameters: [
					{
						name: "slug",
						in: "path",
						required: true,
						description: "Status page URL slug",
						schema: { type: "string" },
					},
					{
						name: "id",
						in: "path",
						required: true,
						description: "Monitor ID",
						schema: { type: "string" },
					},
				],
				responses: {
					"200": {
						description: "Daily aggregated monitor history",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/MonitorHistory" },
							},
						},
					},
					"401": {
						description: "Password required or invalid",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
					"404": {
						description: "Status page not found or monitor not on this status page",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
				},
			},
		},
		"/v1/status/{slug}/groups/{id}/history": {
			get: {
				tags: ["Group History"],
				summary: "Get raw group history",
				description:
					"Returns raw group history computed from child monitors/groups within a status page. Data is retained for approximately 24 hours due to TTL. Cached for 30 seconds. The group must belong to the specified status page. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
				operationId: "getGroupHistoryRaw",
				security: [{ bearerAuth: [] }, {}],
				parameters: [
					{
						name: "slug",
						in: "path",
						required: true,
						description: "Status page URL slug",
						schema: { type: "string" },
					},
					{
						name: "id",
						in: "path",
						required: true,
						description: "Group ID",
						schema: { type: "string" },
					},
				],
				responses: {
					"200": {
						description: "Raw group history data",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/GroupHistory" },
							},
						},
					},
					"401": {
						description: "Password required or invalid",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
					"404": {
						description: "Status page not found or group not on this status page",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
				},
			},
		},
		"/v1/status/{slug}/groups/{id}/history/hourly": {
			get: {
				tags: ["Group History"],
				summary: "Get hourly group history",
				description:
					"Returns hourly aggregated group data within a status page. Data is retained for approximately 90 days. Cached for 5 minutes. The group must belong to the specified status page. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
				operationId: "getGroupHistoryHourly",
				security: [{ bearerAuth: [] }, {}],
				parameters: [
					{
						name: "slug",
						in: "path",
						required: true,
						description: "Status page URL slug",
						schema: { type: "string" },
					},
					{
						name: "id",
						in: "path",
						required: true,
						description: "Group ID",
						schema: { type: "string" },
					},
				],
				responses: {
					"200": {
						description: "Hourly aggregated group history",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/GroupHistory" },
							},
						},
					},
					"401": {
						description: "Password required or invalid",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
					"404": {
						description: "Status page not found or group not on this status page",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
				},
			},
		},
		"/v1/status/{slug}/groups/{id}/history/daily": {
			get: {
				tags: ["Group History"],
				summary: "Get daily group history",
				description:
					"Returns daily aggregated group data within a status page. Data is kept forever. Cached for 15 minutes. The group must belong to the specified status page. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
				operationId: "getGroupHistoryDaily",
				security: [{ bearerAuth: [] }, {}],
				parameters: [
					{
						name: "slug",
						in: "path",
						required: true,
						description: "Status page URL slug",
						schema: { type: "string" },
					},
					{
						name: "id",
						in: "path",
						required: true,
						description: "Group ID",
						schema: { type: "string" },
					},
				],
				responses: {
					"200": {
						description: "Daily aggregated group history",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/GroupHistory" },
							},
						},
					},
					"401": {
						description: "Password required or invalid",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
					"404": {
						description: "Status page not found or group not on this status page",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
							},
						},
					},
				},
			},
		},
		"/v1/status/{slug}/monitors/{id}/reports": {
			get: {
				tags: ["Monitor Reports"],
				summary: "Export raw monitor report",
				description:
					"Export raw pulse data for a monitor as CSV or JSON. Requires reports to be enabled on the status page. Data is retained for approximately 24 hours due to TTL. Cached for 30 seconds. If the status page is password-protected, authentication is required.",
				operationId: "getMonitorReportRaw",
				security: [{ bearerAuth: [] }, {}],
				parameters: [
					{ name: "slug", in: "path", required: true, description: "Status page URL slug", schema: { type: "string" } },
					{ name: "id", in: "path", required: true, description: "Monitor ID", schema: { type: "string" } },
					{
						name: "format",
						in: "query",
						required: false,
						description: "Response format. Defaults to JSON.",
						schema: { type: "string", enum: ["json", "csv"], default: "json" },
					},
				],
				responses: {
					"200": {
						description: "Raw monitor report data. Returns JSON (application/json) or CSV (text/csv) depending on the `format` parameter.",
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/MonitorHistory" } },
							"text/csv": { schema: { type: "string", description: "CSV file with headers and data rows" } },
						},
					},
					"401": {
						description: "Password required or invalid",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
					"404": {
						description: "Status page not found, reports not enabled, or item not on this status page",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
		},
		"/v1/status/{slug}/monitors/{id}/reports/hourly": {
			get: {
				tags: ["Monitor Reports"],
				summary: "Export hourly monitor report",
				description:
					"Export hourly aggregated data for a monitor as CSV or JSON. Requires reports to be enabled on the status page. Data is retained for approximately 90 days. Cached for 5 minutes. If the status page is password-protected, authentication is required.",
				operationId: "getMonitorReportHourly",
				security: [{ bearerAuth: [] }, {}],
				parameters: [
					{ name: "slug", in: "path", required: true, description: "Status page URL slug", schema: { type: "string" } },
					{ name: "id", in: "path", required: true, description: "Monitor ID", schema: { type: "string" } },
					{
						name: "format",
						in: "query",
						required: false,
						description: "Response format. Defaults to JSON.",
						schema: { type: "string", enum: ["json", "csv"], default: "json" },
					},
				],
				responses: {
					"200": {
						description: "Hourly aggregated monitor report. Returns JSON or CSV depending on the `format` parameter.",
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/MonitorHistory" } },
							"text/csv": { schema: { type: "string" } },
						},
					},
					"401": {
						description: "Password required or invalid",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
					"404": {
						description: "Status page not found, reports not enabled, or item not on this status page",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
		},

		"/v1/status/{slug}/monitors/{id}/reports/daily": {
			get: {
				tags: ["Monitor Reports"],
				summary: "Export daily monitor report",
				description:
					"Export daily aggregated data for a monitor as CSV or JSON. Requires reports to be enabled on the status page. Data is kept forever. Cached for 15 minutes. If the status page is password-protected, authentication is required.",
				operationId: "getMonitorReportDaily",
				security: [{ bearerAuth: [] }, {}],
				parameters: [
					{ name: "slug", in: "path", required: true, description: "Status page URL slug", schema: { type: "string" } },
					{ name: "id", in: "path", required: true, description: "Monitor ID", schema: { type: "string" } },
					{
						name: "format",
						in: "query",
						required: false,
						description: "Response format. Defaults to JSON.",
						schema: { type: "string", enum: ["json", "csv"], default: "json" },
					},
				],
				responses: {
					"200": {
						description: "Daily aggregated monitor report. Returns JSON or CSV depending on the `format` parameter.",
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/MonitorHistory" } },
							"text/csv": { schema: { type: "string" } },
						},
					},
					"401": {
						description: "Password required or invalid",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
					"404": {
						description: "Status page not found, reports not enabled, or item not on this status page",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
		},
		"/v1/status/{slug}/groups/{id}/reports": {
			get: {
				tags: ["Group Reports"],
				summary: "Export raw group report",
				description:
					"Export raw group history computed from child monitors/groups as CSV or JSON. Requires reports to be enabled on the status page. Data is retained for approximately 24 hours due to TTL. Cached for 30 seconds. If the status page is password-protected, authentication is required.",
				operationId: "getGroupReportRaw",
				security: [{ bearerAuth: [] }, {}],
				parameters: [
					{ name: "slug", in: "path", required: true, description: "Status page URL slug", schema: { type: "string" } },
					{ name: "id", in: "path", required: true, description: "Group ID", schema: { type: "string" } },
					{
						name: "format",
						in: "query",
						required: false,
						description: "Response format. Defaults to JSON.",
						schema: { type: "string", enum: ["json", "csv"], default: "json" },
					},
				],
				responses: {
					"200": {
						description: "Raw group report data. Returns JSON or CSV depending on the `format` parameter.",
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/GroupHistory" } },
							"text/csv": { schema: { type: "string" } },
						},
					},
					"401": {
						description: "Password required or invalid",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
					"404": {
						description: "Status page not found, reports not enabled, or item not on this status page",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
		},

		"/v1/status/{slug}/groups/{id}/reports/hourly": {
			get: {
				tags: ["Group Reports"],
				summary: "Export hourly group report",
				description:
					"Export hourly aggregated group data as CSV or JSON. Requires reports to be enabled on the status page. Data is retained for approximately 90 days. Cached for 5 minutes. If the status page is password-protected, authentication is required.",
				operationId: "getGroupReportHourly",
				security: [{ bearerAuth: [] }, {}],
				parameters: [
					{ name: "slug", in: "path", required: true, description: "Status page URL slug", schema: { type: "string" } },
					{ name: "id", in: "path", required: true, description: "Group ID", schema: { type: "string" } },
					{
						name: "format",
						in: "query",
						required: false,
						description: "Response format. Defaults to JSON.",
						schema: { type: "string", enum: ["json", "csv"], default: "json" },
					},
				],
				responses: {
					"200": {
						description: "Hourly aggregated group report. Returns JSON or CSV depending on the `format` parameter.",
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/GroupHistory" } },
							"text/csv": { schema: { type: "string" } },
						},
					},
					"401": {
						description: "Password required or invalid",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
					"404": {
						description: "Status page not found, reports not enabled, or item not on this status page",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
		},

		"/v1/status/{slug}/groups/{id}/reports/daily": {
			get: {
				tags: ["Group Reports"],
				summary: "Export daily group report",
				description:
					"Export daily aggregated group data as CSV or JSON. Requires reports to be enabled on the status page. Data is kept forever. Cached for 15 minutes. If the status page is password-protected, authentication is required.",
				operationId: "getGroupReportDaily",
				security: [{ bearerAuth: [] }, {}],
				parameters: [
					{ name: "slug", in: "path", required: true, description: "Status page URL slug", schema: { type: "string" } },
					{ name: "id", in: "path", required: true, description: "Group ID", schema: { type: "string" } },
					{
						name: "format",
						in: "query",
						required: false,
						description: "Response format. Defaults to JSON.",
						schema: { type: "string", enum: ["json", "csv"], default: "json" },
					},
				],
				responses: {
					"200": {
						description: "Daily aggregated group report. Returns JSON or CSV depending on the `format` parameter.",
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/GroupHistory" } },
							"text/csv": { schema: { type: "string" } },
						},
					},
					"401": {
						description: "Password required or invalid",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
					"404": {
						description: "Status page not found, reports not enabled, or item not on this status page",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
		},
		"/v1/status/{slug}/incidents": {
			get: {
				tags: ["Incidents"],
				summary: "Get incidents for a status page",
				description:
					"Returns all incidents for a status page in a given month, with all timeline updates inlined. Defaults to the current month. Paginate by changing the month parameter. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
				operationId: "getStatusPageIncidents",
				security: [{ bearerAuth: [] }, {}],
				parameters: [
					{
						name: "slug",
						in: "path",
						required: true,
						description: "Status page URL slug",
						schema: { type: "string" },
					},
					{
						name: "month",
						in: "query",
						required: false,
						description: "Month to retrieve incidents for (YYYY-MM format). Defaults to current month.",
						schema: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$", example: "2025-06" },
					},
				],
				responses: {
					"200": {
						description: "Incidents for the requested month",
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["statusPageId", "month", "incidents"],
									properties: {
										statusPageId: { type: "string", example: "main" },
										month: { type: "string", example: "2025-06" },
										incidents: {
											type: "array",
											items: { $ref: "#/components/schemas/IncidentWithUpdates" },
										},
									},
								},
							},
						},
					},
					"400": {
						description: "Invalid month format",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
					"401": {
						description: "Password required or invalid",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
					"404": {
						description: "Status page not found",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
		},
		"/v1/reload/{token}": {
			get: {
				tags: ["Configuration"],
				summary: "Reload configuration",
				description: "Hot-reload the server configuration from the config file without restarting the server. Requires the reload token.",
				operationId: "reloadConfig",
				parameters: [
					{
						name: "token",
						in: "path",
						required: true,
						description: "Server reload token (configured in server settings or auto-generated)",
						schema: { type: "string" },
					},
				],
				responses: {
					"200": {
						description: "Configuration reloaded successfully",
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["success", "message", "stats", "timestamp"],
									properties: {
										success: { type: "boolean", enum: [true] },
										message: { type: "string", example: "Configuration reloaded successfully" },
										stats: {
											type: "object",
											required: ["monitors", "groups", "statusPages", "pulseMonitors", "notificationChannels"],
											properties: {
												monitors: { type: "integer", example: 10 },
												groups: { type: "integer", example: 5 },
												statusPages: { type: "integer", example: 3 },
												pulseMonitors: { type: "integer", example: 2 },
												notificationChannels: { type: "integer", example: 2 },
											},
										},
										timestamp: { type: "string", format: "date-time" },
									},
								},
							},
						},
					},
					"401": {
						description: "Invalid reload token",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Error" },
								example: { error: "Invalid token" },
							},
						},
					},
					"500": {
						description: "Configuration reload failed",
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["success", "error", "timestamp"],
									properties: {
										success: { type: "boolean", enum: [false] },
										error: { type: "string", example: "Configuration reload failed" },
										timestamp: { type: "string", format: "date-time" },
									},
								},
							},
						},
					},
				},
			},
		},
		"/v1/admin/config": {
			get: {
				tags: ["Admin: Configuration"],
				summary: "Get full configuration",
				description: "Returns the entire current configuration as read from config.toml. Use ?format=toml to get TOML instead of JSON.",
				operationId: "adminGetConfig",
				security: [{ adminBearerAuth: [] }],
				parameters: [
					{
						name: "format",
						in: "query",
						required: false,
						description: "Response format: json (default) or toml",
						schema: { type: "string", enum: ["json", "toml"], default: "json" },
					},
				],
				responses: {
					"200": {
						description: "Full server configuration",
						content: {
							"application/json": {
								schema: {
									type: "object",
									description: "The complete parsed config.toml as JSON.",
								},
							},
							"application/toml": {
								schema: {
									type: "string",
									description: "The complete config as TOML.",
								},
							},
						},
					},
					"401": {
						description: "Unauthorized - missing or invalid admin token, or Admin API disabled",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
			post: {
				tags: ["Admin: Configuration"],
				summary: "Replace full configuration",
				description:
					"Replace the entire configuration. The body is validated, written to config.toml, and hot-reloaded. On failure, the previous configuration is automatically restored. Use ?format=toml to send TOML instead of JSON.",
				operationId: "adminUpdateConfig",
				security: [{ adminBearerAuth: [] }],
				parameters: [
					{
						name: "format",
						in: "query",
						required: false,
						description: "Request body format: json (default) or toml",
						schema: { type: "string", enum: ["json", "toml"], default: "json" },
					},
				],
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: {
								type: "object",
								description: "The full configuration object with the same structure as config.toml.",
							},
						},
						"application/toml": {
							schema: {
								type: "string",
								description: "The full configuration as TOML.",
							},
						},
					},
				},
				responses: {
					"200": {
						description: "Configuration updated successfully",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/AdminSuccessSimple" },
								example: { success: true },
							},
						},
					},
					"400": {
						description: "Invalid request body or configuration validation failed",
						content: { "application/json": { schema: { $ref: "#/components/schemas/AdminValidationError" } } },
					},
					"401": {
						description: "Unauthorized",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
					"500": {
						description: "Config write or reload failed",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
		},
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
		"/v1/admin/monitors/{id}/reports": {
			get: {
				tags: ["Admin: Reports"],
				summary: "Export raw monitor report",
				description: "Export raw pulse data for any monitor as CSV or JSON. Cached for 30 seconds.",
				operationId: "adminGetMonitorReportRaw",
				security: [{ adminBearerAuth: [] }],
				parameters: [
					{ name: "id", in: "path", required: true, description: "Monitor ID", schema: { type: "string" } },
					{
						name: "format",
						in: "query",
						required: false,
						description: "Response format. Defaults to JSON.",
						schema: { type: "string", enum: ["json", "csv"], default: "json" },
					},
				],
				responses: {
					"200": {
						description: "Raw monitor report data",
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/MonitorHistory" } },
							"text/csv": { schema: { type: "string" } },
						},
					},
					"401": {
						description: "Unauthorized",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
					"404": {
						description: "Resource not found",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
		},
		"/v1/admin/monitors/{id}/reports/hourly": {
			get: {
				tags: ["Admin: Reports"],
				summary: "Export hourly monitor report",
				description: "Export hourly aggregated data for any monitor as CSV or JSON. Cached for 5 minutes.",
				operationId: "adminGetMonitorReportHourly",
				security: [{ adminBearerAuth: [] }],
				parameters: [
					{ name: "id", in: "path", required: true, description: "Monitor ID", schema: { type: "string" } },
					{
						name: "format",
						in: "query",
						required: false,
						description: "Response format. Defaults to JSON.",
						schema: { type: "string", enum: ["json", "csv"], default: "json" },
					},
				],
				responses: {
					"200": {
						description: "Hourly aggregated monitor report",
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/MonitorHistory" } },
							"text/csv": { schema: { type: "string" } },
						},
					},
					"401": {
						description: "Unauthorized",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
					"404": {
						description: "Resource not found",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
		},
		"/v1/admin/monitors/{id}/reports/daily": {
			get: {
				tags: ["Admin: Reports"],
				summary: "Export daily monitor report",
				description: "Export daily aggregated data for any monitor as CSV or JSON. Cached for 15 minutes.",
				operationId: "adminGetMonitorReportDaily",
				security: [{ adminBearerAuth: [] }],
				parameters: [
					{ name: "id", in: "path", required: true, description: "Monitor ID", schema: { type: "string" } },
					{
						name: "format",
						in: "query",
						required: false,
						description: "Response format. Defaults to JSON.",
						schema: { type: "string", enum: ["json", "csv"], default: "json" },
					},
				],
				responses: {
					"200": {
						description: "Daily aggregated monitor report",
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/MonitorHistory" } },
							"text/csv": { schema: { type: "string" } },
						},
					},
					"401": {
						description: "Unauthorized",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
					"404": {
						description: "Resource not found",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
		},
		"/v1/admin/groups/{id}/reports": {
			get: {
				tags: ["Admin: Reports"],
				summary: "Export raw group report",
				description: "Export raw group history for any group as CSV or JSON. Cached for 30 seconds.",
				operationId: "adminGetGroupReportRaw",
				security: [{ adminBearerAuth: [] }],
				parameters: [
					{ name: "id", in: "path", required: true, description: "Group ID", schema: { type: "string" } },
					{
						name: "format",
						in: "query",
						required: false,
						description: "Response format. Defaults to JSON.",
						schema: { type: "string", enum: ["json", "csv"], default: "json" },
					},
				],
				responses: {
					"200": {
						description: "Raw group report data",
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/GroupHistory" } },
							"text/csv": { schema: { type: "string" } },
						},
					},
					"401": {
						description: "Unauthorized",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
					"404": {
						description: "Resource not found",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
		},
		"/v1/admin/groups/{id}/reports/hourly": {
			get: {
				tags: ["Admin: Reports"],
				summary: "Export hourly group report",
				description: "Export hourly aggregated group data for any group as CSV or JSON. Cached for 5 minutes.",
				operationId: "adminGetGroupReportHourly",
				security: [{ adminBearerAuth: [] }],
				parameters: [
					{ name: "id", in: "path", required: true, description: "Group ID", schema: { type: "string" } },
					{
						name: "format",
						in: "query",
						required: false,
						description: "Response format. Defaults to JSON.",
						schema: { type: "string", enum: ["json", "csv"], default: "json" },
					},
				],
				responses: {
					"200": {
						description: "Hourly aggregated group report",
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/GroupHistory" } },
							"text/csv": { schema: { type: "string" } },
						},
					},
					"401": {
						description: "Unauthorized",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
					"404": {
						description: "Resource not found",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
		},
		"/v1/admin/groups/{id}/reports/daily": {
			get: {
				tags: ["Admin: Reports"],
				summary: "Export daily group report",
				description: "Export daily aggregated group data for any group as CSV or JSON. Cached for 15 minutes.",
				operationId: "adminGetGroupReportDaily",
				security: [{ adminBearerAuth: [] }],
				parameters: [
					{ name: "id", in: "path", required: true, description: "Group ID", schema: { type: "string" } },
					{
						name: "format",
						in: "query",
						required: false,
						description: "Response format. Defaults to JSON.",
						schema: { type: "string", enum: ["json", "csv"], default: "json" },
					},
				],
				responses: {
					"200": {
						description: "Daily aggregated group report",
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/GroupHistory" } },
							"text/csv": { schema: { type: "string" } },
						},
					},
					"401": {
						description: "Unauthorized",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
					"404": {
						description: "Resource not found",
						content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
					},
				},
			},
		},
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
					"Update incident metadata (title, severity, affected_monitors). Status cannot be changed directly — use the updates endpoint to post a new timeline entry which changes the status.",
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
	},
	components: {
		securitySchemes: {
			bearerAuth: {
				type: "http",
				scheme: "bearer",
				description: "BLAKE2b-512 hash of the status page password. Only required for password-protected status pages.",
			},
			adminBearerAuth: {
				type: "http",
				scheme: "bearer",
				description: "Admin API token configured in config.toml under [adminAPI]. Required for all admin endpoints.",
			},
		},
		schemas: {
			Error: {
				type: "object",
				required: ["error"],
				properties: {
					error: { type: "string" },
				},
			},
			CustomMetricConfig: {
				type: "object",
				required: ["id", "name"],
				properties: {
					id: { type: "string", description: "Unique identifier for the metric", example: "connections" },
					name: { type: "string", description: "Human-readable display name", example: "Active Connections" },
					unit: { type: "string", description: "Unit of measurement", example: "conn" },
				},
			},
			CustomMetricData: {
				type: "object",
				required: ["config"],
				properties: {
					config: { $ref: "#/components/schemas/CustomMetricConfig" },
					value: { type: "number", description: "Current value of the metric", example: 150 },
				},
			},
			StatusData: {
				type: "object",
				required: ["id", "type", "name", "status", "latency", "uptime1h", "uptime24h", "uptime7d", "uptime30d", "uptime90d", "uptime365d"],
				properties: {
					id: { type: "string", example: "api-prod" },
					type: { type: "string", enum: ["monitor", "group"], example: "monitor" },
					name: { type: "string", example: "Production API" },
					status: { type: "string", enum: ["up", "down", "degraded"], example: "up" },
					latency: { type: "number", description: "Latest measured latency in milliseconds", example: 42 },
					lastCheck: { type: "string", format: "date-time", description: "Timestamp of the last check" },
					firstPulse: { type: "string", format: "date-time", description: "Timestamp of the first received pulse" },
					uptime1h: { type: "number", description: "1-hour uptime percentage", example: 100 },
					uptime24h: { type: "number", description: "24-hour uptime percentage", example: 100 },
					uptime7d: { type: "number", description: "7-day uptime percentage", example: 99.95 },
					uptime30d: { type: "number", description: "30-day uptime percentage", example: 99.98 },
					uptime90d: { type: "number", description: "90-day uptime percentage", example: 99.92 },
					uptime365d: { type: "number", description: "365-day uptime percentage", example: 99.95 },
					children: {
						type: "array",
						description: "Child status data (only for groups)",
						items: { $ref: "#/components/schemas/StatusData" },
					},
					custom1: { $ref: "#/components/schemas/CustomMetricData" },
					custom2: { $ref: "#/components/schemas/CustomMetricData" },
					custom3: { $ref: "#/components/schemas/CustomMetricData" },
				},
			},
			HistoryRecord: {
				type: "object",
				required: ["timestamp", "uptime"],
				properties: {
					timestamp: { type: "string", format: "date-time", example: "2025-01-15T10:00:00Z" },
					uptime: { type: "number", description: "Uptime percentage for this period", example: 100 },
					latency_min: { type: "number", description: "Minimum latency in milliseconds", example: 40 },
					latency_max: { type: "number", description: "Maximum latency in milliseconds", example: 65 },
					latency_avg: { type: "number", description: "Average latency in milliseconds", example: 52.3 },
				},
			},
			MonitorHistory: {
				type: "object",
				required: ["monitorId", "type", "data"],
				properties: {
					monitorId: { type: "string", example: "api-prod" },
					type: { type: "string", enum: ["raw", "hourly", "daily"], example: "raw" },
					data: {
						type: "array",
						items: { $ref: "#/components/schemas/HistoryRecord" },
					},
					customMetrics: {
						type: "object",
						description: "Custom metric configurations for this monitor",
						properties: {
							custom1: { $ref: "#/components/schemas/CustomMetricConfig" },
							custom2: { $ref: "#/components/schemas/CustomMetricConfig" },
							custom3: { $ref: "#/components/schemas/CustomMetricConfig" },
						},
					},
				},
			},
			GroupHistory: {
				type: "object",
				required: ["groupId", "type", "data"],
				properties: {
					groupId: { type: "string", example: "production" },
					type: { type: "string", enum: ["raw", "hourly", "daily"], example: "raw" },
					strategy: {
						type: "string",
						enum: ["any-up", "percentage", "all-up"],
						description: "Strategy used for determining group status",
						example: "percentage",
					},
					data: {
						type: "array",
						items: { $ref: "#/components/schemas/HistoryRecord" },
					},
				},
			},
			Incident: {
				type: "object",
				required: ["id", "status_page_id", "title", "status", "severity", "affected_monitors", "created_at", "updated_at"],
				properties: {
					id: { type: "string", example: "a1b2c3d4e5f6a1b2c3d4e5f6" },
					status_page_id: { type: "string", example: "main" },
					title: { type: "string", example: "Database connectivity issues" },
					status: { type: "string", enum: ["investigating", "identified", "monitoring", "resolved"], example: "investigating" },
					severity: { type: "string", enum: ["minor", "major", "critical"], example: "major" },
					affected_monitors: { type: "array", items: { type: "string" }, example: ["api-prod", "web-app"] },
					created_at: { type: "string", format: "date-time", example: "2025-06-15T10:30:00.000Z" },
					updated_at: { type: "string", format: "date-time", example: "2025-06-15T11:00:00.000Z" },
					resolved_at: { type: "string", format: "date-time", nullable: true, example: null },
				},
			},
			IncidentUpdate: {
				type: "object",
				required: ["id", "incident_id", "status", "message", "created_at"],
				properties: {
					id: { type: "string", example: "f6e5d4c3b2a1f6e5d4c3b2a1" },
					incident_id: { type: "string", example: "a1b2c3d4e5f6a1b2c3d4e5f6" },
					status: { type: "string", enum: ["investigating", "identified", "monitoring", "resolved"], example: "identified" },
					message: { type: "string", example: "We have identified the root cause as a failed database migration." },
					created_at: { type: "string", format: "date-time", example: "2025-06-15T10:45:00.000Z" },
				},
			},
			IncidentWithUpdates: {
				type: "object",
				required: ["id", "status_page_id", "title", "status", "severity", "affected_monitors", "created_at", "updated_at", "updates"],
				properties: {
					id: { type: "string" },
					status_page_id: { type: "string" },
					title: { type: "string" },
					status: { type: "string", enum: ["investigating", "identified", "monitoring", "resolved"] },
					severity: { type: "string", enum: ["minor", "major", "critical"] },
					affected_monitors: { type: "array", items: { type: "string" } },
					created_at: { type: "string", format: "date-time" },
					updated_at: { type: "string", format: "date-time" },
					resolved_at: { type: "string", format: "date-time", nullable: true },
					updates: {
						type: "array",
						items: { $ref: "#/components/schemas/IncidentUpdate" },
						description: "All timeline updates for this incident, ordered chronologically",
					},
				},
			},
			AdminIncidentCreate: {
				type: "object",
				required: ["status_page_id", "title", "status", "severity", "message"],
				properties: {
					status_page_id: { type: "string", description: "ID of the status page this incident belongs to", example: "main" },
					title: { type: "string", description: "Short incident title", example: "Database connectivity issues" },
					status: { type: "string", enum: ["investigating", "identified", "monitoring", "resolved"], example: "investigating" },
					severity: { type: "string", enum: ["minor", "major", "critical"], example: "major" },
					message: {
						type: "string",
						description: "Initial timeline update message",
						example: "We are investigating reports of degraded database performance.",
					},
					affected_monitors: {
						type: "array",
						items: { type: "string" },
						description: "Optional list of affected monitor/group IDs (must be on the status page)",
						example: ["api-prod"],
					},
				},
			},
			AdminIncidentUpdate: {
				type: "object",
				properties: {
					title: { type: "string", example: "Database connectivity issues - resolved" },
					severity: { type: "string", enum: ["minor", "major", "critical"] },
					affected_monitors: { type: "array", items: { type: "string" } },
				},
			},
			AdminSuccess: {
				type: "object",
				required: ["success", "message"],
				properties: {
					success: { type: "boolean", enum: [true] },
					message: { type: "string", example: "Resource updated" },
				},
			},
			AdminSuccessWithId: {
				type: "object",
				required: ["success", "message", "id"],
				properties: {
					success: { type: "boolean", enum: [true] },
					message: { type: "string", example: "Resource created" },
					id: { type: "string", example: "my-resource" },
				},
			},
			AdminValidationError: {
				type: "object",
				required: ["error", "details"],
				properties: {
					error: { type: "string", example: "Validation failed" },
					details: {
						type: "array",
						items: { type: "string" },
						example: ["name is required", "interval must be a positive number"],
					},
				},
			},
			AdminMonitor: {
				type: "object",
				required: ["id", "name", "token", "interval", "maxRetries", "resendNotification", "notificationChannels", "dependencies", "pulseMonitors"],
				properties: {
					id: { type: "string", example: "api-prod" },
					name: { type: "string", example: "Production API" },
					token: { type: "string", example: "tk_prod_api_abc123" },
					interval: { type: "number", description: "Expected pulse interval in seconds", example: 30 },
					maxRetries: { type: "integer", description: "Missed pulses before marking down", example: 0 },
					resendNotification: { type: "integer", description: "Resend notification every N down checks (0 = never)", example: 12 },
					children: { type: "array", items: { type: "string" }, description: "Array of child monitor/group IDs" },
					notificationChannels: { type: "array", items: { type: "string" }, example: ["critical"] },
					dependencies: { type: "array", items: { type: "string" }, example: [] },
					pulseMonitors: { type: "array", items: { type: "string" }, example: [] },
					custom1: { $ref: "#/components/schemas/CustomMetricConfig" },
					custom2: { $ref: "#/components/schemas/CustomMetricConfig" },
					custom3: { $ref: "#/components/schemas/CustomMetricConfig" },
					pulse: {
						type: "object",
						description: "PulseMonitor protocol configuration (omitted if not set)",
					},
				},
			},
			AdminMonitorCreate: {
				type: "object",
				required: ["id", "name", "token", "interval", "maxRetries", "resendNotification"],
				properties: {
					id: { type: "string", description: "Unique ID (alphanumeric, hyphens, underscores)", example: "api-staging" },
					name: { type: "string", example: "Staging API" },
					token: { type: "string", description: "Unique secret token for sending pulses", example: "tk_staging_api_def456" },
					interval: { type: "number", description: "Expected pulse interval in seconds (> 0)", example: 30 },
					maxRetries: { type: "integer", description: "Missed pulses before marking down (>= 0)", minimum: 0, example: 2 },
					resendNotification: { type: "integer", description: "Resend notification every N down checks (0 = never)", minimum: 0, example: 0 },
					children: { type: "array", items: { type: "string" }, description: "Array of child monitor/group IDs" },
					notificationChannels: { type: "array", items: { type: "string" }, description: "Notification channel IDs" },
					dependencies: { type: "array", items: { type: "string" }, description: "Monitor/group IDs for notification suppression" },
					pulseMonitors: { type: "array", items: { type: "string" }, description: "PulseMonitor IDs" },
					custom1: { $ref: "#/components/schemas/CustomMetricConfig" },
					custom2: { $ref: "#/components/schemas/CustomMetricConfig" },
					custom3: { $ref: "#/components/schemas/CustomMetricConfig" },
					pulse: { type: "object", description: "PulseMonitor protocol configuration (http, tcp, etc.)" },
				},
			},
			AdminMonitorUpdate: {
				type: "object",
				properties: {
					name: { type: "string", example: "Staging API v2" },
					token: { type: "string" },
					interval: { type: "number", description: "Must be > 0" },
					maxRetries: { type: "integer", minimum: 0 },
					resendNotification: { type: "integer", minimum: 0 },
					children: { type: "array", items: { type: "string" }, nullable: true, description: "Set to null to remove" },
					notificationChannels: { type: "array", items: { type: "string" } },
					dependencies: { type: "array", items: { type: "string" } },
					pulseMonitors: { type: "array", items: { type: "string" } },
					custom1: { oneOf: [{ $ref: "#/components/schemas/CustomMetricConfig" }, { type: "null" }], description: "Set to null to remove" },
					custom2: { oneOf: [{ $ref: "#/components/schemas/CustomMetricConfig" }, { type: "null" }], description: "Set to null to remove" },
					custom3: { oneOf: [{ $ref: "#/components/schemas/CustomMetricConfig" }, { type: "null" }], description: "Set to null to remove" },
					pulse: { type: "object", nullable: true, description: "Set to null to remove" },
				},
			},
			AdminGroup: {
				type: "object",
				required: ["id", "name", "strategy", "degradedThreshold", "interval", "resendNotification", "notificationChannels", "dependencies"],
				properties: {
					id: { type: "string", example: "production" },
					name: { type: "string", example: "Production Services" },
					strategy: { type: "string", enum: ["any-up", "percentage", "all-up"], example: "percentage" },
					degradedThreshold: { type: "number", description: "Percentage threshold for degraded status (0-100)", minimum: 0, maximum: 100, example: 50 },
					interval: { type: "number", description: "Interval in seconds for uptime calculations", example: 60 },
					resendNotification: { type: "integer", description: "Resend notification every N down checks (0 = never)", example: 12 },
					children: { type: "array", items: { type: "string" }, description: "Array of child monitor/group IDs" },
					notificationChannels: { type: "array", items: { type: "string" }, example: [] },
					dependencies: { type: "array", items: { type: "string" }, example: [] },
				},
			},
			AdminGroupCreate: {
				type: "object",
				required: ["id", "name", "strategy", "degradedThreshold", "interval"],
				properties: {
					id: { type: "string", description: "Unique ID (alphanumeric, hyphens, underscores)", example: "eu-services" },
					name: { type: "string", example: "EU Services" },
					strategy: { type: "string", enum: ["any-up", "percentage", "all-up"], example: "percentage" },
					degradedThreshold: { type: "number", minimum: 0, maximum: 100, example: 50 },
					interval: { type: "number", description: "Must be > 0", example: 60 },
					resendNotification: { type: "integer", minimum: 0, description: "Defaults to 0", example: 0 },
					children: { type: "array", items: { type: "string" }, description: "Array of child monitor/group IDs" },
					notificationChannels: { type: "array", items: { type: "string" } },
					dependencies: { type: "array", items: { type: "string" } },
				},
			},
			AdminGroupUpdate: {
				type: "object",
				properties: {
					name: { type: "string" },
					strategy: { type: "string", enum: ["any-up", "percentage", "all-up"] },
					degradedThreshold: { type: "number", minimum: 0, maximum: 100 },
					interval: { type: "number", description: "Must be > 0" },
					resendNotification: { type: "integer", minimum: 0 },
					children: { type: "array", items: { type: "string" }, nullable: true, description: "Set to null to remove" },
					notificationChannels: { type: "array", items: { type: "string" } },
					dependencies: { type: "array", items: { type: "string" } },
				},
			},
			AdminStatusPage: {
				type: "object",
				required: ["id", "name", "slug", "items"],
				properties: {
					id: { type: "string", example: "public" },
					name: { type: "string", example: "Public Status Page" },
					slug: { type: "string", example: "status" },
					items: { type: "array", items: { type: "string" }, description: "Monitor and/or group IDs", example: ["all-services", "third-party"] },
					leafItems: {
						type: "array",
						items: { type: "string" },
						description: "IDs treated as leaf nodes (children not expanded on status page)",
						example: ["europe"],
					},
					password: { type: "string", description: "Password for protection (omitted if not set)" },
					reports: { type: "boolean", description: "Whether report export endpoints are enabled (default: false)", example: false },
				},
			},
			AdminStatusPageCreate: {
				type: "object",
				required: ["id", "name", "slug", "items"],
				properties: {
					id: { type: "string", description: "Unique ID (alphanumeric, hyphens, underscores)", example: "partners" },
					name: { type: "string", example: "Partner Status" },
					slug: { type: "string", description: "URL slug (lowercase letters, numbers, hyphens only)", example: "partner-status" },
					items: { type: "array", items: { type: "string" }, description: "Non-empty array of monitor/group IDs", example: ["production", "api-prod"] },
					leafItems: { type: "array", items: { type: "string" }, nullable: true, description: "Set to null to remove" },
					password: { type: "string", description: "Password to protect the page (minimum 8 characters)" },
					reports: { type: "boolean", description: "Enable report export endpoints (default: false)" },
				},
			},
			AdminStatusPageUpdate: {
				type: "object",
				properties: {
					name: { type: "string" },
					slug: { type: "string", description: "Must not conflict with another status page" },
					items: { type: "array", items: { type: "string" }, description: "Must be non-empty" },
					password: { type: "string", nullable: true, description: "Set to null to remove password protection (minimum 8 characters if set)" },
					reports: { type: "boolean", description: "Enable or disable report export endpoints" },
				},
			},
			AdminNotificationChannel: {
				type: "object",
				required: ["id", "name", "enabled"],
				properties: {
					id: { type: "string", example: "critical" },
					name: { type: "string", example: "Critical Production Alerts" },
					description: { type: "string", description: "Omitted if not set", example: "High-priority alerts" },
					enabled: { type: "boolean", example: true },
					discord: { $ref: "#/components/schemas/AdminDiscordConfig" },
					email: { $ref: "#/components/schemas/AdminEmailConfig" },
					ntfy: { $ref: "#/components/schemas/AdminNtfyConfig" },
					telegram: { $ref: "#/components/schemas/AdminTelegramConfig" },
					webhook: { $ref: "#/components/schemas/AdminWebhookConfig" },
				},
			},
			AdminNotificationChannelCreate: {
				type: "object",
				required: ["id", "name", "enabled"],
				properties: {
					id: { type: "string", description: "Unique ID (alphanumeric, hyphens, underscores)", example: "ops-alerts" },
					name: { type: "string", example: "Ops Team Alerts" },
					description: { type: "string" },
					enabled: { type: "boolean", example: true },
					discord: { $ref: "#/components/schemas/AdminDiscordConfig" },
					email: { $ref: "#/components/schemas/AdminEmailConfig" },
					ntfy: { $ref: "#/components/schemas/AdminNtfyConfig" },
					telegram: { $ref: "#/components/schemas/AdminTelegramConfig" },
					webhook: { $ref: "#/components/schemas/AdminWebhookConfig" },
				},
			},
			AdminNotificationChannelUpdate: {
				type: "object",
				properties: {
					name: { type: "string" },
					description: { type: "string", nullable: true },
					enabled: { type: "boolean" },
					discord: { oneOf: [{ $ref: "#/components/schemas/AdminDiscordConfig" }, { type: "null" }], description: "Set to null to remove" },
					email: { oneOf: [{ $ref: "#/components/schemas/AdminEmailConfig" }, { type: "null" }], description: "Set to null to remove" },
					ntfy: { oneOf: [{ $ref: "#/components/schemas/AdminNtfyConfig" }, { type: "null" }], description: "Set to null to remove" },
					telegram: { oneOf: [{ $ref: "#/components/schemas/AdminTelegramConfig" }, { type: "null" }], description: "Set to null to remove" },
					webhook: { oneOf: [{ $ref: "#/components/schemas/AdminWebhookConfig" }, { type: "null" }], description: "Set to null to remove" },
				},
			},
			AdminDiscordConfig: {
				type: "object",
				required: ["enabled"],
				properties: {
					enabled: { type: "boolean", example: true },
					webhookUrl: { type: "string", description: "Required when enabled", example: "https://discord.com/api/webhooks/123/abc" },
					username: { type: "string", example: "Alert Bot" },
					avatarUrl: { type: "string", example: "https://example.com/avatar.png" },
					mentions: {
						type: "object",
						properties: {
							users: { type: "array", items: { type: "string" }, description: "Discord user IDs" },
							roles: { type: "array", items: { type: "string" }, description: "Discord role IDs" },
							everyone: { type: "boolean" },
						},
					},
				},
			},
			AdminEmailConfig: {
				type: "object",
				required: ["enabled"],
				properties: {
					enabled: { type: "boolean", example: true },
					from: { type: "string", description: "Sender address (required when enabled)", example: '"Uptime Monitor" <alerts@example.com>' },
					to: { type: "array", items: { type: "string" }, description: "Recipient addresses (required when enabled)", example: ["admin@example.com"] },
					smtp: {
						type: "object",
						description: "SMTP configuration (required when enabled)",
						required: ["host", "port", "secure", "user", "pass"],
						properties: {
							host: { type: "string", example: "smtp.example.com" },
							port: { type: "integer", example: 465 },
							secure: { type: "boolean", example: true },
							user: { type: "string", example: "alerts@example.com" },
							pass: { type: "string", example: "your-smtp-password" },
						},
					},
				},
			},
			AdminNtfyConfig: {
				type: "object",
				required: ["enabled"],
				properties: {
					enabled: { type: "boolean", example: true },
					server: { type: "string", description: "Required when enabled", example: "https://ntfy.sh" },
					topic: { type: "string", description: "Required when enabled", example: "uptime-monitor" },
					token: { type: "string", description: "Optional token authentication" },
					username: { type: "string", description: "Optional username (must be paired with password)" },
					password: { type: "string", description: "Optional password (must be paired with username)" },
				},
			},
			AdminTelegramConfig: {
				type: "object",
				required: ["enabled"],
				properties: {
					enabled: { type: "boolean", example: true },
					botToken: { type: "string", description: "Required when enabled", example: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" },
					chatId: { type: "string", description: "Required when enabled", example: "-1001234567890" },
					topicId: { type: "integer", description: "Optional forum topic ID" },
					disableNotification: { type: "boolean", description: "Send silently" },
				},
			},
			AdminWebhookConfig: {
				type: "object",
				required: ["enabled"],
				properties: {
					enabled: { type: "boolean", example: true },
					url: { type: "string", description: "Required when enabled", example: "https://example.com/webhook" },
					headers: {
						type: "object",
						additionalProperties: { type: "string" },
						description: "Custom HTTP headers for authentication",
						example: { Authorization: "Bearer your-token" },
					},
				},
			},
			AdminPulseMonitor: {
				type: "object",
				required: ["id", "name", "token"],
				properties: {
					id: { type: "string", example: "US-WEST-1" },
					name: { type: "string", example: "US West 1 (Oregon)" },
					token: { type: "string", example: "tk_pulse_monitor_us_west_1" },
				},
			},
			AdminPulseMonitorCreate: {
				type: "object",
				required: ["id", "name", "token"],
				properties: {
					id: { type: "string", description: "Unique ID (alphanumeric, hyphens, underscores)", example: "AP-EAST-1" },
					name: { type: "string", example: "Asia Pacific (Tokyo)" },
					token: { type: "string", description: "Unique token for WebSocket authentication", example: "tk_pulse_monitor_ap_east_1" },
				},
			},
			AdminPulseMonitorUpdate: {
				type: "object",
				properties: {
					name: { type: "string" },
					token: { type: "string", description: "Must not conflict with another PulseMonitor" },
				},
			},
		},
	},
} as const;
