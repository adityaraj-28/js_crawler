const { website_crawler } = require('./website_crawler.js');
const db = require("./db");
const { LEVEL_LIMIT } = require("./constants");

function fetch_unprocessed_urls(level) {
    const results = []
    // todo: remove limit after testing
    const query = `select domain, url from crawl_status_2 where level=${level} and status=false LIMIT 3`
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

function get_root_domain(callback){
    db.query(`select name from domains LIMIT 3`, (err, res) => {
        console.log(res.length)
        if(err){
            console.log('error fetching root domain')
            process.exit(0)
        }
        const domains = []
        res.forEach(row => {
            console.log(row.name)
            domains.push(row.name)
        })
        callback(domains)
    });
    return [];
}

function processRootDomains() {
    get_root_domain(root_domains => {
        console.log("rd len " + root_domains.length)
        root_domains.forEach(domain => {
            const event = {body: {raw_url: domain}};
            const context = {level: 0}
            website_crawler(event, context, (err, _) => {
                if (err) {
                    console.log(err)
                }
            })
        })
    })
}

function run() {
    processRootDomains();
    let level = 1
    while(1){
        if (level > LEVEL_LIMIT){
            break
        }
        const raw_url_list = fetch_unprocessed_urls(level)
        if(raw_url_list.length === 0)
            break
        raw_url_list.forEach(url => {
            const event = {body: {raw_url: url}};
            const context = {level: level}
            let all_success = true
            website_crawler(event, context, (err, res) => {
                if(err){
                    console.log(err)
                    all_success = false
                }
                console.log(res)
            })
            if(all_success) {
                level++;
            }
        })
    }
}

run()
