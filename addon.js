const {
    addonBuilder,
    serveHTTP
} = require("stremio-addon-sdk");
const nameToImdb = require("name-to-imdb");

const manifest = {
    id: "com.example.mdblist-history",
    version: "1.0.0",
    name: "MDBList History",
    description: "Shows your recently watched items from MDBList.",
    resources: ["catalog", "meta"],
    types: ["series"],
    idPrefixes: ["tt"],
    catalogs: [
        {
            id: "mdblist-complete-history",
            type: "series",
            name: "Complete History"
        },
        {
            id: "mdblist-last-episode",
            type: "series",
            name: "Last Episode of Show Watched"
        },
        {
            id: "mdblist-next-episodes",
            type: "series",
            name: "Next Episodes"
        }
    ],
    config: [
        {
            key: "apiKey",
            type: "password",
            title: "MDBList API Key",
            required: true
        },
        {
            key: "username",
            type: "text",
            title: "MDBList Username",
            required: true
        }
    ],
    behaviorHints: {
        configurable: true,
        configurationRequired: true
    }
};

const builder = new addonBuilder(manifest);

// In-memory cache to prevent redundant title-to-IMDb lookups
const imdbCache = new Map();

// In-memory cache to map IMDb ID to the target episode details for the Meta Handler
const showEpisodeCache = new Map();

// In-memory cache to store fetched Cinemeta payloads to avoid rate-limiting/high latency
const cinemetaCache = new Map();

/**
 * Clean show name to guarantee only the main series title remains.
 */
function cleanShowTitle(rawTitle) {
    if (!rawTitle) return "";

    return rawTitle
        .replace(/<[^>]+>/g, "")             // Remove HTML tags
        .replace(/&amp;/g, "&")               // Decode entities
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s*S[0-9]+E[0-9]+.*$/i, "") // Strip S01E01 and anything after
        .replace(/\s*Season\s*[0-9]+.*$/i, "")// Strip "Season X..."
        .replace(/\s*\([0-9]{4}\)\s*$/g, "")  // Strip year like (2022) if needed
        .replace(/\s+/g, " ")                 // Normalize spaces
        .trim();
}

/**
 * Helper to cache Cinemeta metadata and avoid memory leaks.
 */
function cacheCinemetaMeta(id, meta) {
    if (cinemetaCache.size >= 100) {
        const firstKey = cinemetaCache.keys().next().value;
        cinemetaCache.delete(firstKey);
    }
    cinemetaCache.set(id, meta);
}

/**
 * Fetches the complete metadata object from Cinemeta to capture the official 'videos' list.
 */
