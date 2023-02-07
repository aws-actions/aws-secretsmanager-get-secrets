import * as core from '@actions/core'
import { mockClient } from "aws-sdk-client-mock";
import {
    GetSecretValueCommand,
    ListSecretsCommand,
    SecretsManagerClient,
    ResourceNotFoundException, ListSecretsCommandInput
} from '@aws-sdk/client-secrets-manager';
import {
    buildSecretsList,
    getSecretValue,
    getSecretsWithPrefix,
    isJSONString,
    injectSecret,
    isSecretArn,
    extractAliasAndSecretIdFromInput,
    transformToValidEnvName
} from "../src/utils";

import { CLEANUP_NAME, LIST_SECRETS_MAX_RESULTS } from "../src/constants";

const TEST_NAME = 'test/secret';
const TEST_ENV_NAME = 'TEST_SECRET';
const TEST_VALUE = 'test!secret!value!';
const SIMPLE_JSON_SECRET = '{"api_key": "testkey", "user": "testuser"}';
const NESTED_JSON_SECRET = '{"host":"127.0.0.1", "port": "3600", "config":{"db_user":"testuser","db_password":"testpw","options":{"a":"YES","b":"NO", "c": 100 }}}';

const VALID_ARN_1 = 'arn:aws:secretsmanager:us-east-1:123456789000:secret:test1-aBcdef';
const TEST_NAME_1 = 'test/secret1';

const VALID_ARN_2 = 'arn:aws:secretsmanager:ap-south-1:123456789000:secret:test2-aBcdef';
const TEST_NAME_2 = 'test/secret2';

const INVALID_ARN = 'aws:secretsmanager:us-east-1:123456789000:secret:test3-aBcdef';

jest.mock('@actions/core');

const smClient = new SecretsManagerClient({}); // Cannot send mock directly because of type enforcement
const smMockClient = mockClient(smClient);


