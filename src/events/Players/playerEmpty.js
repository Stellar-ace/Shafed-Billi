module.exports = {
  name: "playerEmpty",
  run: async (client, player) => {
    client.logger?.log(`[Player] Queue empty in guild ${player.guildId}`, "log");
    try {
      const { attemptAutoplay } = require("../../utils/playerUtils");
      const queued = await attemptAutoplay(client, player);
      if (queued) return;
    } catch (e) {
      client.logger?.log(`[Autoplay] playerEmpty hook error: ${e.message}`, "error");
    }
    if (!player.queue?.current && !player.playing) {
      const { syncVoiceChannelStatus } = require("../../utils/voiceChannelStatus");
      await syncVoiceChannelStatus(client, player, { state: "idle" });
    }
  },
};
