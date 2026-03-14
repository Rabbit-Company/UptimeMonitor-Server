export const publicPaths = {
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
	"/v1/status/{statusPageId}": {
		get: {
			tags: ["Status Pages"],
			summary: "Get full status page",
			description:
				"Get full status page data with all monitors and groups, including uptime percentages and custom metrics. Cached for 30 seconds. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
			operationId: "getStatusPage",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{
					name: "statusPageId",
					in: "path",
					required: true,
					description: "Status page ID",
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
								required: ["id", "name", "items", "lastUpdated"],
								properties: {
									id: { name: "id", in: "path", required: true, description: "Status page ID", schema: { type: "string" } },
									name: { type: "string", example: "Public Status" },
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
	"/v1/status/{statusPageId}/summary": {
		get: {
			tags: ["Status Pages"],
			summary: "Get status page summary",
			description: "Get a quick overview of the status page without full monitor details. Cached for 30 seconds.",
			operationId: "getStatusPageSummary",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{
					name: "statusPageId",
					in: "path",
					required: true,
					description: "Status page ID",
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
	"/v1/status/{statusPageId}/monitors/{monitorId}/history": {
		get: {
			tags: ["Monitor History"],
			summary: "Get raw monitor history",
			description:
				"Returns all raw pulse data for a monitor within a status page. Data is retained for approximately 24 hours due to TTL. Cached for 30 seconds. The monitor must belong to the specified status page. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
			operationId: "getMonitorHistoryRaw",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{
					name: "statusPageId",
					in: "path",
					required: true,
					description: "Status page ID",
					schema: { type: "string" },
				},
				{
					name: "monitorId",
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
	"/v1/status/{statusPageId}/monitors/{monitorId}/history/hourly": {
		get: {
			tags: ["Monitor History"],
			summary: "Get hourly monitor history",
			description:
				"Returns hourly aggregated data for a monitor within a status page. Data is retained for approximately 90 days. Cached for 5 minutes. The monitor must belong to the specified status page. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
			operationId: "getMonitorHistoryHourly",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{
					name: "statusPageId",
					in: "path",
					required: true,
					description: "Status page ID",
					schema: { type: "string" },
				},
				{
					name: "monitorId",
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
	"/v1/status/{statusPageId}/monitors/{monitorId}/history/daily": {
		get: {
			tags: ["Monitor History"],
			summary: "Get daily monitor history",
			description:
				"Returns daily aggregated data for a monitor within a status page. Data is kept forever. Cached for 15 minutes. The monitor must belong to the specified status page. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
			operationId: "getMonitorHistoryDaily",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{
					name: "statusPageId",
					in: "path",
					required: true,
					description: "Status page ID",
					schema: { type: "string" },
				},
				{
					name: "monitorId",
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
	"/v1/status/{statusPageId}/groups/{groupId}/history": {
		get: {
			tags: ["Group History"],
			summary: "Get raw group history",
			description:
				"Returns raw group history computed from child monitors/groups within a status page. Data is retained for approximately 24 hours due to TTL. Cached for 30 seconds. The group must belong to the specified status page. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
			operationId: "getGroupHistoryRaw",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{
					name: "statusPageId",
					in: "path",
					required: true,
					description: "Status page ID",
					schema: { type: "string" },
				},
				{
					name: "groupId",
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
	"/v1/status/{statusPageId}/groups/{groupId}/history/hourly": {
		get: {
			tags: ["Group History"],
			summary: "Get hourly group history",
			description:
				"Returns hourly aggregated group data within a status page. Data is retained for approximately 90 days. Cached for 5 minutes. The group must belong to the specified status page. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
			operationId: "getGroupHistoryHourly",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{
					name: "statusPageId",
					in: "path",
					required: true,
					description: "Status page ID",
					schema: { type: "string" },
				},
				{
					name: "groupId",
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
	"/v1/status/{statusPageId}/groups/{groupId}/history/daily": {
		get: {
			tags: ["Group History"],
			summary: "Get daily group history",
			description:
				"Returns daily aggregated group data within a status page. Data is kept forever. Cached for 15 minutes. The group must belong to the specified status page. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
			operationId: "getGroupHistoryDaily",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{
					name: "statusPageId",
					in: "path",
					required: true,
					description: "Status page ID",
					schema: { type: "string" },
				},
				{
					name: "groupId",
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
	"/v1/status/{statusPageId}/monitors/{monitorId}/reports": {
		get: {
			tags: ["Monitor Reports"],
			summary: "Export raw monitor report",
			description:
				"Export raw pulse data for a monitor as CSV or JSON. Requires reports to be enabled on the status page. Data is retained for approximately 24 hours due to TTL. Cached for 30 seconds. If the status page is password-protected, authentication is required.",
			operationId: "getMonitorReportRaw",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{ name: "statusPageId", in: "path", required: true, description: "Status page ID", schema: { type: "string" } },
				{ name: "monitorId", in: "path", required: true, description: "Monitor ID", schema: { type: "string" } },
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
	"/v1/status/{statusPageId}/monitors/{monitorId}/reports/hourly": {
		get: {
			tags: ["Monitor Reports"],
			summary: "Export hourly monitor report",
			description:
				"Export hourly aggregated data for a monitor as CSV or JSON. Requires reports to be enabled on the status page. Data is retained for approximately 90 days. Cached for 5 minutes. If the status page is password-protected, authentication is required.",
			operationId: "getMonitorReportHourly",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{ name: "statusPageId", in: "path", required: true, description: "Status page ID", schema: { type: "string" } },
				{ name: "monitorId", in: "path", required: true, description: "Monitor ID", schema: { type: "string" } },
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

	"/v1/status/{statusPageId}/monitors/{monitorId}/reports/daily": {
		get: {
			tags: ["Monitor Reports"],
			summary: "Export daily monitor report",
			description:
				"Export daily aggregated data for a monitor as CSV or JSON. Requires reports to be enabled on the status page. Data is kept forever. Cached for 15 minutes. If the status page is password-protected, authentication is required.",
			operationId: "getMonitorReportDaily",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{ name: "statusPageId", in: "path", required: true, description: "Status Page ID", schema: { type: "string" } },
				{ name: "monitorId", in: "path", required: true, description: "Monitor ID", schema: { type: "string" } },
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
	"/v1/status/{statusPageId}/groups/{groupId}/reports": {
		get: {
			tags: ["Group Reports"],
			summary: "Export raw group report",
			description:
				"Export raw group history computed from child monitors/groups as CSV or JSON. Requires reports to be enabled on the status page. Data is retained for approximately 24 hours due to TTL. Cached for 30 seconds. If the status page is password-protected, authentication is required.",
			operationId: "getGroupReportRaw",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{ name: "statusPageId", in: "path", required: true, description: "Status Page ID", schema: { type: "string" } },
				{ name: "groupId", in: "path", required: true, description: "Group ID", schema: { type: "string" } },
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

	"/v1/status/{statusPageId}/groups/{groupId}/reports/hourly": {
		get: {
			tags: ["Group Reports"],
			summary: "Export hourly group report",
			description:
				"Export hourly aggregated group data as CSV or JSON. Requires reports to be enabled on the status page. Data is retained for approximately 90 days. Cached for 5 minutes. If the status page is password-protected, authentication is required.",
			operationId: "getGroupReportHourly",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{ name: "statusPageId", in: "path", required: true, description: "Status Page ID", schema: { type: "string" } },
				{ name: "groupId", in: "path", required: true, description: "Group ID", schema: { type: "string" } },
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

	"/v1/status/{statusPageId}/groups/{groupId}/reports/daily": {
		get: {
			tags: ["Group Reports"],
			summary: "Export daily group report",
			description:
				"Export daily aggregated group data as CSV or JSON. Requires reports to be enabled on the status page. Data is kept forever. Cached for 15 minutes. If the status page is password-protected, authentication is required.",
			operationId: "getGroupReportDaily",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{ name: "statusPageId", in: "path", required: true, description: "Status Page ID", schema: { type: "string" } },
				{ name: "groupId", in: "path", required: true, description: "Group ID", schema: { type: "string" } },
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
	"/v1/status/{statusPageId}/incidents": {
		get: {
			tags: ["Incidents"],
			summary: "Get incidents for a status page",
			description:
				"Returns all incidents for a status page in a given month, with all timeline updates inlined. Defaults to the current month. Paginate by changing the month parameter. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
			operationId: "getStatusPageIncidents",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{
					name: "statusPageId",
					in: "path",
					required: true,
					description: "Status Page ID",
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
	"/v1/status/{statusPageId}/maintenances": {
		get: {
			tags: ["Maintenances"],
			summary: "Get maintenances for a status page",
			description:
				"Returns all maintenances for a status page in a given month, with all timeline updates inlined. Cached for 30 seconds. Password-protected pages require a BLAKE2b-512 hash of the password as a Bearer token.",
			operationId: "getMaintenances",
			security: [{ bearerAuth: [] }, {}],
			parameters: [
				{ name: "statusPageId", in: "path", required: true, description: "Status page ID", schema: { type: "string" } },
				{
					name: "month",
					in: "query",
					required: false,
					description: "Month to retrieve maintenances for (YYYY-MM format). Defaults to current month.",
					schema: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$", example: "2026-03" },
				},
			],
			responses: {
				"200": {
					description: "Maintenances for the month",
					content: {
						"application/json": {
							schema: {
								type: "object",
								required: ["statusPageId", "month", "maintenances"],
								properties: {
									statusPageId: { type: "string", example: "main" },
									month: { type: "string", example: "2026-03" },
									maintenances: {
										type: "array",
										items: { $ref: "#/components/schemas/MaintenanceWithUpdates" },
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
					description: "Unauthorized (password-protected page)",
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
} as const;
