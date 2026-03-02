import { LokiTransport, Logger as RabbitLogger, type LokiConfig } from "@rabbit-company/web-middleware/logger";

export const Logger = new RabbitLogger({
	level: 7,
});

let currentLokiTransport: LokiTransport | null = null;

/**
 * Configure (or reconfigure) the Loki transport on the global Logger.
 * Pass `undefined` to remove an existing Loki transport.
 */
export function configureLoki(lokiConfig?: LokiConfig): void {
	// Remove previous transport if one exists
	if (currentLokiTransport) {
		Logger.removeTransport(currentLokiTransport);
		currentLokiTransport = null;
	}

	if (!lokiConfig) return;

	currentLokiTransport = new LokiTransport({
		url: lokiConfig.url,
		tenantID: lokiConfig.tenantID,
		labels: lokiConfig.labels ?? {},
		basicAuth: lokiConfig.basicAuth,
		batchSize: lokiConfig.batchSize ?? 1000,
		batchTimeout: lokiConfig.batchTimeout ?? 5000,
		maxQueueSize: lokiConfig.maxQueueSize ?? 10000,
	});

	Logger.addTransport(currentLokiTransport);
	Logger.info("Loki transport configured", { url: lokiConfig.url });
}
