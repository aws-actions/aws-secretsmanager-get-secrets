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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanup = void 0;
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
function cleanup() {
    return __awaiter(this, void 0, void 0, function* () {
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
    });
}
exports.cleanup = cleanup;
cleanup();
