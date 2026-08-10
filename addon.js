```javascript
const stremio = require("stremio-addon-sdk");

const addon = new stremio.addonBuilder({
    id: "com.example.mdblist-recently-watched",
    version: "5.1.0",
    name: "MDBList Recently Watched",
    description: "Shows recently watched MDBList episodes.",

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


addon.defineCatalogHandler(function(args) {

    return new Promise(function(resolve) {

        if (
            args.id !==
            "mdblist-recently-watched"
        ) {
            resolve({
                metas: []
            });

            return;
        }


        var config =
            args.config || {};


        var username =
            config.username || "";


        username =
            String(username).trim();


        if (!username) {

            console.log(
                "MDBList username is missing."
            );

            resolve({
                metas: []
            });

            return;
        }


        var url =
            "https://mdblist.com/history/" +
            encodeURIComponent(username) +
            "?type=episode";


        console.log(
            "Fetching MDBList history:"
        );

        console.log(url);


        fetch(
            url,
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0"
                }
            }
        )
        .then(function(response) {

            console.log(
                "MDBList HTTP status:",
                response.status
            );

            return response.text();

        })
        .then(function(html) {

            console.log(
                "MDBList response length:",
                html.length
            );


            /*
             * FIRST TEST:
             *
             * Determine whether MDBList actually
             * returned episode information.
             */
            var episodeMatches =
                html.match(
                    /\bS[0-9]{1,3}E[0-9]{1,3}\b/gi
                );


            var count =
                episodeMatches
                    ? episodeMatches.length
                    : 0;


            console.log(
                "Episode references found:",
                count
            );


            /*
             * If the page contains no episodes,
             * don't pretend it did.
             */
            if (count === 0) {

                console.log(
                    "No SxxExx entries found."
                );


                if (
                    html.indexOf(
                        "This profile is private"
                    ) !== -1
                ) {

                    console.log(
                        "MDBList says the profile is private."
                    );

                }


                resolve({
                    metas: []
                });

                return;
            }


            /*
             * For this diagnostic version,
             * create one catalog item for every
             * SxxExx we found.
             *
             * This proves the History page can
             * actually be read before we build
             * the final HTML parser.
             */
            var metas = [];


            for (
                var i = 0;
                i < count && i < 100;
                i++
            ) {

                var code =
                    episodeMatches[i];


                metas.push({
                    id:
                        "mdblist-history-" +
                        i,

                    type:
                        "series",

                    name:
                        "MDBList Recently Watched",

                    releaseInfo:
                        code,

                    description:
                        "Watched episode " +
                        code
                });
            }


            console.log(
                "Returning catalog items:",
                metas.length
            );


            resolve({
                metas: metas,
                cacheMaxAge: 60
            });

        })
        .catch(function(error) {

            console.error(
                "MDBList request failed:"
            );

            console.error(error);


            resolve({
                metas: []
            });

        });

    });
});


stremio.serveHTTP(
    addon.getInterface(),
    {
        port:
            process.env.PORT || 7000
    }
);
```
