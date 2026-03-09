export const adminConfigPaths = {
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
							schema: { $ref: "#/components/schemas/AdminSuccess" },
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
} as const;
