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

    types: ["series"],

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
```javascript
builder.defineCatalogHandler(async (args) => {

    console.log(
        "CATALOG REQUEST:",
        JSON.stringify({
            type: args.type,
            id: args.id,
            hasConfig: !!args.config,
            hasUsername:
                !!(
                    args.config &&
                    args.config.username
                )
        })
    );


    /*
     * Make sure this is our catalog.
     */
    if (
        args.id !== "mdblist-history"
    ) {
        return {
            metas: []
        };
    }


    /*
     * Get the username from the
     * Stremio configuration.
     */
    const username =
        args.config &&
        args.config.username
            ? String(
                args.config.username
            ).trim()
            : "";


    if (!username) {

        console.log(
            "ERROR: No MDBList username received."
        );

        return {
            metas: []
        };
    }


    /*
     * This is the URL you specified:
     *
     * https://mdblist.com/history/USERNAME?type=episode
     */
    const url =
        "https://mdblist.com/history/" +
        encodeURIComponent(username) +
        "?type=episode";


    console.log(
        "Fetching MDBList History:",
        url
    );


    try {

        const response =
            await fetch(url, {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0"
                }
            });


        const html =
            await response.text();


        console.log(
            "MDBList HTTP status:",
            response.status
        );

        console.log(
            "MDBList response length:",
            html.length
        );


        if (!response.ok) {

            throw new Error(
                "MDBList returned HTTP " +
                response.status
            );
        }


        /*
         * Find episode entries in the page.
         *
         * We look for S01E01, S1E1, etc.
         */
        const episodeRegex =
            /\bS([0-9]{1,3})E([0-9]{1,3})\b/gi;


        const episodes = [];

        let match;


        while (
            (match =
                episodeRegex.exec(html)) !== null
        ) {

            const season =
                Number(match[1]);

            const episode =
                Number(match[2]);

            const code =
                "S" +
                String(season).padStart(2, "0") +
                "E" +
                String(episode).padStart(2, "0");


            /*
             * Look around the episode occurrence
             * for the corresponding IMDb ID.
             */
            const start =
                Math.max(
                    0,
                    match.index - 2000
                );

            const end =
                Math.min(
                    html.length,
                    match.index + 2000
                );

            const surrounding =
                html.substring(
                    start,
                    end
                );


            const imdbMatch =
                surrounding.match(
                    /tt[0-9]{7,9}/
                );


            const imdbId =
                imdbMatch
                    ? imdbMatch[0]
                    : null;


            /*
             * Remove HTML tags so we can get
             * human-readable text.
             */
            let title =
                surrounding
                    .replace(
                        /<script[\s\S]*?<\/script>/gi,
                        " "
                    )
                    .replace(
                        /<style[\s\S]*?<\/style>/gi,
                        " "
                    )
                    .replace(
                        /<[^>]+>/g,
                        " "
                    )
                    .replace(
                        /&amp;/g,
                        "&"
                    )
                    .replace(
                        /&quot;/g,
                        '"'
                    )
                    .replace(
                        /&#39;/g,
                        "'"
                    )
                    .replace(
                        /\s+/g,
                        " "
                    )
                    .trim();


            /*
             * Remove the episode number from
             * the displayed title.
             */
            title =
                title.replace(
                    new RegExp(
                        "\\b" +
                        code +
                        "\\b",
                        "i"
                    ),
                    ""
                ).trim();


            /*
             * If the surrounding HTML is too large,
             * don't use it as the title.
             */
            if (
                title.length > 250
            ) {
                title =
                    "Recently Watched";
            }


            episodes.push({
                imdbId: imdbId,
                title:
                    title ||
                    "Recently Watched",
                season: season,
                episode: episode,
                code: code
            });
        }


        console.log(
            "Episode references found:",
            episodes.length
        );


        /*
         * Remove duplicates.
         */
        const seen =
            new Set();

        const uniqueEpisodes =
            episodes.filter(
                (item) => {

                    const key =
                        String(
                            item.imdbId || ""
                        ) +
                        "|" +
                        item.code +
                        "|" +
                        item.title;


                    if (
                        seen.has(key)
                    ) {
                        return false;
                    }


                    seen.add(key);

                    return true;
                }
            );


        /*
         * Convert the history entries into
         * Stremio catalog items.
         */
        const metas =
            uniqueEpisodes
                .slice(0, 100)
                .map(
                    (item, index) => {

                        /*
                         * Use the real IMDb ID when
                         * we found one.
                         */
                        const id =
                            item.imdbId ||
                            (
                                "mdblist-history-" +
                                index
                            );


                        return {
                            id: id,

                            type: "series",

                            name:
                                item.title,

                            releaseInfo:
                                item.code,

                            description:
                                "Recently watched " +
                                item.code,

                            posterShape:
                                "poster"
                        };
                    }
                );


        console.log(
            "Returning catalog items:",
            metas.length
        );


        return {
            metas: metas,
            cacheMaxAge: 60
        };


    } catch (error) {

        console.error(
            "MDBList History error:",
            error
        );


        return {
            metas: []
        };
    }
});
```



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
