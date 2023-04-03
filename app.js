const { main } = require('./website_crawler.js');
// const db = require("./db");

const event = { body: {raw_url: 'apple.com'} };
const context = {level: 0};

const callback = (error, response) => {
    if (error) {
        console.log("Error here")
        console.error(error);
    } else {
        console.log("Success Here")
        console.log(response);
    }
    process.exit(0)
};

main(event, context, callback);
