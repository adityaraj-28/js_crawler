const { website_crawler } = require('./website_crawler.js');
const db = require("./db");
const { LEVEL_LIMIT } = require("./constants");
const website_crawler_sync = require("./website_crawler");

async function fetch_unprocessed_urls(level) {
    return new Promise((resolve, reject) => {
        // todo: remove limit after testing
        const query = `select domain, url from crawl_status_2 where level=${level} and status=false`
        db.query(query, (err, res) => {
            const results = []
            if(err) {
                console.log(`error getting urls at level: ${level}`)
                reject(err)
            }
            else {
                res.forEach(row => {
                    console.log("in fetch_unprocessed_urls: " + row.url + ' | url end')
                    results.push(row.url)
                })
                resolve(results)
            }
        })
    })
}

async function get_root_domain(){
    return new Promise((resolve, reject) => {
        // todo: remove limit after testing
        db.query(`select name from domains left outer join crawl_status_2 on domains.name = crawl_status_2.domain where domain is NULL LIMIT 1`, (err, res) => {
            if(err){
                console.log('error fetching root domain')
                process.exit(0)
                reject()
            }
            const domains = []
            res.forEach(row => {
                console.log(row.name)
                domains.push(row.name)
            })
            resolve(domains)
        });
    })
}

async function processRootDomains() {
    const root_domains = await get_root_domain();
    for (const domain of root_domains) {
        console.log(domain);
        const event = {body: {raw_url: domain}};
        const context = {level: 0};
        try {
            const res = await website_crawler_sync(event, context);
            console.log(res.statusCode);
        } catch (err) {
            console.log(err);
        }
    }
}

async function run() {
    await processRootDomains();
    let level = 1
    while(1){
        console.log("here, start level: " + level)
        if (level > LEVEL_LIMIT) {
            break
        }
        const raw_url_list = await fetch_unprocessed_urls(level)
        console.log("rul " + JSON.stringify(raw_url_list))
        if(raw_url_list.length === 0) {
            level++;
            continue
        }
        for(const url of raw_url_list){
            console.log("rul value " + url)
            const event = {body: {raw_url: url}};
            const context = {level: level}
            try {
                const res = await website_crawler_sync(event, context);
                console.log(res)
            } catch (err) {
                console.log(err)
            }
        }
        console.log("here, level: " + level)
    }
    db.end()
}

run()
