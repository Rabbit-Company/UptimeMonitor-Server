import { sleep } from "bun";
import { cache } from "./cache";
import { updateMonitorStatus } from "./clickhouse";
import { Logger } from "./logger";

class StatusUpdater {
	private pending = new Set<string>();
	private inflight = 0;
	private concurrency: number;
	private maxRetries: number;
	private flushResolvers: Array<() => void> = [];

	private completed = 0;
	private failed = 0;
	private batchStartTime?: number;

	constructor(opts: { concurrency?: number; maxRetries?: number } = {}) {
		this.concurrency = opts.concurrency ?? 30;
		this.maxRetries = opts.maxRetries ?? 3;
	}

	/** Enqueue a single monitor (deduplicated) */
	enqueue(monitorId: string): void {
		this.pending.add(monitorId);
		this.drain();
	}

	/** Enqueue all monitors in dependency-level order */
	enqueueAll(): void {
		this.completed = 0;
		this.failed = 0;
		this.batchStartTime = Date.now();

		for (const m of cache.getMonitorsByDependencyLevel()) {
			this.pending.add(m.id);
		}

		Logger.info("Bulk monitor status update enqueued", {
			totalMonitors: this.pending.size,
			concurrency: this.concurrency,
		});

		this.drain();
	}

	/** Returns a promise that resolves when the queue is fully drained */
	flush(): Promise<void> {
		if (this.pending.size === 0 && this.inflight === 0) {
			return Promise.resolve();
		}
		return new Promise((resolve) => this.flushResolvers.push(resolve));
	}

	private drain(): void {
		while (this.inflight < this.concurrency && this.pending.size > 0) {
			const monitorId = this.nextByDependencyLevel();
			if (!monitorId) break;
			this.pending.delete(monitorId);
			this.inflight++;
			this.process(monitorId).finally(() => {
				this.inflight--;
				this.drain(); // pull next item
				if (this.pending.size === 0 && this.inflight === 0) {
					if (this.batchStartTime) {
						Logger.info("Bulk monitor status update complete", {
							completed: this.completed,
							failed: this.failed,
							duration: Date.now() - this.batchStartTime + "ms",
						});
						this.batchStartTime = undefined;
					}
					for (const resolve of this.flushResolvers.splice(0)) resolve();
				}
			});
		}
	}

	/** Pick the pending monitor with the lowest dependency level */
	private nextByDependencyLevel(): string | undefined {
		let best: string | undefined;
		let bestLevel = Infinity;
		for (const id of this.pending) {
			const level = cache.getDependencyLevel(id);
			if (level < bestLevel) {
				bestLevel = level;
				best = id;
			}
		}
		return best;
	}

	private async process(monitorId: string, attempt = 1): Promise<void> {
		const start = Date.now();
		const TIMEOUT = 2000;

		try {
			await Promise.race([
				updateMonitorStatus(monitorId),
				sleep(TIMEOUT).then(() => {
					throw new Error(`Timeout after ${TIMEOUT}ms`);
				}),
			]);

			const duration = Date.now() - start;
			this.completed++;

			Logger.debug("Monitor status updated", {
				monitorId,
				duration: duration + "ms",
				attempt,
			});

			if (duration > 1000) {
				Logger.warn("Slow monitor status update", {
					monitorId,
					duration: duration + "ms",
				});
			}
		} catch (err) {
			if (attempt < this.maxRetries) {
				await sleep(100 * 2 ** attempt);
				return this.process(monitorId, attempt + 1);
			}
			this.failed++;
			Logger.error("Monitor status update failed after retries", {
				monitorId,
				attempts: attempt,
				error: err instanceof Error ? err.message : "Unknown",
			});
		}
	}
}

export const statusUpdater = new StatusUpdater();
