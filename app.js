const db = require("./db");
const { LEVEL_LIMIT } = require("./constants");
const website_crawler_sync = require("./website_crawler");
const log = require('./logger')

async function fetch_unprocessed_urls(level) {
    return new Promise((resolve, reject) => {
        // -2 is a temp state, which is added when code first touches this url, if it is completed, final state would
        // be 1 or -1 (error), so any one terminated before completion can be obtained via status 0 and -2
        const query = `select domain, url from crawl_status_2 where level=${level} and status IN (0,-2)`
        db.query(query, (err, res) => {
            const results = []
            if(err) {
                log.error(`error getting urls at level: ${level}`)
                reject(err)
            }
            else {
                res.forEach(row => {
                    results.push({url: row.url, domain: row.domain})
                })
                resolve(results)
            }
        })
    })
}

async function get_root_domain(){
    return new Promise((resolve, reject) => {
        const argv = process.argv
        const limit = argv[2]
        const offset = argv[3]
        db.query(`select name from domains left outer join crawl_status_2 on domains.name = crawl_status_2.domain where domain is NULL LIMIT ${limit} OFFSET ${offset}`, (err, res) => {
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
        if(domain.includes(':')) continue
        const event = {body: {domain: domain, level: 0}};
        try {
            await website_crawler_sync(event);
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
        const domain_url_list = await fetch_unprocessed_urls(level)
        if(domain_url_list.length === 0) {
            level++;
            break
        }
        for(const domain_url of domain_url_list){
            const event = {body: {url: domain_url.url, domain: domain_url.domain, level: level}};
            try {
                // -2 to mark that code has touched this url
                const query = `update crawl_status_2 set status=-2 where domain='${domain_url.domain}' and url='${domain_url.url}'`
                db.query(query, async (err, res, fields) => {
                    if (err) {
                        log.error(`${query}, error: ${err}`)
                        throw new Error(`${err}`)
                    } else {
                        log.info(`${query}, success`)
                    }
                })
                const res = await website_crawler_sync(event);
                console.log(res)
            } catch (err) {
                log.error('website_crawler_sync error: ' + err)
            }
        }
    }
    log.info("===ending===")
}

run()
