const path = require("path");
const {
    addonBuilder,
    serveHTTP
} = require("stremio-addon-sdk");

const manifest = {
    id: "com.example.mdblist-history",
    version: "1.0.0",
    name: "MDBList History",
    description: "Shows recently watched movies and series from MDBList.",

    resources: ["catalog"],

    types: ["movie", "series"],

    catalogs: [
        {
            type: "movie",
            id: "mdblist-history",
            name: "MDBList History"
        },
        {
            type: "series",
            id: "mdblist-history",
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
        const text = await response.text();

        throw new Error(
            `MDBList API error ${response.status}: ${text}`
        );
    }

    return response.json();
}


/*
 * Convert an MDBList item into a Stremio MetaPreview.
 */
function toStremioMeta(item, type) {
    const imdbId =
        item.imdb_id ||
        item.imdbid ||
        item.ids?.imdb;

    if (!imdbId) {
        return null;
    }

    const name =
        item.title ||
        item.name ||
        "Unknown";

    const meta = {
        id: imdbId,
        type,
        name
    };

    if (item.poster) {
        meta.poster = item.poster;
    }

    if (item.year) {
        meta.releaseInfo = String(item.year);
    }

    return meta;
}


/*
 * MDBList watched catalog.
 */
builder.defineCatalogHandler(async (args) => {
    const apiKey =
        args.config?.apiKey;

    if (!apiKey) {
        console.log("No MDBList API key supplied.");

        return {
            metas: []
        };
    }

    const mediaType =
        args.type === "series"
            ? "show"
            : "movie";

    try {
        console.log(
            `Loading MDBList watched ${mediaType} items...`
        );

        const data =
            await getWatched(
                apiKey,
                mediaType
            );

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
                toStremioMeta(
                    item,
                    args.type
                )
            )
            .filter(Boolean)
            .slice(0, 100);

        console.log(
            `Returning ${metas.length} items.`
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
 * Start the addon server.
 */
serveHTTP(
    builder.getInterface(),
    {
        port: process.env.PORT || 7000,

        // Serves files from ./public
        static: path.join(
            __dirname,
            "public"
        )
    }
);
