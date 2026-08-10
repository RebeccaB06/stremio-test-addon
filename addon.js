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

builder.defineCatalogHandler(async (args) => {

    console.log(
        "CATALOG REQUEST:",
        JSON.stringify({
            type: args.type,
            id: args.id,
            hasConfig: !!args.config,
            hasUsername: !!args.config?.username
        })
    );


    /*
     * Only handle our three catalogs.
     */
    if (
        args.id !== "mdblist-history" &&
        args.id !== "mdblist-last-episode" &&
        args.id !== "mdblist-next-episodes"
    ) {
        return {
            metas: []
        };
    }


    const username =
        args.config?.username;


    if (!username) {

        console.log(
            "ERROR: No MDBList username received."
        );

        return {
            metas: []
        };
    }


    const historyUrl =
        "https://mdblist.com/history/" +
        encodeURIComponent(username) +
        "?type=episode";


    console.log(
        "Fetching:",
        historyUrl
    );


    try {

        /*
         * --------------------------------------------------
         * Fetch MDBList history.
         * --------------------------------------------------
         */

        const response =
            await fetch(historyUrl);


        const html =
            await response.text();


        console.log(
            "MDBList HTTP status:",
            response.status
        );


        console.log(
            "MDBList HTML length:",
            html.length
        );


        if (!response.ok) {

            throw new Error(
                "MDBList returned HTTP " +
                response.status
            );
        }


        /*
         * --------------------------------------------------
         * Extract day groups so every episode gets
         * its watched date.
         * --------------------------------------------------
         */

        const dayRegex =
            /<div class="day-group"[^>]*data-date="([^"]+)"[^>]*>([\s\S]*?)(?=<div class="day-group"|$)/gi;


        const history =
            [];


        let dayMatch;


        while (
            (dayMatch =
                dayRegex.exec(html)) !== null
        ) {

            const watchedDate =
                dayMatch[1];


            const dayHtml =
                dayMatch[2];


            /*
             * Extract individual activity cards.
             */
            const cardRegex =
                /<div class="activity-poster-card">([\s\S]*?)<\/div>\s*<\/div>/gi;


            let cardMatch;


            while (
                (cardMatch =
                    cardRegex.exec(dayHtml)) !== null
            ) {

                const card =
                    cardMatch[1];


                /*
                 * MDBList episode path.
                 *
                 * Example:
                 *
                 * /show/8pw7-angel/season/3/episode/10
                 */
                const pathMatch =
                    card.match(
                        /href="(\/show\/[^"]+\/season\/[0-9]+\/episode\/[0-9]+)"/i
                    );


                if (!pathMatch) {
                    continue;
                }


                const path =
                    pathMatch[1];


                /*
                 * Poster.
                 */
                const posterMatch =
                    card.match(
                        /<img[^>]+src="([^"]+)"/i
                    );


                const poster =
                    posterMatch
                        ? posterMatch[1]
                        : "";


                /*
                 * Main title.
                 *
                 * Example:
                 *
                 * Angel S03E10
                 */
                const titleMatch =
                    card.match(
                        /<div class="activity-poster-card__title">\s*<a[^>]*>([\s\S]*?)<\/a>/i
                    );


                let title =
                    titleMatch
                        ? titleMatch[1]
                        : "";


                title =
                    title
                        .replace(
                            /<[^>]+>/g,
                            ""
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
                 * Episode title.
                 */
                const episodeTitleMatch =
                    card.match(
                        /<div class="activity-poster-card__sub">\s*([\s\S]*?)\s*<\/div>/i
                    );


                let episodeTitle =
                    episodeTitleMatch
                        ? episodeTitleMatch[1]
                        : "";


                episodeTitle =
                    episodeTitle
                        .replace(
                            /<[^>]+>/g,
                            ""
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
                 * Extract SxxExx.
                 */
                const episodeMatch =
                    title.match(
                        /\bS([0-9]+)E([0-9]+)\b/i
                    );


                if (!episodeMatch) {
                    continue;
                }


                const season =
                    Number(
                        episodeMatch[1]
                    );


                const episode =
                    Number(
                        episodeMatch[2]
                    );


                /*
                 * Remove SxxExx from show name.
                 */
                const showName =
                    title
                        .replace(
                            /\s*S[0-9]+E[0-9]+\s*$/i,
                            ""
                        )
                        .trim();


                history.push({

                    path:
                        path,

                    showName:
                        showName,

                    episodeTitle:
                        episodeTitle,

                    season:
                        season,

                    episode:
                        episode,

                    code:
                        "S" +
                        episodeMatch[1] +
                        "E" +
                        episodeMatch[2],

                    poster:
                        poster,

                    watchedDate:
                        watchedDate
                });
            }
        }


        console.log(
            "Episode entries found:",
            history.length
        );


        /*
         * --------------------------------------------------
         * FIRST 100 ONLY.
         *
         * This happens BEFORE deduplication.
         * --------------------------------------------------
         */

        const first100 =
            history.slice(
                0,
                100
            );


        console.log(
            "Using first 100:",
            first100.length
        );


        /*
         * --------------------------------------------------
         * HISTORY
         *
         * Keep every episode.
         *
         * IMPORTANT:
         * No IMDb request happens here.
         * --------------------------------------------------
         */

        if (
            args.id === "mdblist-history"
        ) {

            const metas =
                first100.map(
                    function(item) {

                        return {

                            /*
                             * Temporary ID containing
                             * the MDBList episode path.
                             *
                             * The IMDb ID is NOT fetched here.
                             */
                            id:
                                "mdblist:" +
                                encodeURIComponent(
                                    item.path
                                ),

                            type:
                                "series",

                            name:
                                item.showName,

                            poster:
                                item.poster,

                            posterShape:
                                "poster",

                            releaseInfo:
                                item.code,

                            description:
                                item.episodeTitle +
                                " • Watched " +
                                item.watchedDate
                        };
                    }
                );


            console.log(
                "Returning History items:",
                metas.length
            );


            return {
                metas:
                    metas,

                cacheMaxAge:
                    60
            };
        }


        /*
         * --------------------------------------------------
         * DEDUPLICATE AFTER THE 100 LIMIT.
         *
         * History is newest-first, so the first
         * occurrence of each show is its latest
         * watched episode.
         * --------------------------------------------------
         */

        const latestByShow =
            {};


        for (
            let i = 0;
            i < first100.length;
            i++
        ) {

            const item =
                first100[i];


            const showKey =
                item.showName
                    .toLowerCase()
                    .trim();


            if (
                !latestByShow[showKey]
            ) {

                latestByShow[showKey] =
                    item;
            }
        }


        const latestEpisodes =
            Object.keys(
                latestByShow
            ).map(
                function(key) {
                    return latestByShow[key];
                }
            );


        console.log(
            "Unique shows:",
            latestEpisodes.length
        );


        /*
         * --------------------------------------------------
         * LAST EPISODE OF SHOW WATCHED
         * --------------------------------------------------
         */

        if (
            args.id === "mdblist-last-episode"
        ) {

            const metas =
                latestEpisodes.map(
                    function(item) {

                        return {

                            id:
                                "mdblist:" +
                                encodeURIComponent(
                                    item.path
                                ),

                            type:
                                "series",

                            name:
                                item.showName,

                            poster:
                                item.poster,

                            posterShape:
                                "poster",

                            releaseInfo:
                                item.code,

                            description:
                                item.episodeTitle +
                                " • Watched " +
                                item.watchedDate
                        };
                    }
                );


            console.log(
                "Returning Last Episode items:",
                metas.length
            );


            return {
                metas:
                    metas,

                cacheMaxAge:
                    60
            };
        }


        /*
         * --------------------------------------------------
         * NEXT EPISODES
         *
         * Still no IMDb requests.
         * --------------------------------------------------
         */

        if (
            args.id === "mdblist-next-episodes"
        ) {

            const metas =
                [];


            for (
                let i = 0;
                i < latestEpisodes.length;
                i++
            ) {

                const watched =
                    latestEpisodes[i];


                const nextEpisode =
                    watched.episode + 1;


                const nextPath =
                    watched.path.replace(
                        /\/season\/[0-9]+\/episode\/[0-9]+$/i,
                        "/season/" +
                        watched.season +
                        "/episode/" +
                        nextEpisode
                    );


                const nextCode =
                    "S" +
                    String(
                        watched.season
                    ) +
                    "E" +
                    String(
                        nextEpisode
                    );


                metas.push({

                    /*
                     * Again, do NOT fetch IMDb here.
                     */
                    id:
                        "mdblist:" +
                        encodeURIComponent(
                            nextPath
                        ),

                    type:
                        "series",

                    name:
                        watched.showName,

                    poster:
                        watched.poster,

                    posterShape:
                        "poster",

                    releaseInfo:
                        nextCode,

                    description:
                        "Next episode"
                });
            }


            console.log(
                "Returning Next Episodes:",
                metas.length
            );


            return {
                metas:
                    metas,

                cacheMaxAge:
                    60
            };
        }


        return {
            metas: []
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
