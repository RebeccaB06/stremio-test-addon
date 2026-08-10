```javascript
const {
    addonBuilder,
    serveHTTP
} = require("stremio-addon-sdk");

const builder = new addonBuilder({
    id: "com.rebeccabijkerk.mdblist-recently-watched",
    version: "6.0.0",
    name: "MDBList Recently Watched",
    description: "MDBList Recently Watched",

    resources: [
        "catalog"
    ],

    types: [
        "series"
    ],

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
            title: "MDBList Username"
        }
    ],

    behaviorHints: {
        configurable: true,
        configurationRequired: true
    }
});


builder.defineCatalogHandler(function(args) {

    return Promise.resolve({
        metas: [
            {
                id: "tt0111161",
                type: "series",
                name: "TEST - Addon Working",
                releaseInfo: "S01E01"
            }
        ]
    });

});


serveHTTP(
    builder.getInterface(),
    {
        port: process.env.PORT || 7000
    }
);
```
