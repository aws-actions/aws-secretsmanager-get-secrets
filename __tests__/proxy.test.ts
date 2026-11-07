import * as core from '@actions/core';
import { ProxyAgent } from 'proxy-agent';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import {
    ProxySettings,
    resolveProxySettings,
    validateProxyUrl,
    maskProxySecrets,
    getProxyForUrl,
    buildProxyRequestHandler,
    proxyErrorHint,
    exitWhenDone,
    bypassesEveryHost,
    PROXY_CONNECTION_TIMEOUT_MS,
    PROXY_SOCKET_TIMEOUT_MS,
    PROCESS_EXIT_GRACE_MS
} from '../src/proxy';

const PROXY_URL = 'http://proxy.example.com:3128';
const SM_ENDPOINT = 'https://secretsmanager.us-east-1.amazonaws.com/';

jest.mock('@actions/core', () => {
    return {
        setSecret: jest.fn(),
    };
});

// jest cannot load proxy-agent (ESM-only); the integration tests exercise the real library
jest.mock('proxy-agent', () => {
    return {
        ProxyAgent: jest.fn(),
    };
});

jest.mock('@smithy/node-http-handler', () => {
    return {
        NodeHttpHandler: jest.fn(),
    };
});

describe('resolveProxySettings', () => {
    test('Returns undefined when nothing is configured', () => {
        expect(resolveProxySettings('', '', {})).toBeUndefined();
    });

    test('Ignores blank values', () => {
        expect(resolveProxySettings('   ', '', { HTTPS_PROXY: ' ' })).toBeUndefined();
    });

    test('Uses the http-proxy input', () => {
        expect(resolveProxySettings(PROXY_URL, '', {})).toEqual({ proxyUrl: PROXY_URL, source: 'http-proxy input' });
    });

    test('The input takes precedence over every environment variable', () => {
        const env = { https_proxy: 'http://a', HTTPS_PROXY: 'http://b', http_proxy: 'http://c', HTTP_PROXY: 'http://d' };
        expect(resolveProxySettings(PROXY_URL, '', env)).toEqual({ proxyUrl: PROXY_URL, source: 'http-proxy input' });
    });

    test.each([
        [{ https_proxy: 'http://a', HTTPS_PROXY: 'http://b', http_proxy: 'http://c', HTTP_PROXY: 'http://d' }, 'http://a', 'https_proxy'],
        [{ HTTPS_PROXY: 'http://b', http_proxy: 'http://c', HTTP_PROXY: 'http://d' }, 'http://b', 'HTTPS_PROXY'],
        [{ http_proxy: 'http://c', HTTP_PROXY: 'http://d' }, 'http://c', 'http_proxy'],
        [{ HTTP_PROXY: 'http://d' }, 'http://d', 'HTTP_PROXY'],
    ])('Environment precedence: %p resolves to %s from %s', (env, proxyUrl, source) => {
        expect(resolveProxySettings('', '', env)).toEqual({ proxyUrl, source });
    });

    test('Trims whitespace from environment values', () => {
        expect(resolveProxySettings('', '', { HTTPS_PROXY: ` ${PROXY_URL} ` })).toEqual({ proxyUrl: PROXY_URL, source: 'HTTPS_PROXY' });
    });

    test('Uses the no-proxy input before the environment', () => {
        const env = { HTTPS_PROXY: PROXY_URL, no_proxy: 'a.example', NO_PROXY: 'b.example' };
        expect(resolveProxySettings('', '.amazonaws.com', env)?.noProxy).toBe('.amazonaws.com');
        expect(resolveProxySettings('', '', env)?.noProxy).toBe('a.example');
        expect(resolveProxySettings('', '', { HTTPS_PROXY: PROXY_URL, NO_PROXY: 'b.example' })?.noProxy).toBe('b.example');
    });

    test('Omits no-proxy when it is blank', () => {
        expect(resolveProxySettings(PROXY_URL, '  ', { NO_PROXY: '' })).toEqual({ proxyUrl: PROXY_URL, source: 'http-proxy input' });
    });

    test('Ignores no-proxy when no proxy is configured', () => {
        expect(resolveProxySettings('', '.amazonaws.com', { NO_PROXY: '*' })).toBeUndefined();
    });

    test.each([
        ['proxy.example.com:3128', 'http://proxy.example.com:3128'],
        ['10.0.0.1:3128', 'http://10.0.0.1:3128'],
        ['user:pass@proxy.example.com', 'http://user:pass@proxy.example.com'],
    ])('Assumes http for a value without a scheme: %s', (value, proxyUrl) => {
        expect(resolveProxySettings(value, '', {})?.proxyUrl).toBe(proxyUrl);
        expect(resolveProxySettings('', '', { HTTPS_PROXY: value })?.proxyUrl).toBe(proxyUrl);
    });

    test('Leaves a value with a scheme alone', () => {
        expect(resolveProxySettings('https://proxy.example.com', '', {})?.proxyUrl).toBe('https://proxy.example.com');
        expect(resolveProxySettings('socks5://proxy.example.com', '', {})?.proxyUrl).toBe('socks5://proxy.example.com');
    });
});

