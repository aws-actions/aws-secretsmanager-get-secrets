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
exports.PROCESS_EXIT_GRACE_MS = exports.PROXY_SOCKET_TIMEOUT_MS = exports.PROXY_CONNECTION_TIMEOUT_MS = void 0;
exports.resolveProxySettings = resolveProxySettings;
exports.bypassesEveryHost = bypassesEveryHost;
exports.validateProxyUrl = validateProxyUrl;
exports.maskProxySecrets = maskProxySecrets;
exports.getProxyForUrl = getProxyForUrl;
exports.buildProxyRequestHandler = buildProxyRequestHandler;
exports.proxyErrorHint = proxyErrorHint;
exports.exitWhenDone = exitWhenDone;
const core = __importStar(require("@actions/core"));
const node_http_handler_1 = require("@smithy/node-http-handler");
const proxy_agent_1 = require("proxy-agent");
const DEFAULT_PORTS = { http: 80, https: 443 };
// Time allowed for the TCP connection to the proxy and the CONNECT tunnel through it. Without a limit a proxy
// that accepts the connection but never answers would stall the step until the job times out.
exports.PROXY_CONNECTION_TIMEOUT_MS = 10000;
// Longest the tunnel may stay silent once it is established. Covers a proxy that answers CONNECT and then never
// relays the TLS handshake or the response, which the connection timeout does not see.
exports.PROXY_SOCKET_TIMEOUT_MS = 10000;
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
function resolveProxySettings(httpProxyInput, noProxyInput, env = process.env) {
    const candidates = [
        ['http-proxy input', httpProxyInput],
        ['https_proxy', env.https_proxy],
        ['HTTPS_PROXY', env.HTTPS_PROXY],
        ['http_proxy', env.http_proxy],
        ['HTTP_PROXY', env.HTTP_PROXY],
    ];
    for (const [source, value] of candidates) {
        const proxyUrl = value === null || value === void 0 ? void 0 : value.trim();
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
function withScheme(proxyUrl) {
    return proxyUrl.includes('://') ? proxyUrl : `http://${proxyUrl}`;
}
/**
 * Tells whether the no-proxy list excludes every host, in which case the proxy is never used
 *
 * @param settings: Resolved proxy settings
 * @returns true when no-proxy is '*'
 */
function bypassesEveryHost(settings) {
    return settings.noProxy === '*';
}
/**
 * Parses the proxy URL and rejects anything other than an http or https proxy with decodable credentials
 *
 * @param proxyUrl: Proxy URL to validate
 * @returns The parsed URL
 */
function validateProxyUrl(proxyUrl) {
    let url;
    try {
        url = new URL(proxyUrl);
    }
    catch (_a) {
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
    }
    catch (_b) {
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
function maskProxySecrets(proxyUrl, url) {
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
function getProxyForUrl(settings, requestUrl) {
    let url;
    try {
        url = new URL(requestUrl);
    }
    catch (_a) {
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
function shouldProxy(hostname, port, noProxy) {
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
function buildProxyRequestHandler(settings) {
    // NodeHttpHandler's own defaults, which it does not apply to an agent supplied by the caller
    const agent = new proxy_agent_1.ProxyAgent({
        keepAlive: true,
        maxSockets: 50,
        getProxyForUrl: (url) => getProxyForUrl(settings, url),
    });
    return new node_http_handler_1.NodeHttpHandler({
        httpAgent: agent,
        httpsAgent: agent,
        connectionTimeout: exports.PROXY_CONNECTION_TIMEOUT_MS,
        socketTimeout: exports.PROXY_SOCKET_TIMEOUT_MS,
    });
}
/**
 * Builds a hint for the failure message when the proxy answered a request with 403 or 407
 *
 * @param error: Error thrown by the SDK
 * @param settings: Resolved proxy settings, if a proxy is configured
 * @returns Text to append to the failure message, or an empty string
 */
function proxyErrorHint(error, settings) {
    var _a;
    if (!settings) {
        return '';
    }
    // 407 is Proxy Authentication Required; 403 is a refused destination
    const statusCode = (_a = error === null || error === void 0 ? void 0 : error.$metadata) === null || _a === void 0 ? void 0 : _a.httpStatusCode;
    if (statusCode === 403 || statusCode === 407) {
        return ` The request was sent through the HTTP proxy configured by ${settings.source}, which may have rejected it (HTTP ${statusCode}). Check the proxy credentials and policy.`;
    }
    return '';
}
// Time given to the process to exit on its own after the action has finished
exports.PROCESS_EXIT_GRACE_MS = 5000;
/**
 * Makes sure the process ends once the action is done. A proxy connection the library never finished can keep
 * the event loop alive after the action has reported its result. The timer does not hold the loop open itself,
 * so a process that would have exited anyway still does so at once.
 */
function exitWhenDone() {
    setTimeout(() => process.exit(), exports.PROCESS_EXIT_GRACE_MS).unref();
}
