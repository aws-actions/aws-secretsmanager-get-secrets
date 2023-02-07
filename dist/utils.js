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
exports.cleanVariable = exports.extractAliasAndSecretIdFromInput = exports.isSecretArn = exports.transformToValidEnvName = exports.isJSONString = exports.injectSecret = exports.getSecretValue = exports.getSecretsWithPrefix = exports.buildSecretsList = void 0;
const core = __importStar(require("@actions/core"));
const client_secrets_manager_1 = require("@aws-sdk/client-secrets-manager");
const constants_1 = require("./constants");
/**
 * Gets the unique list of all secrets to be requested
 *
 * @param client: SecretsManager client
 * @param configInputs: List of secret names, ARNs, and prefixes provided by user
 */
function buildSecretsList(client, configInputs) {
    return __awaiter(this, void 0, void 0, function* () {
        const finalSecretsList = new Set();
        // Prefix filters should be at least 3 characters, ending in *
        const validFilter = new RegExp('^[a-zA-Z0-9\\/_+=.@-]{3,}\\*$');
        for (const configInput of configInputs) {
            if (configInput.includes('*')) {
                const [secretAlias, secretPrefix] = extractAliasAndSecretIdFromInput(configInput);
                if (!validFilter.test(secretPrefix)) {
                    throw new Error('Please use a valid prefix search (should be at least 3 characters and end in *)');
                }
                // Find and add results for a given prefix
                const prefixMatches = yield getSecretsWithPrefix(client, secretPrefix, !!secretAlias);
                // Add back the alias, if one was requested
                prefixMatches.forEach(secret => finalSecretsList.add(secretAlias ? `${secretAlias},${secret}` : secret));
            }
            else {
                finalSecretsList.add(configInput);
            }
        }
        return [...finalSecretsList];
    });
}
exports.buildSecretsList = buildSecretsList;
/**
 * Uses ListSecrets to find secrets for a given prefix
 *
 * @param client: SecretsManager client
 * @param prefix: Name to search for
 * @param hasAlias: Flag to indicate that an alias was requested (can only match 1 secret)
 */
function getSecretsWithPrefix(client, prefix, hasAlias) {
    return __awaiter(this, void 0, void 0, function* () {
        const params = {
            Filters: [
                {
                    Key: "name",
                    Values: [
                        prefix.replace('*', ''),
                    ]
                },
            ],
            MaxResults: constants_1.LIST_SECRETS_MAX_RESULTS,
        };
        const response = yield client.send(new client_secrets_manager_1.ListSecretsCommand(params));
        if (response.SecretList) {
            const secretsList = response.SecretList;
            if (secretsList.length === 0) {
                throw new Error(`No matching secrets were returned for prefix "${prefix}".`);
            }
            else if (hasAlias && secretsList.length > 1) {
                // If an alias was requested, we cannot match more than one result
                throw new Error(`A unique alias was requested for prefix "${prefix}", but the search result for this prefix returned multiple results.`);
            }
            else if (response.NextToken) {
                // If there is a second page of results, this exceeds the max number of matches
                throw new Error(`A search for prefix "${prefix}" matched more than the maximum of ${constants_1.LIST_SECRETS_MAX_RESULTS} secrets per prefix.`);
            }
            return secretsList.reduce((foundSecrets, secret) => {
                if (secret.Name) {
                    foundSecrets.push(secret.Name);
                }
                return foundSecrets;
            }, []);
        }
        else {
            throw new Error('Invalid response from ListSecrets occurred');
        }
    });
}
exports.getSecretsWithPrefix = getSecretsWithPrefix;
/**
 * Retrieves a secret from Secrets Manager
 *
 * @param client: SecretsManager client
 * @param secretId: The name or full ARN of a secret
 * @returns SecretValueResponse
 */
function getSecretValue(client, secretId) {
    return __awaiter(this, void 0, void 0, function* () {
        let secretValue = '';
        const data = yield client.send(new client_secrets_manager_1.GetSecretValueCommand({ SecretId: secretId }));
        if (data.SecretString) {
            secretValue = data.SecretString;
        }
        else if (data.SecretBinary) {
            // Only string and JSON string values are supported in Github env
            secretValue = Buffer.from(data.SecretBinary).toString('ascii');
        }
        if (!(data.Name)) {
            throw new Error('Invalid name for secret');
        }
        return {
            name: data.Name,
            secretValue
        };
    });
}
exports.getSecretValue = getSecretValue;
/**
 * Transforms and injects secret as a masked environmental variable
 *
 * @param secretName: Name of the secret
 * @param secretAlias: Alias of the secret. If undefined, defaults to the `secretName`.
 * @param secretValue: Value to set for secret
 * @param parseJsonSecrets: Indicates whether to deserialize JSON secrets
 * @param tempEnvName: If parsing JSON secrets, contains the current name for the env variable
 */
