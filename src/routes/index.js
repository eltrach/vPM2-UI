const config = require('../config');
const RateLimit = require('koa2-ratelimit').RateLimit;
const router = require('@koa/router')();
const {
  listApps,
  describeApp,
  reloadApp,
  restartApp,
  stopApp,
  flushLogs,
  restartAllApps,
} = require('../providers/pm2/api');
const { validateAdminUser } = require('../services/admin.service');
const discordService = require('../services/discord.service');
const { readLogsReverse } = require('../utils/read-logs.util');
const { getCurrentGitBranch, getCurrentGitCommit } = require('../utils/git.util');
const { getEnvFileContent } = require('../utils/env.util');
const { isAuthenticated, checkAuthentication } = require('../middlewares/auth');
const AnsiConverter = require('ansi-to-html');
const ansiConvert = new AnsiConverter();
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const authService = require('../services/auth.service');
const bcrypt = require('bcrypt');

const loginRateLimiter = RateLimit.middleware({
  interval: 2 * 60 * 1000, // 2 minutes
  max: 5, // Reduced to 5 attempts per 2 minutes
  prefixKey: '/login',
});

router.get('/', async (ctx) => {
  return ctx.redirect('/login');
});

router.get('/login', loginRateLimiter, checkAuthentication, async (ctx) => {
  return await ctx.render('auth/login', {
    layout: false,
    login: { username: '', password: '', error: null },
  });
});

router.post('/login', loginRateLimiter, checkAuthentication, async (ctx) => {
  const { username, password } = ctx.request.body;
  try {
    const user = await authService.validateUser(username, password, ctx.request.ip);
    ctx.session.isAuthenticated = true;
    ctx.session.user = user;
    ctx.session.ipAddress = ctx.request.ip;

    await discordService.sendNotification({
      title: '🔐 User Login',
      description: 'A user has successfully logged in',
      color: discordService.colors.success,
      fields: [
        {
          name: 'Username',
          value: username,
          inline: true,
        },
        {
          name: 'IP Address',
          value: ctx.request.ip,
          inline: true,
        },
        {
          name: 'Role',
          value: user.role,
          inline: true,
        },
      ],
    });
    return ctx.redirect('/apps');
  } catch (err) {
    await discordService.notifyError(err, 'User Login');
    return await ctx.render('auth/login', {
      layout: false,
      login: { username, password, error: err.message },
    });
  }
});

router.get('/apps', isAuthenticated, async (ctx) => {
  try {
    const apps = await listApps();
    return await ctx.render('apps/dashboard', {
      apps,
    });
  } catch (error) {
    await discordService.notifyError(error, 'Dashboard Load');
    throw error;
  }
});

router.get('/logout', (ctx) => {
  const username = ctx.session.user?.username || 'Unknown User';
  ctx.session = null;
  discordService.sendNotification({
    title: '🚪 User Logout',
    description: 'A user has logged out',
    color: discordService.colors.info,
    fields: [
      {
        name: 'Username',
        value: username,
        inline: true,
      },
      {
        name: 'IP Address',
        value: ctx.request.ip,
        inline: true,
      },
    ],
  });
  return ctx.redirect('/login');
});

router.get('/apps/:appName', isAuthenticated, async (ctx) => {
  const { appName } = ctx.params;
  try {
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
        .join('<br/>');
      stderr.lines = stderr.lines
        .map((log) => {
          return ansiConvert.toHtml(log);
        })
        .join('<br/>');
      return await ctx.render('apps/app', {
        app,
        logs: {
          stdout,
          stderr,
        },
      });
    }
    return ctx.redirect('/apps');
  } catch (error) {
    await discordService.notifyError(error, `App View: ${appName}`);
    throw error;
  }
});

router.get('/api/apps/:appName/logs/:logType', isAuthenticated, async (ctx) => {
  const { appName, logType } = ctx.params;
  const { linePerRequest, nextKey } = ctx.query;
  try {
    if (logType !== 'stdout' && logType !== 'stderr') {
      return (ctx.body = {
        error: 'Log Type must be stdout or stderr',
      });
    }
    const app = await describeApp(appName);
    const filePath = logType === 'stdout' ? app.pm_out_log_path : app.pm_err_log_path;
    let logs = await readLogsReverse({ filePath, nextKey });
    logs.lines = logs.lines
      .map((log) => {
        return ansiConvert.toHtml(log);
      })
      .join('<br/>');
    return (ctx.body = {
      logs,
    });
  } catch (error) {
    await discordService.notifyError(error, `Log View: ${appName} - ${logType}`);
    throw error;
  }
});

