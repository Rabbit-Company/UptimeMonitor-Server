import { SQL } from "bun";
import { Logger } from "./logger";

export let db: InstanceType<typeof SQL>;

/**
 * Initialize the SQL database.
 * Supports SQLite, PostgreSQL and MySQL via Bun's native SQL driver.
 */
export async function initDatabase(url?: string): Promise<void> {
	const dbUrl = url || process.env["DATABASE_URL"] || "sqlite://./databases/uptime_monitor.db";

	db = new SQL(dbUrl);

	let adapter = "postgresql";
	if (dbUrl.startsWith("mysql://") || dbUrl.startsWith("mysql2://")) {
		adapter = "mysql";
	} else if (dbUrl === ":memory:" || dbUrl.startsWith("sqlite:") || dbUrl.startsWith("file:")) {
		adapter = "sqlite";
		await db`PRAGMA journal_mode = WAL`;
	}

	await createTables();

	Logger.info("Database initialized", { adapter });
}

async function createTables(): Promise<void> {
	await db`
		CREATE TABLE IF NOT EXISTS incidents (
			id TEXT PRIMARY KEY,
			status_page_id TEXT NOT NULL,
			title TEXT NOT NULL,
			status TEXT NOT NULL,
			severity TEXT NOT NULL,
			affected_monitors TEXT NOT NULL DEFAULT '[]',
			suppress_notifications INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			resolved_at TEXT
		)
	`;

	await db`
		CREATE TABLE IF NOT EXISTS incident_updates (
			id TEXT PRIMARY KEY,
			incident_id TEXT NOT NULL,
			status TEXT NOT NULL,
			message TEXT NOT NULL,
			created_at TEXT NOT NULL
		)
	`;

	await db`
		CREATE TABLE IF NOT EXISTS maintenances (
			id TEXT PRIMARY KEY,
			status_page_id TEXT NOT NULL,
			title TEXT NOT NULL,
			status TEXT NOT NULL,
			scheduled_start TEXT NOT NULL,
			scheduled_end TEXT NOT NULL,
			affected_monitors TEXT NOT NULL DEFAULT '[]',
			suppress_notifications INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			completed_at TEXT
		)
	`;

	await db`
		CREATE TABLE IF NOT EXISTS maintenance_updates (
			id TEXT PRIMARY KEY,
			maintenance_id TEXT NOT NULL,
			status TEXT NOT NULL,
			message TEXT NOT NULL,
			created_at TEXT NOT NULL
		)
	`;

	const indexes = [
		`CREATE INDEX IF NOT EXISTS idx_incidents_page_created ON incidents (status_page_id, created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_incident_updates_incident ON incident_updates (incident_id, created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_maintenances_page_start ON maintenances (status_page_id, scheduled_start)`,
		`CREATE INDEX IF NOT EXISTS idx_maintenances_status_start ON maintenances (status, scheduled_start)`,
		`CREATE INDEX IF NOT EXISTS idx_maintenances_status_end ON maintenances (status, scheduled_end)`,
		`CREATE INDEX IF NOT EXISTS idx_maintenance_updates_maint ON maintenance_updates (maintenance_id, created_at)`,
	];

	for (const ddl of indexes) {
		try {
			await db.unsafe(ddl);
		} catch {}
	}
}

/**
 * Gracefully close the database connection.
 */
export async function closeDatabase(): Promise<void> {
	try {
		await db.close();
	} catch {}
}
