"use strict";
exports.id = 947;
exports.ids = [947];
exports.modules = {

/***/ 8947:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   HttpProxyAgent: () => (/* binding */ HttpProxyAgent)
/* harmony export */ });
/* harmony import */ var net__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(9278);
/* harmony import */ var tls__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(4756);
/* harmony import */ var debug__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(2830);
/* harmony import */ var events__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(4434);
/* harmony import */ var agent_base__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(319);
/* harmony import */ var url__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(7016);
/* harmony import */ var proxy_agent_negotiate__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(6825);







const debug = debug__WEBPACK_IMPORTED_MODULE_2__('http-proxy-agent');
/**
 * The `HttpProxyAgent` implements an HTTP Agent subclass that connects
 * to the specified "HTTP proxy server" in order to proxy HTTP requests.
 */
class HttpProxyAgent extends agent_base__WEBPACK_IMPORTED_MODULE_4__/* .Agent */ .g6 {
    constructor(proxy, opts) {
        super(opts);
        this.proxy = typeof proxy === 'string' ? new url__WEBPACK_IMPORTED_MODULE_5__.URL(proxy) : proxy;
        this.proxyHeaders = opts?.headers ?? {};
        debug('Creating new HttpProxyAgent instance: %o', this.proxy.href);
        if (opts?.negotiate) {
            this.onProxyAuth = (0,proxy_agent_negotiate__WEBPACK_IMPORTED_MODULE_6__/* .createNegotiateAuth */ .h)();
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
            ...(opts
                ? omit(opts, 'headers', 'onProxyAuth', 'negotiate')
                : null),
            host,
            port,
        };
    }
    addRequest(req, opts) {
        req._header = null;
        this.setRequestProps(req, opts);
        // @ts-expect-error `addRequest()` isn't defined in `@types/node`
        super.addRequest(req, opts);
    }
    setRequestProps(req, opts) {
        const { proxy } = this;
        const protocol = opts.secureEndpoint ? 'https:' : 'http:';
        const hostname = req.getHeader('host') || 'localhost';
        const base = `${protocol}//${hostname}`;
        const url = new url__WEBPACK_IMPORTED_MODULE_5__.URL(req.path, base);
        if (opts.port !== 80) {
            url.port = String(opts.port);
        }
        // Change the `http.ClientRequest` instance's "path" field
        // to the absolute path of the URL that will be requested.
        req.path = String(url);
        // Inject the `Proxy-Authorization` header if necessary.
        const headers = typeof this.proxyHeaders === 'function'
            ? this.proxyHeaders()
            : { ...this.proxyHeaders };
        if (proxy.username || proxy.password) {
            const auth = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
            headers['Proxy-Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
        }
        if (!headers['Proxy-Connection']) {
            headers['Proxy-Connection'] = this.keepAlive
                ? 'Keep-Alive'
                : 'close';
        }
        for (const name of Object.keys(headers)) {
            const value = headers[name];
            if (value) {
                req.setHeader(name, value);
            }
        }
    }
    async connect(req, opts) {
        req._header = null;
        if (!req.path.includes('://')) {
            this.setRequestProps(req, opts);
        }
        // At this point, the http ClientRequest's internal `_header` field
        // might have already been set. If this is the case then we'll need
        // to re-generate the string since we just changed the `req.path`.
        let first;
        let endOfHeaders;
        debug('Regenerating stored HTTP header string for request');
        req._implicitHeader();
        if (req.outputData && req.outputData.length > 0) {
            debug('Patching connection write() output buffer with updated header');
            first = req.outputData[0].data;
            endOfHeaders = first.indexOf('\r\n\r\n') + 4;
            req.outputData[0].data =
                req._header + first.substring(endOfHeaders);
            debug('Output buffer: %o', req.outputData[0].data);
        }
        // Create a socket connection to the proxy server.
        let socket;
        if (this.proxy.protocol === 'https:') {
            debug('Creating `tls.Socket`: %o', this.connectOpts);
            socket = tls__WEBPACK_IMPORTED_MODULE_1__.connect(this.connectOpts);
        }
        else {
            debug('Creating `net.Socket`: %o', this.connectOpts);
            socket = net__WEBPACK_IMPORTED_MODULE_0__.connect(this.connectOpts);
        }
        // Wait for the socket's `connect` event, so that this `callback()`
        // function throws instead of the `http` request machinery. This is
        // important for i.e. `PacProxyAgent` which determines a failed proxy
        // connection via the `callback()` function throwing.
        await (0,events__WEBPACK_IMPORTED_MODULE_3__.once)(socket, 'connect');
        // Emit the 'proxyConnect' event for parity with https-proxy-agent
        const connect = { socket };
        req.emit('proxyConnect', connect);
        this.emit('proxyConnect', connect, req);
        req.emit('proxy', { proxy: this.proxy.href, socket });
        return socket;
    }
}
HttpProxyAgent.protocols = ['http', 'https'];
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
//# sourceMappingURL=947.index.js.map