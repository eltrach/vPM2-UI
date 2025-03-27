const config = require("../config");
const RateLimit = require("koa2-ratelimit").RateLimit;
const router = require("@koa/router")();
const {
  listApps,
  describeApp,
  reloadApp,
  restartApp,
  stopApp,
  flushLogs,
  restartAllApps,
} = require("../providers/pm2/api");
const { validateAdminUser } = require("../services/admin.service");
const { readLogsReverse } = require("../utils/read-logs.util");
const {
  getCurrentGitBranch,
  getCurrentGitCommit,
} = require("../utils/git.util");
const { getEnvFileContent } = require("../utils/env.util");
const { isAuthenticated, checkAuthentication } = require("../middlewares/auth");
const AnsiConverter = require("ansi-to-html");
const ansiConvert = new AnsiConverter();
const fs = require("fs");

const loginRateLimiter = RateLimit.middleware({
  interval: 2 * 60 * 1000, // 2 minutes
  max: 100,
  prefixKey: "/login", // to allow the bdd to Differentiate the endpoint
});

router.get("/", async (ctx) => {
  return ctx.redirect("/login");
});

router.get("/login", loginRateLimiter, checkAuthentication, async (ctx) => {
  return await ctx.render("auth/login", {
    layout: false,
    login: { username: "", password: "", error: null },
  });
});

router.post("/login", loginRateLimiter, checkAuthentication, async (ctx) => {
  const { username, password } = ctx.request.body;
  try {
    await validateAdminUser(username, password);
    ctx.session.isAuthenticated = true;
    return ctx.redirect("/apps");
  } catch (err) {
    return await ctx.render("auth/login", {
      layout: false,
      login: { username, password, error: err.message },
    });
  }
});

router.get("/apps", isAuthenticated, async (ctx) => {
  const apps = await listApps();
  return await ctx.render("apps/dashboard", {
    apps,
  });
});

router.get("/logout", (ctx) => {
  ctx.session = null;
  return ctx.redirect("/login");
});

router.get("/apps/:appName", isAuthenticated, async (ctx) => {
  const { appName } = ctx.params;
  let app = await describeApp(appName);
  if (app) {
    app.git_branch = await getCurrentGitBranch(app.pm2_env_cwd);
    app.git_commit = await getCurrentGitCommit(app.pm2_env_cwd);
    app.env_file = await getEnvFileContent(app.pm2_env_cwd);
    const stdout = await readLogsReverse({ filePath: app.pm_out_log_path });
    const stderr = await readLogsReverse({ filePath: app.pm_err_log_path });
    stdout.lines = stdout.lines
      .map((log) => {
        return ansiConvert.toHtml(log);
      })
      .join("<br/>");
    stderr.lines = stderr.lines
      .map((log) => {
        return ansiConvert.toHtml(log);
      })
      .join("<br/>");
    return await ctx.render("apps/app", {
      app,
      logs: {
        stdout,
        stderr,
      },
    });
  }
  return ctx.redirect("/apps");
});

router.get("/api/apps/:appName/logs/:logType", isAuthenticated, async (ctx) => {
  const { appName, logType } = ctx.params;
  const { linePerRequest, nextKey } = ctx.query;
  if (logType !== "stdout" && logType !== "stderr") {
    return (ctx.body = {
      error: "Log Type must be stdout or stderr",
    });
  }
  const app = await describeApp(appName);
  const filePath =
    logType === "stdout" ? app.pm_out_log_path : app.pm_err_log_path;
  let logs = await readLogsReverse({ filePath, nextKey });
  logs.lines = logs.lines
    .map((log) => {
      return ansiConvert.toHtml(log);
    })
    .join("<br/>");
  return (ctx.body = {
    logs,
  });
});

router.post(
  "/api/apps/:appName/logs/:logType/clear",
  isAuthenticated,
  async (ctx) => {
    const { appName, logType } = ctx.params;
    if (logType !== "stdout" && logType !== "stderr") {
      ctx.status = 400;
      return (ctx.body = "Log Type must be stdout or stderr");
    }

    try {
      const app = await describeApp(appName);
      if (!app) {
        ctx.status = 404;
        return (ctx.body = `Application ${appName} not found`);
      }

      const filePath =
        logType === "stdout" ? app.pm_out_log_path : app.pm_err_log_path;

      if (!fs.existsSync(filePath)) {
        ctx.status = 404;
        return (ctx.body = `Log file not found for ${logType}`);
      }

      // Clear the log file by truncating it
      await fs.promises.truncate(filePath, 0);

      ctx.status = 200;
      return (ctx.body = `${logType} logs cleared successfully`);
    } catch (error) {
      console.error(`Error clearing ${logType} logs for ${appName}:`, error);
      ctx.status = 500;
      return (ctx.body = `Failed to clear ${logType} logs: ${error.message}`);
    }
  }
);

router.post("/api/apps/:appName/reload", isAuthenticated, async (ctx) => {
  try {
    let { appName } = ctx.params;
    let apps = await reloadApp(appName);
    if (Array.isArray(apps) && apps.length > 0) {
      return (ctx.body = {
        success: true,
      });
    }
    return (ctx.body = {
      success: false,
    });
  } catch (err) {
    return (ctx.body = {
      error: err,
    });
  }
});

router.post("/api/apps/:appName/restart", isAuthenticated, async (ctx) => {
  try {
    let { appName } = ctx.params;
    let apps = await restartApp(appName);
    if (Array.isArray(apps) && apps.length > 0) {
      return (ctx.body = {
        success: true,
      });
    }
    return (ctx.body = {
      success: false,
    });
  } catch (err) {
    console.log(err);
    return (ctx.body = {
      error: err,
    });
  }
});

router.post("/api/apps/:appName/stop", isAuthenticated, async (ctx) => {
  try {
    let { appName } = ctx.params;
    let apps = await stopApp(appName);
    if (Array.isArray(apps) && apps.length > 0) {
      return (ctx.body = {
        success: true,
      });
    }
    return (ctx.body = {
      success: false,
    });
  } catch (err) {
    return (ctx.body = {
      error: err,
    });
  }
});

router.post("/api/apps/:appName/logs/flush", isAuthenticated, async (ctx) => {
  try {
    const { appName } = ctx.params;
    await flushLogs(appName);
    ctx.status = 200;
    return (ctx.body = `Logs flushed successfully for ${appName}`);
  } catch (flushError) {
    // Check if error is related to PM2 daemon
    if (flushError.message && flushError.message.includes("ECONNREFUSED")) {
      ctx.status = 503;
      return (ctx.body =
        "PM2 daemon is not running. Please start PM2 and try again.");
    }
    throw flushError;
  }
});

router.post("/api/apps/restart-all", isAuthenticated, async (ctx) => {
  try {
    const result = await restartAllApps();
    if (result) {
      ctx.status = 200;
      return (ctx.body = {
        success: true,
        message: "All applications are being restarted",
      });
    }
    ctx.status = 500;
    return (ctx.body = {
      success: false,
      message: "Failed to restart applications",
    });
  } catch (error) {
    console.error("Error restarting all applications:", error);
    ctx.status = 500;
    return (ctx.body = {
      success: false,
      message: error.message || "Failed to restart applications",
    });
  }
});

// test route
router.get("/api/test", isAuthenticated, async (ctx) => {
  return (ctx.body = "Hello World");
});

module.exports = router;
