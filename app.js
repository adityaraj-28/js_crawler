const db = require("./db");
const { LEVEL_LIMIT } = require("./constants");
const website_crawler_sync = require("./website_crawler");
const log = require('./logger')

async function fetch_unprocessed_urls(level) {
    return new Promise((resolve, reject) => {
        const query = `select domain, url from crawl_status where level=${level} and status=false`
        db.query(query, (err, res) => {
            const results = []
            if(err) {
                log.error(`error getting urls at level: ${level}`)
                reject(err)
            }
            else {
                res.forEach(row => {
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
        db.query(`select name from domains left outer join crawl_status on domains.name = crawl_status.domain where domain is NULL LIMIT 100`, (err, res) => {
            if(err){
                log.error('error fetching root domain, terminating app')
                process.exit(0)
                reject()
            }
            const domains = []
            res.forEach(row => {
                domains.push(row.name)
            })
            resolve(domains)
        });
    })
}

async function processRootDomains() {
    log.info('processing root domains')
    const root_domains = await get_root_domain();
    for (const domain of root_domains) {
        const event = {body: {raw_url: domain}};
        const context = {level: 0};
        try {
            await website_crawler_sync(event, context);
        } catch (err) {
            log.error('error to process root domains: ' + err)
        }
    }
}

async function run() {
    log.info('=====started======')
    await processRootDomains();
    let level = 1
    while(1){
        if (level > LEVEL_LIMIT) {
            break
        }
        const raw_url_list = await fetch_unprocessed_urls(level)
        if(raw_url_list.length === 0) {
            level++;
            break
        }
        for(const url of raw_url_list){
            const event = {body: {raw_url: url}};
            const context = {level: level}
            try {
                const res = await website_crawler_sync(event, context);
                console.log(res)
            } catch (err) {
                log.error('website_crawler_sync error: ' + err)
            }
        }
    }
    log.info("===ending===")
}

run()
