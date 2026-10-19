const {
    buildAutoplaySearches,
    extractVideoId,
    rememberTracks,
    selectAutoplayCandidate,
} = require("./autoplay");

async function safeDestroyPlayer(player) {
    if (!player) return;

    try {
        await player.destroy();
    } catch (error) {
        if (error.status === 404) {
            console.log(`Player already destroyed or session not found for guild ${player.guildId}`);
        } else {
            console.error(`Error destroying player for guild ${player.guildId}:`, error);
        }
    }
}

async function handleSessionError(error, player, client) {
    if (error.status === 404 && error.message && error.message.includes('Session not found')) {
        console.log(`Session lost for guild ${player.guildId}, cleaning up...`);

        try {
            if (client.manager.players.has(player.guildId)) {
                client.manager.players.delete(player.guildId);
            }
        } catch (cleanupError) {
            console.error(`Error during session cleanup:`, cleanupError);
        }

        return true;
    }
    return false;
}

async function recreatePlayer(client, guildId, voiceId, textId) {
    try {
        if (client.manager.players.has(guildId)) {
            client.manager.players.delete(guildId);
        }

        const newPlayer = await client.manager.createPlayer({
            guildId: guildId,
            voiceId: voiceId,
            textId: textId,
            volume: 80,
            deaf: true,
        });

        await new Promise(resolve => setTimeout(resolve, 1000));

        if (!newPlayer || !client.manager.players.get(guildId)) {
            throw new Error("Failed to recreate player - connection timeout");
        }

        return newPlayer;
    } catch (error) {
        console.error(`Error recreating player:`, error);
        throw error;
    }
}

async function attemptAutoplay(client, player) {
    try {
        if (!player) return false;
        const autoplay = player.data?.get("autoplay");
        if (!autoplay) return false;
        const loopMode = (player.loop || "none").toString().toLowerCase();
        if (loopMode === "track" || loopMode === "queue") {
            client.logger?.log(`[Autoplay] Skipping autoplay due to loop mode "${loopMode}" in guild ${player.guildId}`, "debug");
            return false;
        }
        if (player.queue?.size > 0) return false;
        if (player.playing || player.paused) return false;
        if (player.data?.get("autoplayInProgress")) return false;

        player.data?.set("autoplayInProgress", true);

        const lastTrack = player.data?.get("lastTrack") || player.queue?.previous?.[0] || null;
        if (!lastTrack || !lastTrack.title) {
            player.data?.delete("autoplayInProgress");
            return false;
        }

        const recentKey = "recentAutoplayIds";
        const historyTracks = player.data?.get("history") || [];
        const previousTracks = player.queue?.previous || [];
        const allPreviousTracks = [lastTrack, ...historyTracks, ...previousTracks];
        let recent = rememberTracks(player.data?.get(recentKey) || [], allPreviousTracks, 500);
        player.data?.set(recentKey, recent);

        let foundTrack = null;
        let videoId = extractVideoId(lastTrack);

        // 1. Try YouTube official recommendation (ytrec / list=RD) if videoId is found
        if (videoId) {
            const ytRecommendationQueries = [
                `ytrec:${videoId}`,
                `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`,
                `https://music.youtube.com/watch?v=${videoId}&list=RDAMVM${videoId}`
            ];

            for (const q of ytRecommendationQueries) {
                try {
                    const res = await player.search(q, {
                        requester: lastTrack.requester || client.user
                    });
                    const candidate = selectAutoplayCandidate(lastTrack, res?.tracks || [], recent);
                    if (candidate) {
                        foundTrack = candidate;
                        player.data?.set("lastAutoplaySource", "ytrec");
                        player.data?.set("lastAutoplayQuery", q);
                        break;
                    }
                } catch { }
            }
        }

        // 2. Fallback to discovery searches if YouTube recommendations were not found
        if (!foundTrack) {
            for (const [engine, query] of buildAutoplaySearches(lastTrack)) {
                try {
                    const res = await player.search(query, {
                        engine,
                        requester: lastTrack.requester || client.user
                    });
                    foundTrack = selectAutoplayCandidate(lastTrack, res?.tracks || [], recent);
                    if (foundTrack) {
                        player.data?.set("lastAutoplaySource", engine);
                        player.data?.set("lastAutoplayQuery", query);
                        break;
                    }
                } catch { }
            }
        }

        if (!foundTrack) {
            client.logger?.log(`[Autoplay] No related tracks found for "${lastTrack.title}" in guild ${player.guildId}`, "debug");
            player.data?.delete("autoplayInProgress");
            return false;
        }

        if (typeof foundTrack.setKazagumo === "function") {
            foundTrack.setKazagumo(client.manager);
        }
        if (!foundTrack.realUri && foundTrack.uri) {
            foundTrack.realUri = foundTrack.uri;
        }

        player.queue.add(foundTrack);
        recent = rememberTracks(recent, [foundTrack], 500);
        player.data?.set(recentKey, recent);
        client.logger?.log(`[Autoplay] Queued "${foundTrack.title}" (source: ${player.data?.get("lastAutoplaySource") || "unknown"}) in guild ${player.guildId}`, "log");

        if (!player.playing && !player.paused) {
            try {
                await player.play();
            } catch (playErr) {
                client.logger?.log(`[Autoplay] Failed to start playback: ${playErr.message}`, "error");
                return false;
            }
        }
        return true;
    } catch (err) {
        client.logger?.log(`[Autoplay] Error: ${err.message}`, "error");
        return false;
    } finally {
        try {
            player?.data?.delete("autoplayInProgress");
        } catch {}
    }
}

module.exports = { safeDestroyPlayer, handleSessionError, recreatePlayer, attemptAutoplay };
