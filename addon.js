```javascript
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const manifest = {
    id: "com.example.mdblist-recently-watched",
    version: "4.1.0",
    name: "MDBList Recently Watched",
    description: "Shows recently watched episodes from MDBList.",

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
 * Fetch:
 *
 * https://mdblist.com/history/USERNAME?type=episode
 */
async function getHistoryPage(username) {

    const encodedUsername =
        encodeURIComponent(
            username.trim()
        );

    const url =
        "https://mdblist.com/history/" +
        encodedUsername +
        "?type=episode";

    console.log(
        "Fetching:",
        url
    );

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
        "MDBList HTTP:",
        response.status
    );

    console.log(
        "Response length:",
        html.length
    );

    if (!response.ok) {
        throw new Error(
            "MDBList returned HTTP " +
            response.status
        );
    }

    return html;
}


/*
 * Decode common HTML entities.
 */
function decodeHtml(text) {

    return String(text)
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#x27;/gi, "'")
        .replace(/&#x2F;/gi, "/");
}


/*
 * Remove HTML tags.
 */
function stripTags(text) {

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
        .replace(
            /\s+/g,
            " "
        )
        .trim();
}


/*
 * Find an IMDb ID.
 */
function findImdbId(text) {

    const match =
        String(text).match(
            /tt\d{7,9}/
        );

    if (!match) {
        return null;
    }

    return match[0];
}


/*
 * Find SxxExx.
 */
function findEpisodeNumber(text) {

    const match =
        String(text).match(
            /\bS(\d{1,3})\s*E(\d{1,3})\b/i
        );

    if (!match) {
        return null;
    }

    return {
        season: Number(match[1]),
        episode: Number(match[2])
    };
}


/*
 * Parse MDBList history HTML.
 */
function parseHistory(html) {

    const results = [];

    /*
     * Find every link in the page.
     */
    const linkRegex =
        /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while (
        (match = linkRegex.exec(html)) !== null
    ) {

        const href = match[1];

        const text =
            stripTags(match[2]);

        if (!text) {
            continue;
        }

        const episode =
            findEpisodeNumber(text);

        if (!episode) {
            continue;
        }

        /*
         * Look for IMDb ID in the link itself
         * or in its surrounding HTML.
         */
        let imdbId =
            findImdbId(href);

        if (!imdbId) {
            imdbId =
                findImdbId(match[0]);
        }

        if (!imdbId) {
            continue;
        }

        results.push({
            id: imdbId,
            text: text,
            season: episode.season,
            episode: episode.episode
        });
    }


    /*
     * If links did not work, search HTML blocks.
     */
    if (results.length === 0) {

        const blocks =
            html.split(
                /<\/(?:div|article|li|tr)>/i
            );

        for (
            const block of blocks
        ) {

            const text =
                stripTags(block);

            const episode =
                findEpisodeNumber(text);

            if (!episode) {
                continue;
            }

            const imdbId =
                findImdbId(block);

            if (!imdbId) {
                continue;
            }

            results.push({
                id: imdbId,
                text: text,
                season: episode.season,
                episode: episode.episode
            });
        }
    }


    /*
     * Remove exact duplicates.
     */
    const seen = new Set();

    return results.filter(
        item => {

            const key =
                item.id +
                ":" +
                item.season +
                ":" +
                item.episode;

            if (seen.has(key)) {
                return false;
            }

            seen.add(key);

            return true;
        }
    );
}


/*
 * Convert to Stremio metadata.
 */
function makeMeta(item) {

    const episodeCode =
        "S" +
        String(item.season).padStart(2, "0") +
        "E" +
        String(item.episode).padStart(2, "0");


    /*
     * Remove the episode code from the text.
     */
    let title =
        item.text.replace(
            /\bS\d{1,3}\s*E\d{1,3}\b/i,
            ""
        ).trim();


    /*
     * Remove common surrounding separators.
     */
    title =
        title
            .replace(
                /^\s*[-:|•]\s*/,
                ""
            )
            .trim();


    if (!title) {
        title = "Recently Watched";
    }


    return {
        id: item.id,

        type: "series",

        name: title,

        releaseInfo: episodeCode,

        description: episodeCode,

        posterShape: "poster",

        behaviorHints: {
            defaultVideoId: item.id
        }
    };
}


/*
 * Catalog handler.
 */
builder.defineCatalogHandler(
    async (args) => {

        console.log(
            "===== MDBList Recently Watched ====="
        );

        console.log(
            "Catalog:",
            args.id
        );

        console.log(
            "Type:",
            args.type
        );

        const username =
            String(
                args.config &&
                args.config.username
                    ? args.config.username
                    : ""
            ).trim();


        console.log(
            "Username:",
            username || "(missing)"
        );


        if (
            args.id !==
            "mdblist-recently-watched"
        ) {
            return {
                metas: []
            };
        }


        if (!username) {

            console.log(
                "No MDBList username."
            );

            return {
                metas: []
            };
        }


        try {

            /*
             * Fetch the exact URL requested.
             */
            const html =
                await getHistoryPage(
                    username
                );


            /*
             * Log what MDBList actually gave us.
             */
            if (
                /This profile is private/i.test(
                    html
                )
            ) {

                console.log(
                    "RESULT: MDBList says profile is private."
                );

                return {
                    metas: []
                };
            }


            if (
                /log.?in/i.test(html) &&
                /password/i.test(html)
            ) {

                console.log(
                    "RESULT: MDBList returned a login page."
                );

                return {
                    metas: []
                };
            }


            /*
             * Parse episodes.
             */
            const episodes =
                parseHistory(html);


            console.log(
                "Parsed episodes:",
                episodes.length
            );


            /*
             * Print first few parsed entries.
             */
            for (
                let i = 0;
                i < Math.min(
                    episodes.length,
                    10
                );
                i++
            ) {

                console.log(
                    i + 1,
                    episodes[i]
                );
            }


            const metas =
                episodes
                    .slice(0, 100)
                    .map(
                        makeMeta
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
                "MDBList error:",
                error
            );

            return {
                metas: []
            };
        }
    }
);


/*
 * Start server.
 */
serveHTTP(
    builder.getInterface(),
    {
        port:
            process.env.PORT || 7000
    }
);
```
