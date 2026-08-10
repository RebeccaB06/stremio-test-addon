```javascript
const {
    addonBuilder,
    serveHTTP
} = require("stremio-addon-sdk");

const manifest = {
    id: "com.example.mdblist-recently-watched",
    version: "4.0.0",

    name: "MDBList Recently Watched",

    description:
        "Shows recently watched episodes from MDBList.",

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
 * Fetch the actual MDBList History page.
 *
 * Example:
 *
 * https://mdblist.com/history/USERNAME?type=episode
 */
async function getHistoryPage(username) {

    const encodedUsername =
        encodeURIComponent(
            username.trim()
        );

    const url =
        `https://mdblist.com/history/${encodedUsername}?type=episode`;

    console.log(
        "Fetching MDBList history page:",
        url
    );

    const response =
        await fetch(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (compatible; Stremio MDBList addon)"
            }
        });

    const html =
        await response.text();

    console.log(
        "MDBList history HTTP status:",
        response.status
    );

    console.log(
        "MDBList history page length:",
        html.length
    );

    if (!response.ok) {

        throw new Error(
            `MDBList history returned HTTP ${response.status}`
        );
    }

    return html;
}


/*
 * Decode common HTML entities.
 */
function decodeHtml(value) {

    return String(value)
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
            /&lt;/g,
            "<"
        )
        .replace(
            /&gt;/g,
            ">"
        )
        .replace(
            /&#x27;/gi,
            "'"
        )
        .replace(
            /&#x2F;/gi,
            "/"
        )
        .replace(
            /&#(\d+);/g,
            (_, code) =>
                String.fromCharCode(
                    Number(code)
                )
        );
}


/*
 * Strip HTML tags.
 */
function stripTags(value) {

    return decodeHtml(
        String(value)
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
 * Extract an IMDb ID from a string.
 */
function getImdbId(value) {

    if (!value) {
        return null;
    }

    const match =
        String(value).match(
            /\btt\d{7,9}\b/
        );

    return match
        ? match[0]
        : null;
}


/*
 * Try to identify SxxExx.
 */
function getEpisodeNumber(text) {

    if (!text) {
        return null;
    }

    const match =
        String(text).match(
            /\bS(\d{1,3})\s*E(\d{1,3})\b/i
        );

    if (!match) {
        return null;
    }

    return {
        season:
            Number(match[1]),

        episode:
            Number(match[2])
    };
}


/*
 * Find title + episode information from
 * the History page.
 *
 * MDBList's HTML can change, so this parser
 * deliberately tries several structures.
 */
function parseHistory(html) {

    const results = [];

    /*
     * First look for links containing IMDb IDs.
     *
     * This gives us the strongest possible
     * Stremio identity.
     */
    const linkRegex =
        /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match;

    while (
        (match =
            linkRegex.exec(html)) !== null
    ) {

        const href =
            match[1];

        const inner =
            match[2];

        const text =
            stripTags(inner);

        if (!text) {
            continue;
        }

        const imdbId =
            getImdbId(
                href
            );

        const episode =
            getEpisodeNumber(
                text
            );

        if (
            !imdbId ||
            !episode
        ) {
            continue;
        }

        results.push({
            id: imdbId,

            name: text,

            season:
                episode.season,

            episode:
                episode.episode
        });
    }


    /*
     * Second strategy:
     *
     * Search the raw HTML for visible SxxExx
     * entries and nearby IMDb IDs.
     */
    if (
        results.length === 0
    ) {

        const blocks =
            html.split(
                /<\/(?:div|article|li|tr)>/i
            );

        for (
            const block of blocks
        ) {

            const text =
                stripTags(
                    block
                );

            const episode =
                getEpisodeNumber(
                    text
                );

            if (!episode) {
                continue;
            }

            const imdbId =
                getImdbId(
                    block
                );

            if (!imdbId) {
                continue;
            }

            results.push({
                id: imdbId,

                name: text,

                season:
                    episode.season,

                episode:
                    episode.episode
            });
        }
    }


    /*
     * Remove exact duplicates.
     */
    const seen =
        new Set();

    return results.filter(
        item => {

            const key =
                `${item.id}:${item.season}:${item.episode}`;

            if (
                seen.has(key)
            ) {
                return false;
            }

            seen.add(key);

            return true;
        }
    );
}


/*
 * Convert parsed HTML entry into Stremio meta.
 */
function toMeta(item) {

    const code =
        `S${String(item.season).padStart(2, "0")}` +
        `E${String(item.episode).padStart(2, "0")}`;

    /*
     * Try to remove the episode code from
     * the title so the catalog displays the
     * show name cleanly.
     */
    let title =
        String(
            item.name || ""
        )
        .replace(
            /\bS\d{1,3}\s*E\d{1,3}\b/i,
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

        releaseInfo: code,

        description: code,

        posterShape: "poster",

        behaviorHints: {
            defaultVideoId: item.id
        }
    };
}


/*
 * Stremio catalog handler.
 */
builder.defineCatalogHandler(
    async (args) => {

        console.log(
            "================================"
        );

        console.log(
            "MDBList Recently Watched"
        );

        console.log(
            "Catalog:",
            args.id
        );

        console.log(
            "Username:",
            args.config?.username || "(missing)"
        );

        console.log(
            "================================"
        );


        if (
            args.id !==
            "mdblist-recently-watched"
        ) {
            return {
                metas: []
            };
        }


        const username =
            String(
                args.config?.username || ""
            ).trim();


        if (!username) {

            console.log(
                "ERROR: MDBList username missing."
            );

            return {
                metas: []
            };
        }


        try {

            /*
             * Fetch exactly:
             *
             * /history/USERNAME?type=episode
             */
            const html =
                await getHistoryPage(
                    username
                );


            /*
             * Check for the private-profile
             * response before attempting parsing.
             */
            if (
                /This profile is private/i.test(
                    html
                )
            ) {

                console.log(
                    "MDBList returned: This profile is private."
                );

                return {
                    metas: []
                };
            }


            /*
             * Check whether MDBList sent us
             * a login page.
             */
            if (
                /name=["'](?:username|email)["']/i.test(
                    html
                ) &&
                /login/i.test(html)
            ) {

                console.log(
                    "MDBList returned a login page."
                );

                return {
                    metas: []
                };
            }


            const entries =
                parseHistory(
                    html
                );


            console.log(
                "Parsed history entries:",
                entries.length
            );


            for (
                let i = 0;
                i < Math.min(
                    entries.length,
                    10
                );
                i++
            ) {

                console.log(
                    `${i + 1}.`,
                    entries[i]
                );
            }


            const metas =
                entries
                    .slice(0, 100)
                    .map(
                        toMeta
                    );


            console.log(
                "Returning:",
                metas.length,
                "catalog items"
            );


            return {
                metas,

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
