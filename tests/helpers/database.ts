import { afterAll, beforeAll, beforeEach } from "bun:test";
import { closeDatabase, db, initDatabase } from "../../src/database";

/** Give the current test file a fresh in-memory SQLite database, emptied before every test. */
export function useDatabase(): void {
	beforeAll(async () => {
		await initDatabase("sqlite://:memory:");
	});

	beforeEach(async () => {
		await db`DELETE FROM incident_updates`;
		await db`DELETE FROM incidents`;
		await db`DELETE FROM maintenance_updates`;
		await db`DELETE FROM maintenances`;
	});

	afterAll(async () => {
		await closeDatabase();
	});
}
