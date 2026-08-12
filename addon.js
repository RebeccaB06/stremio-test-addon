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
    resources: ["catalog"],
    types: ["series"],
    idPrefixes: ["tt"], // REQUIRED so Stremio knows 'tt...' maps to Cinemeta
    catalogs: [
        {
            id: "mdblist-history",
            type: "series",
            name: "History"
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

// Simple in-memory cache to prevent repetitive IMDb lookups
const imdbCache = new Map();

/**
 * Resolves a show name to an IMDb ID using name-to-imdb.
 */
function getSeriesImdbId(showName) {
    if (!showName) return Promise.resolve(null);

    const cleanName = showName.trim();
    if (imdbCache.has(cleanName.toLowerCase())) {
        return Promise.resolve(imdbCache.get(cleanName.toLowerCase()));
    }

    return new Promise((resolve) => {
        nameToImdb({ name: cleanName, type: "series" }, (err, res) => {
            if (err || !res) {
                console.log(`Failed to resolve IMDb ID for series: "${cleanName}"`);
                resolve(null);
            } else {
                imdbCache.set(cleanName.toLowerCase(), res);
                resolve(res);
            }
        });
    });
}

builder.defineCatalogHandler(async (args) => {
    console.log(
        "CATALOG REQUEST:",
        JSON.stringify({
            type: args.type,
            id: args.id,
            hasConfig: !!args.config,
            hasUsername: !!(args.config && args.config.username)
        })
    );

    if (
        args.id !== "mdblist-history" &&
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

    console.log("Fetching history:", historyUrl);

    try {
        /* ==================================================
         * STEP 1: Fetch MDBList history HTML
         * ================================================== */
        const response = await fetch(historyUrl);
        const html = await response.text();

        if (!response.ok) {
            throw new Error(`MDBList returned HTTP ${response.status}`);
        }

        /* ==================================================
         * STEP 2: Extract day-groups and activity cards
         * ================================================== */
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

                const episodePath = urlMatch[1];

                const posterMatch = card.match(/<img[^>]+src="([^"]+)"/i);
                const poster = posterMatch ? posterMatch[1] : "";

                const titleMatch = card.match(/<div class="activity-poster-card__title">\s*<a[^>]*>([\s\S]*?)<\/a>/i);
                let title = titleMatch ? titleMatch[1] : "";

                title = title
                    .replace(/<[^>]+>/g, "")
                    .replace(/&amp;/g, "&")
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/\s+/g, " ")
                    .trim();

                const episodeTitleMatch = card.match(/<div class="activity-poster-card__sub">\s*([\s\S]*?)\s*<\/div>/i);
                let episodeTitle = episodeTitleMatch ? episodeTitleMatch[1] : "";

                episodeTitle = episodeTitle
                    .replace(/<[^>]+>/g, "")
                    .replace(/&amp;/g, "&")
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/\s+/g, " ")
                    .trim();

                const episodeMatch = title.match(/\bS([0-9]+)E([0-9]+)\b/i);
                if (!episodeMatch) continue;

                const season = Number(episodeMatch[1]);
                const episode = Number(episodeMatch[2]);
                const showName = title.replace(/\s*S[0-9]+E[0-9]+\s*$/i, "").trim();

                history.push({
                    path: episodePath,
                    showName: showName,
                    episodeTitle: episodeTitle,
                    season: season,
                    episode: episode,
                    code: "S" + episodeMatch[1] + "E" + episodeMatch[2],
                    poster: poster,
                    watchedDate: watchedDate
                });
            }
        }

        /* ==================================================
         * STEP 3: Take first 100 items
         * ================================================== */
        const first100 = history.slice(0, 100);

        /* ==================================================
         * CATALOG: HISTORY
         * ================================================== */
        if (args.id === "mdblist-history") {
            const metas = [];

            for (const item of first100) {
                const imdbId = await getSeriesImdbId(item.showName);
                if (!imdbId) continue;

                metas.push({
                    id: imdbId,
                    type: "series",
                    name: item.showName,
                    poster: item.poster,
                    posterShape: "poster",
                    releaseInfo: item.code,
                    description: `${item.episodeTitle} • Watched ${item.watchedDate}`
                });
            }

            return { metas, cacheMaxAge: 60 };
        }

        /* ==================================================
         * STEP 4: Deduplicate for Latest Episodes per show
         * ================================================== */
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
                const imdbId = await getSeriesImdbId(item.showName);
                if (!imdbId) continue;

                metas.push({
                    id: imdbId,
                    type: "series",
                    name: item.showName,
                    poster: item.poster,
                    posterShape: "poster",
                    releaseInfo: item.code,
                    description: `${item.episodeTitle} • Watched ${item.watchedDate}`
                });
            }

            return { metas, cacheMaxAge: 60 };
        }

        /* ==================================================
         * CATALOG: NEXT EPISODES
         * ================================================== */
        if (args.id === "mdblist-next-episodes") {
            const metas = [];

            for (const watched of latestEpisodes) {
                const imdbId = await getSeriesImdbId(watched.showName);
                if (!imdbId) continue;

                const nextEpisode = watched.episode + 1;
                const nextCode = `S${watched.season}E${nextEpisode}`;

                metas.push({
                    id: imdbId,
                    type: "series",
                    name: watched.showName,
                    poster: watched.poster,
                    posterShape: "poster",
                    releaseInfo: nextCode,
                    description: `Next: ${nextCode}`
                });
            }

            return { metas, cacheMaxAge: 60 };
        }

        return { metas: [] };

    } catch (error) {
        console.error("MDBList History error:", error);
        return { metas: [] };
    }
});

/*
 * Start the addon.
 */
serveHTTP(builder.getInterface(), {
    port: process.env.PORT || 7000
});
