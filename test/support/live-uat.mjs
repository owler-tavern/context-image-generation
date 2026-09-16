function classifyUrl(actual, expected) {
    if (actual.username || actual.password) return 'credentialed-url';
    if (actual.origin !== expected.origin) return 'blocked-origin';
    if (/images\/generations|(?:^|\/)generate(?:$|\/)/iu.test(actual.pathname)) return 'generation';
    if (actual.pathname !== expected.pathname || actual.search || actual.hash) return 'blocked-path';
    return 'expected-catalog';
}

export function createNoSpendInterceptionGate({ catalogUrl, fetchImpl } = {}) {
    const expected = new URL(String(catalogUrl));
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname);
    if (!(expected.protocol === 'https:' || (expected.protocol === 'http:' && loopback)) || expected.username || expected.password || expected.search || expected.hash) {
        throw new TypeError('No-spend UAT requires a safe catalog URL.');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('No-spend UAT requires a controlled fetch implementation.');
    const requests = [];
    const gate = {
        requests,
        async fetch(rawUrl, init = {}) {
            const actual = new URL(String(rawUrl));
            const method = String(init.method || 'GET').toUpperCase();
            const urlClass = classifyUrl(actual, expected);
            requests.push({ method, urlClass });
            if (urlClass === 'credentialed-url') throw new Error('No-spend UAT blocked a credentialed URL.');
            if (method !== 'GET' || urlClass !== 'expected-catalog') {
                throw new Error(`No-spend UAT blocked ${method} request outside the catalog allowlist.`);
            }
            const response = await fetchImpl(actual.href, { ...init, method: 'GET', redirect: 'manual' });
            if (response?.redirected || (Number(response?.status) >= 300 && Number(response?.status) < 400)
                || (response?.url && new URL(response.url).href !== expected.href)) {
                throw new Error('No-spend UAT blocked a catalog redirect.');
            }
            return response;
        },
        install(globalObject = globalThis) {
            if (!globalObject || typeof globalObject.fetch !== 'function') throw new TypeError('No-spend UAT requires a replaceable global fetch.');
            const originalFetch = globalObject.fetch;
            const originalXhr = globalObject.XMLHttpRequest;
            globalObject.fetch = gate.fetch;
            // XHR follows redirects without a portable pre-redirect interception hook. Fail closed;
            // controlled catalog acceptance must use the guarded global fetch above.
            globalObject.XMLHttpRequest = class BlockedXmlHttpRequest {
                constructor() { throw new Error('No-spend UAT blocked XHR because redirects cannot be safely intercepted.'); }
            };
            return () => {
                globalObject.fetch = originalFetch;
                if (originalXhr === undefined) delete globalObject.XMLHttpRequest;
                else globalObject.XMLHttpRequest = originalXhr;
            };
        },
    };
    return gate;
}

export async function runControlledNoSpendUat({ installInterception, actions, globalObject = globalThis } = {}) {
    if (typeof installInterception !== 'function' || typeof actions !== 'function') throw new TypeError('UAT gate and actions are required.');
    const gate = installInterception();
    if (!gate || typeof gate.install !== 'function') throw new TypeError('UAT interception was not installed.');
    const restore = gate.install(globalObject);
    try {
        await actions();
        return { requests: [...gate.requests] };
    } finally {
        restore();
    }
}
