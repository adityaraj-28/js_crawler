const { website_crawler } = require('./website_crawler.js');
const db = require("./db");
const { LEVEL_LIMIT } = require("./constants");

function fetch_unprocessed_urls(level) {
    const results = []
    const query = `select domain, url from crawl_status_2 where level=${level} and status=false`
    db.query(query, (err, res) => {
        if(err) {
            console.log(`error getting urls at level: ${level}`)
        }
        res.forEach(row => {
            results.push(row.url)
        })
    })
    return results
}

function get_root_domain(){
    const domains = []
    db.query(`select name from domains`, (err, res) => {
        if(err){
            console.log('error fetching root domain')
            process.exit(0)
        }
        res.forEach(row => {
            domains.push(row.name)
        })
    });
    return domains;
}
// website_crawler(event, context, callback);
function run() {
    const callback = (error, response) => {
        if (error) {
            console.log("Error here")
            console.error(error);
        } else {
            console.log("Success Here")
            console.log(response);
        }
    };
    const root_domains = get_root_domain()
    root_domains.forEach(domain => {
        const event = {body: {raw_url: domain}};
        const context = {level: 0}
        website_crawler(event, context, (err, res) => {
            if(err){
                console.log(err)
            } else {
                // we need url, domain and level info here from the callback, so we need to change
                // what is written on db and what is send to callback response
            }
        })
    })
}
