import nodemailer, { createTransport } from "nodemailer";
import { Logger } from "../../logger";
import { formatDateTimeLocal, formatDuration } from "../../times";
import type { EmailConfig, NotificationEvent, NotificationProvider } from "../../types";
import { cache } from "../../cache";

export class EmailProvider implements NotificationProvider {
	private transporter: nodemailer.Transporter | null = null;
	private config: EmailConfig;

	constructor(config: EmailConfig) {
		this.config = config;
		this.initializeTransporter();
	}

	private async initializeTransporter(): Promise<void> {
		if (!this.config.enabled) {
			Logger.info("Email notifications disabled");
			return;
		}

		try {
			this.transporter = createTransport({
				host: this.config.smtp.host,
				port: this.config.smtp.port,
				secure: this.config.smtp.secure,
				auth: {
					user: this.config.smtp.auth.user,
					pass: this.config.smtp.auth.pass,
				},
			});

			// Verify connection
			await this.transporter.verify();
			Logger.info("Email transporter initialized successfully", {
				host: this.config.smtp.host,
				port: this.config.smtp.port,
			});
		} catch (error) {
			Logger.error("Failed to initialize email transporter", {
				error: error instanceof Error ? error.message : "Unknown error",
			});
			this.transporter = null;
		}
	}

