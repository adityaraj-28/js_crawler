'use strict';
const mysql = require('mysql2');
const log = require('./logger')
require('dotenv').config()

let queryCount = 0

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
});

const increment = () => queryCount++;
const decrement = () => queryCount--;
const getActiveQueries = () => queryCount;

connection.connect((err) => {
    if (err) {
        log.error('Error connecting to MySQL database: ' + err.stack);
        return;
    }
    log.info('Connected to MySQL database as id ' + connection.threadId);
});

module.exports = {db: connection, queryCountInc: increment, queryCountDec: decrement, activeQueries: getActiveQueries};
