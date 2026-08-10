const {
    addonBuilder,
    serveHTTP
} = require("stremio-addon-sdk");

const manifest = {
    id: "com.example.mdblist-history",
    version: "1.0.0",
    name: "MDBList History",
    description: "Shows your recently watched items from MDBList.",

    resources: ["catalog"],

    types: ["movie"],

    catalogs: [
        {
            id: "mdblist-history",
            type: "movie",
            name: "MDBList History"
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
},
    ],

    behaviorHints: {
        configurable: true,
        configurationRequired: true
    }
};

const builder = new addonBuilder(manifest);


/*
 * Ask MDBList for watched movies.
 */
async function getWatchedMovies(apiKey) {

    const url =
        "https://api.mdblist.com/sync/watched" +
        "?apikey=" +
        encodeURIComponent(apiKey) +
        "&mediatype=movie" +
        "&limit=1000" +
        "&append_to_response=poster";

    console.log("Calling MDBList watched movies API");

    const response = await fetch(url);

    const text = await response.text();

    console.log(
        "MDBList HTTP status:",
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
 * Ask MDBList for watched shows.
 */
async function getWatchedShows(apiKey) {

    const url =
        "https://api.mdblist.com/sync/watched" +
        "?apikey=" +
        encodeURIComponent(apiKey) +
        "&mediatype=show" +
        "&limit=1000" +
        "&append_to_response=poster";

    console.log("Calling MDBList watched shows API");

    const response = await fetch(url);

    const text = await response.text();

    console.log(
        "MDBList HTTP status:",
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
 * Get the actual array from an MDBList response.
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
 * Convert an MDBList item to a Stremio item.
 */
function convertItem(item, type) {

    const imdbId =
        item.imdb_id ||
        item.imdbid ||
        item.ids?.imdb;

    if (!imdbId) {
        console.log(
            "Skipping MDBList item without IMDb ID:",
            item.title || item.name
        );

        return null;
    }

    const meta = {
        id: imdbId,
        type: type,
        name:
            item.title ||
            item.name ||
            "Unknown"
    };

    if (item.poster) {
        meta.poster = item.poster;
    }

    if (item.images?.poster) {
        meta.poster = item.images.poster;
    }

    if (item.year) {
        meta.releaseInfo =
            String(item.year);
    }

    meta.posterShape = "poster";

    return meta;
}


/*
 * Stremio asks us for the MDBList History catalog.
 */
builder.defineCatalogHandler(async (args) => {

    console.log(
        "CATALOG REQUEST:",
        JSON.stringify({
            type: args.type,
            id: args.id,
            hasConfig: !!args.config,
            hasApiKey: !!args.config?.apiKey
        })
    );

    /*
     * Make sure this is our catalog.
     */
    if (args.id !== "mdblist-history") {
        return {
            metas: []
        };
    }

    /*
     * Get the API key supplied through
     * the Stremio configuration.
     */
    const apiKey =
        args.config?.apiKey;

    if (!apiKey) {

        console.log(
            "ERROR: No MDBList API key received."
        );

        return {
            metas: []
        };
    }

    try {

        /*
         * Get both watched movies and watched shows.
         */
        const [
            movieData,
            showData
        ] = await Promise.all([
            getWatchedMovies(apiKey),
            getWatchedShows(apiKey)
        ]);

        const movies =
            getItems(movieData);

        const shows =
            getItems(showData);

        console.log(
            "MDBList movies:",
            movies.length
        );

        console.log(
            "MDBList shows:",
            shows.length
        );

        /*
         * Convert movies.
         */
        const movieMetas =
            movies
                .map(item =>
                    convertItem(
                        item,
                        "movie"
                    )
                )
                .filter(Boolean);

        /*
         * Convert shows.
         */
        const showMetas =
            shows
                .map(item =>
                    convertItem(
                        item,
                        "series"
                    )
                )
                .filter(Boolean);

        /*
         * Combine them into one catalog.
         */
        const metas = [
            ...movieMetas,
            ...showMetas
        ];

        console.log(
            "Returning catalog items:",
            metas.length
        );

        return {
            metas,
            cacheMaxAge: 60
        };

    } catch (error) {

        console.error(
            "MDBList catalog error:",
            error
        );

        return {
            metas: []
        };
    }
});


/*
 * Start the addon.
 */
serveHTTP(
    builder.getInterface(),
    {
        port:
            process.env.PORT || 7000
    }
);
