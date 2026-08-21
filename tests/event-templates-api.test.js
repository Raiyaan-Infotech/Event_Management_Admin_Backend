/**
 * End-to-end smoke test for /api/v1/event-templates against the running local
 * backend. Logs in as the seeded admin, then exercises every route.
 *
 *   node test_templates_api.js
 */
const BASE = 'http://localhost:5001/api/v1';

let cookie = '';

async function call(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, json };
}

const ok = (label, cond, extra = '') =>
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);

(async () => {
    const email = process.argv[2] || 'admin@admin.com';
    const password = process.argv[3] || '123456';

    const login = await call('POST', '/auth/login', { email, password });
    ok('login', login.status === 200, `status ${login.status} ${login.json?.message ?? ''}`);
    if (login.status !== 200) return;

    // Taxonomy the template needs — pick a real (category, type) pair, since the
    // service rejects a type that does not belong to its category.
    const cats = await call('GET', '/event-categories?limit=50&is_active=true');
    const categories = cats.json?.data ?? [];
    let categoryId = null;
    let typeId = null;
    for (const c of categories) {
        const types = await call('GET', `/event-types?limit=50&is_active=true&event_category_id=${c.id}`);
        if ((types.json?.data ?? []).length) {
            categoryId = c.id;
            typeId = types.json.data[0].id;
            break;
        }
    }
    ok('found a category/type pair', !!categoryId && !!typeId, `cat ${categoryId} type ${typeId}`);
    if (!categoryId) return;

    /* ---------------------------------------------------------- create -- */
    const created = await call('POST', '/event-templates', {
        name: 'Floral Wedding Classic',
        code: 'FWE-001',
        event_category_id: categoryId,
        event_type_id: typeId,
        style: 'floral',
        tags: ['wedding', 'floral', 'wedding'],           // duplicate on purpose
        description: 'A soft floral invitation.',
        background_type: 'color',
        background_color: '#fff7f0',
        secondary_color: 'not-a-colour',                   // must land as null
        overlay_opacity: 250,                              // must clamp to 100
        primary_font: 'Playfair Display',
        secondary_font: 'Poppins',
        border_style: 'ornate',
        components: { venue: 0, social_icons: 0 },         // partial map
        component_order: ['venue', 'bogus_key', 'date_time'],
        permissions: { colors: 0 },
        status: 'published',
        is_active: true,
        is_featured: true,
        available_for: ['both'],
        plan_availability: 'selected',
        plan_ids: [],                                      // empty -> falls back to all
        sort_order: '12',
        pricing_type: 'premium',                           // removed field, must be dropped
        price: 999,
    });
    const t = created.json?.data?.template;
    ok('create', created.status === 201, `status ${created.status} ${created.json?.message ?? ''}`);
    if (!t) { console.log(JSON.stringify(created.json, null, 2)); return; }

    ok('code slugified', t.code === 'fwe-001', t.code);
    ok('tags de-duplicated', JSON.stringify(t.tags) === '["wedding","floral"]', JSON.stringify(t.tags));
    ok('bad hex -> null', t.secondary_color === null, String(t.secondary_color));
    ok('overlay clamped to 100', t.overlay_opacity === 100, String(t.overlay_opacity));
    ok('components map complete (12 keys)', Object.keys(t.components).length === 12);
    ok('venue off, event_title defaulted on', t.components.venue === 0 && t.components.event_title === 1);
    ok('order is a full permutation (12)', t.component_order.length === 12, t.component_order.slice(0, 4).join(','));
    ok('order honours the sent prefix', t.component_order[0] === 'venue' && t.component_order[1] === 'date_time');
    ok('bogus order key dropped', !t.component_order.includes('bogus_key'));
    ok('permissions map complete (15 keys)', Object.keys(t.permissions).length === 15);
    ok('permissions.colors off', t.permissions.colors === 0);
    ok('"both" expanded to two audiences',
        JSON.stringify(t.available_for) === '["individual","company"]', JSON.stringify(t.available_for));
    ok('selected+empty fell back to all', t.plan_availability === 'all', t.plan_availability);
    ok('pricing fields NOT stored', t.pricing_type === undefined && t.price === undefined);
    ok('joins resolved', !!t.category && !!t.eventType, `${t.category?.name} / ${t.eventType?.name}`);

    /* -------------------------------------------------- duplicate code -- */
    const dupeCode = await call('POST', '/event-templates', {
        name: 'Another One',
        code: 'FWE-001',
        event_category_id: categoryId,
        event_type_id: typeId,
    });
    ok('duplicate code gets a suffix',
        dupeCode.json?.data?.template?.code === 'fwe-001-2',
        dupeCode.json?.data?.template?.code);

    /* ------------------------------------------------------ validation -- */
    const noName = await call('POST', '/event-templates', { code: 'x', event_category_id: categoryId, event_type_id: typeId });
    ok('name required', noName.status === 400, noName.json?.message);

    const noCat = await call('POST', '/event-templates', { name: 'X' });
    ok('category required', noCat.status === 400, noCat.json?.message);

    // A type from a DIFFERENT category must be refused.
    const otherType = await call('GET', '/event-types?limit=50');
    const mismatched = (otherType.json?.data ?? []).find((x) => x.event_category_id !== categoryId);
    if (mismatched) {
        const bad = await call('POST', '/event-templates', {
            name: 'Mismatch', event_category_id: categoryId, event_type_id: mismatched.id,
        });
        ok('type must belong to category', bad.status === 400, bad.json?.message);
    }

    /* ------------------------------------------------------------ read -- */
    const list = await call('GET', '/event-templates?limit=50');
    ok('list', list.status === 200, `${(list.json?.data ?? []).length} rows`);

    const stats = await call('GET', '/event-templates/stats');
    const s = stats.json?.data?.stats;
    ok('stats (not matched as an id)', stats.status === 200, JSON.stringify(s));
    ok('stats total == active + inactive', s && s.total === s.active + s.inactive);

    const one = await call('GET', `/event-templates/${t.id}`);
    ok('get by id', one.status === 200 && one.json?.data?.template?.id === t.id);

    const filtered = await call('GET', `/event-templates?status=active&event_category_id=${categoryId}`);
    ok('filter status=active', filtered.status === 200, `${(filtered.json?.data ?? []).length} rows`);

    const draftFilter = await call('GET', '/event-templates?status=draft');
    ok('filter status=draft', draftFilter.status === 200, `${(draftFilter.json?.data ?? []).length} rows`);

    const searched = await call('GET', '/event-templates?search=Floral');
    ok('search', (searched.json?.data ?? []).some((r) => r.id === t.id));

    /* ---------------------------------------------------------- update -- */
    const renamed = await call('PUT', `/event-templates/${t.id}`, { name: 'Floral Wedding Renamed' });
    ok('rename does NOT change the code',
        renamed.json?.data?.template?.code === 'fwe-001',
        renamed.json?.data?.template?.code);

    const partial = await call('PUT', `/event-templates/${t.id}`, { components: { event_photos: 0 } });
    const pc = partial.json?.data?.template?.components;
    ok('partial component map keeps the others on', pc?.event_photos === 0 && pc?.event_title === 1);

    const statusRes = await call('PATCH', `/event-templates/${t.id}/status`, { is_active: false });
    ok('patch status', Number(statusRes.json?.data?.template?.is_active) === 0);

    const featRes = await call('PATCH', `/event-templates/${t.id}/featured`, { is_featured: false });
    ok('patch featured', Number(featRes.json?.data?.template?.is_featured) === 0);

    /* ------------------------------------------------------- duplicate -- */
    const dup = await call('POST', `/event-templates/${t.id}/duplicate`);
    const d = dup.json?.data?.template;
    ok('duplicate', dup.status === 201 && d?.name?.endsWith('(Copy)'), d?.name);
    ok('the copy is a draft', d?.status === 'draft', d?.status);
    ok('the copy is not featured', Number(d?.is_featured) === 0);

    /* --------------------------------------------------------- reorder -- */
    const reord = await call('PATCH', '/event-templates/reorder', {
        items: [{ id: t.id, sort_order: 5 }, { id: d.id, sort_order: 6 }],
    });
    ok('reorder', reord.status === 200 && reord.json?.data?.updated === 2, JSON.stringify(reord.json?.data));

    /* ---------------------------------------------------------- delete -- */
    for (const victim of [t.id, d.id, dupeCode.json?.data?.template?.id].filter(Boolean)) {
        await call('DELETE', `/event-templates/${victim}`);
    }
    const gone = await call('GET', `/event-templates/${t.id}`);
    ok('deleted row is gone (soft delete)', gone.status === 404, `status ${gone.status}`);

    // The code freed by a soft delete must be reusable — the whole reason it is
    // not a UNIQUE index.
    const reuse = await call('POST', '/event-templates', {
        name: 'Reuse Code', code: 'FWE-001', event_category_id: categoryId, event_type_id: typeId,
    });
    ok('a soft-deleted code is reusable',
        reuse.json?.data?.template?.code === 'fwe-001',
        reuse.json?.data?.template?.code);
    if (reuse.json?.data?.template?.id) {
        await call('DELETE', `/event-templates/${reuse.json.data.template.id}`);
    }

    console.log('\ndone.');
})().catch((e) => { console.error(e); process.exit(1); });
