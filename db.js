'use strict';
const mysql = require('mysql2');
const log = require('./logger')

const connection = mysql.createConnection({
    host: 'labs-core-rds.nvst-staging.com',
    user: 'root',
    password: 'VyCloudno9db',
    database: 'meta_database_staging'
});

connection.connect((err) => {
    if (err) {
        log.error('Error connecting to MySQL database: ' + err.stack);
        return;
    }
    log.info('Connected to MySQL database as id ' + connection.threadId);
});

module.exports = connection;
