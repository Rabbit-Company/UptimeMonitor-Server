import nodemailer, { createTransport } from "nodemailer";
import { Logger } from "../../logger";
import type { EmailConfig, NotificationEvent, NotificationProvider } from "../../types";

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
		const timestamp = event.timestamp.toISOString();
		const formattedTime = event.timestamp.toLocaleString();

		let subject: string;
		let htmlBody: string;
		let textBody: string;

		switch (event.type) {
			case "down":
				subject = this.config.templates.subject.down.replace("{monitorName}", event.monitorName);

				const downtimeMinutes = event.downtime ? Math.round(event.downtime / 60000) : 0;

				htmlBody = `
          <html>
            <body style="font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5;">
              <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <div style="background-color: #dc3545; color: white; padding: 20px; text-align: center;">
                  <h1 style="margin: 0; font-size: 24px;">🚨 Monitor Down Alert</h1>
                </div>
                <div style="padding: 30px;">
                  <h2 style="color: #dc3545; margin-top: 0;">Service Outage Detected</h2>
                  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                    Monitor <strong>${event.monitorName}</strong> has stopped responding and is now marked as <strong>DOWN</strong>.
                  </p>
                  <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 20px 0;">
                    <table style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold; width: 150px;">Monitor:</td>
                        <td style="padding: 8px 0;">${event.monitorName}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Status:</td>
                        <td style="padding: 8px 0; color: #dc3545; font-weight: bold;">DOWN</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Detected at:</td>
                        <td style="padding: 8px 0;">${formattedTime}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Downtime:</td>
                        <td style="padding: 8px 0;">${downtimeMinutes} minutes</td>
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
🚨 MONITOR DOWN ALERT

Service Outage Detected

Monitor: ${event.monitorName}
Status: DOWN
Detected at: ${formattedTime}
Downtime: ${downtimeMinutes} minutes
Monitor ID: ${event.monitorId}

This is an automated notification from your monitoring system.
        `.trim();
				break;

			case "still-down":
				subject = this.config.templates.subject.stillDown
					.replace("{monitorName}", event.monitorName)
					.replace("{consecutiveCount}", String(event.consecutiveDownCount || 0));

				htmlBody = `
          <html>
            <body style="font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5;">
              <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <div style="background-color: #dc3545; color: white; padding: 20px; text-align: center;">
                  <h1 style="margin: 0; font-size: 24px;">⚠️ Monitor Still Down</h1>
                </div>
                <div style="padding: 30px;">
                  <h2 style="color: #dc3545; margin-top: 0;">Continued Outage</h2>
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
                        <td style="padding: 8px 0; color: #dc3545; font-weight: bold;">STILL DOWN</td>
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
Checked at: ${formattedTime}
Consecutive downs: ${event.consecutiveDownCount || 0}
Monitor ID: ${event.monitorId}

This is an automated notification from your monitoring system.
        `.trim();
				break;

			case "recovered":
				subject = this.config.templates.subject.recovered.replace("{monitorName}", event.monitorName);

				htmlBody = `
          <html>
            <body style="font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5;">
              <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <div style="background-color: #28a745; color: white; padding: 20px; text-align: center;">
                  <h1 style="margin: 0; font-size: 24px;">✅ Monitor Recovered</h1>
                </div>
                <div style="padding: 30px;">
                  <h2 style="color: #28a745; margin-top: 0;">Service Restored</h2>
                  <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                    Great news! Monitor <strong>${event.monitorName}</strong> has recovered and is now responding normally.
                  </p>
                  <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 20px 0;">
                    <table style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold; width: 150px;">Monitor:</td>
                        <td style="padding: 8px 0;">${event.monitorName}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: bold;">Status:</td>
                        <td style="padding: 8px 0; color: #28a745; font-weight: bold;">UP</td>
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
✅ MONITOR RECOVERED

Service Restored

Monitor: ${event.monitorName}
Status: UP
Recovered at: ${formattedTime}
Previous outage: ${event.previousConsecutiveDownCount || 0} consecutive down checks
Monitor ID: ${event.monitorId}

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
