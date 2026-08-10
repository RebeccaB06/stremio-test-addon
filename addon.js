```javascript
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const builder = new addonBuilder({
    id: "com.example.mdblist-recently-watched",
    version: "5.0.0",
    name: "MDBList Recently Watched",
    description: "MDBList recently watched episodes",

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
        }
    ],

    behaviorHints: {
        configurable: true,
        configurationRequired: true
    }
});


builder.defineCatalogHandler(async (args) => {

    if (args.id !== "mdblist-recently-watched") {
        return { metas: [] };
    }

    const username = String(
        args.config?.username || ""
    ).trim();

    if (!username) {
        console.log("No username configured");
        return { metas: [] };
    }

    const url = new URL(
        "/history/" + encodeURIComponent(username),
        "https://mdblist.com"
    );

    url.searchParams.set("type", "episode");

    console.log(
        "Fetching MDBList:",
        url.toString()
    );

    try {

        const response = await fetch(
            url,
            {
                headers: {
                    "User-Agent": "Mozilla/5.0"
                }
            }
        );

        const html = await response.text();

        console.log(
            "MDBList status:",
            response.status
        );

        console.log(
            "MDBList content length:",
            html.length
        );

        console.log(
            "Contains private message:",
            html.includes("This profile is private")
        );

        console.log(
            "Contains SxxExx:",
            /\bS\d{1,3}E\d{1,3}\b/i.test(html)
        );

        /*
         * TEMPORARY TEST:
         *
         * If the page actually contains episode data,
         * this will prove it before we write the parser.
         */
        const matches = [
            ...html.matchAll(
                /\bS(\d{1,3})E(\d{1,3})\b/gi
            )
        ];

        console.log(
            "Episode references found:",
            matches.length
        );

        /*
         * Return simple test entries so we can see
         * whether Stremio receives catalog results.
         */
        const metas = matches
            .slice(0, 100)
            .map((match, index) => ({
                id: "mdblist-test-" + index,
                type: "series",
                name: "MDBList History Episode",
                releaseInfo:
                    "S" +
                    String(match[1]).padStart(2, "0") +
                    "E" +
                    String(match[2]).padStart(2, "0"),
                description:
                    "MDBList episode detected"
            }));

        console.log(
            "Returning test catalog entries:",
            metas.length
        );

        return {
            metas: metas,
            cacheMaxAge: 60
        };

    } catch (error) {

        console.error(
            "MDBList request failed:",
            error
        );

        return {
            metas: []
        };
    }
});


serveHTTP(
    builder.getInterface(),
    {
        port: process.env.PORT || 7000
    }
);
```
