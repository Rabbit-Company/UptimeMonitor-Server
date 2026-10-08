/**
 * In-memory stand-ins for the external services the server talks to.
 * They are installed by tests/setup.ts before any source module is loaded.
 */

export interface RecordedQuery {
	query: string;
	query_params?: Record<string, unknown>;
}

export interface RecordedInsert {
	table: string;
	values: Record<string, any>[];
}

export interface PublishedMessage {
	channel: string;
	message: any;
}

type QueryHandler = (query: string, params: Record<string, unknown>) => unknown[] | undefined;

class FakeClickHouse {
	queries: RecordedQuery[] = [];
	inserts: RecordedInsert[] = [];
	commands: string[] = [];
	private handler: QueryHandler | null = null;
	private failure: Error | null = null;

	/** Decide which rows a query returns. Returning undefined yields no rows. */
	onQuery(handler: QueryHandler): void {
		this.handler = handler;
	}

	/** Make every call reject, as if ClickHouse was unreachable. */
	failWith(error: Error): void {
		this.failure = error;
	}

	reset(): void {
		this.queries = [];
		this.inserts = [];
		this.commands = [];
		this.handler = null;
		this.failure = null;
	}

	/** Rows inserted into a table across all recorded inserts. */
	rows(table: string): Record<string, any>[] {
		return this.inserts.filter((i) => i.table === table).flatMap((i) => i.values);
	}

	readonly client = {
		query: async (params: { query: string; query_params?: Record<string, unknown> }) => {
			if (this.failure) throw this.failure;
			this.queries.push({ query: params.query, query_params: params.query_params });
			const rows = this.handler?.(params.query, params.query_params ?? {}) ?? [];
			return { json: async () => rows, text: async () => JSON.stringify(rows), close: () => {} };
		},
		insert: async (params: { table: string; values: Record<string, any>[] }) => {
			if (this.failure) throw this.failure;
			this.inserts.push({ table: params.table, values: params.values });
			return { executed: true, query_id: "test" };
		},
		command: async (params: { query: string }) => {
			if (this.failure) throw this.failure;
			this.commands.push(params.query);
			return { query_id: "test" };
		},
		exec: async (params: { query: string }) => {
			if (this.failure) throw this.failure;
			this.commands.push(params.query);
			return { query_id: "test" };
		},
		ping: async () => ({ success: !this.failure }),
		close: async () => {},
	};
}

class FakeServer {
	published: PublishedMessage[] = [];
	pendingWebSockets = 0;

	publish(channel: string, message: string): number {
		let parsed: any = message;
		try {
			parsed = JSON.parse(message);
		} catch {}
		this.published.push({ channel, message: parsed });
		return 0;
	}

	reset(): void {
		this.published = [];
	}

	/** Messages published with a given action. */
	byAction(action: string): PublishedMessage[] {
		return this.published.filter((p) => p.message?.action === action);
	}
}

export const fakeClickHouse = new FakeClickHouse();
export const fakeServer = new FakeServer();
