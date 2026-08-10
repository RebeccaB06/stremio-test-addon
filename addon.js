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


    if (args.id !== "mdblist-history") {
        return {
            metas: []
        };
    }


    const username =
        args.config &&
        args.config.username
            ? args.config.username
            : "";


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
         * MDBList uses:
         *
         * <div class="activity-poster-card">
         *
         * Each card contains:
         *
         * /show/.../season/.../episode/...
         *
         * poster
         * title
         * episode number
         * episode title
         */


        const cardRegex =
            /<div class="activity-poster-card">([\s\S]*?)<\/div>\s*<\/div>/gi;


        const cards = [];


        let cardMatch;


        while (
            (cardMatch =
                cardRegex.exec(html)) !== null
        ) {

            const card =
                cardMatch[1];


            /*
             * Episode URL
             */
            const urlMatch =
                card.match(
                    /href="(\/show\/[^"]+\/season\/[0-9]+\/episode\/[0-9]+)"/i
                );


            if (!urlMatch) {
                continue;
            }


            const episodePath =
                urlMatch[1];


            /*
             * Poster
             */
            const posterMatch =
                card.match(
                    /<img[^>]+src="([^"]+)"/i
                );


            const poster =
                posterMatch
                    ? posterMatch[1]
                    : null;


            /*
             * Title from:
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
             * Episode title:
             *
             * Dead Things
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
             * S06E13
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


            const code =
                "S" +
                episodeMatch[1] +
                "E" +
                episodeMatch[2];


            /*
             * Remove S06E13 from the show title.
             */
            const showName =
                title
                    .replace(
                        /\s*S[0-9]+E[0-9]+\s*$/i,
                        ""
                    )
                    .trim();


            cards.push({
                path:
                    episodePath,

                showName:
                    showName,

                episodeTitle:
                    episodeTitle,

                season:
                    season,

                episode:
                    episode,

                code:
                    code,

                poster:
                    poster
            });
        }


        console.log(
            "MDBList episode cards found:",
            cards.length
        );


        /*
         * Now resolve the actual IMDb episode IDs.
         *
         * MDBList's episode page contains the IMDb
         * episode ID.
         */


        const metas = [];


        for (
            let i = 0;
            i < cards.length &&
            i < 100;
            i++
        ) {

            const item =
                cards[i];


            const episodeUrl =
                "https://mdblist.com" +
                item.path;


            console.log(
                "Fetching episode:",
                episodeUrl
            );


            try {

                const episodeResponse =
                    await fetch(
                        episodeUrl
                    );


                const episodeHtml =
                    await episodeResponse.text();


                /*
                 * MDBList episode pages contain:
                 *
                 * tt1234567
                 *
                 * for the IMDb episode.
                 */
                const imdbMatch =
                    episodeHtml.match(
                        /\btt[0-9]{7,9}\b/
                    );


                const imdbId =
                    imdbMatch
                        ? imdbMatch[0]
                        : null;


                console.log(
                    "Episode IMDb ID:",
                    imdbId
                );


                if (!imdbId) {

                    console.log(
                        "No IMDb ID found for:",
                        item.showName,
                        item.code
                    );

                    continue;
                }


                /*
                 * Return the actual IMDb episode ID.
                 *
                 * This is no longer a fake
                 * mdblist-history-123 ID.
                 */
                metas.push({

                    id:
                        imdbId,

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
                        item.episodeTitle
                });


            } catch (episodeError) {

                console.error(
                    "Episode lookup failed:",
                    episodeUrl,
                    episodeError
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
            "MDBList History error:",
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
