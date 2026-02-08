export const openapi = {
	openapi: "3.1.0",
	info: {
		title: "UptimeMonitor Server API",
		description: "API for UptimeMonitor Server - a push-based uptime monitoring system with status pages, history tracking, and real-time WebSocket updates.",
		version: "0.2.0",
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
		{ name: "Configuration", description: "Server configuration management" },
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
		"/v1/monitors/{id}/history": {
			get: {
				tags: ["Monitor History"],
				summary: "Get raw monitor history",
				description: "Returns all raw pulse data for a monitor. Data is retained for approximately 24 hours due to TTL. Cached for 30 seconds.",
				operationId: "getMonitorHistoryRaw",
				parameters: [
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
				},
			},
		},
		"/v1/monitors/{id}/history/hourly": {
			get: {
				tags: ["Monitor History"],
				summary: "Get hourly monitor history",
				description: "Returns hourly aggregated data for a monitor. Data is retained for approximately 90 days. Cached for 5 minutes.",
				operationId: "getMonitorHistoryHourly",
				parameters: [
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
				},
			},
		},
		"/v1/monitors/{id}/history/daily": {
			get: {
				tags: ["Monitor History"],
				summary: "Get daily monitor history",
				description: "Returns daily aggregated data for a monitor. Data is kept forever. Cached for 15 minutes.",
				operationId: "getMonitorHistoryDaily",
				parameters: [
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
				},
			},
		},
		"/v1/groups/{id}/history": {
			get: {
				tags: ["Group History"],
				summary: "Get raw group history",
				description:
					"Returns raw group history computed from child monitors/groups. Data is retained for approximately 24 hours due to TTL. Cached for 30 seconds.",
				operationId: "getGroupHistoryRaw",
				parameters: [
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
				},
			},
		},
		"/v1/groups/{id}/history/hourly": {
			get: {
				tags: ["Group History"],
				summary: "Get hourly group history",
				description: "Returns hourly aggregated group data. Data is retained for approximately 90 days. Cached for 5 minutes.",
				operationId: "getGroupHistoryHourly",
				parameters: [
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
				},
			},
		},
		"/v1/groups/{id}/history/daily": {
			get: {
				tags: ["Group History"],
				summary: "Get daily group history",
				description: "Returns daily aggregated group data. Data is kept forever. Cached for 15 minutes.",
				operationId: "getGroupHistoryDaily",
				parameters: [
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
	},
	components: {
		securitySchemes: {
			bearerAuth: {
				type: "http",
				scheme: "bearer",
				description: "BLAKE2b-512 hash of the status page password. Only required for password-protected status pages.",
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
		},
	},
} as const;
