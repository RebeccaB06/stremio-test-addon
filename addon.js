```javascript
const {
    addonBuilder,
    serveHTTP
} = require("stremio-addon-sdk");

const manifest = {
    id: "com.example.mdblist-recently-watched",
    version: "3.0.0",

    name: "MDBList Recently Watched",

    description:
        "Shows your recently watched MDBList episodes.",

    resources: ["catalog"],

    types: ["series"],

    catalogs: [
        {
            type: "series",
            id: "mdblist-recently-watched",
            name: "MDBList Recently Watched"
        }
    ],

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
 * ---------------------------------------------------------
 * MDBList
 * ---------------------------------------------------------
 *
 * MDBList /sync/watched returns separate buckets:
 *
 *   movies
 *   shows
 *   seasons
 *   episodes
 *
 * We want ONLY the episode bucket.
 *
 * The current MDBList response structure is:
 *
 * episodes: [
 *   {
 *     watched_at: "...",
 *     episode: {
 *       ids: {...},
 *       number: 3,
 *       season: 4,
 *       show: {
 *         ids: {...},
 *         title: "The Bear"
 *       }
 *     }
 *   }
 * ]
 *
 * This matches the current MDBList integration used
 * by CrossWatch.
 */
async function getMDBListHistory(apiKey) {

    const results = [];

    let offset = 0;

    const limit = 1000;

    for (let page = 0; page < 100; page++) {

        const params = new URLSearchParams();

        params.set(
            "apikey",
            apiKey
        );

        params.set(
            "offset",
            String(offset)
        );

        params.set(
            "limit",
            String(limit)
        );

        const url =
            "https://api.mdblist.com/sync/watched?" +
            params.toString();

        console.log(
            "MDBList request:",
            url.replace(
                apiKey,
                "[REDACTED]"
            )
        );

        const response =
            await fetch(url);

        const text =
            await response.text();

        console.log(
            "MDBList HTTP:",
            response.status
        );

        if (!response.ok) {

            throw new Error(
                `MDBList HTTP ${response.status}: ${text}`
            );
        }

        let data;

        try {

            data =
                JSON.parse(text);

        } catch (error) {

            throw new Error(
                "MDBList returned invalid JSON."
            );
        }

        /*
         * THIS is the important part.
         */
        const episodes =
            Array.isArray(data.episodes)
                ? data.episodes
                : [];

        console.log(
            "Episodes in this page:",
            episodes.length
        );

        results.push(
            ...episodes
        );

        /*
         * Respect MDBList pagination.
         */
        if (
            data.pagination &&
            data.pagination.has_more === false
        ) {
            break;
        }

        /*
         * No more records.
         */
        const total =
            (
                Array.isArray(data.movies)
                    ? data.movies.length
                    : 0
            ) +
            (
                Array.isArray(data.shows)
                    ? data.shows.length
                    : 0
            ) +
            (
                Array.isArray(data.seasons)
                    ? data.seasons.length
                    : 0
            ) +
            episodes.length;

        if (total === 0) {
            break;
        }

        if (total < limit) {
            break;
        }

        offset += limit;
    }

    return results;
}


/*
 * ---------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------
 */

function validIMDbId(value) {

    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const id =
        String(value).trim();

    if (
        /^tt\d+$/.test(id)
    ) {
        return id;
    }

    return null;
}


/*
 * Get an IMDb ID from an MDBList IDs object.
 */
function imdbFromIds(ids) {

    if (
        !ids ||
        typeof ids !== "object"
    ) {
        return null;
    }

    return (
        validIMDbId(ids.imdb) ||
        validIMDbId(ids.imdb_id)
    );
}


/*
 * Get the actual episode record.
 */
function getEpisodeRecord(row) {

    if (
        row &&
        row.episode &&
        typeof row.episode === "object"
    ) {
        return row.episode;
    }

    return null;
}


/*
 * Get show information.
 */
function getShowRecord(episode) {

    if (
        episode &&
        episode.show &&
        typeof episode.show === "object"
    ) {
        return episode.show;
    }

    return null;
}


/*
 * Get watch timestamp.
 */
function getWatchedAt(row) {

    return (
        row?.watched_at ||
        row?.last_watched_at ||
        row?.watchedAt ||
        null
    );
}


/*
 * Parse a date safely.
 */
function timestamp(value) {

    if (!value) {
        return 0;
    }

    const parsed =
        Date.parse(
            String(value)
        );

    return Number.isNaN(parsed)
        ? 0
        : parsed;
}


/*
 * ---------------------------------------------------------
 * Convert MDBList episode → Stremio catalog item
 * ---------------------------------------------------------
 */
function convertEpisode(row) {

    const episode =
        getEpisodeRecord(row);

    if (!episode) {

        console.log(
            "Skipping row without episode object."
        );

        return null;
    }

    const show =
        getShowRecord(episode);

    if (!show) {

        console.log(
            "Skipping episode without show object."
        );

        return null;
    }


    /*
     * Episode IMDb ID.
     */
    const episodeId =
        imdbFromIds(
            episode.ids
        );


    /*
     * Show IMDb ID.
     */
    const showId =
        imdbFromIds(
            show.ids
        );


    /*
     * We need at least one IMDb ID.
     *
     * Prefer the episode ID because this is
     * the actual item the user watched.
     */
    const id =
        episodeId ||
        showId;


    if (!id) {

        console.log(
            "Skipping episode with no IMDb ID:",
            JSON.stringify({
                episode: episode.ids,
                show: show.ids
            })
        );

        return null;
    }


    /*
     * Show title.
     */
    const showTitle =
        String(
            show.title ||
            show.name ||
            ""
        ).trim();


    if (!showTitle) {

        console.log(
            "Skipping episode without show title:",
            JSON.stringify(show)
        );

        return null;
    }


    /*
     * Season number.
     */
    const season =
        Number(
            episode.season
        );


    /*
     * Episode number.
     */
    const episodeNumber =
        Number(
            episode.number
        );


    if (
        !Number.isInteger(season) ||
        !Number.isInteger(episodeNumber)
    ) {

        console.log(
            "Skipping episode with invalid S/E:",
            JSON.stringify({
                show: showTitle,
                season: episode.season,
                episode: episode.number
            })
        );

        return null;
    }


    /*
     * Build SxxExx.
     */
    const episodeCode =
        "S" +
        String(season).padStart(2, "0") +
        "E" +
        String(episodeNumber).padStart(2, "0");


    /*
     * Episode title, if MDBList supplies one.
     */
    const episodeTitle =
        String(
            episode.title ||
            episode.name ||
            ""
        ).trim();


    /*
     * Poster.
     */
    const poster =
        show.poster ||
        show.images?.poster ||
        episode.poster ||
        episode.images?.poster ||
        undefined;


    /*
     * IMPORTANT:
     *
     * We use the episode IMDb ID when available.
     *
     * This prevents every episode of a show from
     * collapsing into the same catalog ID.
     */
    const meta = {

        id,

        type: "series",

        name: showTitle,

        releaseInfo:
            episodeCode,

        description:
            episodeTitle
                ? `${episodeCode} — ${episodeTitle}`
                : episodeCode,

        poster,

        posterShape: "poster",

        behaviorHints: {
            defaultVideoId:
                episodeId || undefined
        }
    };


    return {
        meta,
        watchedAt:
            getWatchedAt(row)
    };
}


/*
 * ---------------------------------------------------------
 * Stremio catalog
 * ---------------------------------------------------------
 */
builder.defineCatalogHandler(
    async (args) => {

        console.log(
            "========================================"
        );

        console.log(
            "MDBList Recently Watched catalog request"
        );

        console.log(
            "Catalog:",
            args.id
        );

        console.log(
            "Type:",
            args.type
        );

        console.log(
            "API key supplied:",
            Boolean(
                args.config?.apiKey
            )
        );

        console.log(
            "========================================"
        );


        /*
         * Make sure this is our catalog.
         */
        if (
            args.id !==
            "mdblist-recently-watched"
        ) {

            return {
                metas: []
            };
        }


        /*
         * API key entered on the Stremio
         * configuration page.
         */
        const apiKey =
            String(
                args.config?.apiKey ||
                ""
            ).trim();


        if (!apiKey) {

            console.log(
                "ERROR: MDBList API key missing."
            );

            return {
                metas: []
            };
        }


        try {

            /*
             * Get MDBList's watched snapshot.
             */
            const rows =
                await getMDBListHistory(
                    apiKey
                );


            console.log(
                "Total episode rows:",
                rows.length
            );


            /*
             * Convert only valid episode rows.
             */
            const converted =
                rows
                    .map(
                        convertEpisode
                    )
                    .filter(
                        Boolean
                    );


            console.log(
                "Valid episode catalog entries:",
                converted.length
            );


            /*
             * Newest watched first.
             */
            converted.sort(
                (a, b) =>
                    timestamp(
                        b.watchedAt
                    ) -
                    timestamp(
                        a.watchedAt
                    )
            );


            /*
             * Log the first few entries so the
             * Render log immediately tells us
             * what MDBList returned.
             */
            for (
                let i = 0;
                i < Math.min(
                    converted.length,
                    10
                );
                i++
            ) {

                const entry =
                    converted[i];

                console.log(
                    `#${i + 1}`,
                    entry.meta.name,
                    entry.meta.releaseInfo,
                    entry.watchedAt,
                    entry.meta.id
                );
            }


            /*
             * Return the most recent 100.
             *
             * Do NOT deduplicate by show.
             *
             * Each episode is its own catalog item.
             */
            const metas =
                converted
                    .slice(0, 100)
                    .map(
                        entry =>
                            entry.meta
                    );


            console.log(
                "Returning to Stremio:",
                metas.length,
                "items"
            );


            return {

                metas,

                cacheMaxAge: 60
            };


        } catch (error) {

            console.error(
                "========================================"
            );

            console.error(
                "MDBList ERROR"
            );

            console.error(
                error
            );

            console.error(
                "========================================"
            );

            return {
                metas: []
            };
        }
    }
);


/*
 * ---------------------------------------------------------
 * Start server
 * ---------------------------------------------------------
 */
serveHTTP(
    builder.getInterface(),
    {
        port:
            process.env.PORT || 7000
    }
);
```
