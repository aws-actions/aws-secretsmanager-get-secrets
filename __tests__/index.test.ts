import * as core from '@actions/core'
import { mockClient } from "aws-sdk-client-mock";
import {
    GetSecretValueCommand, ListSecretsCommand,
    ResourceNotFoundException,
    SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { run } from "../src";
import { CLEANUP_NAME } from "../src/constants";

const DEFAULT_TEST_ENV = {
    AWS_DEFAULT_REGION: 'us-east-1'
};

import * as net from 'net';

const smMockClient = mockClient(SecretsManagerClient);

const TEST_NAME = "test/*";

const TEST_NAME_1 = "test/one";
const SECRET_1 = '{"user": "admin", "password": "adminpw"}';

const TEST_NAME_2 = "test/two";
const SECRET_2 = '{"user": "integ", "password": "integpw"}';

const TEST_NAME_3 = "app/secret";
const ENV_NAME_3 = "SECRET_ALIAS";
const SECRET_3 = "secretString1";
const TEST_INPUT_3 = ENV_NAME_3 + "," + TEST_NAME_3;

const TEST_ARN_1 = 'arn:aws:secretsmanager:ap-south-1:123456789000:secret:test2-aBcdef';
const TEST_NAME_4 = 'arn/secret-name';
const ENV_NAME_4 = 'ARN_ALIAS';
const SECRET_4 = "secretString2";
const TEST_ARN_INPUT = ENV_NAME_4 + "," + TEST_ARN_1;

const BLANK_NAME = "test/blank";
const SECRET_FOR_BLANK = '{"username": "integ", "password": "integpw", "config": {"id1": "example1"}}';
const BLANK_ALIAS_INPUT = "," + BLANK_NAME;

const BLANK_NAME_2 = "test/blank2";
const SECRET_FOR_BLANK_2 = "blankNameSecretString";
const BLANK_ALIAS_INPUT_2 = "," + BLANK_NAME_2;

const BLANK_NAME_3 = "test/blank3";
const SECRET_FOR_BLANK_3 = '{"username": "integ", "password": "integpw", "config": {"id2": "example2"}}';
const BLANK_ALIAS_INPUT_3 = "," + BLANK_NAME_3;



const VALID_TIMEOUT = '3000';
const INVALID_TIMEOUT_STRING = 'abc';
const DEFAULT_TIMEOUT = '1000';
const INVALID_TIMEOUT = '9';

// Mock the inputs for Github action
jest.mock('@actions/core', () => {
    return {
        getMultilineInput: jest.fn(),
        getBooleanInput: jest.fn(),
        getInput: jest.fn(),
        setFailed: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        exportVariable: jest.fn((name: string, val: string) => process.env[name] = val),
        setSecret: jest.fn(),
    };
});

jest.mock('net', () => {
    return {
        setDefaultAutoSelectFamilyAttemptTimeout: jest.fn()
    }
});

describe('Test main action', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        smMockClient.reset();
        process.env = { ...OLD_ENV, ...DEFAULT_TEST_ENV };
    });

    afterEach(() => {
        process.env = OLD_ENV;
    });

    test('Retrieves and sets the requested secrets as environment variables, parsing JSON', async () => {
        const getInputSpy = jest.spyOn(core, 'getInput');
        getInputSpy.mockImplementation((name) => {
            switch (name) {
                case 'auto-select-family-attempt-timeout':
                    return DEFAULT_TIMEOUT;
                case 'name-transformation':
                    return 'uppercase';
                default:
                    return '';
            }
        });
        const booleanSpy = jest.spyOn(core, "getBooleanInput").mockReturnValue(true);
        const multilineInputSpy = jest.spyOn(core, "getMultilineInput").mockReturnValue(
            [TEST_NAME, TEST_INPUT_3, TEST_ARN_INPUT, BLANK_ALIAS_INPUT]
        );


        // Mock all Secrets Manager calls
        smMockClient
            .on(GetSecretValueCommand, { SecretId: TEST_NAME_1 })
            .resolves({ Name: TEST_NAME_1, SecretString: SECRET_1 })
            .on(GetSecretValueCommand, { SecretId: TEST_NAME_2 })
            .resolves({ Name: TEST_NAME_2, SecretString: SECRET_2 })
            .on(GetSecretValueCommand, { SecretId: TEST_NAME_3 })
            .resolves({ Name: TEST_NAME_3, SecretString: SECRET_3 })
            .on(GetSecretValueCommand, { // Retrieve arn secret
                SecretId: TEST_ARN_1,
            })
            .resolves({
                Name: TEST_NAME_4,
                SecretString: SECRET_4
            })
            .on(ListSecretsCommand)
            .resolves({
                SecretList: [
                    {
                        Name: TEST_NAME_1
                    },
                    {
                        Name: TEST_NAME_2
                    }
                ]
            })
            .on(GetSecretValueCommand, { SecretId: BLANK_NAME })
            .resolves({ Name: BLANK_NAME, SecretString: SECRET_FOR_BLANK });

        await run();
        expect(core.setFailed).not.toHaveBeenCalled();
        expect(core.exportVariable).toHaveBeenCalledTimes(10);

        // JSON secrets should be parsed
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_ONE_USER', 'admin');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_ONE_PASSWORD', 'adminpw');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_TWO_USER', 'integ');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_TWO_PASSWORD', 'integpw');

        expect(core.exportVariable).toHaveBeenCalledWith(ENV_NAME_3, SECRET_3);
        expect(core.exportVariable).toHaveBeenCalledWith(ENV_NAME_4, SECRET_4);

        // Case when alias is blank, but still comma delimited in workflow and json is parsed
        // ex: ,test5/secret
        expect(core.exportVariable).toHaveBeenCalledWith("USERNAME", "integ");
        expect(core.exportVariable).toHaveBeenCalledWith("PASSWORD", "integpw");
        expect(core.exportVariable).toHaveBeenCalledWith("CONFIG_ID1", "example1");

        expect(core.exportVariable).toHaveBeenCalledWith(
            CLEANUP_NAME,
            JSON.stringify([
                'TEST_ONE_USER', 'TEST_ONE_PASSWORD',
                'TEST_TWO_USER', 'TEST_TWO_PASSWORD',
                ENV_NAME_3,
                ENV_NAME_4,
                "USERNAME", "PASSWORD", "CONFIG_ID1"
            ])
        );

        booleanSpy.mockClear();
        multilineInputSpy.mockClear();
    });

    test('Defaults to correct behavior with empty string alias', async () => {
        const booleanSpy = jest.spyOn(core, "getBooleanInput").mockReturnValue(false);
        const multilineInputSpy = jest.spyOn(core, "getMultilineInput").mockReturnValue(
            [BLANK_ALIAS_INPUT_2, BLANK_ALIAS_INPUT_3]
        );

        smMockClient
            .on(GetSecretValueCommand, { SecretId: BLANK_NAME_2 })
            .resolves({ Name: BLANK_NAME_2, SecretString: SECRET_FOR_BLANK_2 })
            .on(GetSecretValueCommand, { SecretId: BLANK_NAME_3 })
            .resolves({ Name: BLANK_NAME_3, SecretString: SECRET_FOR_BLANK_3 });

        await run();
        expect(core.setFailed).not.toHaveBeenCalled();
        expect(core.exportVariable).toHaveBeenCalledTimes(3);

        // Case when alias is blank, but still comma delimited in workflow and no json is parsed
        // ex: ,test/blank2
        expect(core.exportVariable).toHaveBeenCalledWith("TEST_BLANK2", "blankNameSecretString");
        expect(core.exportVariable).toHaveBeenCalledWith("TEST_BLANK3", '{"username": "integ", "password": "integpw", "config": {"id2": "example2"}}');

        expect(core.exportVariable).toHaveBeenCalledWith(
            CLEANUP_NAME,
            JSON.stringify([
                "TEST_BLANK2",
                "TEST_BLANK3"
            ])
        );

        booleanSpy.mockClear();
        multilineInputSpy.mockClear();
    });

    test('Fails the action when an error occurs in Secrets Manager', async () => {
        const booleanSpy = jest.spyOn(core, "getBooleanInput").mockReturnValue(true);
        const multilineInputSpy = jest.spyOn(core, "getMultilineInput").mockReturnValue(
            [TEST_NAME, TEST_INPUT_3, TEST_ARN_INPUT]
        );

        smMockClient.onAnyCommand().resolves({});

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(1);

        booleanSpy.mockClear();
        multilineInputSpy.mockClear();
    });

    test('Fails the action when Secrets Manager GetSecretValue fails', async () => {
        const booleanSpy = jest.spyOn(core, "getBooleanInput").mockReturnValue(true);
        const multilineInputSpy = jest.spyOn(core, "getMultilineInput").mockReturnValue(
            [TEST_NAME, TEST_INPUT_3, TEST_ARN_INPUT]
        );

        smMockClient.on(ListSecretsCommand).resolves({
            SecretList: [
                {
                    Name: TEST_NAME_1
                },
                {
                    Name: TEST_NAME_2
                }
            ]
        }).on(GetSecretValueCommand)
            .rejects(new ResourceNotFoundException({
                $metadata: {}, message: "Secrets Manager can't find the specified secret."
            }));

        await run();
        expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("Failed to fetch secret:"));

        booleanSpy.mockClear();
        multilineInputSpy.mockClear();
    });

    test('Fails the action when multiple secrets exported the same variable name', async () => {
        const booleanSpy = jest.spyOn(core, "getBooleanInput").mockReturnValue(true);
        const multilineInputSpy = jest.spyOn(core, "getMultilineInput").mockReturnValue(
            [TEST_NAME, TEST_INPUT_3, TEST_ARN_INPUT]
        );
        const nameTransformationSpy = jest.spyOn(core, 'getInput').mockReturnValue('uppercase');

        smMockClient
            .on(GetSecretValueCommand, { SecretId: TEST_NAME_1 })
            .resolves({ Name: TEST_NAME_1, SecretString: SECRET_1 })
            .on(GetSecretValueCommand, { SecretId: TEST_NAME_2 })
            .resolves({ Name: TEST_NAME_2, SecretString: SECRET_2 })
            .on(GetSecretValueCommand, { SecretId: TEST_NAME_3 })
            .resolves({ Name: TEST_NAME_3, SecretString: SECRET_3 })
            .on(GetSecretValueCommand, { // Retrieve arn secret
                SecretId: TEST_ARN_1,
            })
            .resolves({
                Name: TEST_NAME_4,
                SecretString: SECRET_4
            })
            .on(GetSecretValueCommand) // default
            .resolves({ Name: "DefaultName", SecretString: "Default" })
            .on(ListSecretsCommand)
            .resolves({
                SecretList: [
                    {
                        Name: "TEST/SECRET/2"
                    },
                    {
                        Name: "TEST/SECRET@2"
                    }
                ]
            });

        await run();
        expect(core.setFailed).toHaveBeenCalledTimes(1);

        booleanSpy.mockClear();
        multilineInputSpy.mockClear();
        nameTransformationSpy.mockClear();
    });


    test('Keep existing cleanup list', async () => {
        // Set existing cleanup list
        process.env = { ...process.env, SECRETS_LIST_CLEAN_UP: JSON.stringify(["EXISTING_TEST_SECRET", "EXISTING_TEST_SECRET_DB_HOST"]) };

        const getInputSpy = jest.spyOn(core, 'getInput');
        getInputSpy.mockImplementation((name) => {
            switch (name) {
                case 'auto-select-family-attempt-timeout':
                    return DEFAULT_TIMEOUT;
                case 'name-transformation':
                    return 'uppercase';
                default:
                    return '';
            }
        });

        const booleanSpy = jest.spyOn(core, "getBooleanInput").mockReturnValue(true);
        const multilineInputSpy = jest.spyOn(core, "getMultilineInput").mockReturnValue(
            [TEST_NAME, TEST_INPUT_3, TEST_ARN_INPUT, BLANK_ALIAS_INPUT]
        );


        // Mock all Secrets Manager calls
        smMockClient
            .on(GetSecretValueCommand, { SecretId: TEST_NAME_1 })
            .resolves({ Name: TEST_NAME_1, SecretString: SECRET_1 })
            .on(GetSecretValueCommand, { SecretId: TEST_NAME_2 })
            .resolves({ Name: TEST_NAME_2, SecretString: SECRET_2 })
            .on(GetSecretValueCommand, { SecretId: TEST_NAME_3 })
            .resolves({ Name: TEST_NAME_3, SecretString: SECRET_3 })
            .on(GetSecretValueCommand, { // Retrieve arn secret
                SecretId: TEST_ARN_1,
            })
            .resolves({
                Name: TEST_NAME_4,
                SecretString: SECRET_4
            })
            .on(ListSecretsCommand)
            .resolves({
                SecretList: [
                    {
                        Name: TEST_NAME_1
                    },
                    {
                        Name: TEST_NAME_2
                    }
                ]
            })
            .on(GetSecretValueCommand, { SecretId: BLANK_NAME })
            .resolves({ Name: BLANK_NAME, SecretString: SECRET_FOR_BLANK });

        await run();
        expect(core.setFailed).not.toHaveBeenCalled();
        expect(core.exportVariable).toHaveBeenCalledTimes(10);

        // JSON secrets should be parsed
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_ONE_USER', 'admin');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_ONE_PASSWORD', 'adminpw');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_TWO_USER', 'integ');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_TWO_PASSWORD', 'integpw');

        expect(core.exportVariable).toHaveBeenCalledWith(ENV_NAME_3, SECRET_3);
        expect(core.exportVariable).toHaveBeenCalledWith(ENV_NAME_4, SECRET_4);

        // Case when alias is blank, but still comma delimited in workflow and json is parsed
        // ex: ,test5/secret
        expect(core.exportVariable).toHaveBeenCalledWith("USERNAME", "integ");
        expect(core.exportVariable).toHaveBeenCalledWith("PASSWORD", "integpw");
        expect(core.exportVariable).toHaveBeenCalledWith("CONFIG_ID1", "example1");

        expect(core.exportVariable).toHaveBeenCalledWith(
            CLEANUP_NAME,
            JSON.stringify([
                'EXISTING_TEST_SECRET', 'EXISTING_TEST_SECRET_DB_HOST',
                'TEST_ONE_USER', 'TEST_ONE_PASSWORD',
                'TEST_TWO_USER', 'TEST_TWO_PASSWORD',
                ENV_NAME_3,
                ENV_NAME_4,
                "USERNAME", "PASSWORD", "CONFIG_ID1"
            ])
        );

        booleanSpy.mockClear();
        multilineInputSpy.mockClear();
        getInputSpy.mockClear();
    })

    test('handles invalid timeout string', async () => {
        const timeoutSpy = jest.spyOn(core, 'getInput').mockReturnValue(INVALID_TIMEOUT_STRING);

        smMockClient
            .on(GetSecretValueCommand)
            .resolves({ SecretString: 'test' });

        await run();

        expect(core.setFailed).toHaveBeenCalled();


        timeoutSpy.mockClear();

    });

    test('handles valid timeout value', async () => {
        const timeoutSpy = jest.spyOn(core, 'getInput').mockReturnValue(VALID_TIMEOUT);

        smMockClient
            .on(GetSecretValueCommand)
            .resolves({ SecretString: 'test' });

        await run();

        expect(net.setDefaultAutoSelectFamilyAttemptTimeout).toHaveBeenCalledWith(3000);


        timeoutSpy.mockClear();
    });


    test('handles invalid timeout value', async () => {
        const timeoutSpy = jest.spyOn(core, 'getInput').mockReturnValue(INVALID_TIMEOUT);

        smMockClient
            .on(GetSecretValueCommand)
            .resolves({ SecretString: 'test' });

        await run();

        expect(core.setFailed).toHaveBeenCalled();


        timeoutSpy.mockClear();
    })

});