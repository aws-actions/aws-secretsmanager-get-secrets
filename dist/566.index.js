"use strict";
exports.id = 566;
exports.ids = [566];
exports.modules = {

/***/ 1566:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  HttpsProxyAgent: () => (/* binding */ HttpsProxyAgent)
});

// EXTERNAL MODULE: external "net"
var external_net_ = __webpack_require__(9278);
// EXTERNAL MODULE: external "tls"
var external_tls_ = __webpack_require__(4756);
// EXTERNAL MODULE: external "assert"
var external_assert_ = __webpack_require__(2613);
// EXTERNAL MODULE: ./node_modules/debug/src/index.js
var src = __webpack_require__(2830);
// EXTERNAL MODULE: ./node_modules/agent-base/dist/index.js + 1 modules
var dist = __webpack_require__(319);
// EXTERNAL MODULE: external "url"
var external_url_ = __webpack_require__(7016);
;// CONCATENATED MODULE: ./node_modules/https-proxy-agent/dist/parse-proxy-response.js

const debug = src('https-proxy-agent:parse-proxy-response');
function parseProxyResponse(socket) {
    return new Promise((resolve, reject) => {
        // we need to buffer any HTTP traffic that happens with the proxy before we get
        // the CONNECT response, so that if the response is anything other than an "200"
        // response code, then we can re-play the "data" events on the socket once the
        // HTTP parser is hooked up...
        let buffersLength = 0;
        const buffers = [];
        function read() {
            const b = socket.read();
            if (b)
                ondata(b);
            else
                socket.once('readable', read);
        }
        function cleanup() {
            socket.removeListener('end', onend);
            socket.removeListener('error', onerror);
            socket.removeListener('readable', read);
        }
        function onend() {
            cleanup();
            debug('onend');
            reject(new Error('Proxy connection ended before receiving CONNECT response'));
        }
        function onerror(err) {
            cleanup();
            debug('onerror %o', err);
            reject(err);
        }
        function ondata(b) {
            buffers.push(b);
            buffersLength += b.length;
            const buffered = Buffer.concat(buffers, buffersLength);
            const endOfHeaders = buffered.indexOf('\r\n\r\n');
            if (endOfHeaders === -1) {
                // keep buffering
                debug('have not received end of HTTP headers yet...');
                read();
                return;
            }
            const headerParts = buffered
                .slice(0, endOfHeaders)
                .toString('ascii')
                .split('\r\n');
            const firstLine = headerParts.shift();
            if (!firstLine) {
                socket.destroy();
                return reject(new Error('No header received from proxy CONNECT response'));
            }
            const firstLineParts = firstLine.split(' ');
            const statusCode = +firstLineParts[1];
            const statusText = firstLineParts.slice(2).join(' ');
            const headers = {};
            for (const header of headerParts) {
                if (!header)
                    continue;
                const firstColon = header.indexOf(':');
                if (firstColon === -1) {
                    socket.destroy();
                    return reject(new Error(`Invalid header from proxy CONNECT response: "${header}"`));
                }
                const key = header.slice(0, firstColon).toLowerCase();
                const value = header.slice(firstColon + 1).trimStart();
                const current = headers[key];
                if (typeof current === 'string') {
                    headers[key] = [current, value];
                }
                else if (Array.isArray(current)) {
                    current.push(value);
                }
                else {
                    headers[key] = value;
                }
            }
            debug('got proxy server response: %o %o', firstLine, headers);
            cleanup();
            resolve({
                connect: {
                    statusCode,
                    statusText,
                    headers,
                },
                buffered,
            });
        }
        socket.on('error', onerror);
        socket.on('end', onend);
        read();
    });
}
//# sourceMappingURL=parse-proxy-response.js.map
// EXTERNAL MODULE: ./node_modules/proxy-agent-negotiate/dist/index.js
var proxy_agent_negotiate_dist = __webpack_require__(6825);
;// CONCATENATED MODULE: ./node_modules/https-proxy-agent/dist/index.js








const dist_debug = src('https-proxy-agent');
const setServernameFromNonIpHost = (options) => {
    if (options.servername === undefined &&
        options.host &&
        !external_net_.isIP(options.host)) {
        return {
            ...options,
            servername: options.host,
        };
    }
    return options;
};
/**
 * The `HttpsProxyAgent` implements an HTTP Agent subclass that connects to
 * the specified "HTTP(s) proxy server" in order to proxy HTTPS requests.
 *
 * Outgoing HTTP requests are first tunneled through the proxy server using the
 * `CONNECT` HTTP request method to establish a connection to the proxy server,
 * and then the proxy server connects to the destination target and issues the
 * HTTP request from the proxy server.
 *
 * `https:` requests have their socket connection upgraded to TLS once
 * the connection to the proxy server has been established.
 */
