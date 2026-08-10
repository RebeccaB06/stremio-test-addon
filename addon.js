const {
    addonBuilder,
    serveHTTP
} = require("stremio-addon-sdk");

const manifest = {
    id: "com.example.mdblist-history",
    version: "1.0.0",
    name: "MDBList History",
    description: "Shows your recently watched items from MDBList.",

    resources: [
        "catalog",
        {
            name: "meta",
            types: ["series"],
            idPrefixes: ["mdblist:"]
        }
    ],

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
        }
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

builder.defineStreamHandler(async (args) => {

    console.log(
        "STREAM REQUEST:",
        JSON.stringify({
            type: args.type,
            id: args.id
        })
    );


    /*
     * We only handle IMDb series episode IDs.
     *
     * Example:
     *
     * tt0452716:1:1
     */
    if (
        args.type !== "series" ||
        !args.id ||
        !/^tt[0-9]+:[0-9]+:[0-9]+$/.test(args.id)
    ) {

        return {
            streams: []
        };
    }


    const streamId =
        args.id;


    console.log(
        "Looking up streams for:",
        streamId
    );


    try {

        /*
         * ==================================================
         * PUT YOUR STREAM-SOURCE REQUEST HERE.
         *
         * The important thing is that the requested ID is
         * passed through EXACTLY as:
         *
         * tt0452716:1:1
         *
         * ==================================================
         */

        const url =
            "YOUR_STREAMS_REPO_URL/" +
            encodeURIComponent(streamId);


        console.log(
            "Fetching streams:",
            url
        );


        const response =
            await fetch(url);


        const text =
            await response.text();


        console.log(
            "Streams HTTP status:",
            response.status
        );


        if (!response.ok) {

            throw new Error(
                "Streams source returned HTTP " +
                response.status +
                ": " +
                text
            );
        }


        const data =
            JSON.parse(text);


        /*
         * Return the streams exactly as Stremio expects.
         */
        return {

            streams:
                Array.isArray(data.streams)
                    ? data.streams
                    : []

        };


    } catch (error) {

        console.error(
            "Stream lookup error:",
            error
        );


        return {
            streams: []
        };
    }
});

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
     * Only handle our catalogs.
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


    /*
     * --------------------------------------------------
     * Fetch MDBList history.
     * --------------------------------------------------
     */

    const historyUrl =
        "https://mdblist.com/history/" +
        encodeURIComponent(username) +
        "?type=episode";


    console.log(
        "Fetching:",
        historyUrl
    );


    try {

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
         * Parse day groups and episode cards.
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
                 * Example:
                 *
                 * Buffy the Vampire Slayer S06E13
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
                 * SxxExx
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
                 * Show name without SxxExx.
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
         * IMPORTANT:
         *
         * First take 100.
         * THEN remove duplicate shows.
         * --------------------------------------------------
         */

        const first100 =
            history.slice(
                0,
                100
            );


        console.log(
            "First 100 history entries:",
            first100.length
        );


        /*
         * History catalog keeps all 100.
         */
        let selectedItems;


        if (
            args.id === "mdblist-history"
        ) {

            selectedItems =
                first100;

        } else {

            /*
             * Last Episode / Next Episodes:
             * keep only the newest episode for each show.
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


                const key =
                    item.showName
                        .toLowerCase()
                        .trim();


                if (
                    !latestByShow[key]
                ) {

                    latestByShow[key] =
                        item;
                }
            }


            selectedItems =
                Object.keys(
                    latestByShow
                ).map(
                    function(key) {
                        return latestByShow[key];
                    }
                );
        }


        console.log(
            "Selected items:",
            selectedItems.length
        );


        /*
         * --------------------------------------------------
         * For Next Episodes, calculate the next episode.
         * --------------------------------------------------
         */

        if (
            args.id === "mdblist-next-episodes"
        ) {

            selectedItems =
                selectedItems.map(
                    function(item) {

                        return {

                            ...item,

                            episode:
                                item.episode + 1,

                            code:
                                "S" +
                                String(
                                    item.season
                                ) +
                                "E" +
                                String(
                                    item.episode + 1
                                )
                        };
                    }
                );
        }


        /*
         * --------------------------------------------------
         * NOW resolve IMDb IDs.
         *
         * This is intentionally done AFTER the 100-entry
         * limit and duplicate filtering.
         *
         * Therefore:
         *
         * History:
         *   max 100 IMDb requests
         *
         * Last Episode:
         *   max 100 IMDb requests, usually much fewer
         *
         * Next Episodes:
         *   max 100 IMDb requests, usually much fewer
         * --------------------------------------------------
         */

        const metas =
            [];


        for (
            let i = 0;
            i < selectedItems.length;
            i++
        ) {

            const item =
                selectedItems[i];


            /*
             * The MDBList page to inspect.
             *
             * For normal history / last episode this is
             * the watched episode.
             *
             * For next episodes this is the NEXT episode.
             */
            let episodePath =
                item.path;


            if (
                args.id === "mdblist-next-episodes"
            ) {

                episodePath =
                    episodePath.replace(
                        /\/season\/[0-9]+\/episode\/[0-9]+$/i,
                        "/season/" +
                        item.season +
                        "/episode/" +
                        item.episode
                    );
            }


            const episodeUrl =
                "https://mdblist.com" +
                episodePath;


            console.log(
                "Resolving IMDb for:",
                episodeUrl
            );


            try {

                const episodeResponse =
                    await fetch(
                        episodeUrl
                    );


                const episodeHtml =
                    await episodeResponse.text();


                if (
                    !episodeResponse.ok
                ) {

                    console.log(
                        "Skipping IMDb lookup, HTTP:",
                        episodeResponse.status
                    );

                    continue;
                }


                /*
                 * Find IMDb title links.
                 */
                const imdbMatches =
                    [
                        ...episodeHtml.matchAll(
                            /https?:\/\/(?:www\.)?imdb\.com\/title\/(tt[0-9]+)/gi
                        )
                    ];


                const imdbIds =
                    [
                        ...new Set(
                            imdbMatches.map(
                                function(match) {
                                    return match[1];
                                }
                            )
                        )
                    ];


                if (
                    imdbIds.length === 0
                ) {

                    console.log(
                        "No IMDb ID found for:",
                        item.showName,
                        item.code
                    );

                    continue;
                }


                /*
                 * Try to identify the SERIES IMDb ID.
                 *
                 * Prefer an IMDb ID appearing in a
                 * series/show context.
                 */
                let seriesImdbId =
                    null;


                for (
                    let j = 0;
                    j < imdbIds.length;
                    j++
                ) {

                    const candidate =
                        imdbIds[j];


                    const escapedCandidate =
                        candidate.replace(
                            /[.*+?^${}()|[\]\\]/g,
                            "\\$&"
                        );


                    const contextRegex =
                        new RegExp(
                            "[\\s\\S]{0,1500}" +
                            "imdb\\.com\\/title\\/" +
                            escapedCandidate +
                            "[\\s\\S]{0,1500}",
                            "i"
                        );


                    const contextMatch =
                        episodeHtml.match(
                            contextRegex
                        );


                    if (
                        contextMatch &&
                        /series|tvseries|show|parent/i
                            .test(
                                contextMatch[0]
                            )
                    ) {

                        seriesImdbId =
                            candidate;

                        break;
                    }
                }


                /*
                 * If only one IMDb ID exists, use it.
                 */
                if (
                    !seriesImdbId &&
                    imdbIds.length === 1
                ) {

                    seriesImdbId =
                        imdbIds[0];
                }


                /*
                 * If there are multiple IDs and no
                 * obvious series marker, use the first.
                 *
                 * This keeps the catalog populated rather
                 * than silently dropping the item.
                 */
                if (
                    !seriesImdbId
                ) {

                    seriesImdbId =
                        imdbIds[0];
                }


                /*
                 * --------------------------------------------------
                 * THIS IS THE KEY CHANGE.
                 *
                 * The catalog item's ID is already:
                 *
                 * tt11198330:1:2
                 *
                 * So when Stremio calls load(), it receives:
                 *
                 * type=series
                 * id=tt11198330:1:2
                 * --------------------------------------------------
                 */

                const stremioId =
                    seriesImdbId +
                    ":" +
                    item.season +
                    ":" +
                    item.episode;


                metas.push({

                    id:
                        stremioId,

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
                        (
                            item.watchedDate
                                ? " • Watched " +
                                  item.watchedDate
                                : ""
                        )
                });


                console.log(
                    "Added:",
                    item.showName,
                    item.code,
                    "=>",
                    stremioId
                );


            } catch (error) {

                console.error(
                    "IMDb lookup failed for:",
                    item.showName,
                    item.code,
                    error
                );
            }
        }


        console.log(
            "Returning catalog items:",
            metas.length
        );


        return {

            metas:

                metas,

            cacheMaxAge:
                60
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
