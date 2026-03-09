import { publicPaths } from "./paths/public";
import { adminConfigPaths } from "./paths/admin-config";
import { adminMonitorPaths } from "./paths/admin-monitors";
import { adminPagePaths } from "./paths/admin-pages";
import { adminReportPaths } from "./paths/admin-reports";
import { adminIncidentPaths } from "./paths/admin-incidents";
import { adminMaintenancePaths } from "./paths/admin-maintenances";
import { schemas } from "./schemas";

export const openapi = {
	openapi: "3.1.0",
	info: {
		title: "UptimeMonitor Server API",
		description: "API for UptimeMonitor Server - a push-based uptime monitoring system with status pages, history tracking, and real-time WebSocket updates.",
		version: "0.6.0",
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
		{ name: "Maintenances", description: "Scheduled maintenances for status pages" },
		{ name: "Configuration", description: "Server configuration management" },
		{ name: "Admin: Monitors", description: "Admin CRUD operations for monitors" },
		{ name: "Admin: Groups", description: "Admin CRUD operations for groups" },
		{ name: "Admin: Status Pages", description: "Admin CRUD operations for status pages" },
		{ name: "Admin: Notifications", description: "Admin CRUD operations for notification channels" },
		{ name: "Admin: Pulse Monitors", description: "Admin CRUD operations for PulseMonitor instances" },
		{ name: "Admin: Reports", description: "Admin export endpoints for monitor and group history data" },
		{ name: "Admin: Incidents", description: "Admin CRUD operations for incidents" },
		{ name: "Admin: Maintenances", description: "Manage scheduled maintenances" },
		{ name: "Admin: Configuration", description: "Admin configuration access" },
	],
	paths: {
		...publicPaths,
		...adminConfigPaths,
		...adminMonitorPaths,
		...adminPagePaths,
		...adminReportPaths,
		...adminIncidentPaths,
		...adminMaintenancePaths,
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
		schemas,
	},
} as const;
