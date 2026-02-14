import type { Web, Server } from "@rabbit-company/web";
import { Logger } from "../logger";
import { config } from "../config";
import { registerMonitorRoutes } from "./monitors";
import { adminBearerAuth } from "./helpers";
import { registerGroupRoutes } from "./groups";
import { registerStatusPageRoutes } from "./status-pages";
import { registerPulseMonitorRoutes } from "./pulse-monitors";
import { registerNotificationRoutes } from "./notifications";

export function registerAdminAPI(app: Web, getServer: () => Server): void {
	registerMonitorRoutes(app, getServer);
	registerGroupRoutes(app, getServer);
	registerStatusPageRoutes(app, getServer);
	registerPulseMonitorRoutes(app, getServer);
	registerNotificationRoutes(app, getServer);

	app.get("/v1/admin/config", adminBearerAuth(), (ctx) => {
		return ctx.json(config);
	});

	Logger.info("Admin API registered", { prefix: "/v1/admin" });
}
