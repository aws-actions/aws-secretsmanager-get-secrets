import * as core from '@actions/core';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { ProxyAgent } from 'proxy-agent';

export type ProxySource = 'http-proxy input' | 'https_proxy' | 'HTTPS_PROXY' | 'http_proxy' | 'HTTP_PROXY';

export interface ProxySettings {
    proxyUrl: string,
    noProxy?: string,
    source: ProxySource
}

const DEFAULT_PORTS: Record<string, number> = { http: 80, https: 443 };

// Time allowed for the TCP connection to the proxy and the CONNECT tunnel through it. Without a limit a proxy
// that accepts the connection but never answers would stall the step until the job times out.
export const PROXY_CONNECTION_TIMEOUT_MS = 10000;

// Longest the tunnel may stay silent once it is established. Covers a proxy that answers CONNECT and then never
// relays the TLS handshake or the response, which the connection timeout does not see.
export const PROXY_SOCKET_TIMEOUT_MS = 10000;

const INVALID_PROXY_URL_MESSAGE = 'The configured proxy is not a valid URL. Expected the form http[s]://[user:password@]host[:port].';
const INVALID_PROXY_CREDENTIALS_MESSAGE = 'The proxy credentials contain invalid percent-encoding. Encode special characters in the user name and password, for example % as %25.';

/**
 * Finds the proxy to use: the http-proxy input, else the first of https_proxy, HTTPS_PROXY, http_proxy, HTTP_PROXY
 *
 * @param httpProxyInput: Value of the http-proxy input
 * @param noProxyInput: Value of the no-proxy input
 * @param env: Environment variables to read
 * @returns The proxy settings, or undefined when no proxy is configured
 */
export function resolveProxySettings(httpProxyInput: string, noProxyInput: string, env: NodeJS.ProcessEnv = process.env): ProxySettings | undefined {
    const candidates: [ProxySource, string | undefined][] = [
        ['http-proxy input', httpProxyInput],
        ['https_proxy', env.https_proxy],
        ['HTTPS_PROXY', env.HTTPS_PROXY],
        ['http_proxy', env.http_proxy],
        ['HTTP_PROXY', env.HTTP_PROXY],
    ];

    for (const [source, value] of candidates) {
        const proxyUrl = value?.trim();
        if (proxyUrl) {
            const noProxy = (noProxyInput || env.no_proxy || env.NO_PROXY || '').trim();
            return noProxy ? { proxyUrl: withScheme(proxyUrl), noProxy, source } : { proxyUrl: withScheme(proxyUrl), source };
        }
    }

    return undefined;
}

/*
 * Values such as 'proxy.example.com:3128' are accepted by curl, the GitHub runner and proxy-from-env as http proxies
 */
function withScheme(proxyUrl: string): string {
    return proxyUrl.includes('://') ? proxyUrl : `http://${proxyUrl}`;
}

/**
 * Tells whether the no-proxy list excludes every host, in which case the proxy is never used
 *
 * @param settings: Resolved proxy settings
 * @returns true when no-proxy is '*'
 */
export function bypassesEveryHost(settings: ProxySettings): boolean {
    return settings.noProxy === '*';
}

/**
 * Parses the proxy URL and rejects anything other than an http or https proxy with decodable credentials
 *
 * @param proxyUrl: Proxy URL to validate
 * @returns The parsed URL
 */