function injectSecret(secretName, secretAlias, secretValue, parseJsonSecrets, tempEnvName) {
    let secretsToCleanup = [];
    if (parseJsonSecrets && isJSONString(secretValue)) {
        // Recursively parses json secrets
        const secretMap = JSON.parse(secretValue);
        for (const k in secretMap) {
            const keyValue = typeof secretMap[k] === 'string' ? secretMap[k] : JSON.stringify(secretMap[k]);
            // Append the current key to the name of the env variable
            const prefix = tempEnvName || (secretAlias && transformToValidEnvName(secretAlias)) || (secretAlias === undefined && transformToValidEnvName(secretName));
            const envName = transformToValidEnvName(k);
            const fullEnvName = prefix ? `${prefix}_${envName}` : envName;
            secretsToCleanup = [...secretsToCleanup, ...injectSecret(secretName, secretAlias, keyValue, parseJsonSecrets, fullEnvName)];
        }
    }
    else {
        const envName = tempEnvName ? transformToValidEnvName(tempEnvName) : transformToValidEnvName(secretAlias || secretName);
        // Fail the action if this variable name is already in use, or is our cleanup name
        if (process.env[envName] || envName === constants_1.CLEANUP_NAME) {
            throw new Error(`The environment name '${envName}' is already in use. Please use an alias to ensure that each secret has a unique environment name`);
        }
        // Inject a single secret
        core.setSecret(secretValue);
        // Export variable
        core.debug(`Injecting secret ${secretName} as environment variable '${envName}'.`);
        core.exportVariable(envName, secretValue);
        secretsToCleanup.push(envName);
    }
    return secretsToCleanup;
}
exports.injectSecret = injectSecret;
/*
 * Checks if the given secret is a valid JSON value
 */
function isJSONString(secretValue) {
    try {
        // Not valid JSON if the parsed result is null/falsy, not an object, or is an array
        const parsedObject = JSON.parse(secretValue);
        return !!parsedObject && (typeof parsedObject === 'object') && !Array.isArray(parsedObject);
    }
    catch (_a) {
        // Not JSON if the string fails to parse
        return false;
    }
}
exports.isJSONString = isJSONString;
/*
 * Transforms the secret name into a valid environmental variable name
 * It should consist of only upper case letters, digits, and underscores and cannot begin with a number
 */
function transformToValidEnvName(secretName) {
    // Leading digits are invalid
    if (secretName.match(/^[0-9]/)) {
        secretName = '_'.concat(secretName);
    }
    // Remove invalid characters
    return secretName.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
}
exports.transformToValidEnvName = transformToValidEnvName;
/**
 * Checks if the given secretId is an ARN
 *
 * @param secretId: Value to test
 * @returns Boolean
 */
function isSecretArn(secretId) {
    const validArn = new RegExp('^arn:aws:secretsmanager:.*:[0-9]{12,}:secret:.*$');
    return validArn.test(secretId);
}
exports.isSecretArn = isSecretArn;
/*
 * Separates a secret alias from the secret name/arn, if one was provided
 */
function extractAliasAndSecretIdFromInput(input) {
    const parsedInput = input.split(',');
    if (parsedInput.length > 1) {
        const alias = parsedInput[0].trim();
        const secretId = parsedInput[1].trim();
        // Validate that the alias is valid environment name
        const validateEnvName = transformToValidEnvName(alias);
        if (alias !== validateEnvName) {
            throw new Error(`The alias '${alias}' is not a valid environment name. Please verify that it has uppercase letters, numbers, and underscore only.`);
        }
        // Return [alias, id]
        return [alias, secretId];
    }
    // No alias
    return [undefined, input.trim()];
}
exports.extractAliasAndSecretIdFromInput = extractAliasAndSecretIdFromInput;
/*
 * Cleans up an environment variable
 */
function cleanVariable(variableName) {
    core.exportVariable(variableName, '');
    delete process.env[variableName];
}
exports.cleanVariable = cleanVariable;
