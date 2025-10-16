export const LIST_SECRETS_MAX_RESULTS = 100;
export const CLEANUP_NAME = 'SECRETS_LIST_CLEAN_UP';

const packageJson = require('../package.json');
export const ACTION_VERSION = `v${packageJson.version}`;

export function getUserAgent(): string {
    return `github-action/${ACTION_VERSION}`;
}