describe('bypassesEveryHost', () => {
    test.each([
        ['*', true],
        ['.amazonaws.com', false],
        ['*,localhost', false],
        [undefined, false],
    ])('no-proxy %p -> %s', (noProxy, expected) => {
        expect(bypassesEveryHost({ proxyUrl: PROXY_URL, source: 'HTTPS_PROXY', ...(noProxy && { noProxy }) })).toBe(expected);
    });
});

describe('validateProxyUrl', () => {
    test.each([
        ['http://proxy.example.com:3128'],
        ['https://proxy.example.com'],
        ['http://user:p%40ss@proxy.example.com:3128'],
        ['http://10.0.0.5:8080'],
    ])('Accepts %s', (proxyUrl) => {
        expect(validateProxyUrl(proxyUrl).hostname).toBeTruthy();
    });

    test.each([
        ['http://not a url'],
        ['http://proxy.example.com:port'],
        ['http://'],
        [''],
    ])('Rejects malformed value %p without echoing it', (proxyUrl) => {
        expect(() => validateProxyUrl(proxyUrl)).toThrow('The configured proxy is not a valid URL');
        if (proxyUrl) {
            expect(() => validateProxyUrl(proxyUrl)).not.toThrow(proxyUrl);
        }
    });

    test.each([
        ['http://alice:bad%zz@proxy.example.com'],
        ['http://alice:50%off@proxy.example.com'],
        ['http://b%ob:secret@proxy.example.com'],
    ])('Rejects credentials with invalid percent-encoding in %s without echoing them', (proxyUrl) => {
        expect(() => validateProxyUrl(proxyUrl)).toThrow('The proxy credentials contain invalid percent-encoding');
        expect(() => validateProxyUrl(proxyUrl)).not.toThrow('secret');
        expect(() => validateProxyUrl(proxyUrl)).not.toThrow('50%off');
    });

    test.each([
        ['socks5://proxy.example.com:1080', 'socks5:'],
        ['pac+https://proxy.example.com/proxy.pac', 'pac+https:'],
        ['ftp://proxy.example.com', 'ftp:'],
    ])('Rejects unsupported scheme in %s', (proxyUrl, scheme) => {
        expect(() => validateProxyUrl(proxyUrl)).toThrow(`Unsupported proxy scheme '${scheme}'. Only http and https proxies are supported.`);
    });
});

describe('maskProxySecrets', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Masks the full URL', () => {
        maskProxySecrets(PROXY_URL, new URL(PROXY_URL));
        expect(core.setSecret).toHaveBeenCalledTimes(1);
        expect(core.setSecret).toHaveBeenCalledWith(PROXY_URL);
    });

    test('Masks embedded credentials, both encoded and decoded', () => {
        const proxyUrl = 'http://alice:p%40ss%2Fword@proxy.example.com:3128';
        maskProxySecrets(proxyUrl, new URL(proxyUrl));
        expect(core.setSecret).toHaveBeenCalledWith(proxyUrl);
        expect(core.setSecret).toHaveBeenCalledWith('alice');
        expect(core.setSecret).toHaveBeenCalledWith('p%40ss%2Fword');
        expect(core.setSecret).toHaveBeenCalledWith('p@ss/word');
        expect(core.setSecret).toHaveBeenCalledTimes(4);
    });

    test('Does not mask the decoded form again when it equals the raw form', () => {
        const proxyUrl = 'http://alice:secret@proxy.example.com';
        maskProxySecrets(proxyUrl, new URL(proxyUrl));
        expect(core.setSecret).toHaveBeenCalledTimes(3);
    });
});

