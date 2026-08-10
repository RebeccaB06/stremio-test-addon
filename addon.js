const {
    addonBuilder,
    serveHTTP
} = require("stremio-addon-sdk");

const manifest = {
    id: "com.example.mdblist-history",
    version: "1.0.0",
    name: "MDBList History",
    description: "Shows your recently watched movies and series from MDBList.",

    resources: ["catalog"],

    types: ["movie", "series"],

    catalogs: [
        {
            type: "movie",
            id: "mdblist-history-movies",
            name: "MDBList History"
        },
        {
            type: "series",
            id: "mdblist-history-series",
            name: "MDBList History"
        }
    ],

    /*
     * This tells Stremio that the addon has
     * user-configurable settings.
     */
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
 * Get watched items from MDBList.
 */
async function getWatched(apiKey, mediaType) {

    const params = new URLSearchParams({
        apikey: apiKey,
        mediatype: mediaType,
        limit: "1000"
    });

    const response = await fetch(
        `https://api.mdblist.com/sync/watched?${params}`
    );

    if (!response.ok) {
        const errorText = await response.text();

        throw new Error(
            `MDBList API returned ${response.status}: ${errorText}`
        );
    }

    return response.json();
}


/*
 * Convert an MDBList item into a Stremio catalog item.
 */
function convertItem(item, stremioType) {

    const imdbId =
        item.imdb_id ||
        item.imdbid ||
        item.ids?.imdb;

    if (!imdbId) {
        return null;
    }

    const result = {
        id: imdbId,
        type: stremioType,
        name:
            item.title ||
            item.name ||
            "Unknown"
    };

    if (item.poster) {
        result.poster = item.poster;
    }

    if (item.images?.poster) {
        result.poster = item.images.poster;
    }

    if (item.year) {
        result.releaseInfo = String(item.year);
    }

    return result;
}


/*
 * Handle catalog requests from Stremio.
 */
builder.defineCatalogHandler(async (args) => {

    /*
     * The API key entered on the Stremio
     * configuration page arrives here.
     */
    const apiKey = args.config?.apiKey;

    if (!apiKey) {
        console.log("No MDBList API key configured.");

        return {
            metas: []
        };
    }

    /*
     * Stremio "series" corresponds to
     * MDBList "show".
     */
    const mdblistMediaType =
        args.type === "series"
            ? "show"
            : "movie";

    try {

        console.log(
            `Requesting MDBList watched ${mdblistMediaType} items`
        );

        const data = await getWatched(
            apiKey,
            mdblistMediaType
        );

        /*
         * Handle the possible response container.
         */
        const items =
            Array.isArray(data)
                ? data
                : (
                    data.items ||
                    data.results ||
                    []
                );

        const metas = items
            .map(item =>
                convertItem(
                    item,
                    args.type
                )
            )
            .filter(Boolean)
            .slice(0, 100);

        console.log(
            `Returning ${metas.length} items`
        );

        return {
            metas,
            cacheMaxAge: 60
        };

    } catch (error) {

        console.error(
            "MDBList request failed:",
            error
        );

        return {
            metas: []
        };
    }
});


/*
 * Start the Stremio addon server.
 */
serveHTTP(
    builder.getInterface(),
    {
        port: process.env.PORT || 7000
    }
);
