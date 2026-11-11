import * as core from '@actions/core'
import { mockClient } from "aws-sdk-client-mock";
import "aws-sdk-client-mock-jest";
import {
    GetSecretValueCommand, ListSecretsCommand,
    ResourceNotFoundException,
    SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { ProxyAgent } from 'proxy-agent';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { run } from "../src";
import { CLEANUP_NAME } from "../src/constants";
import * as proxy from "../src/proxy";
import { PROCESS_EXIT_GRACE_MS } from "../src/proxy";

const DEFAULT_TEST_ENV = {
    AWS_DEFAULT_REGION: 'us-east-1'
};

// Cleared before each test so the developer's own proxy settings do not affect the results
const PROXY_ENV_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'];

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

const PROXY_URL = 'http://proxy.example.com:3128';
const PROXY_URL_WITH_CREDENTIALS = 'http://alice:p%40ss@proxy.example.com:3128';

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

// jest cannot load proxy-agent (ESM-only); the integration tests exercise the real library
jest.mock('proxy-agent', () => {
    return {
        ProxyAgent: jest.fn(),
    };
});

/*
 * getInput implementation: the action's defaults, overridden by the given inputs, and '' for anything else
 */
function inputs(values: Record<string, string>): (name: string) => string {
    const withDefaults: Record<string, string> = {
        'auto-select-family-attempt-timeout': DEFAULT_TIMEOUT,
        'name-transformation': 'uppercase',
        ...values
    };
    return (name: string) => withDefaults[name] ?? '';
}

describe('Test main action', () => {
    const OLD_ENV = process.env;

    // The action schedules a process exit when a proxy is configured; never let it end the test run
    const processExit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    beforeEach(() => {
        jest.clearAllMocks();
        smMockClient.reset();
        process.env = { ...OLD_ENV, ...DEFAULT_TEST_ENV };
        PROXY_ENV_VARS.forEach(name => delete process.env[name]);
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
        // A blanket return value would also be read as the http-proxy input
        const timeoutSpy = jest.spyOn(core, 'getInput').mockImplementation(inputs({ 'auto-select-family-attempt-timeout': VALID_TIMEOUT }));

        smMockClient
            .on(GetSecretValueCommand)
            .resolves({ SecretString: 'test' });

        await run();

        expect(net.setDefaultAutoSelectFamilyAttemptTimeout).toHaveBeenCalledWith(3000);
        expect(core.setFailed).not.toHaveBeenCalledWith(expect.stringContaining('proxy'));


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

    describe('HTTP proxy', () => {
        // Captures the config of the client the action built
        function captureClientConfig(): () => SecretsManagerClient['config'] | undefined {
            let config: SecretsManagerClient['config'] | undefined;
            smMockClient
                .on(GetSecretValueCommand)
                .callsFake((_input, getClient) => {
                    config = getClient().config;
                    return { Name: TEST_NAME_3, SecretString: SECRET_3 };
                });
            return () => config;
        }

        beforeEach(() => {
            jest.spyOn(core, 'getBooleanInput').mockReturnValue(false);
            jest.spyOn(core, 'getMultilineInput').mockReturnValue([TEST_NAME_3]);
        });

        test('Does not configure a proxy by default', async () => {
            jest.spyOn(core, 'getInput').mockImplementation(inputs({}));
            const buildSpy = jest.spyOn(proxy, 'buildProxyRequestHandler');
            captureClientConfig();

            await run();

            expect(core.setFailed).not.toHaveBeenCalled();
            expect(buildSpy).not.toHaveBeenCalled();
            expect(ProxyAgent).not.toHaveBeenCalled();
            expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining('proxy'));
            expect(core.exportVariable).toHaveBeenCalledWith(TEST_NAME_3.toUpperCase().replace('/', '_'), SECRET_3);
        });

        test('Routes API calls through the proxy from the http-proxy input', async () => {
            jest.spyOn(core, 'getInput').mockImplementation(inputs({
                'http-proxy': PROXY_URL,
                'no-proxy': '.example.com',
            }));
            const buildSpy = jest.spyOn(proxy, 'buildProxyRequestHandler');
            const clientConfig = captureClientConfig();

            await run();

            expect(core.setFailed).not.toHaveBeenCalled();
            expect(buildSpy).toHaveBeenCalledWith({ proxyUrl: PROXY_URL, noProxy: '.example.com', source: 'http-proxy input' });
            expect(ProxyAgent).toHaveBeenCalledWith(expect.objectContaining({ keepAlive: true, getProxyForUrl: expect.any(Function) }));
            // The handler built for the proxy is the one the client uses
            expect(clientConfig()?.requestHandler).toBeInstanceOf(NodeHttpHandler);
            expect(clientConfig()?.requestHandler).toBe(buildSpy.mock.results[0].value);
            expect(core.setSecret).toHaveBeenCalledWith(PROXY_URL);
            expect(core.info).toHaveBeenCalledWith('Using the HTTP proxy configured by http-proxy input for Secrets Manager API calls.');
            // Secrets are still retrieved and injected as before
            expect(core.exportVariable).toHaveBeenCalledWith(TEST_NAME_3.toUpperCase().replace('/', '_'), SECRET_3);
        });

        test('Falls back to the standard proxy environment variables', async () => {
            jest.spyOn(core, 'getInput').mockImplementation(inputs({}));
            process.env.HTTPS_PROXY = PROXY_URL;
            process.env.NO_PROXY = 'localhost';
            const buildSpy = jest.spyOn(proxy, 'buildProxyRequestHandler');
            const clientConfig = captureClientConfig();

            await run();

            expect(core.setFailed).not.toHaveBeenCalled();
            expect(buildSpy).toHaveBeenCalledWith({ proxyUrl: PROXY_URL, noProxy: 'localhost', source: 'HTTPS_PROXY' });
            expect(clientConfig()?.requestHandler).toBe(buildSpy.mock.results[0].value);
            expect(core.info).toHaveBeenCalledWith('Using the HTTP proxy configured by HTTPS_PROXY for Secrets Manager API calls.');
        });

        test('Masks proxy credentials', async () => {
            jest.spyOn(core, 'getInput').mockImplementation(inputs({
                'http-proxy': PROXY_URL_WITH_CREDENTIALS,
            }));
            captureClientConfig();

            await run();

            expect(core.setFailed).not.toHaveBeenCalled();
            expect(core.setSecret).toHaveBeenCalledWith(PROXY_URL_WITH_CREDENTIALS);
            expect(core.setSecret).toHaveBeenCalledWith('alice');
            expect(core.setSecret).toHaveBeenCalledWith('p%40ss');
            expect(core.setSecret).toHaveBeenCalledWith('p@ss');
        });

        test('Fails before calling Secrets Manager when the proxy URL is invalid', async () => {
            jest.spyOn(core, 'getInput').mockImplementation(inputs({
                'http-proxy': 'socks5://proxy.example.com:1080',
            }));
            captureClientConfig();

            await run();

            expect(core.setFailed).toHaveBeenCalledTimes(1);
            expect(core.setFailed).toHaveBeenCalledWith("Unsupported proxy scheme 'socks5:'. Only http and https proxies are supported.");
            expect(ProxyAgent).not.toHaveBeenCalled();
            expect(smMockClient).not.toHaveReceivedAnyCommand();
            expect(core.exportVariable).not.toHaveBeenCalled();
        });

        test('Explains a rejection by the proxy when fetching a secret', async () => {
            jest.spyOn(core, 'getInput').mockImplementation(inputs({
                'http-proxy': PROXY_URL,
            }));
            // A proxy's 407 reaches the SDK as an unknown error carrying the status code
            const rejection = Object.assign(new Error('UnknownError'), { name: 'Unknown', $metadata: { httpStatusCode: 407 } });
            smMockClient.on(GetSecretValueCommand).rejects(rejection);

            await run();

            expect(core.setFailed).toHaveBeenCalledTimes(1);
            expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining(`Failed to fetch secret: '${TEST_NAME_3}'.`));
            expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('which may have rejected it (HTTP 407)'));
            expect(core.setFailed).not.toHaveBeenCalledWith(expect.stringContaining(PROXY_URL));
        });

        test('Explains a rejection by the proxy when listing secrets', async () => {
            jest.spyOn(core, 'getInput').mockImplementation(inputs({
                'http-proxy': PROXY_URL,
            }));
            jest.spyOn(core, 'getMultilineInput').mockReturnValue([TEST_NAME]);
            const rejection = Object.assign(new Error('UnknownError'), { name: 'Unknown', $metadata: { httpStatusCode: 403 } });
            smMockClient.on(ListSecretsCommand).rejects(rejection);

            await run();

            expect(core.setFailed).toHaveBeenCalledTimes(1);
            expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(/^UnknownError .*HTTP 403/));
        });

        test('Accepts a proxy environment value without a scheme and masks it', async () => {
            jest.spyOn(core, 'getInput').mockImplementation(inputs({}));
            process.env.https_proxy = 'proxy.example.com:3128';
            const buildSpy = jest.spyOn(proxy, 'buildProxyRequestHandler');
            captureClientConfig();

            await run();

            expect(core.setFailed).not.toHaveBeenCalled();
            expect(buildSpy).toHaveBeenCalledWith({ proxyUrl: 'http://proxy.example.com:3128', source: 'https_proxy' });
            expect(core.setSecret).toHaveBeenCalledWith('http://proxy.example.com:3128');
        });

        test('Fails before calling Secrets Manager when proxy credentials are not percent-encoded', async () => {
            jest.spyOn(core, 'getInput').mockImplementation(inputs({ 'http-proxy': 'http://svc:50%off@proxy.example.com:3128' }));
            captureClientConfig();

            await run();

            expect(core.setFailed).toHaveBeenCalledTimes(1);
            expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('invalid percent-encoding'));
            expect(core.setFailed).not.toHaveBeenCalledWith(expect.stringContaining('50%off'));
            expect(ProxyAgent).not.toHaveBeenCalled();
            expect(smMockClient).not.toHaveReceivedAnyCommand();
        });

        test('Schedules a process exit once done when a proxy is configured', async () => {
            jest.useFakeTimers();
            try {
                jest.spyOn(core, 'getInput').mockImplementation(inputs({ 'http-proxy': PROXY_URL }));
                captureClientConfig();

                await run();

                expect(processExit).not.toHaveBeenCalled();
                jest.advanceTimersByTime(PROCESS_EXIT_GRACE_MS);
                expect(processExit).toHaveBeenCalledTimes(1);
            } finally {
                jest.useRealTimers();
            }
        });

        test('Does not schedule a process exit without a proxy', async () => {
            jest.useFakeTimers();
            try {
                jest.spyOn(core, 'getInput').mockImplementation(inputs({}));
                captureClientConfig();

                await run();

                jest.advanceTimersByTime(PROCESS_EXIT_GRACE_MS);
                expect(processExit).not.toHaveBeenCalled();
            } finally {
                jest.useRealTimers();
            }
        });

        test.each(['*', 'localhost,*'])('Ignores an unusable proxy from the environment when no-proxy is %p', async (noProxy) => {
            jest.spyOn(core, 'getInput').mockImplementation(inputs({ 'no-proxy': noProxy }));
            process.env.HTTPS_PROXY = 'socks5://proxy.example.com:1080';
            const buildSpy = jest.spyOn(proxy, 'buildProxyRequestHandler');
            captureClientConfig();

            await run();

            expect(core.setFailed).not.toHaveBeenCalled();
            expect(core.info).toHaveBeenCalledWith("Ignoring the HTTP proxy configured by HTTPS_PROXY because no-proxy contains '*'.");
            expect(buildSpy).not.toHaveBeenCalled();
            expect(ProxyAgent).not.toHaveBeenCalled();
            expect(core.exportVariable).toHaveBeenCalledWith(TEST_NAME_3.toUpperCase().replace('/', '_'), SECRET_3);
        });

        test('Does not add the proxy hint to unrelated failures', async () => {
            jest.spyOn(core, 'getInput').mockImplementation(inputs({
                'http-proxy': PROXY_URL,
            }));
            smMockClient.on(GetSecretValueCommand).rejects(new ResourceNotFoundException({
                $metadata: { httpStatusCode: 400 }, message: "Secrets Manager can't find the specified secret."
            }));

            await run();

            expect(core.setFailed).toHaveBeenCalledTimes(1);
            expect(core.setFailed).not.toHaveBeenCalledWith(expect.stringContaining('proxy'));
        });
    });

});