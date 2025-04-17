const axios = require("axios");
const config = require("../config");

class DiscordService {
  constructor() {
    this.webhookUrl = config.DISCORD_WEBHOOK_URL;
    this.colors = {
      success: 0x00ff00, // Green
      warning: 0xffa500, // Orange
      error: 0xff0000, // Red
      info: 0x00bfff, // Blue
    };
  }

  async sendNotification({
    title,
    description,
    color,
    fields = [],
    timestamp = new Date(),
  }) {
    if (!this.webhookUrl) {
      console.warn(
        "Discord webhook URL not configured. Skipping notification."
      );
      return;
    }

    try {
      const embed = {
        title,
        description,
        color,
        fields,
        timestamp: timestamp.toISOString(),
      };

      await axios.post(this.webhookUrl, {
        embeds: [embed],
      });
    } catch (error) {
      console.error("Failed to send Discord notification:", error);
    }
  }

  async notifyServerRestart(initiatedBy) {
    await this.sendNotification({
      title: "🔄 Server Restart",
      description: "Server restart has been initiated",
      color: this.colors.warning,
      fields: [
        {
          name: "Initiated By",
          value: initiatedBy,
          inline: true,
        },
        {
          name: "Status",
          value: "In Progress",
          inline: true,
        },
      ],
    });
  }

  async notifyMariaDBRestart(initiatedBy) {
    await this.sendNotification({
      title: "💾 MariaDB Restart",
      description: "MariaDB service restart has been initiated",
      color: this.colors.warning,
      fields: [
        {
          name: "Initiated By",
          value: initiatedBy,
          inline: true,
        },
        {
          name: "Status",
          value: "In Progress",
          inline: true,
        },
      ],
    });
  }

  async notifyAppAction(appName, action, initiatedBy) {
    const actionEmojis = {
      restart: "🔄",
      reload: "🔄",
      stop: "⏹️",
      start: "▶️",
    };

    await this.sendNotification({
      title: `${actionEmojis[action] || "⚡"} Application ${
        action.charAt(0).toUpperCase() + action.slice(1)
      }`,
      description: `Application "${appName}" has been ${action}ed`,
      color: this.colors.info,
      fields: [
        {
          name: "Application",
          value: appName,
          inline: true,
        },
        {
          name: "Action",
          value: action,
          inline: true,
        },
        {
          name: "Initiated By",
          value: initiatedBy,
          inline: true,
        },
      ],
    });
  }

  async notifyError(error, context) {
    await this.sendNotification({
      title: "❌ Error Occurred",
      description: `An error occurred in ${context}`,
      color: this.colors.error,
      fields: [
        {
          name: "Error Message",
          value: error.message || "Unknown error",
          inline: false,
        },
        {
          name: "Context",
          value: context,
          inline: true,
        },
      ],
    });
  }

  async notifyServerRestartComplete(initiatedBy) {
    await this.sendNotification({
      title: "✅ Server Restart Complete",
      description: "Server has been successfully restarted",
      color: this.colors.success,
      fields: [
        {
          name: "Initiated By",
          value: initiatedBy,
          inline: true,
        },
        {
          name: "Status",
          value: "Completed",
          inline: true,
        },
      ],
    });
  }

  async notifyServerRestartFailed(initiatedBy, error) {
    await this.sendNotification({
      title: "❌ Server Restart Failed",
      description: "Server restart operation failed",
      color: this.colors.error,
      fields: [
        {
          name: "Initiated By",
          value: initiatedBy,
          inline: true,
        },
        {
          name: "Error",
          value: error.message || "Unknown error",
          inline: false,
        },
      ],
    });
  }

  async notifyMariaDBRestartComplete(initiatedBy) {
    await this.sendNotification({
      title: "✅ MariaDB Restart Complete",
      description: "MariaDB service has been successfully restarted",
      color: this.colors.success,
      fields: [
        {
          name: "Initiated By",
          value: initiatedBy,
          inline: true,
        },
        {
          name: "Status",
          value: "Completed",
          inline: true,
        },
      ],
    });
  }

  async notifyMariaDBRestartFailed(initiatedBy, error) {
    await this.sendNotification({
      title: "❌ MariaDB Restart Failed",
      description: "MariaDB restart operation failed",
      color: this.colors.error,
      fields: [
        {
          name: "Initiated By",
          value: initiatedBy,
          inline: true,
        },
        {
          name: "Error",
          value: error.message || "Unknown error",
          inline: false,
        },
      ],
    });
  }

  async notifyAppActionComplete(appName, action, initiatedBy) {
    const actionEmojis = {
      restart: "✅",
      reload: "✅",
      stop: "✅",
      start: "✅",
    };

    await this.sendNotification({
      title: `${actionEmojis[action] || "✅"} Application ${
        action.charAt(0).toUpperCase() + action.slice(1)
      } Complete`,
      description: `Application "${appName}" has been successfully ${action}ed`,
      color: this.colors.success,
      fields: [
        {
          name: "Application",
          value: appName,
          inline: true,
        },
        {
          name: "Action",
          value: action,
          inline: true,
        },
        {
          name: "Initiated By",
          value: initiatedBy,
          inline: true,
        },
      ],
    });
  }

  async notifyAppActionFailed(appName, action, initiatedBy, error) {
    const actionEmojis = {
      restart: "❌",
      reload: "❌",
      stop: "❌",
      start: "❌",
    };

    await this.sendNotification({
      title: `${actionEmojis[action] || "❌"} Application ${
        action.charAt(0).toUpperCase() + action.slice(1)
      } Failed`,
      description: `Failed to ${action} application "${appName}"`,
      color: this.colors.error,
      fields: [
        {
          name: "Application",
          value: appName,
          inline: true,
        },
        {
          name: "Action",
          value: action,
          inline: true,
        },
        {
          name: "Initiated By",
          value: initiatedBy,
          inline: true,
        },
        {
          name: "Error",
          value: error.message || "Unknown error",
          inline: false,
        },
      ],
    });
  }
}

module.exports = new DiscordService();
