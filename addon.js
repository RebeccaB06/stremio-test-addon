const {
    addonBuilder,
    serveHTTP
} = require("stremio-addon-sdk");

const manifest = {
    id: "com.example.mdblist-history",
    version: "1.0.0",
    name: "MDBList History",
    description: "Shows your recently watched MDBList movies and series in Stremio.",

    resources: ["catalog"],

    types: ["movie", "series"],

    catalogs: [
        {
            id: "mdblist-history",
            type: "movie",
            name: "MDBList History"
        },
        {
            id: "mdblist-history",
            type: "series",
            name: "MDBList History"
        }
    ],

    idPrefixes: ["tt"],

    behaviorHints: {
        configurable: true,
        configurationRequired: true
    }
};

const builder = new addonBuilder(manifest);


/*
 * MDBList API
 */
async function getWatched(apiKey, mediaType) {
    const url =
        "https://api.mdblist.com/sync/watched" +
        "?apikey=" + encodeURIComponent(apiKey) +
        "&mediatype=" + encodeURIComponent(mediaType) +
        "&limit=1000" +
        "&append_to_response=poster";

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            `MDBList API returned ${response.status}`
        );
    }

    return await response.json();
}


/*
 * Convert one MDBList item into a Stremio catalog item.
 */
function convertItem(item, type) {
    const imdbId =
        item.imdb_id ||
        item.imdbid ||
        item.ids?.imdb;

    if (!imdbId) {
        return null;
    }

    const meta = {
        id: imdbId,
        type: type,
        name:
            item.title ||
            item.name ||
            "Unknown",

        poster:
            item.poster ||
            item.images?.poster,

        posterShape: "poster"
    };

    if (item.year) {
        meta.releaseInfo = String(item.year);
    }

    return meta;
}


/*
 * Catalog handler
 */
builder.defineCatalogHandler(async (args) => {

    if (
        args.id !== "mdblist-history"
    ) {
        return {
            metas: []
        };
    }

    const apiKey = args.config?.apiKey;

    if (!apiKey) {
        return {
            metas: []
        };
    }

    try {

        const mediaType =
            args.type === "series"
                ? "show"
                : "movie";

        const data = await getWatched(
            apiKey,
            mediaType
        );

        /*
         * MDBList returns the watched items.
         *
         * We reverse the list so the most recently
         * watched items appear first when the API
         * returns them oldest-first.
         */
        let items =
            data.items ||
            data.results ||
            [];

        items = [...items].reverse();

        const metas = items
            .map(item =>
                convertItem(
                    item,
                    args.type
                )
            )
            .filter(Boolean);

        return {
            metas: metas.slice(0, 100),
            cacheMaxAge: 60
        };

    } catch (error) {

        console.error(
            "MDBList error:",
            error
        );

        return {
            metas: []
        };
    }
});


serveHTTP(
    builder.getInterface(),
    {
        port: process.env.PORT || 7000,
        static: "./public"
    }
);