	async sendNotification(event: NotificationEvent): Promise<void> {
		if (!this.transporter || !this.config.enabled) return;

		try {
			const { subject, htmlBody, textBody } = this.generateEmailContent(event);

			const mailOptions = {
				from: this.config.from,
				to: this.config.to.join(", "),
				subject,
				html: htmlBody,
				text: textBody,
			};

			await this.transporter.sendMail(mailOptions);

			Logger.info("Email notification sent successfully", {
				type: event.type,
				monitorId: event.monitorId,
				monitorName: event.monitorName,
				recipients: this.config.to.length,
			});
		} catch (error) {
			Logger.error("Failed to send email notification", {
				type: event.type,
				monitorId: event.monitorId,
				monitorName: event.monitorName,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}

	private generateEmailContent(event: NotificationEvent): {
		subject: string;
		htmlBody: string;
		textBody: string;
	} {
		const formattedTime = formatDateTimeLocal(event.timestamp);
		const downtimeDuration = event.downtime ? formatDuration(event.downtime) : "Just now";
		const interval = event.sourceType === "group" ? cache.getGroup(event.monitorId)!.interval : cache.getMonitor(event.monitorId)!.interval;

		let subject: string;
		let htmlBody: string;
		let textBody: string;

		switch (event.type) {
			case "down":
				subject = `🚨 Down Alert: ${event.monitorName}`;

				htmlBody = `
          <html>
            <body style="font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5;">
              <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <div style="background-color: #dc3545; color: white; padding: 20px; text-align: center;">
                  <h1 style="margin: 0; font-size: 24px;">${event.sourceType === "group" ? "🚨 Group Down Alert" : "🚨 Monitor Down Alert"}</h1>
                </div>
                <div style="padding: 30px;">
                  <h2 style="color: #dc3545; margin-top: 0;">Service Outage Detected</h2>
                  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                    ${
											event.sourceType === "group"
												? `Group <strong>${event.monitorName}</strong> has degraded below acceptable thresholds.`
												: `Monitor <strong>${event.monitorName}</strong> has stopped responding and is now marked as <strong>DOWN</strong>.`
										}
                  </p>
                  <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 20px 0;">
                    <table style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold; width: 150px;">${event.sourceType === "group" ? "Group:" : "Monitor:"}</td>
                        <td style="padding: 8px 0;">${event.monitorName}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Status:</td>
                        <td style="padding: 8px 0; color: #dc3545; font-weight: bold;">DOWN</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Type:</td>
                        <td style="padding: 8px 0;">${event.sourceType === "group" ? "Group" : "Monitor"}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Detected at:</td>
                        <td style="padding: 8px 0;">${formattedTime}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Downtime:</td>
                        <td style="padding: 8px 0;">${downtimeDuration}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">${event.sourceType === "group" ? "Group ID:" : "Monitor ID:"}</td>
                        <td style="padding: 8px 0; font-family: monospace; font-size: 14px;">${event.monitorId}</td>
                      </tr>
                      ${
												event.groupInfo
													? `
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Strategy:</td>
                        <td style="padding: 8px 0;">${event.groupInfo.strategy}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Children Status:</td>
                        <td style="padding: 8px 0;">${event.groupInfo.childrenUp}/${event.groupInfo.totalChildren} up (${event.groupInfo.upPercentage.toFixed(
															1
													  )}%)</td>
                      </tr>
                      `
													: ""
											}
                    </table>
                  </div>
                  <p style="color: #6c757d; font-size: 14px; margin-top: 30px;">
                    This is an automated notification from your monitoring system.
                  </p>
                </div>
              </div>
            </body>
          </html>
        `;

				textBody = `
🚨 ${event.sourceType === "group" ? "GROUP" : "MONITOR"} DOWN ALERT

Service Outage Detected

${event.sourceType === "group" ? "Group" : "Monitor"}: ${event.monitorName}
Status: DOWN
Type: ${event.sourceType === "group" ? "Group" : "Monitor"}
Detected at: ${formattedTime}
Downtime: ${downtimeDuration}
${event.sourceType === "group" ? "Group" : "Monitor"} ID: ${event.monitorId}
${
	event.groupInfo
		? `Strategy: ${event.groupInfo.strategy}
Children Status: ${event.groupInfo.childrenUp}/${event.groupInfo.totalChildren} up (${event.groupInfo.upPercentage.toFixed(1)}%)`
		: ""
}

This is an automated notification from your monitoring system.
        `.trim();
				break;

			case "still-down":
				subject = `⚠️ Still Down: ${event.monitorName} (${event.consecutiveDownCount || 0} checks)`;

				const totalDowntime = event.downtime ? formatDuration(event.downtime) : `${event.consecutiveDownCount || 0} consecutive checks`;

				htmlBody = `
          <html>
            <body style="font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5;">
              <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <div style="background-color: #fd7e14; color: white; padding: 20px; text-align: center;">
                  <h1 style="margin: 0; font-size: 24px;">⚠️ Monitor Still Down</h1>
                </div>
                <div style="padding: 30px;">
                  <h2 style="color: #fd7e14; margin-top: 0;">Continued Outage</h2>
                  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                    Monitor <strong>${event.monitorName}</strong> remains down after multiple consecutive checks.
                  </p>
                  <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 20px 0;">
                    <table style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold; width: 150px;">Monitor:</td>
                        <td style="padding: 8px 0;">${event.monitorName}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Status:</td>
                        <td style="padding: 8px 0; color: #fd7e14; font-weight: bold;">STILL DOWN</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Type:</td>
                        <td style="padding: 8px 0;">${event.sourceType === "group" ? "Group" : "Monitor"}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Checked at:</td>
                        <td style="padding: 8px 0;">${formattedTime}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Consecutive downs:</td>
                        <td style="padding: 8px 0;">${event.consecutiveDownCount || 0}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Total downtime:</td>
                        <td style="padding: 8px 0;">${totalDowntime}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Monitor ID:</td>
                        <td style="padding: 8px 0; font-family: monospace; font-size: 14px;">${event.monitorId}</td>
                      </tr>
                    </table>
                  </div>
                  <p style="color: #6c757d; font-size: 14px; margin-top: 30px;">
                    This is an automated notification from your monitoring system.
                  </p>
                </div>
              </div>
            </body>
          </html>
        `;

				textBody = `
⚠️ MONITOR STILL DOWN

Continued Outage

Monitor: ${event.monitorName}
Status: STILL DOWN
Type: ${event.sourceType === "group" ? "Group" : "Monitor"}
Checked at: ${formattedTime}
Consecutive downs: ${event.consecutiveDownCount || 0}
Total downtime: ${totalDowntime}
Monitor ID: ${event.monitorId}

This is an automated notification from your monitoring system.
        `.trim();
				break;

			case "recovered":
				subject = `✅ Recovered: ${event.monitorName}`;

				const outageDuration = event.downtime
					? formatDuration(event.downtime)
					: formatDuration((event.previousConsecutiveDownCount || 0) * (interval || 30) * 1000);

				htmlBody = `
          <html>
            <body style="font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5;">
              <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <div style="background-color: #28a745; color: white; padding: 20px; text-align: center;">
                  <h1 style="margin: 0; font-size: 24px;">${event.sourceType === "group" ? "✅ Group Recovered" : "✅ Monitor Recovered"}</h1>
                </div>
                <div style="padding: 30px;">
                  <h2 style="color: #28a745; margin-top: 0;">Service Restored</h2>
                  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                    Great news! ${event.sourceType === "group" ? "Group" : "Monitor"} <strong>${event.monitorName}</strong> has recovered and is now ${
					event.sourceType === "group" ? "healthy" : "responding normally"
				}.
                  </p>
                  <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 20px 0;">
                    <table style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold; width: 150px;">${event.sourceType === "group" ? "Group:" : "Monitor:"}</td>
                        <td style="padding: 8px 0;">${event.monitorName}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Status:</td>
                        <td style="padding: 8px 0; color: #28a745; font-weight: bold;">UP</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Type:</td>
                        <td style="padding: 8px 0;">${event.sourceType === "group" ? "Group" : "Monitor"}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Recovered at:</td>
                        <td style="padding: 8px 0;">${formattedTime}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Previous outage:</td>
                        <td style="padding: 8px 0;">${event.previousConsecutiveDownCount || 0} consecutive down checks</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Total outage duration:</td>
                        <td style="padding: 8px 0;">${outageDuration}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">${event.sourceType === "group" ? "Group ID:" : "Monitor ID:"}</td>
                        <td style="padding: 8px 0; font-family: monospace; font-size: 14px;">${event.monitorId}</td>
                      </tr>
                      ${
												event.groupInfo
													? `
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Strategy:</td>
                        <td style="padding: 8px 0;">${event.groupInfo.strategy}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Children Status:</td>
                        <td style="padding: 8px 0;">${event.groupInfo.childrenUp}/${event.groupInfo.totalChildren} up (${event.groupInfo.upPercentage.toFixed(
															1
													  )}%)</td>
                      </tr>
                      `
													: ""
											}
                    </table>
                  </div>
                  <p style="color: #6c757d; font-size: 14px; margin-top: 30px;">
                    This is an automated notification from your monitoring system.
                  </p>
                </div>
              </div>
            </body>
          </html>
        `;

				textBody = `
✅ ${event.sourceType === "group" ? "GROUP" : "MONITOR"} RECOVERED

Service Restored

${event.sourceType === "group" ? "Group" : "Monitor"}: ${event.monitorName}
Status: UP
Type: ${event.sourceType === "group" ? "Group" : "Monitor"}
Recovered at: ${formattedTime}
Previous outage: ${event.previousConsecutiveDownCount || 0} consecutive down checks
Total outage duration: ${outageDuration}
${event.sourceType === "group" ? "Group" : "Monitor"} ID: ${event.monitorId}
${
	event.groupInfo
		? `Strategy: ${event.groupInfo.strategy}
Children Status: ${event.groupInfo.childrenUp}/${event.groupInfo.totalChildren} up (${event.groupInfo.upPercentage.toFixed(1)}%)`
		: ""
}

This is an automated notification from your monitoring system.
        `.trim();
				break;

			default:
				subject = `Unknown notification type: ${event.type}`;
				htmlBody = `<p>Unknown notification type: ${event.type}</p>`;
				textBody = `Unknown notification type: ${event.type}`;
		}

		return { subject, htmlBody, textBody };
	}
}