describe('Test secret value retrieval', () => {
    beforeEach(() => {
        smMockClient.reset();
        jest.clearAllMocks();
    });

    test('Retrieves a secret string', async () => {
        smMockClient.on(GetSecretValueCommand).resolves({
            Name: TEST_NAME,
            SecretString: TEST_VALUE,
        });

        const secretValue = await getSecretValue(smClient, TEST_NAME);
        expect(secretValue.secretValue).toStrictEqual(TEST_VALUE);
    });

    test('Retrieves a secret string and returns with name if requested', async () => {
        smMockClient.on(GetSecretValueCommand).resolvesOnce({
            Name: TEST_NAME_1,
            SecretString: SIMPLE_JSON_SECRET
        }).resolves({
            SecretString: TEST_VALUE
        });

        const secretValue1 = await getSecretValue(smClient, VALID_ARN_1);
        expect(secretValue1.name).toStrictEqual(TEST_NAME_1);
        expect(secretValue1.secretValue).toStrictEqual(SIMPLE_JSON_SECRET);

        // Throw an error if something wrong with secret name
        await expect(getSecretValue(smClient, TEST_NAME_2)).rejects.toThrow();
    });

    test('Retrieves a binary secret', async () => {
        const bytes = new TextEncoder().encode(TEST_VALUE);

        smMockClient.on(GetSecretValueCommand).resolves({
            Name: TEST_NAME,
            SecretBinary: bytes,
        });

        const secretValue = await getSecretValue(smClient, TEST_NAME);
        expect(secretValue.secretValue).toStrictEqual(TEST_VALUE);
    });

    test('Throws an error if unable to retrieve the secret', async () => {
        const error = new ResourceNotFoundException({$metadata: {}, message: 'Error'});
        smMockClient.on(GetSecretValueCommand).rejects(error);
        await expect(getSecretValue(smClient, TEST_NAME)).rejects.toThrow(error);
    });

    test('Throws an error if the secret value is invalid', async () => {
        smMockClient.on(GetSecretValueCommand).resolves({});
        await expect(getSecretValue(smClient, TEST_NAME)).rejects.toThrow();
    });

    test('Throws error on invalid list secrets response ', async () => {
        smMockClient
            .on(ListSecretsCommand)
            .resolves({});
        await expect(getSecretsWithPrefix(smClient, "test", false)).rejects.toThrow();
    });

    test('Builds a complete list of secrets from user input', async () => {
        const input = ["test/*", "alternativeSecret"];
        const expectedParams = {
            Filters: [
                {
                    Key: "name",
                    Values: [
                        "test/",
                    ]
                },
            ],
            MaxResults: LIST_SECRETS_MAX_RESULTS,
        } as ListSecretsCommandInput;

        smMockClient.on(ListSecretsCommand).resolves({
            SecretList: [
                {
                    ARN: VALID_ARN_1,
                    Name: TEST_NAME_1
                },
                {
                    ARN: VALID_ARN_2,
                    Name: TEST_NAME_2
                }
            ]
        });
        const result = await buildSecretsList(smClient, input);
        expect(smMockClient).toHaveReceivedCommandTimes(ListSecretsCommand, 1);
        expect(smMockClient).toHaveReceivedCommandWith(ListSecretsCommand, expectedParams);
        expect(result).toEqual([TEST_NAME_1, TEST_NAME_2, 'alternativeSecret']);
    });

    test('Builds a complete list of secrets, including alias, for prefix secret', async () => {
        const input = ["SECRET_ALIAS,test/*", "alternativeSecret"];
        const expectedParams = {
            Filters: [
                {
                    Key: "name",
                    Values: [
                        "test/",
                    ]
                },
            ],
            MaxResults: LIST_SECRETS_MAX_RESULTS,
        } as ListSecretsCommandInput;

        smMockClient.on(ListSecretsCommand).resolves({
            SecretList: [
                {
                    ARN: VALID_ARN_1,
                    Name: TEST_NAME_1
                }
            ]
        });
        const result = await buildSecretsList(smClient, input);
        expect(smMockClient).toHaveReceivedCommandTimes(ListSecretsCommand, 1);
        expect(smMockClient).toHaveReceivedCommandWith(ListSecretsCommand, expectedParams);
        expect(result).toEqual(['SECRET_ALIAS,' + TEST_NAME_1, 'alternativeSecret']);
    });


    test('Throws an error if a prefix filter is invalid or not specific enough', async () => {
        let input = ["/*", "alternativeSecret"];
        await expect(buildSecretsList(smClient, input)).rejects.toThrow();

        input = ["*not/a/prefix", "alternativeSecret"];
        await expect(buildSecretsList(smClient, input)).rejects.toThrow();

        input = ["a*", "alternativeSecret"];
        await expect(buildSecretsList(smClient, input)).rejects.toThrow();
    });

    test('Throws an error if a prefix filter returns too many results', async () => {
        const input = ["too/many/matches/*"];
        const expectedParams = {
            Filters: [
                {
                    Key: "name",
                    Values: [
                        "too/many/matches/",
                    ]
                },
            ],
            MaxResults: LIST_SECRETS_MAX_RESULTS,
        } as ListSecretsCommandInput;

        smMockClient.on(ListSecretsCommand).resolves({
            SecretList: [
                {
                    ARN: VALID_ARN_1,
                    Name: TEST_NAME_1
                },
                {
                    ARN: VALID_ARN_2,
                    Name: TEST_NAME_2
                }
            ],
            NextToken: "ThereAreTooManyResults"
        });

        await expect(buildSecretsList(smClient, input)).rejects.toThrow();
        expect(smMockClient).toHaveReceivedCommandTimes(ListSecretsCommand, 1);
        expect(smMockClient).toHaveReceivedCommandWith(ListSecretsCommand, expectedParams);
    });

    test('Throws an error if a prefix filter has no results', async () => {
        const input = ["no/matches/*"];
        const expectedParams = {
            Filters: [
                {
                    Key: "name",
                    Values: [
                        "no/matches/",
                    ]
                },
            ],
            MaxResults: LIST_SECRETS_MAX_RESULTS,
        } as ListSecretsCommandInput;

        smMockClient.on(ListSecretsCommand).resolves({
            SecretList: []
        });

        await expect(buildSecretsList(smClient, input)).rejects.toThrow();
        expect(smMockClient).toHaveReceivedCommandTimes(ListSecretsCommand, 1);
        expect(smMockClient).toHaveReceivedCommandWith(ListSecretsCommand, expectedParams);
    });

    test('Throws an error if a prefix filter with an alias returns more than 1 result', async () => {
        const input = ["SECRET_ALIAS,test/*"];
        const expectedParams = {
            Filters: [
                {
                    Key: "name",
                    Values: [
                        "test/",
                    ]
                },
            ],
            MaxResults: LIST_SECRETS_MAX_RESULTS,
        } as ListSecretsCommandInput;

        smMockClient.on(ListSecretsCommand).resolves({
            SecretList: [
                {
                    ARN: VALID_ARN_1,
                    Name: TEST_NAME_1
                },
                {
                    ARN: VALID_ARN_2,
                    Name: TEST_NAME_2
                }
            ]
        });

        await expect(buildSecretsList(smClient, input)).rejects.toThrow();
        expect(smMockClient).toHaveReceivedCommandTimes(ListSecretsCommand, 1);
        expect(smMockClient).toHaveReceivedCommandWith(ListSecretsCommand, expectedParams);
    });

});

