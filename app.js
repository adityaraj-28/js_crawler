const { main } = require('./website_crawler.js');
const db = require('./db');

const event = { body: {raw_url: 'mailto:topaplikasi1@gmail.com'} };
const context = {level: 0};

const callback = (error, response) => {
    if (error) {
        console.log("Error here")
        console.error(error);
    } else {
        console.log("Success Here")
        console.log(response);
    }
};

// db.query('SELECT * FROM domains', (err, results, fields) => {
//     if (err) throw err;
//     console.log(results);
// });

main(event, context, callback);
