/**
 * MSG91 WhatsApp OTP sender — payload shape and every failure path.
 *
 * Runs fully offline: `axios.post` is replaced, so nothing here sends a real
 * WhatsApp message, spends credit, or needs credentials. That is the point —
 * the contract can be checked on any machine, and the one thing that cannot be
 * asserted offline (that MSG91 accepts the template) is called out at the end.
 */
const axios = require('axios');

const msg91 = require('../src/services/msg91Whatsapp.service');

let passed = 0;
let failed = 0;

const ok = (name, cond, extra = '') => {
    if (cond) {
        passed += 1;
        console.log(`  PASS  ${name}`);
    } else {
        failed += 1;
        console.log(`  FAIL  ${name}${extra ? `  ${extra}` : ''}`);
    }
};

/** Swap in a fake transport; returns the captured request. */
const withAxios = async (impl, fn) => {
    const real = axios.post;
    const captured = { calls: [] };
    axios.post = async (url, body, opts) => {
        captured.calls.push({ url, body, opts });
        return impl(url, body, opts);
    };
    try {
        captured.result = await fn();
    } finally {
        axios.post = real;
    }
    return captured;
};

const env = (vars) => {
    const prev = {};
    for (const [k, v] of Object.entries(vars)) {
        prev[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    return () => {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    };
};

const CONFIGURED = {
    MSG91_WA_AUTHKEY: 'test-authkey',
    MSG91_OTP_TEMPLATE: 'otp_template',
    MSG91_WA_NUMBER: '919999888877',
    MSG91_WA_NAMESPACE: undefined,
    MSG91_WA_LANG: undefined,
    MSG91_OTP_BUTTON: undefined,
};

const OK_RESPONSE = { status: 200, data: { type: 'success', message: 'queued' } };

(async () => {
    console.log('\nMSG91 WhatsApp OTP\n');

    /* ── Not configured ──────────────────────────────────────────────────── */
    {
        const restore = env({
            MSG91_WA_AUTHKEY: undefined,
            MSG91_OTP_TEMPLATE: undefined,
            MSG91_WA_NUMBER: undefined,
        });
        ok('unconfigured -> isConfigured() false', msg91.isConfigured() === false);

        const cap = await withAxios(
            () => OK_RESPONSE,
            () => msg91.sendOtp({ dialCode: '+91', mobile: '9884699435', code: '123456' }),
        );
        ok('unconfigured -> no HTTP call at all', cap.calls.length === 0);
        ok('unconfigured -> delivered false', cap.result.delivered === false);
        ok("unconfigured -> reason 'not_configured'", cap.result.reason === 'not_configured');
        restore();
    }

    /* ── The happy path, and the exact payload ───────────────────────────── */
    {
        const restore = env(CONFIGURED);
        ok('configured -> isConfigured() true', msg91.isConfigured() === true);

        const cap = await withAxios(
            () => OK_RESPONSE,
            () => msg91.sendOtp({
                dialCode: '+91', mobile: '9884699435', code: '123456', purpose: 'login',
            }),
        );

        const { url, body, opts } = cap.calls[0] || {};
        const tpl = body?.payload?.template;
        const entry = tpl?.to_and_components?.[0];

        ok('posts to the documented bulk endpoint', url === msg91.ENDPOINT, url);
        ok('authkey goes in the header, not the body',
            opts?.headers?.authkey === 'test-authkey' && !JSON.stringify(body).includes('test-authkey'));
        ok('content-type json', opts?.headers?.['Content-Type'] === 'application/json');
        ok('has a timeout', typeof opts?.timeout === 'number' && opts.timeout > 0);
        ok('reads the body on 4xx (validateStatus always true)',
            typeof opts?.validateStatus === 'function' && opts.validateStatus(400) === true);

        ok('integrated_number is the WA number', body?.integrated_number === '919999888877');
        ok("content_type 'template'", body?.content_type === 'template');
        ok("messaging_product 'whatsapp'", body?.payload?.messaging_product === 'whatsapp');
        ok('template name from MSG91_OTP_TEMPLATE', tpl?.name === 'otp_template');
        ok("language defaults to 'en' + deterministic policy",
            tpl?.language?.code === 'en' && tpl?.language?.policy === 'deterministic');
        ok('namespace OMITTED when unset', !('namespace' in (tpl || {})));
        ok('recipient is cc+number, no plus', JSON.stringify(entry?.to) === JSON.stringify(['919884699435']));
        ok('code goes in body_1', entry?.components?.body_1?.value === '123456');
        ok('code also in button_1 (copy-code) by default',
            entry?.components?.button_1?.value === '123456'
            && entry?.components?.button_1?.subtype === 'url');

        ok('delivered true on success', cap.result.delivered === true);
        ok('no reason on success', cap.result.reason === null);
        restore();
    }

    /* ── Optional knobs ──────────────────────────────────────────────────── */
    {
        const restore = env({
            ...CONFIGURED,
            MSG91_WA_NAMESPACE: 'ns-abc',
            MSG91_WA_LANG: 'en_US',
            MSG91_OTP_BUTTON: 'false',
        });
        const cap = await withAxios(
            () => OK_RESPONSE,
            () => msg91.sendOtp({ dialCode: '+91', mobile: '9884699435', code: '111222' }),
        );
        const tpl = cap.calls[0].body.payload.template;
        ok('namespace SENT when set', tpl.namespace === 'ns-abc');
        ok('language override honoured', tpl.language.code === 'en_US');
        ok('button_1 dropped when MSG91_OTP_BUTTON=false',
            !('button_1' in tpl.to_and_components[0].components));
        ok('body_1 still present without the button',
            tpl.to_and_components[0].components.body_1.value === '111222');
        restore();
    }

    /* ── Failure paths: none may throw ───────────────────────────────────── */
    {
        const restore = env(CONFIGURED);

        // MSG91 answers 200 with type:error for an unapproved template.
        let cap = await withAxios(
            () => ({ status: 200, data: { type: 'error', message: 'template not approved' } }),
            () => msg91.sendOtp({ dialCode: '+91', mobile: '9884699435', code: '1' }),
        );
        ok('200 + type:error is NOT delivered', cap.result.delivered === false);
        ok('carries MSG91 message as the reason', cap.result.reason === 'template not approved');

        cap = await withAxios(
            () => ({ status: 401, data: { message: 'bad authkey' } }),
            () => msg91.sendOtp({ dialCode: '+91', mobile: '9884699435', code: '1' }),
        );
        ok('401 not delivered, reason kept', cap.result.delivered === false && cap.result.reason === 'bad authkey');

        cap = await withAxios(
            () => { const e = new Error('timeout of 10000ms exceeded'); e.code = 'ECONNABORTED'; throw e; },
            () => msg91.sendOtp({ dialCode: '+91', mobile: '9884699435', code: '1' }),
        );
        ok("timeout -> reason 'timeout', no throw", cap.result.delivered === false && cap.result.reason === 'timeout');

        cap = await withAxios(
            () => { throw new Error('getaddrinfo ENOTFOUND'); },
            () => msg91.sendOtp({ dialCode: '+91', mobile: '9884699435', code: '1' }),
        );
        ok("network error -> reason 'network', no throw",
            cap.result.delivered === false && cap.result.reason === 'network');

        cap = await withAxios(
            () => OK_RESPONSE,
            () => msg91.sendOtp({ dialCode: '+91', mobile: '', code: '1' }),
        );
        ok('empty number -> no HTTP call', cap.calls.length === 0);
        ok("empty number -> reason 'no_number'", cap.result.reason === 'no_number');
        restore();
    }

    console.log(`\n${passed} passed, ${failed} failed\n`);
    console.log('NOT covered offline: that MSG91 accepts the template and Meta');
    console.log('delivers it. Authentication templates need business verification,');
    console.log('and an unapproved one comes back as 200 + type:error (asserted above).\n');
    process.exit(failed ? 1 : 0);
})();