class HttpsProxyAgent extends dist/* Agent */.g6 {
    constructor(proxy, opts) {
        super(opts);
        this.options = { path: undefined };
        this.proxy = typeof proxy === 'string' ? new external_url_.URL(proxy) : proxy;
        this.proxyHeaders = opts?.headers ?? {};
        dist_debug('Creating new HttpsProxyAgent instance: %o', this.proxy.href);
        if (opts?.negotiate) {
            this.onProxyAuth = (0,proxy_agent_negotiate_dist/* createNegotiateAuth */.h)();
        }
        else if (opts?.onProxyAuth) {
            this.onProxyAuth = opts.onProxyAuth;
        }
        // Trim off the brackets from IPv6 addresses
        const host = (this.proxy.hostname || this.proxy.host).replace(/^\[|\]$/g, '');
        const port = this.proxy.port
            ? parseInt(this.proxy.port, 10)
            : this.proxy.protocol === 'https:'
                ? 443
                : 80;
        this.connectOpts = {
            // Attempt to negotiate http/1.1 for proxy servers that support http/2
            ALPNProtocols: ['http/1.1'],
            ...(opts
                ? omit(opts, 'headers', 'onProxyAuth', 'negotiate')
                : null),
            host,
            port,
        };
    }
    /**
     * Called when the node-core HTTP client library is creating a
     * new HTTP request.
     */
    async connect(req, opts) {
        const { proxy } = this;
        if (!opts.host) {
            throw new TypeError('No "host" provided');
        }
        // Create a socket connection to the proxy server.
        let socket;
        if (proxy.protocol === 'https:') {
            dist_debug('Creating `tls.Socket`: %o', this.connectOpts);
            socket = external_tls_.connect(setServernameFromNonIpHost(this.connectOpts));
        }
        else {
            dist_debug('Creating `net.Socket`: %o', this.connectOpts);
            socket = external_net_.connect(this.connectOpts);
        }
        const headers = typeof this.proxyHeaders === 'function'
            ? this.proxyHeaders()
            : { ...this.proxyHeaders };
        const host = external_net_.isIPv6(opts.host) ? `[${opts.host}]` : opts.host;
        let payload = `CONNECT ${host}:${opts.port} HTTP/1.1\r\n`;
        // Inject the `Proxy-Authorization` header if necessary.
        if (proxy.username || proxy.password) {
            const auth = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
            headers['Proxy-Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
        }
        headers.Host = `${host}:${opts.port}`;
        if (!headers['Proxy-Connection']) {
            headers['Proxy-Connection'] = this.keepAlive
                ? 'Keep-Alive'
                : 'close';
        }
        for (const name of Object.keys(headers)) {
            payload += `${name}: ${headers[name]}\r\n`;
        }
        const proxyResponsePromise = parseProxyResponse(socket);
        socket.write(`${payload}\r\n`);
        const { connect, buffered } = await proxyResponsePromise;
        req.emit('proxyConnect', connect);
        this.emit('proxyConnect', connect, req);
        req.emit('proxy', { proxy: this.proxy.href, socket });
        if (connect.statusCode === 200) {
            req.once('socket', resume);
            if (opts.secureEndpoint) {
                // The proxy is connecting to a TLS server, so upgrade
                // this socket connection to a TLS connection.
                dist_debug('Upgrading socket connection to TLS');
                return external_tls_.connect({
                    ...omit(setServernameFromNonIpHost(opts), 'host', 'path', 'port'),
                    socket,
                });
            }
            return socket;
        }
        // Handle 407 Proxy Authentication Required
        if (connect.statusCode === 407 && this.onProxyAuth) {
            dist_debug('Got 407 response, invoking onProxyAuth callback');
            socket.destroy();
            const proxyAuthenticate = connect.headers['proxy-authenticate'] || '';
            const scheme = Array.isArray(proxyAuthenticate)
                ? proxyAuthenticate[0].split(/\s/)[0]
                : proxyAuthenticate.split(/\s/)[0];
            const authResponse = await this.onProxyAuth({
                response: connect,
                scheme,
            });
            // Retry with the auth headers
            return this._connectWithAuth(req, opts, authResponse.headers);
        }
        // Some other status code that's not 200... need to re-play the HTTP
        // header "data" events onto the socket once the HTTP machinery is
        // attached so that the node core `http` can parse and handle the
        // error status code.
        // Close the original socket, and a new "fake" socket is returned
        // instead, so that the proxy doesn't get the HTTP request
        // written to it (which may contain `Authorization` headers or other
        // sensitive data).
        //
        // See: https://hackerone.com/reports/541502
        socket.destroy();
        const fakeSocket = new external_net_.Socket({ writable: false });
        fakeSocket.readable = true;
        // Need to wait for the "socket" event to re-play the "data" events.
        req.once('socket', (s) => {
            dist_debug('Replaying proxy buffer for failed request');
            external_assert_(s.listenerCount('data') > 0);
            // Replay the "buffered" Buffer onto the fake `socket`, since at
            // this point the HTTP module machinery has been hooked up for
            // the user.
            s.push(buffered);
            s.push(null);
        });
        return fakeSocket;
    }
    /**
     * Retry a CONNECT request with additional auth headers.
     */
    async _connectWithAuth(req, opts, authHeaders) {
        const { proxy } = this;
        let socket;
        if (proxy.protocol === 'https:') {
            socket = external_tls_.connect(setServernameFromNonIpHost(this.connectOpts));
        }
        else {
            socket = external_net_.connect(this.connectOpts);
        }
        const headers = typeof this.proxyHeaders === 'function'
            ? this.proxyHeaders()
            : { ...this.proxyHeaders };
        const host = external_net_.isIPv6(opts.host) ? `[${opts.host}]` : opts.host;
        let payload = `CONNECT ${host}:${opts.port} HTTP/1.1\r\n`;
        if (proxy.username || proxy.password) {
            const auth = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
            headers['Proxy-Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
        }
        // Merge auth headers (overrides existing)
        Object.assign(headers, authHeaders);
        headers.Host = `${host}:${opts.port}`;
        if (!headers['Proxy-Connection']) {
            headers['Proxy-Connection'] = this.keepAlive
                ? 'Keep-Alive'
                : 'close';
        }
        for (const name of Object.keys(headers)) {
            payload += `${name}: ${headers[name]}\r\n`;
        }
        const proxyResponsePromise = parseProxyResponse(socket);
        socket.write(`${payload}\r\n`);
        const { connect } = await proxyResponsePromise;
        req.emit('proxyConnect', connect);
        this.emit('proxyConnect', connect, req);
        if (connect.statusCode === 200) {
            req.once('socket', resume);
            if (opts.secureEndpoint) {
                dist_debug('Upgrading socket connection to TLS');
                return external_tls_.connect({
                    ...omit(setServernameFromNonIpHost(opts), 'host', 'path', 'port'),
                    socket,
                });
            }
            return socket;
        }
        // If still not 200, throw
        socket.destroy();
        throw new Error(`Proxy authentication failed with status ${connect.statusCode} after retry`);
    }
}
HttpsProxyAgent.protocols = ['http', 'https'];
function resume(socket) {
    // Defer the resume so that all 'socket' event handlers have a chance
    // to attach their listeners (e.g. the HTTP client's 'data' handler)
    // before data starts flowing. Without this, buffered proxy-response
    // data can be emitted synchronously before listeners are ready.
    // See: https://github.com/nicolo-ribaudo/tc39-proposal-await-dictionary/issues/7
    setImmediate(() => {
        socket.resume();
    });
}
function omit(obj, ...keys) {
    const ret = {};
    let key;
    for (key in obj) {
        if (!keys.includes(key)) {
            ret[key] = obj[key];
        }
    }
    return ret;
}
//# sourceMappingURL=index.js.map

/***/ }),