describe('getProxyForUrl', () => {
    const settings = (noProxy?: string): ProxySettings => ({ proxyUrl: PROXY_URL, source: 'http-proxy input', ...(noProxy && { noProxy }) });

    test('Proxies when there is no no-proxy list', () => {
        expect(getProxyForUrl(settings(), SM_ENDPOINT)).toBe(PROXY_URL);
    });

    test('Never proxies an unparseable URL', () => {
        expect(getProxyForUrl(settings(), 'not a url')).toBe('');
    });

    test('Never proxies a non-http(s) URL', () => {
        expect(getProxyForUrl(settings(), 'ftp://secretsmanager.us-east-1.amazonaws.com/')).toBe('');
    });

    test.each([
        ['*', SM_ENDPOINT, false],
        ['secretsmanager.us-east-1.amazonaws.com', SM_ENDPOINT, false],
        ['amazonaws.com', SM_ENDPOINT, true],
        ['.amazonaws.com', SM_ENDPOINT, false],
        ['*.amazonaws.com', SM_ENDPOINT, false],
        ['.us-west-2.amazonaws.com', SM_ENDPOINT, true],
        ['localhost,127.0.0.1,.amazonaws.com', SM_ENDPOINT, false],
        ['localhost, 127.0.0.1', SM_ENDPOINT, true],
        ['localhost  .amazonaws.com', SM_ENDPOINT, false],
        [',,', SM_ENDPOINT, true],
        ['.amazonaws.com:443', SM_ENDPOINT, false],
        ['.amazonaws.com:8443', SM_ENDPOINT, true],
        ['secretsmanager.us-east-1.amazonaws.com:443', 'https://secretsmanager.us-east-1.amazonaws.com:443/', false],
        ['secretsmanager.us-east-1.amazonaws.com:80', 'http://secretsmanager.us-east-1.amazonaws.com/', false],
        ['secretsmanager.us-east-1.amazonaws.com', 'https://secretsmanager.us-east-1.amazonaws.com:8443/', false],
        ['.AmazonAWS.com', SM_ENDPOINT, false],
        ['SecretsManager.US-EAST-1.amazonaws.com', SM_ENDPOINT, false],
        ['.AmazonAWS.com:443', SM_ENDPOINT, false],
        ['.amazonaws.com', 'https://SecretsManager.US-East-1.AmazonAWS.com/', false],
    ])('no-proxy %p for %s -> proxied: %s', (noProxy, requestUrl, proxied) => {
        expect(getProxyForUrl(settings(noProxy), requestUrl)).toBe(proxied ? PROXY_URL : '');
    });
});

describe('buildProxyRequestHandler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Creates a keep-alive ProxyAgent and uses it for both http and https', () => {
        const settings: ProxySettings = { proxyUrl: PROXY_URL, noProxy: '.example.com', source: 'HTTPS_PROXY' };

        buildProxyRequestHandler(settings);

        expect(ProxyAgent).toHaveBeenCalledTimes(1);
        expect(ProxyAgent).toHaveBeenCalledWith({ keepAlive: true, maxSockets: 50, getProxyForUrl: expect.any(Function) });
        const agent = (ProxyAgent as unknown as jest.Mock).mock.instances[0];
        expect(NodeHttpHandler).toHaveBeenCalledTimes(1);
        expect(NodeHttpHandler).toHaveBeenCalledWith({
            httpAgent: agent,
            httpsAgent: agent,
            connectionTimeout: PROXY_CONNECTION_TIMEOUT_MS,
            socketTimeout: PROXY_SOCKET_TIMEOUT_MS,
        });
    });

    test('The agent resolves the proxy per request, honoring no-proxy', () => {
        const settings: ProxySettings = { proxyUrl: PROXY_URL, noProxy: '.example.com', source: 'HTTPS_PROXY' };

        buildProxyRequestHandler(settings);

        const { getProxyForUrl: resolver } = (ProxyAgent as unknown as jest.Mock).mock.calls[0][0];
        expect(resolver(SM_ENDPOINT)).toBe(PROXY_URL);
        expect(resolver('https://api.example.com/')).toBe('');
    });
});

describe('proxyErrorHint', () => {
    const settings: ProxySettings = { proxyUrl: PROXY_URL, source: 'HTTP_PROXY' };

    test('Is empty when no proxy is configured', () => {
        expect(proxyErrorHint({ $metadata: { httpStatusCode: 407 } }, undefined)).toBe('');
    });

    test.each([407, 403])('Explains an HTTP %i received through the proxy', (statusCode) => {
        const hint = proxyErrorHint({ $metadata: { httpStatusCode: statusCode } }, settings);
        expect(hint).toContain(`HTTP ${statusCode}`);
        expect(hint).toContain('HTTP_PROXY');
        expect(hint).not.toContain(PROXY_URL);
    });

    test.each([
        [{ $metadata: { httpStatusCode: 400 } }],
        [{ $metadata: {} }],
        [new Error('connect ECONNREFUSED')],
        [undefined],
        ['string error'],
    ])('Is empty for %p', (error) => {
        expect(proxyErrorHint(error, settings)).toBe('');
    });
});

describe('exitWhenDone', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test('Exits the process after the grace period, with the exit code already set', () => {
        exitWhenDone();

        jest.advanceTimersByTime(PROCESS_EXIT_GRACE_MS - 1);
        expect(process.exit).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(process.exit).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledWith();
    });

    test('Does not keep the event loop alive', () => {
        const unref = jest.fn();
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockReturnValue({ unref } as unknown as NodeJS.Timeout);

        exitWhenDone();

        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), PROCESS_EXIT_GRACE_MS);
        expect(unref).toHaveBeenCalledTimes(1);
    });
});