async function getCinemetaMeta(id) {
    const url = `https://v3-cinemeta.strem.io/meta/series/${encodeURIComponent(id)}.json`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Cinemeta returned HTTP ${response.status}`);
        }
        const data = await response.json();
        return data && data.meta ? data.meta : null;
    } catch (error) {
        console.error(`❌ Error fetching Cinemeta meta for ${id}:`, error);
        return null;
    }
}

/**
 * Resolves ONLY the show title to its main series IMDb ID.
 */
function getSeriesImdbId(showName) {
    const cleanTitle = cleanShowTitle(showName);
    
    if (!cleanTitle) {
        console.log("❌ ERROR: Empty show title provided to getSeriesImdbId");
        return Promise.resolve(null);
    }

    const cacheKey = cleanTitle.toLowerCase();
    if (imdbCache.has(cacheKey)) {
        const cachedId = imdbCache.get(cacheKey);
        console.log(`[CACHE HIT] Title: "${cleanTitle}" -> IMDb ID: ${cachedId}`);
        return Promise.resolve(cachedId);
    }

    console.log(`🔍 [NAME-TO-IMDB LOOKUP] Searching for Series Title: "${cleanTitle}"`);

    return new Promise((resolve) => {
        nameToImdb({ name: cleanTitle, type: "series" }, (err, res) => {
            if (err || !res) {
                console.log(`❌ [NAME-TO-IMDB FAILED] Could not resolve IMDb ID for title: "${cleanTitle}"`);
                resolve(null);
            } else {
                console.log(`✅ [NAME-TO-IMDB SUCCESS] Title: "${cleanTitle}" -> IMDb ID: ${res}`);
                imdbCache.set(cacheKey, res);
                resolve(res);
            }
        });
    });
}

/**
 * Hybrid Meta Handler:
 * Dynamically grabs standard Cinemeta details (including full videos lists)
 * and appends the target defaultVideoId to satisfy Stremio and Nuvio clients simultaneously.
 */
builder.defineMetaHandler(async ({ type, id }) => {
    console.log(`\n================================================`);
    console.log(`META REQUEST: Fetching details for ${id}`);
    console.log(`================================================`);

    if (type !== "series") {
        return { meta: null };
    }

    const cached = showEpisodeCache.get(id);
    if (!cached) {
        console.log(`[META CACHE MISS] No episode mapping found for ID: ${id}`);
        return { meta: null };
    }

    console.log(`[META CACHE HIT] Mapping ${id} to ${cached.showName} S${cached.season}E${cached.episode}`);

    // Attempt to pull official, complete metadata from Cinemeta
    let meta = null;
    if (cinemetaCache.has(id)) {
        console.log(`[CINEMETA CACHE HIT] ID: ${id}`);
        meta = JSON.parse(JSON.stringify(cinemetaCache.get(id))); // Deep clone to avoid mutating cache
    } else {
        console.log(`🔍 [CINEMETA API FETCH] ID: ${id}`);
        const fetchedMeta = await getCinemetaMeta(id);
        if (fetchedMeta) {
            cacheCinemetaMeta(id, fetchedMeta);
            meta = JSON.parse(JSON.stringify(fetchedMeta));
        }
    }

    const targetVideoId = `${id}:${cached.season}:${cached.episode}`;

    if (meta) {
        // We inject our targeted defaultVideoId into the Cinemeta metadata.
        // This ensures both Stremio and Nuvio see the full video list as well as the target episode.
        meta.behaviorHints = {
            ...meta.behaviorHints,
            defaultVideoId: targetVideoId
        };
        console.log(`✅ Returning full Cinemeta metadata with custom defaultVideoId: ${targetVideoId}`);
        return { meta };
    } else {
        // Fallback to basic metadata shell if Cinemeta is unreachable
        console.log(`⚠️ Falling back to basic metadata structure`);
        return {
            meta: {
                id: id,
                type: "series",
                name: cached.showName,
                behaviorHints: {
                    defaultVideoId: targetVideoId
                }
            }
        };
    }
});

builder.defineCatalogHandler(async (args) => {
    console.log("\n================================================");
    console.log("CATALOG REQUEST:", JSON.stringify({ type: args.type, id: args.id }));
    console.log("================================================");

    if (
        args.id !== "mdblist-complete-history" &&
        args.id !== "mdblist-last-episode" &&
        args.id !== "mdblist-next-episodes"
    ) {
        return { metas: [] };
    }

    const username = args.config && args.config.username ? args.config.username : "";

    if (!username) {
        console.log("ERROR: No MDBList username received.");
        return { metas: [] };
    }

    const historyUrl = "https://mdblist.com/history/" + encodeURIComponent(username) + "?type=episode";
    console.log("Fetching history from:", historyUrl);

    try {
        const response = await fetch(historyUrl);
        const html = await response.text();

        if (!response.ok) {
            throw new Error(`MDBList returned HTTP ${response.status}`);
        }

        const dayRegex = /<div class="day-group"[^>]*data-date="([^"]+)"[^>]*>([\s\S]*?)<\/div>\s*(?=<div class="day-group"|$)/gi;
        const history = [];
        let dayMatch;

        while ((dayMatch = dayRegex.exec(html)) !== null) {
            const watchedDate = dayMatch[1];
            const dayHtml = dayMatch[2];

            const cardRegex = /<div class="activity-poster-card">([\s\S]*?)<\/div>\s*<\/div>/gi;
            let cardMatch;

            while ((cardMatch = cardRegex.exec(dayHtml)) !== null) {
                const card = cardMatch[1];

                const urlMatch = card.match(/href="(\/show\/[^"]+\/season\/[0-9]+\/episode\/[0-9]+)"/i);
                if (!urlMatch) continue;

                const posterMatch = card.match(/<img[^>]+src="([^"]+)"/i);
                const poster = posterMatch ? posterMatch[1] : "";

                const titleMatch = card.match(/<div class="activity-poster-card__title">\s*<a[^>]*>([\s\S]*?)<\/a>/i);
                let rawTitle = titleMatch ? titleMatch[1] : "";

                const episodeTitleMatch = card.match(/<div class="activity-poster-card__sub">\s*([\s\S]*?)\s*<\/div>/i);
                let episodeTitle = episodeTitleMatch ? episodeTitleMatch[1] : "";

                episodeTitle = episodeTitle
                    .replace(/<[^>]+>/g, "")
                    .replace(/&amp;/g, "&")
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/\s+/g, " ")
                    .trim();

                const episodeMatch = rawTitle.match(/\bS([0-9]+)E([0-9]+)\b/i);
                if (!episodeMatch) continue;

                // Extract show title cleanly
                const showName = cleanShowTitle(rawTitle);

                history.push({
                    path: urlMatch[1],
                    showName: showName,
                    episodeTitle: episodeTitle,
                    season: Number(episodeMatch[1]),
                    episode: Number(episodeMatch[2]),
                    code: "S" + episodeMatch[1] + "E" + episodeMatch[2],
                    poster: poster,
                    watchedDate: watchedDate
                });
            }
        }

        const first100 = history.slice(0, 100);

        /* ==================================================
         * CATALOG: HISTORY
         * ================================================== */
        if (args.id === "mdblist-complete-history") {
            const metas = [];

            for (const item of first100) {
                console.log(`\nProcessing History Item: ${item.showName} (${item.code})`);
                const imdbId = await getSeriesImdbId(item.showName);
                if (!imdbId) continue;

                // Set mapping details for the meta handler
                showEpisodeCache.set(imdbId, {
                    showName: item.showName,
                    season: item.season,
                    episode: item.episode
                });

                metas.push({
                    id: imdbId,
                    type: "series",
                    name: item.showName,
                    poster: item.poster,
                    posterShape: "poster",
                    releaseInfo: item.code,
                    description: `${item.episodeTitle} • Watched ${item.watchedDate}`,
                    behaviorHints: {
                        defaultVideoId: `${imdbId}:${item.season}:${item.episode}`
                    }
                });
            }

            return { metas, cacheMaxAge: 10 };
        }

        /* Deduplicate for latest episodes */
        const latestByShow = {};
        for (const item of first100) {
            const showKey = item.showName.toLowerCase().trim();
            if (!latestByShow[showKey]) {
                latestByShow[showKey] = item;
            }
        }

        const latestEpisodes = Object.values(latestByShow);

        /* ==================================================
         * CATALOG: LAST EPISODE OF SHOW WATCHED
         * ================================================== */
        if (args.id === "mdblist-last-episode") {
            const metas = [];

            for (const item of latestEpisodes) {
                console.log(`\nProcessing Last Episode Item: ${item.showName} (${item.code})`);
                const imdbId = await getSeriesImdbId(item.showName);
                if (!imdbId) continue;

                // Set mapping details for the meta handler
                showEpisodeCache.set(imdbId, {
                    showName: item.showName,
                    season: item.season,
                    episode: item.episode
                });

                metas.push({
                    id: imdbId,
                    type: "series",
                    name: item.showName,
                    poster: item.poster,
                    posterShape: "poster",
                    releaseInfo: item.code,
                    description: `${item.episodeTitle} • Watched ${item.watchedDate}`,
                    behaviorHints: {
                        defaultVideoId: `${imdbId}:${item.season}:${item.episode}`
                    }
                });
            }

            return { metas, cacheMaxAge: 10 };
        }

        /* ==================================================
         * CATALOG: NEXT EPISODES
         * ================================================== */
        if (args.id === "mdblist-next-episodes") {
            const metas = [];

            for (const watched of latestEpisodes) {
                console.log(`\nProcessing Next Episode Item: ${watched.showName}`);
                const imdbId = await getSeriesImdbId(watched.showName);
                if (!imdbId) continue;

                const nextEpisode = watched.episode + 1;
                const nextCode = `S${watched.season}E${nextEpisode}`;

                // Set mapping details for the meta handler (points to next episode)
                showEpisodeCache.set(imdbId, {
                    showName: watched.showName,
                    season: watched.season,
                    episode: nextEpisode
                });

                metas.push({
                    id: imdbId,
                    type: "series",
                    name: watched.showName,
                    poster: watched.poster,
                    posterShape: "poster",
                    releaseInfo: nextCode,
                    description: `Next: ${nextCode}`,
                    behaviorHints: {
                        defaultVideoId: `${imdbId}:${watched.season}:${nextEpisode}`
                    }
                });
            }

            return { metas, cacheMaxAge: 10 };
        }

        return { metas: [] };

    } catch (error) {
        console.error("MDBList History error:", error);
        return { metas: [] };
    }
});

serveHTTP(builder.getInterface(), {
    port: process.env.PORT || 7000
});
