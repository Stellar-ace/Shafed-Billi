

const { Client, GatewayIntentBits, Collection } = require("discord.js");
const mongoose = require("mongoose");
const { ClusterClient, getInfo } = require("discord-hybrid-sharding");
const loadPlayerManager = require("../loaders/loadPlayerManager");
const initializeAccessCleanup = require("../utils/accessCleanup");
const { discordShardOptions, resolveClusterInfo } = require("../utils/clusterMode");
const VoiceHealthMonitor = require("../utils/voiceHealthMonitor");

class MusicBot extends Client {
  constructor() {
    const clusterInfo = resolveClusterInfo(getInfo);
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
      ],
      properties: {
        browser: "Discord Android",
      },
      allowedMentions: {
        parse: ["users"],
        repliedUser: false,
      },
      ...discordShardOptions(clusterInfo),
    });

    this.commands = new Collection();
    this.slashCommands = new Collection();
    this.config = require("../config.js");
    this.config.validate();
    this.owners = this.config.ownerID;
    this.prefix = this.config.prefix;
    this.color = this.config.color;
    this.embedColor = this.config.color;
    this.button = require("../custom/button.js");
    this.embed = require("../custom/embed.js")(this.color);
    require("../custom/numformat")(this);
    this.aliases = new Collection();
    this.logger = require("../utils/logger.js");
    this.emoji = require("../emojis.js");
    this.emojiReady = Promise.resolve(this.emoji);
    this.cluster = clusterInfo ? new ClusterClient(this) : null;
    this.clusterInfo = clusterInfo || {
      SHARD_LIST: [0],
      TOTAL_SHARDS: 1,
      CLUSTER_COUNT: 1,
      CLUSTER: 0,
      CLUSTER_MANAGER_MODE: "standalone",
    };
    if (!this.token) this.token = this.config.token;
    this.manager = null;
    this.spamMap = new Map();
    this.cooldowns = new Collection();
    this.voiceHealthMonitor = new VoiceHealthMonitor(this);

    if (process.env.DEBUG_VOICE === "true") {
      this.on("raw", (packet) => {
        if (["VOICE_SERVER_UPDATE", "VOICE_STATE_UPDATE"].includes(packet.t)) {
          this.logger.log(`[Voice debug] ${packet.t} for guild ${packet.d?.guild_id || "unknown"}`, "debug");
        }
      });
    }

    this._connectMongodb().catch((error) => {
      this.logger.log(`[DB] Connection setup error: ${error.message}`, "error");
    });
    initializeAccessCleanup(this);
    loadPlayerManager(this);
    [
      "loadClients",
      "loadCommands",
      "loadNodes",
      "loadPlayers",
    ].forEach((handler) => {
      require(`../loaders/${handler}`)(this);
    });
  }
  async _connectMongodb() {
    if (!this.config.mongourl) {
      this.logger.log("[DB] No MONGODB_URL provided in configuration.", "warn");
      return;
    }

    const dns = require("node:dns");
    try {
      dns.setDefaultResultOrder("ipv4first");
      dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1"]);
    } catch {
      // Ignore if custom DNS cannot be configured
    }

    const dbOptions = {
      autoIndex: false,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
      serverSelectionTimeoutMS: 30000,
      family: 4,
    };

    mongoose.set("strictQuery", false);
    mongoose.Promise = global.Promise;

    mongoose.connection.on("connected", () => {
      this.logger.log("[DB] Database connected", "ready");
    });

    mongoose.connection.on("error", (err) => {
      this.logger.log(`[DB] Mongoose connection error: ${err.message || err}`, "error");
    });

    mongoose.connection.on("disconnected", () => {
      this.logger.log("[DB] Mongoose disconnected", "warn");
    });

    const connectWithRetry = async (attempt = 1) => {
      try {
        await mongoose.connect(this.config.mongourl, dbOptions);
      } catch (error) {
        this.logger.log(`[DB] Initial connection failed (attempt ${attempt}): ${error.message}`, "error");
        setTimeout(() => connectWithRetry(attempt + 1), 5000);
      }
    };

    await connectWithRetry();
  }

  connect() {
    return super.login(this.token);
  }
}

module.exports = MusicBot;
