import type { Web } from "@rabbit-company/web";
import { Logger } from "../logger";
import { registerPulseRoutes } from "./pulse";
import { registerStatusPageRoutes } from "./status-pages";
import { registerMonitorHistoryRoutes } from "./monitor-history";
import { registerGroupHistoryRoutes } from "./group-history";
import { registerMonitorReportRoutes } from "./monitor-reports";
import { registerGroupReportRoutes } from "./group-reports";
import { registerIncidentRoutes } from "./incidents";

export function registerPublicRoutes(app: Web): void {
	registerPulseRoutes(app);
	registerStatusPageRoutes(app);
	registerMonitorHistoryRoutes(app);
	registerGroupHistoryRoutes(app);
	registerMonitorReportRoutes(app);
	registerGroupReportRoutes(app);
	registerIncidentRoutes(app);

	Logger.info("Public routes registered");
}