router.post('/api/apps/:appName/logs/:logType/clear', isAuthenticated, async (ctx) => {
  const { appName, logType } = ctx.params;
  try {
    if (logType !== 'stdout' && logType !== 'stderr') {
      ctx.status = 400;
      return (ctx.body = 'Log Type must be stdout or stderr');
    }

    const app = await describeApp(appName);
    if (!app) {
      ctx.status = 404;
      return (ctx.body = `Application ${appName} not found`);
    }

    const filePath = logType === 'stdout' ? app.pm_out_log_path : app.pm_err_log_path;

    if (!fs.existsSync(filePath)) {
      ctx.status = 404;
      return (ctx.body = `Log file not found for ${logType}`);
    }

    await fs.promises.truncate(filePath, 0);

    await discordService.sendNotification({
      title: '🧹 Logs Cleared',
      description: `Logs have been cleared for application`,
      color: discordService.colors.info,
      fields: [
        {
          name: 'Application',
          value: appName,
          inline: true,
        },
        {
          name: 'Log Type',
          value: logType,
          inline: true,
        },
        {
          name: 'Cleared By',
          value: ctx.session.user?.username || 'Unknown User',
          inline: true,
        },
      ],
    });

    ctx.status = 200;
    return (ctx.body = `${logType} logs cleared successfully`);
  } catch (error) {
    await discordService.notifyError(error, `Log Clear: ${appName} - ${logType}`);
    throw error;
  }
});

router.post('/api/apps/:appName/reload', isAuthenticated, async (ctx) => {
  const { appName } = ctx.params;
  const initiatedBy = ctx.session.user?.username || 'Unknown User';
  try {
    let apps = await reloadApp(appName);

    // Send initial notification
    await discordService.notifyAppAction(appName, 'reload', initiatedBy);

    if (Array.isArray(apps) && apps.length > 0) {
      // Send completion notification
      await discordService.notifyAppActionComplete(appName, 'reload', initiatedBy);
      return (ctx.body = {
        success: true,
      });
    }
    throw new Error('Failed to reload application');
  } catch (err) {
    await discordService.notifyAppActionFailed(appName, 'reload', initiatedBy, err);
    return (ctx.body = {
      error: err,
    });
  }
});

router.post('/api/apps/:appName/restart', isAuthenticated, async (ctx) => {
  const { appName } = ctx.params;
  const initiatedBy = ctx.session.user?.username || 'Unknown User';
  try {
    let apps = await restartApp(appName);

    // Send initial notification
    await discordService.notifyAppAction(appName, 'restart', initiatedBy);

    if (Array.isArray(apps) && apps.length > 0) {
      // Send completion notification
      await discordService.notifyAppActionComplete(appName, 'restart', initiatedBy);
      return (ctx.body = {
        success: true,
      });
    }
    throw new Error('Failed to restart application');
  } catch (err) {
    await discordService.notifyAppActionFailed(appName, 'restart', initiatedBy, err);
    console.log(err);
    return (ctx.body = {
      error: err,
    });
  }
});

router.post('/api/apps/:appName/stop', isAuthenticated, async (ctx) => {
  const { appName } = ctx.params;
  const initiatedBy = ctx.session.user?.username || 'Unknown User';
  try {
    let apps = await stopApp(appName);

    // Send initial notification
    await discordService.notifyAppAction(appName, 'stop', initiatedBy);

    if (Array.isArray(apps) && apps.length > 0) {
      // Send completion notification
      await discordService.notifyAppActionComplete(appName, 'stop', initiatedBy);
      return (ctx.body = {
        success: true,
      });
    }
    throw new Error('Failed to stop application');
  } catch (err) {
    await discordService.notifyAppActionFailed(appName, 'stop', initiatedBy, err);
    return (ctx.body = {
      error: err,
    });
  }
});

