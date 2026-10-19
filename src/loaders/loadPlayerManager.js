

const { Kazagumo, Plugins, KazagumoTrack, SupportedSources } = require("kazagumo");
const { Connectors, LoadType } = require("shoukaku");

// Ensure modern Lavalink sources are treated as ready-to-play without redundant re-resolving
if (Array.isArray(SupportedSources)) {
  for (const src of ["ytmusic", "youtubemusic", "deezer", "jiosaavn", "applemusic"]) {
    if (!SupportedSources.includes(src)) SupportedSources.push(src);
  }
}

const searchEngines = {
  DEEZER: "dzsearch",
  SPOTIFY: "spsearch",
  YOUTUBE: "ytsearch",
  JIO_SAAVAN: "jssearch",
  APPLE_MUSIC: "amsearch",
  YOUTUBE_MUSIC: "ytmsearch"
};

const fallbackEngines = ["ytmsearch", "amsearch", "spsearch", "ytsearch"];

module.exports = function loadPlayerManager(client) {
  const manager = new Kazagumo(
    {
      defaultSearchEngine: client.config.node_source,
      send: (guildId, payload) => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) guild.shard.send(payload);
      }
    },
    new Connectors.DiscordJS(client),
    client.config.nodes,
    client.config.node_options
  );

  manager.shoukaku.on("ready", (name, resumed) => {
    const node = manager.shoukaku.nodes.get(name);
    console.log(`[LAVALINK DEBUG] Node "${name}" is ready. Resumed: ${resumed}. SessionID: ${node?.sessionId}`);
  });

  manager.on("playerResolveError", (player, track, message) => {
    client.logger?.log(`[Player] Resolve error for "${track?.title}" in guild ${player?.guildId}: ${message}`, "warn");
  });

  manager.searchEngines = searchEngines;

  manager.defaultSearchEngine = client.config.node_source;

  manager.search = async function (query, options = {}) {
    const node = [...this.shoukaku.nodes.values()][0];
    if (!node) return { type: "SEARCH", tracks: [] };

    const isUrl = /^https?:\/\//.test(query);

    if (isUrl) {
      const directRes = await node.rest.resolve(query).catch(() => null);
      if (directRes && directRes.loadType !== LoadType.ERROR) {
        return processSearchResult(directRes, options.requester);
      }

      if (query.includes('youtube.com') || query.includes('youtu.be')) {
        const videoId = query.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1];
        if (videoId) {
          query = `intitle:${videoId}`;
        }
      }
    }

    const hasPrefix = /^[a-z0-9_-]+:/i.test(query);
    let searchEngineList = [options.engine || this.defaultSearchEngine];
    searchEngineList = [...new Set([...searchEngineList, ...fallbackEngines])];

    for (const engine of searchEngineList) {
      const searchQuery = hasPrefix ? query : `${engine}:${query}`;
      const res = await node.rest.resolve(searchQuery).catch(() => null);

      if (res && res.loadType !== LoadType.ERROR && res.loadType !== LoadType.EMPTY && res.data) {
        const result = processSearchResult(res, options.requester);
        if (result && result.tracks && result.tracks.length > 0) {
          return result;
        }
      }

      if (hasPrefix) break;
    }

    return { type: "SEARCH", tracks: [] };
  };

  function processSearchResult(res, requester) {
    const makeTrack = (data) => {
      const track = new KazagumoTrack(data, requester);
      if (!track.realUri && track.uri) track.realUri = track.uri;
      return track;
    };

    switch (res.loadType) {
      case LoadType.TRACK:
        return {
          type: "TRACK",
          tracks: [makeTrack(res.data)]
        };
      case LoadType.PLAYLIST:
        return {
          type: "PLAYLIST",
          playlistName: res.data.info.name,
          tracks: res.data.tracks.map(makeTrack)
        };
      case LoadType.SEARCH:
        return {
          type: "SEARCH",
          tracks: res.data.map(makeTrack)
        };
      default:
        return { type: "SEARCH", tracks: [] };
    }
  }

  client.manager = manager;
  return manager;
};