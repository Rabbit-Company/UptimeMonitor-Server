import { clickhouse } from "./clickhouse";
import { Logger } from "./logger";
import type { PulseRow } from "./types";

class PulseBuffer {
	private buffer: PulseRow[] = [];
	private readonly flushInterval: number;
	private readonly maxSize: number;
	private timer?: Timer;

	constructor(opts: { flushInterval?: number; maxSize?: number } = {}) {
		this.flushInterval = opts.flushInterval ?? 5_000;
		this.maxSize = opts.maxSize ?? 10_000;
	}

	start(): void {
		this.timer = setInterval(() => this.flush(), this.flushInterval);
	}

	stop(): void {
		clearInterval(this.timer);
	}

	add(row: PulseRow): void {
		this.buffer.push(row);
		if (this.buffer.length >= this.maxSize) {
			this.flush();
		}
	}

	async flush(): Promise<void> {
		if (this.buffer.length === 0) return;

		const batch = this.buffer;
		this.buffer = [];

		try {
			await clickhouse.insert({
				table: "pulses",
				values: batch,
				format: "JSONEachRow",
				clickhouse_settings: { date_time_input_format: "best_effort" },
			});
		} catch (err: any) {
			Logger.error("Failed to flush pulse buffer", {
				batchSize: batch.length,
				"error.message": err?.message,
			});
			this.buffer = [...batch, ...this.buffer];
		}
	}
}

export const pulseBuffer = new PulseBuffer();
