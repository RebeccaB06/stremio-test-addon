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
    idPrefixes: ["mdblist"], // Only route our custom IDs to this addon
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

// In-memory caches
const imdbCache = new Map();
const metaCache = new Map();

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
 * Robust Meta Handler
 * Responds to detail/playback requests for custom mdblist: IDs
 */
builder.defineMetaHandler(async ({ type, id }) => {
    console.log(`\n================================================`);
    console.log(`META REQUEST for ID: ${id}`);
    console.log(`================================================`);

    // Check if we have this item cached in memory
    const cached = metaCache.get(id);
    if (cached) {
        return {
            meta: {
                id: id,
                type: "series",
                name: cached.name,
                poster: cached.poster,
                posterShape: "poster",
                background: cached.poster,
                description: `${cached.episodeTitle ? cached.episodeTitle + ' • ' : ''}Season ${cached.season}, Episode ${cached.episode}`,
                behaviorHints: {
                    defaultVideoId: `${cached.imdbId}:${cached.season}:${cached.episode}`
                },
                videos: [
                    {
                        id: `${cached.imdbId}:${cached.season}:${cached.episode}`,
                        title: cached.episodeTitle || `Episode ${cached.episode}`,
                        season: cached.season,
                        episode: cached.episode,
                        released: new Date().toISOString() // Required by some strict clients to show item as playable
                    }
                ]
            }
        };
    }

    // Fallback if not in memory (e.g., server restart or serverless cold start)
    const parts = id.split(":");
    if (parts[0] === "mdblist" && parts.length >= 4) {
        const imdbId = parts[1];
        const season = Number(parts[2]);
        const episode = Number(parts[3]);

        return {
            meta: {
                id: id,
                type: "series",
                name: "MDBList Item",
                behaviorHints: {
                    defaultVideoId: `${imdbId}:${season}:${episode}`
                },
                videos: [
                    {
                        id: `${imdbId}:${season}:${episode}`,
                        title: `Season ${season} Episode ${episode}`,
                        season: season,
                        episode: episode,
                        released: new Date().toISOString()
                    }
                ]
            }
        };
    }

    return { meta: null };
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

                const metaId = `mdblist:${imdbId}:${item.season}:${item.episode}`;

                // Cache metadata properties
                metaCache.set(metaId, {
                    imdbId,
                    name: item.showName,
                    poster: item.poster,
                    season: item.season,
                    episode: item.episode,
                    episodeTitle: item.episodeTitle,
                    watchedDate: item.watchedDate
                });

                metas.push({
                    id: metaId,
                    type: "series",
                    name: item.showName,
                    poster: item.poster,
                    posterShape: "poster",
                    releaseInfo: item.code,
                    description: `${item.episodeTitle} • Watched ${item.watchedDate}`
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

                const metaId = `mdblist:${imdbId}:${item.season}:${item.episode}`;

                // Cache metadata properties
                metaCache.set(metaId, {
                    imdbId,
                    name: item.showName,
                    poster: item.poster,
                    season: item.season,
                    episode: item.episode,
                    episodeTitle: item.episodeTitle,
                    watchedDate: item.watchedDate
                });

                metas.push({
                    id: metaId,
                    type: "series",
                    name: item.showName,
                    poster: item.poster,
                    posterShape: "poster",
                    releaseInfo: item.code,
                    description: `${item.episodeTitle} • Watched ${item.watchedDate}`
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
                const metaId = `mdblist:${imdbId}:${watched.season}:${nextEpisode}`;

                // Cache metadata properties
                metaCache.set(metaId, {
                    imdbId,
                    name: watched.showName,
                    poster: watched.poster,
                    season: watched.season,
                    episode: nextEpisode,
                    episodeTitle: `Episode ${nextEpisode}`,
                    watchedDate: null
                });

                metas.push({
                    id: metaId,
                    type: "series",
                    name: watched.showName,
                    poster: watched.poster,
                    posterShape: "poster",
                    releaseInfo: nextCode,
                    description: `Next: ${nextCode}`
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
