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

builder.defineMetaHandler(async (args) => {

    console.log(
        "META REQUEST:",
        JSON.stringify({
            type: args.type,
            id: args.id
        })
    );


    /*
     * The catalog gives us:
     *
     * mdblist:%2Fshow%2F...%2Fseason%2F1%2Fepisode%2F2
     *
     * We resolve that only when the user opens it.
     */
    if (
        args.type !== "series" ||
        !args.id ||
        !args.id.startsWith("mdblist:")
    ) {
        return {
            meta: null
        };
    }


    let episodePath;


    try {

        episodePath =
            decodeURIComponent(
                args.id.substring(
                    "mdblist:".length
                )
            );

    } catch (error) {

        console.error(
            "Failed to decode MDBList ID:",
            error
        );

        return {
            meta: null
        };
    }


    /*
     * Make sure this really is an episode path.
     *
     * Example:
     *
     * /show/8pw7-angel/season/3/episode/10
     */
    const pathMatch =
        episodePath.match(
            /^\/show\/([^/]+)\/season\/([0-9]+)\/episode\/([0-9]+)$/i
        );


    if (!pathMatch) {

        console.error(
            "Invalid MDBList episode path:",
            episodePath
        );

        return {
            meta: null
        };
    }


    const season =
        Number(
            pathMatch[2]
        );


    const episode =
        Number(
            pathMatch[3]
        );


    /*
     * --------------------------------------------------
     * FETCH ONLY THIS ONE EPISODE PAGE.
     * --------------------------------------------------
     */

    const url =
        "https://mdblist.com" +
        episodePath;


    console.log(
        "Fetching clicked MDBList episode:",
        url
    );


    try {

        const response =
            await fetch(url);


        const html =
            await response.text();


        console.log(
            "MDBList episode HTTP status:",
            response.status
        );


        console.log(
            "MDBList episode HTML length:",
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
         * FIND IMDb IDs.
         *
         * We do NOT simply use the first IMDb ID.
         *
         * The page can contain both the show's IMDb ID
         * and the episode's IMDb ID.
         * --------------------------------------------------
         */


        /*
         * First look for an IMDb ID in structured data.
         *
         * JSON-LD commonly contains:
         *
         * TVSeries
         * TVEpisode
         *
         * with their IMDb URLs.
         */

        let seriesImdbId =
            null;


        let episodeImdbId =
            null;


        /*
         * Find JSON-LD blocks.
         */
        const jsonLdRegex =
            /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;


        let jsonLdMatch;


        while (
            (jsonLdMatch =
                jsonLdRegex.exec(html)) !== null
        ) {

            const rawJson =
                jsonLdMatch[1].trim();


            try {

                const data =
                    JSON.parse(rawJson);


                const objects =
                    Array.isArray(data)
                        ? data
                        : data["@graph"]
                            ? data["@graph"]
                            : [data];


                for (
                    let i = 0;
                    i < objects.length;
                    i++
                ) {

                    const obj =
                        objects[i];


                    if (
                        !obj ||
                        typeof obj !== "object"
                    ) {
                        continue;
                    }


                    const type =
                        obj["@type"];


                    let imdbUrl =
                        null;


                    if (
                        typeof obj.url === "string"
                    ) {

                        imdbUrl =
                            obj.url;
                    }


                    if (
                        typeof obj["@id"] === "string"
                    ) {

                        if (
                            obj["@id"].includes(
                                "imdb.com/title/"
                            )
                        ) {

                            imdbUrl =
                                obj["@id"];
                        }
                    }


                    if (
                        typeof imdbUrl !== "string"
                    ) {
                        continue;
                    }


                    const imdbMatch =
                        imdbUrl.match(
                            /imdb\.com\/title\/(tt[0-9]+)/i
                        );


                    if (!imdbMatch) {
                        continue;
                    }


                    const imdbId =
                        imdbMatch[1];


                    /*
                     * TVSeries = the ID we need.
                     */
                    if (
                        type === "TVSeries" ||
                        type === "Series"
                    ) {

                        seriesImdbId =
                            imdbId;
                    }


                    /*
                     * TVEpisode = useful fallback.
                     */
                    if (
                        type === "TVEpisode"
                    ) {

                        episodeImdbId =
                            imdbId;
                    }
                }

            } catch (error) {

                /*
                 * Some pages can contain JSON-LD that
                 * isn't valid JSON. Ignore that block.
                 */
            }
        }


        /*
         * --------------------------------------------------
         * If JSON-LD didn't give us the series ID,
         * inspect IMDb links in the HTML.
         * --------------------------------------------------
         */

        if (!seriesImdbId) {

            /*
             * Find all IMDb title links.
             */
            const imdbMatches =
                [
                    ...html.matchAll(
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


            console.log(
                "IMDb IDs found on page:",
                imdbIds
            );


            /*
             * Try to identify the SERIES link by
             * looking around each IMDb link for
             * series/show context.
             */
            for (
                let i = 0;
                i < imdbIds.length;
                i++
            ) {

                const candidate =
                    imdbIds[i];


                const escaped =
                    candidate.replace(
                        /[.*+?^${}()|[\]\\]/g,
                        "\\$&"
                    );


                const candidateRegex =
                    new RegExp(
                        "[\\s\\S]{0,1000}" +
                        "imdb\\.com\\/title\\/" +
                        escaped +
                        "[\\s\\S]{0,1000}",
                        "i"
                    );


                const context =
                    html.match(
                        candidateRegex
                    );


                if (!context) {
                    continue;
                }


                const contextText =
                    context[0];


                /*
                 * Look for show/series indicators.
                 */
                if (
                    /series|tvseries|show|parent|series_id|show_id/i
                        .test(
                            contextText
                        )
                ) {

                    seriesImdbId =
                        candidate;

                    break;
                }
            }


            /*
             * If there is only one IMDb ID on the page,
             * it is the best available candidate.
             */
            if (
                !seriesImdbId &&
                imdbIds.length === 1
            ) {

                seriesImdbId =
                    imdbIds[0];
            }
        }


        /*
         * We MUST have the series IMDb ID.
         *
         * Do not manufacture one.
         */
        if (!seriesImdbId) {

            console.error(
                "Could not find the IMDb SERIES ID."
            );

            return {
                meta: null
            };
        }


        console.log(
            "IMDb SERIES ID:",
            seriesImdbId
        );


        /*
         * --------------------------------------------------
         * Extract the show name.
         * --------------------------------------------------
         */

        let showName =
            "";


        /*
         * Look for the page's main heading/title.
         */
        const headingMatches =
            [
                ...html.matchAll(
                    /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi
                )
            ];


        for (
            let i = 0;
            i < headingMatches.length;
            i++
        ) {

            const text =
                headingMatches[i][1]
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
             * Avoid using generic page headings.
             */
            if (
                text &&
                !/recently watched|history|mdblist/i
                    .test(text)
            ) {

                showName =
                    text;

                break;
            }
        }


        /*
         * Fallback: derive a readable name from
         * the MDBList show slug.
         */
        if (!showName) {

            showName =
                pathMatch[1]
                    .replace(
                        /^[^-]+-/,
                        ""
                    )
                    .replace(
                        /-/g,
                        " "
                    )
                    .replace(
                        /\b\w/g,
                        function(letter) {
                            return letter.toUpperCase();
                        }
                    );
        }


        /*
         * --------------------------------------------------
         * Find the episode title.
         * --------------------------------------------------
         */

        let episodeTitle =
            "";


        /*
         * Look for the same activity-card structure
         * we already know MDBList uses.
         */
        const subMatch =
            html.match(
                /<div class="activity-poster-card__sub">\s*([\s\S]*?)\s*<\/div>/i
            );


        if (subMatch) {

            episodeTitle =
                subMatch[1]
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
        }


        /*
         * --------------------------------------------------
         * THIS IS THE IMPORTANT PART.
         *
         * Stremio expects:
         *
         * meta.id:
         *     tt11198330
         *
         * video.id:
         *     tt11198330:1:1
         *
         * Exactly the normal Cinemeta format.
         * --------------------------------------------------
         */

        const videoId =
            seriesImdbId +
            ":" +
            season +
            ":" +
            episode;


        console.log(
            "Returning canonical Stremio IDs:",
            JSON.stringify({
                metaId:
                    seriesImdbId,

                videoId:
                    videoId
            })
        );


        return {

            meta: {

                /*
                 * NORMAL IMDb SERIES ID.
                 */
                id:
                    seriesImdbId,

                type:
                    "series",

                name:
                    showName,

                videos: [

                    {
                        /*
                         * NORMAL Stremio episode ID.
                         *
                         * Example:
                         * tt11198330:1:1
                         */
                        id:
                            videoId,

                        title:
                            episodeTitle ||
                            (
                                "Episode " +
                                episode
                            ),

                        season:
                            season,

                        episode:
                            episode
                    }
                ]
            }
        };


    } catch (error) {

        console.error(
            "MDBList meta error:",
            error
        );

        return {
            meta: null
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