router.post('/api/apps/:appName/logs/flush', isAuthenticated, async (ctx) => {
  try {
    const { appName } = ctx.params;
    await flushLogs(appName);
    ctx.status = 200;
    return (ctx.body = `Logs flushed successfully for ${appName}`);
  } catch (flushError) {
    // Check if error is related to PM2 daemon
    if (flushError.message && flushError.message.includes('ECONNREFUSED')) {
      ctx.status = 503;
      return (ctx.body = 'PM2 daemon is not running. Please start PM2 and try again.');
    }
    throw flushError;
  }
});

router.post('/api/apps/restart-all', isAuthenticated, async (ctx) => {
  const initiatedBy = ctx.session.user?.username || 'Unknown User';
  console.log(ctx.session);
  try {
    // Send initial notification
    await discordService.sendNotification({
      title: '🔄 All Applications Restart',
      description: 'All applications are being restarted',
      color: discordService.colors.warning,
      fields: [
        {
          name: 'Initiated By',
          value: initiatedBy,
          inline: true,
        },
        {
          name: 'Status',
          value: 'In Progress',
          inline: true,
        },
      ],
    });

    const result = await restartAllApps();
    if (result) {
      // Send completion notification
      await discordService.sendNotification({
        title: '✅ All Applications Restart Complete',
        description: 'All applications have been successfully restarted',
        color: discordService.colors.success,
        fields: [
          {
            name: 'Initiated By',
            value: initiatedBy,
            inline: true,
          },
          {
            name: 'Status',
            value: 'Completed',
            inline: true,
          },
        ],
      });

      ctx.status = 200;
      return (ctx.body = {
        success: true,
        message: 'All applications are being restarted',
      });
    }

    // If result is false, send failure notification
    const error = new Error('Failed to restart all applications');
    await discordService.sendNotification({
      title: '❌ All Applications Restart Failed',
      description: 'Failed to restart all applications',
      color: discordService.colors.error,
      fields: [
        {
          name: 'Initiated By',
          value: initiatedBy,
          inline: true,
        },
        {
          name: 'Error',
          value: error.message,
          inline: false,
        },
      ],
    });

    ctx.status = 500;
    return (ctx.body = {
      success: false,
      message: 'Failed to restart applications',
    });
  } catch (error) {
    // Send error notification
    await discordService.sendNotification({
      title: '❌ All Applications Restart Failed',
      description: 'An error occurred while restarting all applications',
      color: discordService.colors.error,
      fields: [
        {
          name: 'Initiated By',
          value: initiatedBy,
          inline: true,
        },
        {
          name: 'Error',
          value: error.message || 'Unknown error',
          inline: false,
        },
      ],
    });

    console.error('Error restarting all applications:', error);
    ctx.status = 500;
    return (ctx.body = {
      success: false,
      message: error.message || 'Failed to restart applications',
    });
  }
});

// Restart Server Route
router.post('/api/restart-server', isAuthenticated, async (ctx) => {
  const initiatedBy = ctx.session.user?.username || 'Unknown User';
  try {
    // Check if we're on Windows
    if (process.platform === 'win32') {
      const error = new Error('Server restart is not supported on Windows');
      await discordService.notifyServerRestartFailed(initiatedBy, error);
      ctx.status = 400;
      ctx.body = {
        success: false,
        message: error.message,
      };
      return;
    }

    // Send initial notification
    await discordService.notifyServerRestart(initiatedBy);

    // Try to execute the reboot command
    const { stdout, stderr } = await execAsync('sudo reboot');

    if (stderr) {
      throw new Error(stderr);
    }

    // Send completion notification
    await discordService.notifyServerRestartComplete(initiatedBy);

    ctx.body = {
      success: true,
      message: 'Server restart initiated',
    };
  } catch (error) {
    console.error('Server restart error:', error);
    await discordService.notifyServerRestartFailed(initiatedBy, error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      message:
        error.message || 'Failed to restart server. Please check if you have sudo permissions.',
    };
  }
});

