export const adminReportPaths = {
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
} as const;