export function validateProxyUrl(proxyUrl: string): URL {
    let url: URL;
    try {
        url = new URL(proxyUrl);
    } catch {
        // The value is left out of the message because it may contain a password
        throw new Error(INVALID_PROXY_URL_MESSAGE);
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Unsupported proxy scheme '${url.protocol}'. Only http and https proxies are supported.`);
    }

    // The proxy library decodes the credentials after it has opened the connection, and a decoding error there
    // leaves the socket open and the step running
    try {
        decodeURIComponent(url.username);
        decodeURIComponent(url.password);
    } catch {
        throw new Error(INVALID_PROXY_CREDENTIALS_MESSAGE);
    }

    return url;
}

/**
 * Masks the proxy URL and any credentials in it, as written and decoded, in the job log
 *
 * @param proxyUrl: Proxy URL as configured
 * @param url: The parsed proxy URL, from validateProxyUrl
 */
export function maskProxySecrets(proxyUrl: string, url: URL): void {
    core.setSecret(proxyUrl);

    for (const part of [url.username, url.password]) {
        if (!part) {
            continue;
        }
        core.setSecret(part);
        const decoded = decodeURIComponent(part);
        if (decoded !== part) {
            core.setSecret(decoded);
        }
    }
}

/**
 * Returns the proxy to use for a request, or an empty string when the no-proxy list excludes its host
 *
 * @param settings: Resolved proxy settings
 * @param requestUrl: URL of the request
 * @returns The proxy URL, or '' to connect directly
 */
export function getProxyForUrl(settings: ProxySettings, requestUrl: string): string {
    let url: URL;
    try {
        url = new URL(requestUrl);
    } catch {
        return '';
    }

    const protocol = url.protocol.replace(':', '');
    if (protocol !== 'http' && protocol !== 'https') {
        return '';
    }

    const port = parseInt(url.port) || DEFAULT_PORTS[protocol];

    return shouldProxy(url.hostname, port, settings.noProxy) ? settings.proxyUrl : '';
}

/**
 * Checks a host against the no-proxy list: '*', an exact host, a '.suffix' or '*.suffix', each with an optional ':port'.
 * Matching is case-insensitive.
 *
 * Ported from the ProxyResolver in aws-actions/configure-aws-credentials, which is based on
 * https://github.com/Rob--W/proxy-from-env/tree/caf8c32301afdac8b5feaf346028bd8240690144
 * Copyright (C) 2016-2018 Rob Wu, MIT License,
 * see https://github.com/Rob--W/proxy-from-env/blob/caf8c32301afdac8b5feaf346028bd8240690144/LICENSE
 *
 * @param hostname: Host of the request, as returned by URL (always lowercase)
 * @param port: Port of the request
 * @param noProxy: No-proxy entries separated by commas or whitespace
 * @returns true when the request should go through the proxy
 */
function shouldProxy(hostname: string, port: number, noProxy?: string): boolean {
    if (!noProxy) {
        return true;
    }
    if (noProxy === '*') {
        return false;
    }

    return noProxy.toLowerCase().split(/[,\s]/).every((entry) => {
        if (!entry) {
            return true;
        }

        const match = entry.match(/^(.+):(\d+)$/);
        const entryHost = match ? match[1] : entry;
        const entryPort = match ? parseInt(match[2]) : 0;

        if (entryPort && entryPort !== port) {
            return true;
        }

        // Without a leading wildcard, only an exact match bypasses the proxy
        if (!/^[.*]/.test(entryHost)) {
            return hostname !== entryHost;
        }

        const suffix = entryHost.startsWith('*') ? entryHost.slice(1) : entryHost;
        return !hostname.endsWith(suffix);
    });
}

/**
 * Builds the SDK request handler that sends Secrets Manager API calls through the proxy
 *
 * @param settings: Resolved proxy settings
 * @returns Request handler for the SecretsManagerClient
 */
export function buildProxyRequestHandler(settings: ProxySettings): NodeHttpHandler {
    // NodeHttpHandler's own defaults, which it does not apply to an agent supplied by the caller
    const agent = new ProxyAgent({
        keepAlive: true,
        maxSockets: 50,
        getProxyForUrl: (url: string) => getProxyForUrl(settings, url),
    });

    return new NodeHttpHandler({
        httpAgent: agent,
        httpsAgent: agent,
        connectionTimeout: PROXY_CONNECTION_TIMEOUT_MS,
        socketTimeout: PROXY_SOCKET_TIMEOUT_MS,
    });
}

/**
 * Builds a hint for the failure message when the proxy answered a request with 403 or 407
 *
 * @param error: Error thrown by the SDK
 * @param settings: Resolved proxy settings, if a proxy is configured
 * @returns Text to append to the failure message, or an empty string
 */
export function proxyErrorHint(error: unknown, settings?: ProxySettings): string {
    if (!settings) {
        return '';
    }

    // 407 is Proxy Authentication Required; 403 is a refused destination
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (statusCode === 403 || statusCode === 407) {
        return ` The request was sent through the HTTP proxy configured by ${settings.source}, which may have rejected it (HTTP ${statusCode}). Check the proxy credentials and policy.`;
    }

    return '';
}

// Time given to the process to exit on its own after the action has finished
export const PROCESS_EXIT_GRACE_MS = 5000;

/**
 * Makes sure the process ends once the action is done. A proxy connection the library never finished can keep
 * the event loop alive after the action has reported its result. The timer does not hold the loop open itself,
 * so a process that would have exited anyway still does so at once.
 */
export function exitWhenDone(): void {
    setTimeout(() => process.exit(), PROCESS_EXIT_GRACE_MS).unref();
}