/***/ 6825:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   h: () => (/* binding */ createNegotiateAuth)
/* harmony export */ });
function createNegotiateAuth() {
    return async ({ response, scheme }) => {
        if (scheme.toLowerCase() !== 'negotiate') {
            throw new Error(`Expected Negotiate scheme but got "${scheme}"`);
        }
        let kerberos;
        try {
            kerberos = await __webpack_require__.e(/* import() */ 50).then(__webpack_require__.t.bind(__webpack_require__, 8050, 19));
        }
        catch {
            throw new Error('The "kerberos" package is required for Negotiate proxy authentication. ' +
                'Install it with: npm install kerberos');
        }
        const proxyAuthenticate = response.headers['proxy-authenticate'] || '';
        const challengeHeader = Array.isArray(proxyAuthenticate)
            ? proxyAuthenticate[0]
            : proxyAuthenticate;
        const serverToken = typeof challengeHeader === 'string' && challengeHeader.includes(' ')
            ? challengeHeader.split(' ').slice(1).join(' ')
            : undefined;
        const client = await kerberos.initializeClient('HTTP@proxy', {
            mechOID: kerberos.GSS_MECH_OID_SPNEGO,
        });
        const token = await client.step(serverToken || '');
        if (!token) {
            throw new Error('Kerberos client.step() returned no token');
        }
        return {
            headers: {
                'Proxy-Authorization': `Negotiate ${token}`,
            },
        };
    };
}
//# sourceMappingURL=index.js.map

/***/ })

};
;
//# sourceMappingURL=566.index.js.map