```javascript
const {
    addonBuilder,
    serveHTTP
} = require("stremio-addon-sdk");

const manifest = {
    id: "com.example.mdblist-history",
    version: "2.0.0",
    name: "MDBList History",
    description: "Shows your recently watched episodes from MDBList.",

    resources: ["catalog"],

    types: ["series"],

    catalogs: [
        {
            id: "mdblist-history",
            type: "series",
            name: "MDBList History"
        }
    ],

    config: [
        {
            key: "username",
            type: "text",
            title: "MDBList Username",
            required: true
        },
        {
            key: "apiKey",
            type: "password",
            title: "MDBList API Key",
            required: false
        }
    ],

    behaviorHints: {
        configurable: true,
        configurationRequired: true
    }
};

const builder = new addonBuilder(manifest);


/*
 * Fetch the MDBList History page.
 */
async function getHistoryPage(username) {

    const url =
        "https://mdblist.com/history/" +
        encodeURIComponent(username) +
        "?type=episode";

    console.log(
        "Calling MDBList History:",
        url
    );

    const response =
        await fetch(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0"
            }
        });

    const text =
        await response.text();

    console.log(
        "MDBList HTTP status:",
        response.status
    );

    console.log(
        "MDBList response length:",
        text.length
    );

    if (!response.ok) {

        throw new Error(
            "MDBList returned HTTP " +
            response.status +
            ": " +
            text
        );
    }

    return text;
}


/*
 * Decode HTML entities.
 */
function decodeHtml(text) {

    return String(text)
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#x27;/gi, "'");
}


/*
 * Remove HTML tags.
 */
function stripHtml(text) {

    return decodeHtml(
        String(text)
            .replace(
                /<script[\s\S]*?<\/script>/gi,
                ""
            )
            .replace(
                /<style[\s\S]*?<\/style>/gi,
                ""
            )
            .replace(
                /<[^>]+>/g,
                " "
            )
    )
        .replace(/\s+/g, " ")
        .trim();
}


/*
 * Find an IMDb ID.
 */
function getImdbId(text) {

    const match =
        String(text).match(
            /tt[0-9]{7,9}/
        );

    if (!match) {
        return null;
    }

    return match[0];
}


/*
 * Find SxxExx.
 */
function getEpisodeCode(text) {

    const match =
        String(text).match(
            /\bS([0-9]{1,3})E([0-9]{1,3})\b/i
        );

    if (!match) {
        return null;
    }

    return {
        season: Number(match[1]),
        episode: Number(match[2]),
        code: match[0].toUpperCase()
    };
}


/*
 * Try to extract episode history entries
 * from the MDBList History HTML.
 */
function parseHistory(html) {

    const entries = [];

    /*
     * Look at every anchor in the page.
     */
    const linkRegex =
        /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while (
        (match = linkRegex.exec(html)) !== null
    ) {

        const href =
            match[1];

        const linkHtml =
            match[0];

        const text =
            stripHtml(match[2]);

        /*
         * History entries should contain
         * an SxxExx value.
         */
        const episode =
            getEpisodeCode(text);

        if (!episode) {
            continue;
        }

        /*
         * Look for IMDb ID in the link.
         */
        let imdbId =
            getImdbId(href);

        /*
         * If it wasn't in href, look at
         * the complete anchor.
         */
        if (!imdbId) {
            imdbId =
                getImdbId(linkHtml);
        }

        /*
         * Keep entries even if the page doesn't
         * expose an IMDb ID in the anchor.
         *
         * We'll use a generated ID below.
         */
        entries.push({
            imdbId: imdbId,
            text: text,
            season: episode.season,
            episode: episode.episode,
            code: episode.code
        });
    }


    /*
     * If the anchor search found nothing,
     * search larger HTML blocks.
     */
    if (entries.length === 0) {

        const blocks =
            html.split(
                /<\/(?:div|article|li|tr)>/i
            );

        for (
            let i = 0;
            i < blocks.length;
            i++
        ) {

            const block =
                blocks[i];

            const text =
                stripHtml(block);

            const episode =
                getEpisodeCode(text);

            if (!episode) {
                continue;
            }

            const imdbId =
                getImdbId(block);

            entries.push({
                imdbId: imdbId,
                text: text,
                season: episode.season,
                episode: episode.episode,
                code: episode.code
            });
        }
    }


    /*
     * Remove exact duplicate entries.
     */
    const seen =
        new Set();

    return entries.filter(
        entry => {

            const key =
                String(entry.imdbId || "") +
                "|" +
                entry.code +
                "|" +
                entry.text;

            if (seen.has(key)) {
                return false;
            }

            seen.add(key);

            return true;
        }
    );
}


/*
 * Convert a History entry into a Stremio
 * catalog item.
 */
function convertItem(item, index) {

    /*
     * Prefer an IMDb ID from MDBList.
     */
    let id =
        item.imdbId;


    /*
     * If there isn't one, create a stable ID
     * so the catalog still displays the item.
     */
    if (!id) {

        id =
            "mdblist-history-" +
            index;
    }


    /*
     * Try to make the show title cleaner.
     */
    let title =
        item.text
            .replace(
                /\bS[0-9]{1,3}E[0-9]{1,3}\b/i,
                ""
            )
            .replace(
                /^\s*[-:|•]\s*/,
                ""
            )
            .trim();


    if (!title) {
        title =
            "Recently Watched";
    }


    const meta = {
        id: id,

        type: "series",

        name: title,

        releaseInfo:
            item.code,

        description:
            "Recently watched — " +
            item.code,

        posterShape: "poster"
    };


    /*
     * If the History page contained an IMDb
     * episode ID, use it as the default video ID.
     */
    if (item.imdbId) {

        meta.behaviorHints = {
            defaultVideoId:
                item.imdbId
        };
    }


    return meta;
}


/*
 * Stremio asks us for the MDBList History catalog.
 */
builder.defineCatalogHandler(
    async (args) => {

        console.log(
            "CATALOG REQUEST:",
            JSON.stringify({
                type: args.type,
                id: args.id,
                hasConfig: !!args.config,
                username:
                    args.config &&
                    args.config.username
                        ? args.config.username
                        : "(none)"
            })
        );


        /*
         * Make sure this is our catalog.
         */
        if (
            args.id !==
            "mdblist-history"
        ) {

            return {
                metas: []
            };
        }


        /*
         * Get username supplied through
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


        try {

            /*
             * Fetch:
             *
             * https://mdblist.com/history/USERNAME?type=episode
             */
            const html =
                await getHistoryPage(
                    username
                );


            /*
             * Tell us what MDBList returned.
             */
            console.log(
                "Contains private-profile message:",
                html.indexOf(
                    "This profile is private"
                ) !== -1
            );


            /*
             * Parse episode history.
             */
            const history =
                parseHistory(html);


            console.log(
                "Parsed MDBList history entries:",
                history.length
            );


            /*
             * Print the first entries to the log.
             */
            for (
                let i = 0;
                i < Math.min(
                    history.length,
                    10
                );
                i++
            ) {

                console.log(
                    "HISTORY ENTRY:",
                    JSON.stringify(
                        history[i]
                    )
                );
            }


            /*
             * Convert to Stremio catalog items.
             */
            const metas =
                history
                    .slice(0, 100)
                    .map(
                        (item, index) =>
                            convertItem(
                                item,
                                index
                            )
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
                "MDBList catalog error:",
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