describe('Test secret parsing and handling', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    /* 
    * Test: isSecretArn()
    */
    test('Returns true for valid arn', () => {
        expect(isSecretArn(VALID_ARN_1)).toEqual(true);
        expect(isSecretArn(VALID_ARN_2)).toEqual(true);
    });

    test('Return false for invalid arn or secret name', () => {
        expect(isSecretArn(INVALID_ARN)).toEqual(false);
        expect(isSecretArn(TEST_NAME)).toEqual(false);
    });

    /* 
    * Test: injectSecret()
    */
    test('Stores a simple secret', () => {
        injectSecret(TEST_NAME, undefined, TEST_VALUE, false);
        expect(core.exportVariable).toHaveBeenCalledTimes(1);
        expect(core.exportVariable).toHaveBeenCalledWith(TEST_ENV_NAME, TEST_VALUE);
    });

    test('Stores a simple secret with alias', () => {
        injectSecret(TEST_NAME, 'ALIAS_1', TEST_VALUE, false);
        expect(core.exportVariable).toHaveBeenCalledTimes(1);
        expect(core.exportVariable).toHaveBeenCalledWith('ALIAS_1', TEST_VALUE);
    });

    test('Stores a JSON secret as string when parseJson is false', () => {
        injectSecret(TEST_NAME, undefined, SIMPLE_JSON_SECRET, false);
        expect(core.exportVariable).toHaveBeenCalledTimes(1);
        expect(core.exportVariable).toHaveBeenCalledWith(TEST_ENV_NAME, SIMPLE_JSON_SECRET);
    });

    test('Throws an error if reserved name is used', () => {
        expect(() => {
            injectSecret(CLEANUP_NAME, undefined, TEST_VALUE, false);
        }).toThrow();
    });

    test('Stores a variable for each JSON key value when parseJson is true', () => {
        injectSecret(TEST_NAME, undefined, SIMPLE_JSON_SECRET, true);
        expect(core.exportVariable).toHaveBeenCalledTimes(2);
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_SECRET_API_KEY', 'testkey');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_SECRET_USER', 'testuser');
    });

    test('Stores a variable for nested JSON key values when parseJson is true', () => {
        injectSecret(TEST_NAME, undefined, NESTED_JSON_SECRET, true);
        expect(core.setSecret).toHaveBeenCalledTimes(7);
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_SECRET_HOST', '127.0.0.1');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_SECRET_PORT', '3600');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_SECRET_CONFIG_DB_USER', 'testuser');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_SECRET_CONFIG_DB_PASSWORD', 'testpw');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_SECRET_CONFIG_OPTIONS_A', 'YES');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_SECRET_CONFIG_OPTIONS_B', 'NO');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_SECRET_CONFIG_OPTIONS_C', '100');
    });

    /* 
    * Test: parseAliasFromId()
    */
    test('Separates an alias from an id if provided', () => {
        // Expect whitespace to be cleaned
        expect(extractAliasAndSecretIdFromInput("SECRET_ALIAS, test/secret")).toEqual(['SECRET_ALIAS', 'test/secret']);
        expect(extractAliasAndSecretIdFromInput(`ARN_ALIAS,${VALID_ARN_1}`)).toEqual(['ARN_ALIAS', VALID_ARN_1]);
    });

    test('Returns undefined for alias if none is provided', () => {
        expect(extractAliasAndSecretIdFromInput("test/secret")).toEqual([undefined, 'test/secret']);
        expect(extractAliasAndSecretIdFromInput(VALID_ARN_1)).toEqual([undefined, VALID_ARN_1]);
    });

    test('Returns blank for alias if empty string is provided', () => {
        expect(extractAliasAndSecretIdFromInput(",test/secret")).toEqual(['', 'test/secret']);
        expect(extractAliasAndSecretIdFromInput(`,${VALID_ARN_1}`)).toEqual(['', VALID_ARN_1]);
    });

    test('Throws an error if the provided alias cannot be used as the environment name', () => {
        expect(() => {
            extractAliasAndSecretIdFromInput("Invalid-env, test/secret")
        }).toThrow();

        expect(() => {
            extractAliasAndSecretIdFromInput("0INVALID, test/secret")
        }).toThrow();

        expect(() => {
            extractAliasAndSecretIdFromInput("@Invalid, test/secret")
        }).toThrow();
    });

    /* 
    * Test: transformToValidEnvName()
    */
    test('Prevents illegal special characters in environment name', () => {
        expect(transformToValidEnvName('prod/db/admin')).toBe('PROD_DB_ADMIN')
    });

    test('Prevents leading digits in environment name', () => {
        expect(transformToValidEnvName('0Admin')).toBe('_0ADMIN')
    });

    test('Transforms to uppercase for environment name', () => {
        expect(transformToValidEnvName('secret3')).toBe('SECRET3')
    });

    /* 
    * Test: isJSONString()
    */
    test('Test invalid JSON "100" ', () => {
        expect(isJSONString('100')).toBe(false)
    });

    test('Test invalid JSON key { a: "100" } ', () => {
        expect(isJSONString('{ a: "100" }')).toBe(false)
    });

    test('Test invalid array ["a", "b"] ', () => {
        expect(isJSONString('["a", "b"]')).toBe(false)
    });

    test('Test invalid JSON { "a": "Missing quote }', () => {
        expect(isJSONString('{ "a": }')).toBe(false)
    });

    test('Test invalid JSON null', () => {
        expect(isJSONString('')).toBe(false)
    });

    test('Test valid JSON { "a": "yes", "b": "no" } ', () => {
        expect(isJSONString('{ "a": "yes", "b": "no" }')).toBe(true)
    });

    test('Test valid nested JSON { "a": "yes", "options": { "opt_a": "yes", "opt_b": "no"} } ', () => {
        expect(isJSONString('{ "a": "yes", "options": { "opt_a": "yes", "opt_b": "no"} }')).toBe(true)
    });
});