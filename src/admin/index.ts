import type { Web, Server } from "@rabbit-company/web";
import { Logger } from "../logger";
import { registerMonitorRoutes } from "./monitors";
import { registerGroupRoutes } from "./groups";
import { registerStatusPageRoutes } from "./status-pages";
import { registerPulseMonitorRoutes } from "./pulse-monitors";
import { registerNotificationRoutes } from "./notifications";
import { registerAdminReportRoutes } from "./reports";
import { registerIncidentRoutes } from "./incidents";
import { registerConfigRoutes } from "./config";

export function registerAdminAPI(app: Web, getServer: () => Server): void {
	registerConfigRoutes(app, getServer);
	registerMonitorRoutes(app, getServer);
	registerGroupRoutes(app, getServer);
	registerStatusPageRoutes(app, getServer);
	registerPulseMonitorRoutes(app, getServer);
	registerNotificationRoutes(app, getServer);
	registerAdminReportRoutes(app);
	registerIncidentRoutes(app, getServer);

	Logger.info("Admin API registered", { prefix: "/v1/admin" });
}
