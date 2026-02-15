import type { Server, WebSocketData } from "@rabbit-company/web";
import { cache } from "./cache";
import { Logger } from "./logger";
import type { Monitor, PulseMonitor } from "./types";

/**
 * Build PulseMonitor configuration from a monitor
 * Maps UptimeMonitor-Server monitor to PulseMonitor format
 */
export function buildPulseMonitorConfig(monitor: Monitor): any {
	// Calculate pulse interval: server interval / 3, with minimum of 3 seconds
	const pulseInterval = Math.max(3, Math.floor(monitor.interval / 3));

	const pulseConfig: any = {
		enabled: true,
		name: monitor.name,
		token: monitor.token,
		interval: pulseInterval,
		debug: true,
	};

	// Add pulse configuration if the monitor has it configured
	if (monitor.pulse) {
		// HTTP monitoring
		if (monitor.pulse.http) {
			pulseConfig.http = {
				method: monitor.pulse.http.method || "GET",
				url: monitor.pulse.http.url,
				timeout: monitor.pulse.http.timeout || 10,
			};
			if (monitor.pulse.http.headers && monitor.pulse.http.headers.length > 0) {
				pulseConfig.http.headers = monitor.pulse.http.headers;
			}
		}

		// WebSocket monitoring
		if (monitor.pulse.ws) {
			pulseConfig.ws = {
				url: monitor.pulse.ws.url,
				timeout: monitor.pulse.ws.timeout || 3,
			};
		}

		// TCP monitoring
		if (monitor.pulse.tcp) {
			pulseConfig.tcp = {
				host: monitor.pulse.tcp.host,
				port: monitor.pulse.tcp.port,
				timeout: monitor.pulse.tcp.timeout || 5,
			};
		}

		// UDP monitoring
		if (monitor.pulse.udp) {
			pulseConfig.udp = {
				host: monitor.pulse.udp.host,
				port: monitor.pulse.udp.port,
				timeout: monitor.pulse.udp.timeout || 3,
				payload: monitor.pulse.udp.payload || "ping",
				expectResponse: monitor.pulse.udp.expectResponse ?? false,
			};
		}

		// ICMP monitoring
		if (monitor.pulse.icmp) {
			pulseConfig.icmp = {
				host: monitor.pulse.icmp.host,
				timeout: monitor.pulse.icmp.timeout || 2,
			};
		}

		// SMTP monitoring
		if (monitor.pulse.smtp) {
			pulseConfig.smtp = {
				url: monitor.pulse.smtp.url,
			};
		}

		// IMAP monitoring
		if (monitor.pulse.imap) {
			pulseConfig.imap = {
				server: monitor.pulse.imap.server,
				port: monitor.pulse.imap.port,
				username: monitor.pulse.imap.username,
				password: monitor.pulse.imap.password,
			};
		}

		// MySQL monitoring
		if (monitor.pulse.mysql) {
			pulseConfig.mysql = {
				url: monitor.pulse.mysql.url,
				timeout: monitor.pulse.mysql.timeout || 3,
			};
		}

		// MSSQL monitoring
		if (monitor.pulse.mssql) {
			pulseConfig.mssql = {
				url: monitor.pulse.mssql.url,
				timeout: monitor.pulse.mssql.timeout || 3,
			};
		}

		// PostgreSQL monitoring
		if (monitor.pulse.postgresql) {
			pulseConfig.postgresql = {
				url: monitor.pulse.postgresql.url,
				timeout: monitor.pulse.postgresql.timeout || 3,
				useTls: monitor.pulse.postgresql.useTls ?? false,
			};
		}

		// Redis monitoring
		if (monitor.pulse.redis) {
			pulseConfig.redis = {
				url: monitor.pulse.redis.url,
				timeout: monitor.pulse.redis.timeout || 3,
			};
		}

		// Minecraft Java monitoring
		if (monitor.pulse["minecraft-java"]) {
			pulseConfig["minecraft-java"] = {
				host: monitor.pulse["minecraft-java"].host,
				port: monitor.pulse["minecraft-java"].port,
				timeout: monitor.pulse["minecraft-java"].timeout,
			};
		}

		// Minecraft Bedrock monitoring
		if (monitor.pulse["minecraft-bedrock"]) {
			pulseConfig["minecraft-bedrock"] = {
				host: monitor.pulse["minecraft-bedrock"].host,
				port: monitor.pulse["minecraft-bedrock"].port,
				timeout: monitor.pulse["minecraft-bedrock"].timeout,
			};
		}
	}

	return pulseConfig;
}

/**
 * Get all monitors configured for a specific PulseMonitor
 */
export function getPulseMonitorConfigs(pulseMonitorId: string): any[] {
	const monitors = cache.getMonitorsByPulseMonitor(pulseMonitorId);
	const configs: any[] = [];

	for (const monitor of monitors) {
		if (monitor.pulse) {
			configs.push(buildPulseMonitorConfig(monitor));
		}
	}

	return configs;
}

/**
 * Get the WebSocket channel name for a PulseMonitor
 */
export function getPulseMonitorChannel(pulseMonitorId: string): string {
	return `pulsemonitor-${pulseMonitorId}`;
}

/**
 * Build the configuration update message for PulseMonitor clients
 */
export function buildPulseMonitorMessage(pulseMonitorId: string): string {
	const configs = getPulseMonitorConfigs(pulseMonitorId);

	return JSON.stringify({
		action: "config-update",
		data: {
			monitors: configs,
		},
		timestamp: new Date().toISOString(),
	});
}

/**
 * Notify a specific PulseMonitor's connected clients about configuration changes
 */
export function notifyPulseMonitorClients(server: Server, pulseMonitorId: string): void {
	const channel = getPulseMonitorChannel(pulseMonitorId);
	const message = buildPulseMonitorMessage(pulseMonitorId);
	const configs = getPulseMonitorConfigs(pulseMonitorId);

	server.publish(channel, message);

	Logger.info("Sent configuration update to PulseMonitor channel", {
		pulseMonitorId,
		channel,
		monitorCount: configs.length,
	});
}

/**
 * Notify all PulseMonitor channels about configuration changes
 */
export function notifyAllPulseMonitorClients(server: Server): void {
	const pulseMonitors = cache.getAllPulseMonitors();

	for (const pulseMonitor of pulseMonitors) {
		notifyPulseMonitorClients(server, pulseMonitor.id);
	}
}

/**
 * Handle PulseMonitor WebSocket subscription
 * Returns the subscription response or null if invalid
 */
export function handlePulseMonitorSubscription(
	ws: Bun.ServerWebSocket<WebSocketData<Record<string, unknown>>>,
	token: string,
): { success: true; pulseMonitor: PulseMonitor; channel: string; configs: any[] } | { success: false; error: string } {
	const pulseMonitor = cache.getPulseMonitorByToken(token);

	if (!pulseMonitor) {
		return { success: false, error: "Invalid PulseMonitor token" };
	}

	const channel = getPulseMonitorChannel(pulseMonitor.id);
	const configs = getPulseMonitorConfigs(pulseMonitor.id);

	// Subscribe to the channel
	ws.subscribe(channel);

	Logger.audit("PulseMonitor client subscribed", {
		ip: ws.data.clientIp || ws.remoteAddress,
		pulseMonitorId: pulseMonitor.id,
		pulseMonitorName: pulseMonitor.name,
		channel,
		monitorCount: configs.length,
	});

	return {
		success: true,
		pulseMonitor,
		channel,
		configs,
	};
}
