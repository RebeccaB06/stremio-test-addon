const express = require("express");
const {
    addonBuilder,
    getRouter
} = require("stremio-addon-sdk");

const app = express();

const manifest = {
    id: "com.example.mdblist-history",
    version: "1.0.0",
    name: "MDBList History",
    description: "Shows your recently watched MDBList movies and series.",

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

    behaviorHints: {
        configurable: true,
        configurationRequired: true
    }
};

const builder = new addonBuilder(manifest);


/*
 * CONFIGURATION PAGE
 */
app.get("/configure", (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">

    <title>MDBList History - Configure</title>

    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 500px;
            margin: 60px auto;
            padding: 20px;
        }

        h1 {
            margin-bottom: 10px;
        }

        p {
            line-height: 1.5;
        }

        label {
            display: block;
            margin-top: 25px;
            margin-bottom: 8px;
            font-weight: bold;
        }

        input {
            width: 100%;
            box-sizing: border-box;
            padding: 12px;
            font-size: 16px;
        }

        button {
            margin-top: 20px;
            padding: 12px 20px;
            font-size: 16px;
            cursor: pointer;
        }
    </style>
</head>

<body>

    <h1>MDBList History</h1>

    <p>
        Enter your MDBList API key below.
    </p>

    <form id="form">

        <label for="apiKey">
            MDBList API Key
        </label>

        <input
            id="apiKey"
            name="apiKey"
            type="password"
            placeholder="Enter your MDBList API key"
            required
        >

        <button type="submit">
            Install Addon
        </button>

    </form>

    <script>
        document
            .getElementById("form")
            .addEventListener("submit", function(event) {

                event.preventDefault();

                const apiKey =
                    document
                        .getElementById("apiKey")
                        .value
                        .trim();

                if (!apiKey) {
                    return;
                }

                /*
                 * User-specific data is placed in the
                 * addon URL, as supported by Stremio.
                 */
                const addonUrl =
                    window.location.origin +
                    "/" +
                    encodeURIComponent(apiKey) +
                    "/manifest.json";

                /*
                 * Open Stremio with the configured addon.
                 */
                window.location.href =
                    "stremio://" +
                    addonUrl.replace(
                        /^https?:\\/\\//,
                        ""
                    );
            });
    </script>

</body>
</html>
    `);
});


/*
 * MDBLIST API
 */
async function getWatched(apiKey, mediaType) {

    const url =
        "https://api.mdblist.com/sync/watched" +
        "?apikey=" +
        encodeURIComponent(apiKey) +
        "&mediatype=" +
        encodeURIComponent(mediaType) +
        "&limit=1000";

    const response =
        await fetch(url);

    if (!response.ok) {
        throw new Error(
            `MDBList returned HTTP ${response.status}`
        );
    }

    return response.json();
}


/*
 * Convert MDBList item to Stremio catalog item.
 */
function convertItem(item, type) {

    const imdbId =
        item.imdb_id ||
        item.imdbid ||
        item.ids?.imdb;

    if (!imdbId) {
        return null;
    }

    return {
        id: imdbId,

        type: type,

        name:
            item.title ||
            item.name ||
            "Unknown",

        poster:
            item.poster ||
            item.images?.poster,

        releaseInfo:
            item.year
                ? String(item.year)
                : undefined,

        posterShape: "poster"
    };
}


/*
 * CATALOG HANDLER
 */
builder.defineCatalogHandler(async (args) => {

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

    const mediaType =
        args.type === "series"
            ? "show"
            : "movie";

    try {

        console.log(
            `Requesting MDBList watched ${mediaType} items`
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

        const metas =
            items
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
            "MDBList error:",
            error
        );

        return {
            metas: []
        };
    }
});


/*
 * Mount the Stremio addon routes.
 */
const addonRouter =
    getRouter(
        builder.getInterface()
    );

app.use(
    "/",
    addonRouter
);


/*
 * Start server.
 */
const port =
    process.env.PORT || 7000;

app.listen(
    port,
    () => {
        console.log(
            `MDBList History addon running on port ${port}`
        );
    }
);