// Restart MariaDB Route
router.post('/api/restart-mariadb', isAuthenticated, async (ctx) => {
  const initiatedBy = ctx.session.user?.username || 'Unknown User';
  try {
    // Check if we're on Windows
    if (process.platform === 'win32') {
      const error = new Error('MariaDB restart is not supported on Windows');
      await discordService.notifyMariaDBRestartFailed(initiatedBy, error);
      ctx.status = 400;
      ctx.body = {
        success: false,
        message: error.message,
      };
      return;
    }

    // Send initial notification
    await discordService.notifyMariaDBRestart(initiatedBy);

    // Try to execute the MariaDB restart command
    const { stdout, stderr } = await execAsync('sudo systemctl restart mariadb');

    if (stderr) {
      throw new Error(stderr);
    }

    // Send completion notification
    await discordService.notifyMariaDBRestartComplete(initiatedBy);

    ctx.body = {
      success: true,
      message: 'MariaDB restart initiated',
    };
  } catch (error) {
    console.error('MariaDB restart error:', error);
    await discordService.notifyMariaDBRestartFailed(initiatedBy, error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      message:
        error.message || 'Failed to restart MariaDB. Please check if you have sudo permissions.',
    };
  }
});

// test route
router.get('/api/test', isAuthenticated, async (ctx) => {
  return (ctx.body = 'Hello World');
});

// User Management Routes
router.get('/users', isAuthenticated, async (ctx) => {
  try {
    const users = await authService.getUsers();
    return await ctx.render('users/index', {
      users,
      currentUser: ctx.session.user,
    });
  } catch (error) {
    await discordService.notifyError(error, 'User Management');
    throw error;
  }
});

router.post('/api/users', isAuthenticated, async (ctx) => {
  const { username, password, role } = ctx.request.body;
  try {
    await authService.createUser(username, password, role);
    await discordService.sendNotification({
      title: '👤 User Created',
      description: 'A new user has been created',
      color: discordService.colors.success,
      fields: [
        {
          name: 'Username',
          value: username,
          inline: true,
        },
        {
          name: 'Role',
          value: role,
          inline: true,
        },
        {
          name: 'Created By',
          value: ctx.session.user.username,
          inline: true,
        },
      ],
    });
    ctx.status = 201;
    ctx.body = { success: true };
  } catch (error) {
    await discordService.notifyError(error, 'User Creation');
    ctx.status = 400;
    ctx.body = { error: error.message };
  }
});

router.delete('/api/users/:username', isAuthenticated, async (ctx) => {
  const { username } = ctx.params;
  try {
    await authService.deleteUser(username);
    await discordService.sendNotification({
      title: '🗑️ User Deleted',
      description: 'A user has been deleted',
      color: discordService.colors.warning,
      fields: [
        {
          name: 'Username',
          value: username,
          inline: true,
        },
        {
          name: 'Deleted By',
          value: ctx.session.user.username,
          inline: true,
        },
      ],
    });
    ctx.status = 200;
    ctx.body = { success: true };
  } catch (error) {
    await discordService.notifyError(error, 'User Deletion');
    ctx.status = 400;
    ctx.body = { error: error.message };
  }
});

router.post('/api/users/change-password', isAuthenticated, async (ctx) => {
  const { username, newPassword } = ctx.request.body;
  try {
    // If changing own password, require old password
    if (username === ctx.session.user.username) {
      const { oldPassword } = ctx.request.body;
      await authService.changePassword(username, oldPassword, newPassword);
    } else {
      // Admin changing other user's password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);
      const users = await authService.getUsers();
      const user = users.find((u) => u.username === username);
      if (user) {
        user.password = hashedPassword;
        await authService.saveUsers(users);
      }
    }

    await discordService.sendNotification({
      title: '🔑 Password Changed',
      description: "A user's password has been changed",
      color: discordService.colors.info,
      fields: [
        {
          name: 'Username',
          value: username,
          inline: true,
        },
        {
          name: 'Changed By',
          value: ctx.session.user.username,
          inline: true,
        },
      ],
    });
    ctx.status = 200;
    ctx.body = { success: true };
  } catch (error) {
    await discordService.notifyError(error, 'Password Change');
    ctx.status = 400;
    ctx.body = { error: error.message };
  }
});

module.exports = router;
