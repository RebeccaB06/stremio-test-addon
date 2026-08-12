const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
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
        { id: "mdblist-complete-history", type: "series", name: "Complete History" },
        { id: "mdblist-last-episode", type: "series", name: "Last Episode of Show Watched" },
        { id: "mdblist-next-episodes", type: "series", name: "Next Episodes" }
    ],
    config: [
        { key: "apiKey", type: "password", title: "MDBList API Key", required: true },
        { key: "username", type: "text", title: "MDBList Username", required: true }
    ],
    behaviorHints: { configurable: true, configurationRequired: true }
};

const builder = new addonBuilder(manifest);

const imdbCache = new Map();

// Bridges the target episode from catalog execution over to the /meta request from Nuvio
const defaultVideoMap = new Map();

function cleanShowTitle(rawTitle) {
    if (!rawTitle) return "";
    return rawTitle
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s*S[0-9]+E[0-9]+.*$/i, "")
        .replace(/\s*Season\s*[0-9]+.*$/i, "")
        .replace(/\s*\([0-9]{4}\)\s*$/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function getSeriesImdbId(showName) {
    const cleanTitle = cleanShowTitle(showName);
    if (!cleanTitle) return Promise.resolve(null);

    const cacheKey = cleanTitle.toLowerCase();
    if (imdbCache.has(cacheKey)) return Promise.resolve(imdbCache.get(cacheKey));

    return new Promise((resolve) => {
        nameToImdb({ name: cleanTitle, type: "series" }, (err, res) => {
            if (err || !res) {
                resolve(null);
            } else {
                imdbCache.set(cacheKey, res);
                resolve(res);
            }
        });
    });
}

/* ==================================================
 * META HANDLER
 * Nuvio fetches this when the show card is tapped
 * ================================================== */
builder.defineMetaHandler(async ({ type, id }) => {
    // id is the parent IMDb ID (e.g., "tt0162065")
    const targetVideoId = defaultVideoMap.get(id);

    const meta = {
        id: id,
        type: "series",
        name: "Series Details"
    };

    // Populate behaviorHints.defaultVideoId so Nuvio's details feature picks it up
    if (targetVideoId) {
        meta.behaviorHints = {
            defaultVideoId: targetVideoId
        };

        const parts = targetVideoId.split(":");
        if (parts.length === 3) {
            meta.videos = [
                {
                    id: targetVideoId,
                    season: Number(parts[1]),
                    episode: Number(parts[2]),
                    title: `Season ${parts[1]} Episode ${parts[2]}`
                }
            ];
        }
    }

    return { meta };
});

/* ==================================================
 * CATALOG HANDLER
 * ================================================== */
builder.defineCatalogHandler(async (args) => {
    if (!["mdblist-complete-history", "mdblist-last-episode", "mdblist-next-episodes"].includes(args.id)) {
        return { metas: [] };
    }

    const username = args.config?.username || "";
    if (!username) return { metas: [] };

    const historyUrl = "https://mdblist.com/history/" + encodeURIComponent(username) + "?type=episode";

    try {
        const response = await fetch(historyUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();

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
                const titleMatch = card.match(/<div class="activity-poster-card__title">\s*<a[^>]*>([\s\S]*?)<\/a>/i);
                const episodeTitleMatch = card.match(/<div class="activity-poster-card__sub">\s*([\s\S]*?)\s*<\/div>/i);

                let rawTitle = titleMatch ? titleMatch[1] : "";
                let episodeTitle = episodeTitleMatch ? episodeTitleMatch[1].replace(/<[^>]+>/g, "").trim() : "";

                const episodeMatch = rawTitle.match(/\bS([0-9]+)E([0-9]+)\b/i);
                if (!episodeMatch) continue;

                history.push({
                    showName: cleanShowTitle(rawTitle),
                    episodeTitle: episodeTitle,
                    season: Number(episodeMatch[1]),
                    episode: Number(episodeMatch[2]),
                    code: `S${episodeMatch[1]}E${episodeMatch[2]}`,
                    poster: posterMatch ? posterMatch[1] : "",
                    watchedDate: watchedDate
                });
            }
        }

        const first100 = history.slice(0, 100);

        const latestByShow = {};
        for (const item of first100) {
            const key = item.showName.toLowerCase().trim();
            if (!latestByShow[key]) latestByShow[key] = item;
        }
        const latestEpisodes = Object.values(latestByShow);

        /* Complete History */
        if (args.id === "mdblist-complete-history") {
            const metas = [];
            for (const item of first100) {
                const imdbId = await getSeriesImdbId(item.showName);
                if (!imdbId) continue;

                // Save target video ID so /meta can send defaultVideoId back to Nuvio
                defaultVideoMap.set(imdbId, `${imdbId}:${item.season}:${item.episode}`);

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
            return { metas, cacheMaxAge: 10 };
        }

        /* Last Episode Watched */
        if (args.id === "mdblist-last-episode") {
            const metas = [];
            for (const item of latestEpisodes) {
                const imdbId = await getSeriesImdbId(item.showName);
                if (!imdbId) continue;

                defaultVideoMap.set(imdbId, `${imdbId}:${item.season}:${item.episode}`);

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
            return { metas, cacheMaxAge: 10 };
        }

        /* Next Episodes */
        if (args.id === "mdblist-next-episodes") {
            const metas = [];
            for (const watched of latestEpisodes) {
                const imdbId = await getSeriesImdbId(watched.showName);
                if (!imdbId) continue;

                const nextEp = watched.episode + 1;
                const nextCode = `S${watched.season}E${nextEp}`;

                defaultVideoMap.set(imdbId, `${imdbId}:${watched.season}:${nextEp}`);

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
