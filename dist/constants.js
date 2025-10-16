"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTION_VERSION = exports.CLEANUP_NAME = exports.LIST_SECRETS_MAX_RESULTS = void 0;
exports.getUserAgent = getUserAgent;
exports.LIST_SECRETS_MAX_RESULTS = 100;
exports.CLEANUP_NAME = 'SECRETS_LIST_CLEAN_UP';
const packageJson = require('../package.json');
exports.ACTION_VERSION = `v${packageJson.version}`;
function getUserAgent() {
    return `github-action/${exports.ACTION_VERSION}`;
}
