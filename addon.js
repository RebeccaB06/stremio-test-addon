const {
    addonBuilder,
    serveHTTP
} = require("stremio-addon-sdk");

const manifest = {
    id: "com.example.mdblist-history",
    version: "1.0.0",
    name: "MDBList Recently Watched",
    description: "Shows recently watched MDBList episodes and movies.",

    resources: ["catalog"],

    types: ["movie", "series"],

    catalogs: [
        {
            type: "series",
            id: "mdblist-recently-watched",
            name: "MDBList Recently Watched"
        }
    ],

    config: [
        {
            key: "apiKey",
            type: "password",
            title: "MDBList API Key",
            required: true
        }
    ],

    behaviorHints: {
        configurable: true,
        configurationRequired: true
    }
};

const builder = new addonBuilder(manifest);


/*
 * Fetch watched episodes from MDBList.
 *
 * MDBList documents mediatype=episode for
 * /sync/watched.
 */
async function getWatchedEpisodes(apiKey) {

    const params = new URLSearchParams({
        apikey: apiKey,
        mediatype: "episode",
        limit: "1000",
        append_to_response: "poster"
    });

    const response = await fetch(
        `https://api.mdblist.com/sync/watched?${params}`
    );

    const text = await response.text();

    console.log(
        "MDBList episode request:",
        response.status
    );

    if (!response.ok) {
        throw new Error(
            `MDBList returned HTTP ${response.status}: ${text}`
        );
    }

    return JSON.parse(text);
}


/*
 * Get the array from the MDBList response.
 */
function getItems(data) {

    if (Array.isArray(data)) {
        return data;
    }

    if (Array.isArray(data.items)) {
        return data.items;
    }

    if (Array.isArray(data.results)) {
        return data.results;
    }

    return [];
}


/*
 * Find the IMDb ID for an episode.
 */
function getImdbId(item) {

    return (
        item.imdb_id ||
        item.imdbid ||
        item.ids?.imdb ||
        item.episode?.ids?.imdb ||
        item.ids?.imdb_id ||
        item.episode?.imdb_id
    );
}


/*
 * Find the show IMDb ID.
 *
 * Stremio's episode IDs are normally the IMDb ID
 * of the episode itself, which lets Stremio resolve
 * the episode correctly.
 */
function getEpisodeId(item) {

    return getImdbId(item);
}


/*
 * Get season number.
 */
function getSeason(item) {

    return (
        item.season ||
        item.season_number ||
        item.episode?.season ||
        item.episode?.season_number
    );
}


/*
 * Get episode number.
 */
function getEpisode(item) {

    return (
        item.episode ||
        item.episode_number ||
        item.number ||
        item.episode?.number ||
        item.episode?.episode_number
    );
}


/*
 * Get show title.
 */
function getShowTitle(item) {

    return (
        item.show?.title ||
        item.show?.name ||
        item.series?.title ||
        item.series?.name ||
        item.parent?.title ||
        item.parent?.name ||
        item.title ||
        item.name ||
        "Unknown Show"
    );
}


/*
 * Get poster.
 */
function getPoster(item) {

    return (
        item.poster ||
        item.images?.poster ||
        item.show?.poster ||
        item.show?.images?.poster ||
        item.series?.poster ||
        item.series?.images?.poster
    );
}


/*
 * Get the watched timestamp if MDBList returns one.
 */
function getWatchedTime(item) {

    return (
        item.watched_at ||
        item.watchedAt ||
        item.last_watched_at ||
        item.lastWatchedAt ||
        item.episode?.watched_at ||
        item.episode?.last_watched_at ||
        0
    );
}


/*
 * Convert an MDBList episode into a Stremio
 * catalog item.
 */
function convertEpisode(item) {

    const episodeId =
        getEpisodeId(item);

    const season =
        getSeason(item);

    const episode =
        getEpisode(item);

    if (!episodeId) {
        console.log(
            "Skipping episode without IMDb ID:",
            item
        );

        return null;
    }

    if (
        season === undefined ||
        episode === undefined
    ) {
        console.log(
            "Skipping episode without season/episode:",
            item
        );

        return null;
    }

    const title =
        getShowTitle(item);

    const result = {
        id: episodeId,

        /*
         * We deliberately return "series".
         * Stremio can resolve the episode ID and
         * display the corresponding episode.
         */
        type: "series",

        name: title,

        poster: getPoster(item),

        posterShape: "poster",

        /*
         * This tells Stremio which episode this
         * catalog entry represents.
         */
        season: Number(season),
        episode: Number(episode),

        /*
         * Make the catalog entry explicitly show
         * the episode number.
         */
        description:
            `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`
    };

    return result;
}


/*
 * Recently Watched catalog.
 */
builder.defineCatalogHandler(async (args) => {

    console.log(
        "Catalog request:",
        JSON.stringify({
            id: args.id,
            type: args.type,
            configured: !!args.config?.apiKey
        })
    );

    if (
        args.id !==
        "mdblist-recently-watched"
    ) {
        return {
            metas: []
        };
    }

    const apiKey =
        args.config?.apiKey;

    if (!apiKey) {

        console.log(
            "No MDBList API key supplied."
        );

        return {
            metas: []
        };
    }

    try {

        const data =
            await getWatchedEpisodes(
                apiKey
            );

        const items =
            getItems(data);

        console.log(
            "MDBList returned",
            items.length,
            "watched episodes"
        );

        /*
         * Convert episodes.
         */
        const entries =
            items
                .map(item => ({
                    item,
                    meta: convertEpisode(item),
                    watchedTime: getWatchedTime(item)
                }))
                .filter(entry =>
                    entry.meta !== null
                );

        /*
         * Newest watched episode first,
         * when MDBList supplies a timestamp.
         */
        entries.sort((a, b) => {

            const aTime =
                Date.parse(
                    a.watchedTime
                ) || 0;

            const bTime =
                Date.parse(
                    b.watchedTime
                ) || 0;

            return bTime - aTime;
        });

        /*
         * Remove duplicate episode IDs while
         * preserving the newest occurrence.
         */
        const seen = new Set();

        const metas = [];

        for (const entry of entries) {

            if (
                seen.has(
                    entry.meta.id
                )
            ) {
                continue;
            }

            seen.add(
                entry.meta.id
            );

            metas.push(
                entry.meta
            );

            if (metas.length >= 100) {
                break;
            }
        }

        console.log(
            "Returning",
            metas.length,
            "recently watched episodes"
        );

        return {
            metas,
            cacheMaxAge: 60
        };

    } catch (error) {

        console.error(
            "MDBList Recently Watched error:",
            error
        );

        return {
            metas: []
        };
    }
});


/*
 * Start addon server.
 */
serveHTTP(
    builder.getInterface(),
    {
        port:
            process.env.PORT || 7000
    }
);
