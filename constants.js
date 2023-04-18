module.exports = {
    MAX_URLS_ALLOWED: 20,
    PROTOCOLS: ['https://', 'http://', 'www.'],
    USER_AGENT: 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.0 Safari/537.36',
    LEVEL_LIMIT: 1,
    ENV: {
        DEV: 'dev',
        STAGING: 'staging'
    },
    S3_BUCKET_NAME: 'website-crawler-dump-synaptic',
    IMAGE_EXTENSION : ['.png', '.jpg', 'jpeg', '.svg', '.bmp', 'webp','.ico'],
    CRAWL_STATUS: 'crawl_status_test'
}