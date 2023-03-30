const { main } = require('./website_crawler.js');

const event = { body: {raw_url: 'https://venture.com/refund_policy'} };
const context = {level: 1};

const callback = (error, response) => {
    if (error) {
        console.log("Error here")
        console.error(error);
    } else {
        console.log("Success Here")
        console.log(response);
    }
};
main(event, context, callback);
