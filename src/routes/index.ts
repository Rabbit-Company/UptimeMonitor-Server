import type { Web } from "@rabbit-company/web";
import { Logger } from "../logger";
import { registerPulseRoutes } from "./pulse";
import { registerStatusPageRoutes } from "./status-pages";
import { registerMonitorHistoryRoutes } from "./monitor-history";
import { registerGroupHistoryRoutes } from "./group-history";
import { registerMonitorReportRoutes } from "./monitor-reports";
import { registerGroupReportRoutes } from "./group-reports";

export function registerPublicRoutes(app: Web): void {
	registerPulseRoutes(app);
	registerStatusPageRoutes(app);
	registerMonitorHistoryRoutes(app);
	registerGroupHistoryRoutes(app);
	registerMonitorReportRoutes(app);
	registerGroupReportRoutes(app);

	Logger.info("Public routes registered");
}
