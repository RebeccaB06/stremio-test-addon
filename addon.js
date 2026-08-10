const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const builder = new addonBuilder({
    id: "com.example.addonworking",
    version: "1.0.0",
    name: "Addon Working Test",
    description: "Simple Stremio addon test",

    // This addon only provides streams.
    resources: ["stream"],

    // It supports movies.
    types: ["movie"],

    // Movie IDs are IMDb IDs such as tt1234567.
    idPrefixes: ["tt"],

    // We don't provide any catalogs.
    catalogs: []
});

builder.defineStreamHandler(async (args) => {
    console.log("Stremio requested:", args.type, args.id);

    return {
        streams: [
            {
                name: "Addon Working",
                title: "Addon Working ✅",
                url: "https://example.com/test.mp4"
            }
        ]
    };
});

serveHTTP(builder.getInterface(), {
    port: process.env.PORT || 7000
});
