const VARIANT_SOURCE = "\\b(?:official|audio|video|lyrics?|lyric video|hd|4k|8k|remaster(?:ed)?|mv|visuali[sz]er|live|cover|karaoke|instrumental|slowed|reverb|sped up|nightcore|edit|version|full song|video song)\\b";
const VARIANT_WORDS = new RegExp(VARIANT_SOURCE, "gi");
const HAS_VARIANT_WORD = new RegExp(VARIANT_SOURCE, "i");

function cleanText(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTrackText(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/\s*-\s*topic\s*$/i, "")
    .replace(/[([].*?[)\]]/g, (part) => HAS_VARIANT_WORD.test(part) ? " " : part)
    .replace(VARIANT_WORDS, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function youtubeId(uri) {
  return String(uri || "").match(/(?:v=|\/vi?\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] || null;
}

function extractCoreTitles(rawTitle, rawAuthor = "") {
  if (!rawTitle) return [];
  let title = String(rawTitle).trim();

  // 1. Remove leading tags (e.g. "LYRICAL:", "FULL VIDEO:", "AUDIO:", "OFFICIAL VIDEO -")
  title = title.replace(/^(?:lyrical(?:\s*video)?|full\s*(?:video|song|audio)|official\s*(?:video|audio|music\s*video)|video\s*song)\s*[:|-]\s*/i, "");

  // 2. Remove bracketed / parenthesized metadata
  title = title.replace(/\s*[\(\[](?:from\s+["'][^"']+["']|from\s+[^)\]]+|official\b[^)\]]*|audio\b[^)\]]*|video\b[^)\]]*|lyrics?\b[^)\]]*|feat(?:\.|\b)[^)\]]*|ft(?:\.|\b)[^)\]]*|full\s*song\b[^)\]]*|slowed\b[^)\]]*|reverb\b[^)\]]*|remix\b[^)\]]*|8k\b[^)\]]*|4k\b[^)\]]*|hd\b[^)\]]*)[\]\)]/gi, "");

  // 3. Take segment before | or • (everything after is movie / artists / labels)
  const pipeParts = title.split(/[|•]/);
  if (pipeParts.length > 1) {
    title = pipeParts[0].trim();
  }

  // 4. Remove ft. / feat.
  title = title.split(/\s+(?:ft\.?|feat\.?|featuring)\s+/i)[0].trim();

  // 5. Handle "Artist - Song" or "Song - Movie"
  const authorNorm = cleanText(rawAuthor);
  const segments = [];
  if (title.includes(" - ")) {
    const dashParts = title.split(" - ");
    for (const p of dashParts) {
      const pClean = cleanText(p.replace(VARIANT_WORDS, " "));
      if (pClean && pClean !== authorNorm && pClean.length >= 3) {
        segments.push(pClean);
      }
    }
  }

  // 6. Remove variant words
  title = title.replace(VARIANT_WORDS, " ");
  const primary = cleanText(title);

  const results = new Set();
  if (primary && primary.length >= 2) results.add(primary);
  for (const s of segments) {
    if (s && s.length >= 2) results.add(s);
  }
  return [...results];
}

function trackKeys(track) {
  if (!track) return [];
  const fullTitle = cleanText(track.title);
  const author = cleanText(track.author);
  const cores = extractCoreTitles(track.title, track.author);
  const ytid = youtubeId(track.uri) || youtubeId(track.realUri);

  const keys = [
    track.identifier ? `id:${track.identifier}` : null,
    ytid ? `youtube:${ytid}` : null,
    track.uri ? `uri:${track.uri}` : null,
    track.realUri ? `uri:${track.realUri}` : null,
    fullTitle ? `title:${fullTitle}` : null,
    fullTitle && author ? `song:${fullTitle}|${author}` : null,
    ...cores.map((c) => `core:${c}`),
  ];
  return [...new Set(keys.filter(Boolean))];
}

function isSameSong(first, second) {
  if (!first || !second) return false;
  const firstKeys = new Set(trackKeys(first));
  if (trackKeys(second).some((key) => firstKeys.has(key))) return true;

  const firstCores = extractCoreTitles(first.title, first.author);
  const secondCores = extractCoreTitles(second.title, second.author);
  if (firstCores.some((c) => secondCores.includes(c))) return true;

  const firstTitle = normalizeTrackText(first.title);
  const secondTitle = normalizeTrackText(second.title);
  return Boolean(firstTitle && secondTitle && firstTitle === secondTitle);
}

function selectAutoplayCandidate(source, tracks, recentKeys = []) {
  const blocked = new Set(recentKeys);
  const valid = (tracks || []).filter((track) =>
    track?.title &&
    !isSameSong(source, track) &&
    !trackKeys(track).some((key) => blocked.has(key))
  );

  if (valid.length === 0) return null;

  // Pick from the top candidates to preserve recommendation quality with freshness
  const pool = valid.slice(0, Math.min(3, valid.length));
  return pool[Math.floor(Math.random() * pool.length)];
}

function buildAutoplaySearches(track) {
  const title = normalizeTrackText(track?.title);
  const author = normalizeTrackText(track?.author);
  const core = extractCoreTitles(track?.title, track?.author)[0] || title;
  const discovery = author ? `${author} radio` : `${core} similar songs`;
  const mix = author ? `${author} mix` : `${core} radio`;
  const related = [core, author].filter(Boolean).join(" ");
  return [
    ["ytmsearch", discovery],
    ["spsearch", discovery],
    ["ytsearch", mix],
    ["amsearch", discovery],
    ["dzsearch", discovery],
    ["jssearch", discovery],
    ["ytmsearch", related],
    ["spsearch", related],
  ].filter(([, query]) => query);
}

function rememberTracks(existing, tracks, limit = 500) {
  const added = (tracks || []).flatMap(trackKeys);
  return [...new Set([...added, ...(existing || [])])].slice(0, limit);
}

function extractVideoId(track) {
  if (!track) return null;
  const fromUri = youtubeId(track.uri) || youtubeId(track.realUri);
  if (fromUri) return fromUri;
  if (track.identifier && /^[a-zA-Z0-9_-]{11}$/.test(track.identifier)) {
    return track.identifier;
  }
  return null;
}

module.exports = {
  buildAutoplaySearches,
  extractCoreTitles,
  extractVideoId,
  isSameSong,
  normalizeTrackText,
  rememberTracks,
  selectAutoplayCandidate,
  trackKeys,
  youtubeId,
};
