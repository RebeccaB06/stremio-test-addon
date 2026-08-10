```javascript
const {
    addonBuilder,
    serveHTTP
} = require("stremio-addon-sdk");

const manifest = {
    id: "com.example.mdblist-recently-watched",
    version: "2.0.0",

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
 * MDBList history endpoint.
 *
 * IMPORTANT:
 * Do NOT use mediatype=episode here.
 *
 * The current MDBList history response contains:
 *
 * {
 *   movies: [...],
 *   shows: [...],
 *   seasons: [...],
 *   episodes: [...]
 * }
 *
 * The episode records contain:
 *
 * episode
 * episode.show
 * episode.season
 * episode.number
 * watched_at
 *
 * This is the structure used by current
 * MDBList history integrations.
 */
async function getHistory(apiKey) {

    const allEpisodes = [];

    let offset = 0;

    const limit = 1000;

    const maxPages = 100;

    for (let page = 0; page < maxPages; page++) {

        const params = new URLSearchParams({
            apikey: apiKey,
            offset: String(offset),
            limit: String(limit)
        });

        const url =
            `https://api.mdblist.com/sync/watched?${params}`;

        console.log(
            `MDBList history request: offset=${offset}`
        );

        const response =
            await fetch(url);

        const text =
            await response.text();

        console.log(
            `MDBList HTTP status: ${response.status}`
        );

        if (!response.ok) {

            throw new Error(
                `MDBList returned HTTP ${response.status}: ${text}`
            );
        }

        let data;

        try {
            data = JSON.parse(text);
        } catch (error) {

            throw new Error(
                "MDBList returned invalid JSON."
            );
        }

        /*
         * THIS is the important part.
         *
         * History episodes are in data.episodes.
         */
        const episodes =
            Array.isArray(data.episodes)
                ? data.episodes
                : [];

        console.log(
            `Episodes returned: ${episodes.length}`
        );

        allEpisodes.push(
            ...episodes
        );

        /*
         * MDBList's current pagination information.
         */
        const pagination =
            data.pagination;

        if (
            pagination &&
            pagination.has_more === false
        ) {
            break;
        }

        /*
         * Also stop if this page contains nothing.
         */
        if (episodes.length === 0) {
            break;
        }

        /*
         * If fewer than the requested number came back,
         * there is normally nothing more to fetch.
         */
        const totalRows =
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

        if (totalRows < limit) {
            break;
        }

        offset += limit;
    }

    return allEpisodes;
}


/*
 * Get an IMDb ID from an MDBList IDs object.
 */
function getImdbId(ids) {

    if (!ids || typeof ids !== "object") {
        return null;
    }

    const value =
        ids.imdb ||
        ids.imdb_id;

    if (!value) {
        return null;
    }

    const id =
        String(value).trim();

    if (!/^tt\d+$/.test(id)) {
        return null;
    }

    return id;
}


/*
 * Convert an MDBList episode record into
 * a Stremio catalog entry.
 */
function convertEpisode(row) {

    if (!row || typeof row !== "object") {
        return null;
    }

    const episode =
        row.episode || {};

    const show =
        episode.show || {};

    /*
     * MDBList's current history structure puts
     * the show IDs inside episode.show.ids.
     */
    const showId =
        getImdbId(show.ids) ||
        getImdbId(episode.ids) ||
        getImdbId(row.ids);

    if (!showId) {

        console.log(
            "Skipping history entry without IMDb ID."
        );

        return null;
    }

    /*
     * Season and episode numbers.
     */
    const season =
        Number(
            episode.season
        );

    const episodeNumber =
        Number(
            episode.number ??
            episode.episode
        );

    if (
        !Number.isInteger(season) ||
        !Number.isInteger(episodeNumber) ||
        season < 0 ||
        episodeNumber < 0
    ) {

        console.log(
            "Skipping history entry without episode numbers."
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
            row.series_title ||
            row.show_title ||
            "Unknown Show"
        ).trim();

    /*
     * Episode title.
     */
    const episodeTitle =
        String(
            episode.title ||
            episode.name ||
            ""
        ).trim();

    /*
     * The actual watch timestamp.
     */
    const watchedAt =
        row.watched_at ||
        row.last_watched_at ||
        null;

    /*
     * Format exactly like:
     *
     * The Bear
     * S04E03
     */
    const episodeCode =
        `S${String(season).padStart(2, "0")}` +
        `E${String(episodeNumber).padStart(2, "0")}`;

    /*
     * Stremio catalog entries are series previews.
     *
     * We use the show's IMDb ID so clicking the
     * entry opens the actual show.
     *
     * The episode information is displayed in
     * releaseInfo/description.
     */
    const meta = {

        id: showId,

        type: "series",

        name: showTitle,

        releaseInfo: episodeCode,

        description:
            episodeTitle
                ? `${episodeCode} — ${episodeTitle}`
                : episodeCode,

        poster:
            show.poster ||
            show.images?.poster ||
            episode.poster ||
            episode.images?.poster,

        posterShape: "poster",

        behaviorHints: {
            defaultVideoId:
                getImdbId(episode.ids)
        }
    };

    return {
        meta,
        watchedAt
    };
}


/*
 * Recently Watched catalog.
 */
builder.defineCatalogHandler(
    async (args) => {

        console.log(
            "Catalog request:",
            {
                id: args.id,
                type: args.type,
                configured:
                    Boolean(
                        args.config?.apiKey
                    )
            }
        );

        /*
         * Only handle our catalog.
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
         * Get the API key from the Stremio
         * configuration.
         */
        const apiKey =
            args.config?.apiKey;

        if (!apiKey) {

            console.log(
                "No MDBList API key."
            );

            return {
                metas: []
            };
        }

        try {

            /*
             * Get the actual MDBList history.
             */
            const episodes =
                await getHistory(
                    apiKey
                );

            console.log(
                `Total MDBList history episodes: ${episodes.length}`
            );

            /*
             * Convert each episode.
             */
            const converted =
                episodes
                    .map(convertEpisode)
                    .filter(Boolean);

            /*
             * Sort by the ACTUAL MDBList watch
             * timestamp, newest first.
             */
            converted.sort(
                (a, b) => {

                    const aTime =
                        Date.parse(
                            a.watchedAt || ""
                        ) || 0;

                    const bTime =
                        Date.parse(
                            b.watchedAt || ""
                        ) || 0;

                    return bTime - aTime;
                }
            );

            /*
             * Keep every individual history event.
             *
             * Do NOT deduplicate episodes.
             *
             * If you watched:
             *
             * The Bear S04E03
             * The Bear S04E02
             * The Bear S04E03
             *
             * all three history events remain.
             */
            const metas =
                converted
                    .slice(0, 100)
                    .map(
                        entry => entry.meta
                    );

            console.log(
                `Returning ${metas.length} catalog items.`
            );

            return {
                metas,

                /*
                 * Short cache so newly watched episodes
                 * appear quickly.
                 */
                cacheMaxAge: 60
            };

        } catch (error) {

            console.error(
                "MDBList history error:",
                error
            );

            return {
                metas: []
            };
        }
    }
);


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
```
