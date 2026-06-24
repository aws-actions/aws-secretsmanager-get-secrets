"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanup = cleanup;
const core = __importStar(require("@actions/core"));
const constants_1 = require("./constants");
const utils_1 = require("./utils");
/**
 * When the GitHub Actions job is done, clean up any environment variables that
 * may have been set by the job (https://github.com/aws-actions/configure-aws-credentials/blob/master/cleanup.js)
 *
 * Environment variables are not intended to be shared across different jobs in
 * the same GitHub Actions workflow: GitHub Actions documentation states that
 * each job runs in a fresh instance.  However, doing our own cleanup will
 * give us additional assurance that these environment variables are not shared
 * with any other jobs.
 */
async function cleanup() {
    try {
        const cleanupSecrets = process.env[constants_1.CLEANUP_NAME];
        if (cleanupSecrets) {
            // The GitHub Actions toolkit does not have an option to completely unset
            // environment variables, so we overwrite the current value with an empty
            // string.
            JSON.parse(cleanupSecrets).forEach((env) => {
                (0, utils_1.cleanVariable)(env);
                if (!process.env[env]) {
                    core.debug(`Removed secret: ${env}`);
                }
                else {
                    throw new Error(`Failed to clean secret from environment: ${env}.`);
                }
            });
            // Clean overall secret list
            (0, utils_1.cleanVariable)(constants_1.CLEANUP_NAME);
        }
        core.info("Cleanup complete.");
    }
    catch (error) {
        if (error instanceof Error)
            core.setFailed(error.message);
    }
}
cleanup();
