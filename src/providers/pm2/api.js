const pm2 = require("pm2");
const { bytesToSize, timeSince } = require("./ux.helper");

// Safely handle PM2 operations
const safePM2Connect = () => {
  return new Promise((resolve, reject) => {
    try {
      pm2.connect(false, (err) => {
        if (err) {
          reject(new Error("Failed to connect to PM2"));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(new Error("PM2 connection error"));
    }
  });
};

const safePM2Disconnect = () => {
  try {
    pm2.disconnect();
  } catch (error) {
    console.error("PM2 disconnect error:", error);
  }
};

function listApps() {
  return new Promise((resolve, reject) => {
    try {
      safePM2Connect()
        .then(() => {
          pm2.list((err, apps) => {
            try {
              safePM2Disconnect();
              if (err) {
                reject(err);
                return;
              }
              apps = apps.map((app) => {
                return {
                  name: app.name,
                  status: app.pm2_env.status,
                  cpu: app.monit.cpu,
                  memory: bytesToSize(app.monit.memory),
                  uptime: timeSince(app.pm2_env.pm_uptime),
                  pm_id: app.pm_id,
                };
              });
              resolve(apps);
            } catch (error) {
              reject(error);
            }
          });
        })
        .catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

function describeApp(appName) {
  return new Promise((resolve, reject) => {
    try {
      safePM2Connect()
        .then(() => {
          pm2.describe(appName, (err, apps) => {
            try {
              safePM2Disconnect();
              if (err) {
                reject(err);
                return;
              }
              if (Array.isArray(apps) && apps.length > 0) {
                const app = {
                  name: apps[0].name,
                  status: apps[0].pm2_env.status,
                  cpu: apps[0].monit.cpu,
                  memory: bytesToSize(apps[0].monit.memory),
                  uptime: timeSince(apps[0].pm2_env.pm_uptime),
                  pm_id: apps[0].pm_id,
                  pm_out_log_path: apps[0].pm2_env.pm_out_log_path,
                  pm_err_log_path: apps[0].pm2_env.pm_err_log_path,
                  pm2_env_cwd: apps[0].pm2_env.pm_cwd,
                };
                resolve(app);
              } else {
                resolve(null);
              }
            } catch (error) {
              reject(error);
            }
          });
        })
        .catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

function reloadApp(process) {
  return new Promise((resolve, reject) => {
    try {
      safePM2Connect()
        .then(() => {
          pm2.reload(process, (err, proc) => {
            try {
              safePM2Disconnect();
              if (err) {
                reject(err);
                return;
              }
              resolve(proc);
            } catch (error) {
              reject(error);
            }
          });
        })
        .catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

function stopApp(process) {
  return new Promise((resolve, reject) => {
    try {
      safePM2Connect()
        .then(() => {
          pm2.stop(process, (err, proc) => {
            try {
              safePM2Disconnect();
              if (err) {
                reject(err);
                return;
              }
              resolve(proc);
            } catch (error) {
              reject(error);
            }
          });
        })
        .catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

function restartApp(process) {
  return new Promise((resolve, reject) => {
    try {
      safePM2Connect()
        .then(() => {
          console.log("Connected to PM2");
          pm2.restart(process, (err, proc) => {
            try {
              safePM2Disconnect();
              if (err) {
                reject(err);
                return;
              }
              resolve(proc);
            } catch (error) {
              reject(error);
            }
          });
        })
        .catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

function flushLogs(appName) {
  return new Promise((resolve, reject) => {
    try {
      safePM2Connect()
        .then(() => {
          console.log("Flushing logs for app:", appName);
          pm2.flush(appName, (err, proc) => {
            try {
              safePM2Disconnect();
              if (err) {
                reject(err);
                return;
              }
              resolve(proc);
            } catch (error) {
              reject(error);
            }
          });
        })
        .catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

function restartAllApps() {
  return new Promise((resolve, reject) => {
    try {
      safePM2Connect()
        .then(() => {
          console.log("Connected to PM2 - Restarting all applications");
          pm2.restart("all", (err, proc) => {
            try {
              safePM2Disconnect();
              if (err) {
                reject(err);
                return;
              }
              resolve(proc);
            } catch (error) {
              reject(error);
            }
          });
        })
        .catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  listApps,
  describeApp,
  reloadApp,
  stopApp,
  restartApp,
  flushLogs,
  restartAllApps,
};
