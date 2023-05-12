import * as core from '@actions/core'
import {
    SecretsManagerClient,
    GetSecretValueCommand,
    ListSecretsCommand,
    ListSecretsResponse,
    ListSecretsCommandInput
} from "@aws-sdk/client-secrets-manager";
import { LIST_SECRETS_MAX_RESULTS } from "./constants";

export interface SecretValueResponse {
    name: string,
    secretValue: string
}

/**
 * Gets the unique list of all secrets to be requested
 *
 * @param client: SecretsManager client
 * @param configInputs: List of secret names, ARNs, and prefixes provided by user
 */
export async function buildSecretsList(client: SecretsManagerClient, configInputs: string[]): Promise<string[]> {
    const finalSecretsList = new Set<string>();

    // Prefix filters should be at least 3 characters, ending in *
    const validFilter = new RegExp('^[a-zA-Z0-9\\/_+=.@-]{3,}\\*$');

    for (const configInput of configInputs) {
        if (configInput.includes('*')) {
            const [secretAlias, secretPrefix] = extractAliasAndSecretIdFromInput(configInput);

            if (!validFilter.test(secretPrefix)) {
                throw new Error('Please use a valid prefix search (should be at least 3 characters and end in *)');
            }

            // Find and add results for a given prefix
            const prefixMatches: string[] = await getSecretsWithPrefix(client, secretPrefix, !!secretAlias);

            // Add back the alias, if one was requested
            prefixMatches.forEach(secret => finalSecretsList.add(secretAlias ? `${secretAlias},${secret}` : secret));
        } else {
            finalSecretsList.add(configInput);
        }
    }

    return [...finalSecretsList];
}

/**
 * Uses ListSecrets to find secrets for a given prefix
 *
 * @param client: SecretsManager client
 * @param prefix: Name to search for
 * @param hasAlias: Flag to indicate that an alias was requested (can only match 1 secret)
 */
export async function getSecretsWithPrefix(client: SecretsManagerClient, prefix: string, hasAlias: boolean): Promise<string[]> {
    const params = {
        Filters: [
            {
                Key: "name",
                Values: [
                    prefix.replace('*', ''),
                ]
            },
        ],
        MaxResults: LIST_SECRETS_MAX_RESULTS,
    } as ListSecretsCommandInput;

    const response: ListSecretsResponse = await client.send(new ListSecretsCommand(params));

    if (response.SecretList){
        const secretsList = response.SecretList;
        if (secretsList.length === 0){
            throw new Error(`No matching secrets were returned for prefix "${prefix}".`);
        } else if (hasAlias && secretsList.length > 1){
            // If an alias was requested, we cannot match more than one result
            throw new Error(`A unique alias was requested for prefix "${prefix}", but the search result for this prefix returned multiple results.`);
        } else if (response.NextToken) {
            // If there is a second page of results, this exceeds the max number of matches
            throw new Error(`A search for prefix "${prefix}" matched more than the maximum of ${LIST_SECRETS_MAX_RESULTS} secrets per prefix.`);
        }

        return secretsList.reduce((foundSecrets, secret) => {
            if (secret.Name) {
                foundSecrets.push(secret.Name);
            }
            return foundSecrets;
        }, [] as string[]);
    } else {
        throw new Error('Invalid response from ListSecrets occurred');
    }
}

/**
 * Retrieves a secret from Secrets Manager
 *
 * @param client: SecretsManager client
 * @param secretId: The name or full ARN of a secret
 * @returns SecretValueResponse
 */
export async function getSecretValue(client: SecretsManagerClient, secretId: string): Promise<SecretValueResponse> {
    let secretValue = '';

    const data = await client.send(new GetSecretValueCommand({SecretId: secretId}));

    if (data.SecretString) {
        secretValue = data.SecretString as string;
    } else if (data.SecretBinary) {
        // Only string and JSON string values are supported in Github output variables
        secretValue = Buffer.from(data.SecretBinary).toString('ascii');
    }

    if (!(data.Name)){
        throw new Error('Invalid name for secret');
    }

    return {
        name: data.Name,
        secretValue
    } as SecretValueResponse;
}

/**
 * Transforms and returns secret as a masked output value
 *
 * @param secretName: Name of the secret
 * @param secretValue: Value to set for secret
 * @param parseJsonSecrets: Indicates whether to deserialize JSON secrets
 * @param tempVarName: If parsing JSON secrets, contains the current name for the output variable
 */
export function injectSecret(secretName: string, secretValue: string, parseJsonSecrets: boolean, injectedSecretIds: Set<string>, tempVarName?: string): void {
    if(parseJsonSecrets && isJSONString(secretValue)){
        // Recursively parses json secrets
        const secretMap = JSON.parse(secretValue) as Record<string, any>;

        for (const k in secretMap) {
            const keyValue = typeof secretMap[k] === 'string' ? secretMap[k] : JSON.stringify(secretMap[k]);

            // Append the current key to the name of the variable
            const newVarName = `${tempVarName || transformToValidVarName(secretName)}_${transformToValidVarName(k)}`;
            injectSecret(secretName, keyValue, parseJsonSecrets, injectedSecretIds, newVarName);
        }
    } else {
        const varName = tempVarName ? transformToValidVarName(tempVarName) : transformToValidVarName(secretName);

        if (injectedSecretIds.has(varName)) {
            throw new Error(`The output variable name '${varName}' is already in use. Please use an alias to ensure that each secret has a unique output variable name`);
        }

        // Inject a single secret
        core.setSecret(secretValue);

        // Export variable
        core.debug(`Setting secret ${secretName} as output '${varName}'.`);
        injectedSecretIds.add(varName);
        core.setOutput(varName, secretValue);
    }
}

/*
 * Checks if the given secret is a valid JSON value
 */
export function isJSONString(secretValue: string): boolean {
    try {
        // Not valid JSON if the parsed result is null/falsy, not an object, or is an array
        const parsedObject = JSON.parse(secretValue);
        return !!parsedObject && (typeof parsedObject === 'object') && !Array.isArray(parsedObject);
    } catch {
        // Not JSON if the string fails to parse
        return false;
    }
}

/*
 * Transforms the secret name into a valid variable name
 * It should consist of only upper case letters, digits, and underscores and cannot begin with a number
 */
export function transformToValidVarName(secretName: string): string {
    // Leading digits are invalid
    if (secretName.match(/^[0-9]/)){
        secretName = '_'.concat(secretName);
    }

    // Remove invalid characters
    return secretName.replace(/[^a-zA-Z0-9_]/g, '_')
}


/**
 * Checks if the given secretId is an ARN
 *
 * @param secretId: Value to test
 * @returns Boolean
 */
export function isSecretArn(secretId: string): boolean {
    const validArn = new RegExp('^arn:aws:secretsmanager:.*:[0-9]{12,}:secret:.*$');
    return validArn.test(secretId);
}

/*
 * Separates a secret alias from the secret name/arn, if one was provided
 */
export function extractAliasAndSecretIdFromInput(input: string): [string, string] {
    const parsedInput = input.split(',');
    if (parsedInput.length > 1){
        const alias = parsedInput[0].trim();
        const secretId = parsedInput[1].trim();

        // Validate that the alias is valid output variable name
        const validateVarName = transformToValidVarName(alias);
        if (alias !== validateVarName){
            throw new Error(`The alias '${alias}' is not a valid output variable name. Please verify that it has letters, numbers, and underscore only.`);
        }

        // Return [alias, id]
        return [alias, secretId];
    }

    // No alias
    return [ '', input.trim() ];
}