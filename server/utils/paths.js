const path = require('path');

function getProjectRoot() {
    return path.join(__dirname, '../..');
}

function getDataDir() {
    if (process.env.INFOMIND_DATA_DIR) return process.env.INFOMIND_DATA_DIR;
    if (process.env.INFOMIND_DB_PATH) return path.dirname(process.env.INFOMIND_DB_PATH);
    return path.join(getProjectRoot(), 'data');
}

function getDbPath() {
    return process.env.INFOMIND_DB_PATH || path.join(getDataDir(), 'infomind.db');
}

function getCoversDir() {
    return path.join(getDataDir(), 'covers');
}

function getModelsDir() {
    return path.join(getDataDir(), 'models');
}

module.exports = {
    getProjectRoot,
    getDataDir,
    getDbPath,
    getCoversDir,
    getModelsDir,
};
