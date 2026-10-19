process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('The ready event has been renamed to clientReady')) {
    return;
  }
});

const dns = require("node:dns");
try {
  dns.setDefaultResultOrder("ipv4first");
  dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1"]);
} catch {
  // Ignore if custom DNS cannot be configured
}

const config = require("./src/config");
const { ClusterManager } = require("discord-hybrid-sharding");
const Logger = require("./src/utils/logger");

try {
  config.validate();
} catch (error) {
  Logger.log(error.message, "error");
  process.exit(1);
}

const manager = new ClusterManager("./index.js", {
  totalShards: "auto",
  shardsPerCluster: 1,
  mode: "process",
  token: config.token,
  respawn: true,
  execArgv: ["--no-deprecation"],
  restarts: {
    max: 5,
    interval: 1000,
  },
});

manager.on("clusterCreate", (cluster) => {
  Logger.system(`Started Cluster #${cluster.id}`);
});

// Shafed Billi (White Cat) Banner
console.log(`\x1b[36m
   /\\_/\\  
  ( o.o )  SHAFED BILLI
   > ^ <   Music System
\x1b[0m`);
Logger.ready("System Initialized! Spawning Clusters...");

manager.spawn({ timeout: -1 });
