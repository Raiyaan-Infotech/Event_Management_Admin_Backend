const {
    Sequelize,
    WebsiteClient,
    SubscriptionPlan,
    SubscriptionPlanMenu,
    EventMenu,
    EventCategory,
    EventType,
    Religion,
    EventTemplate,
    FrameStyle,
    Decoration,
} = require('../models');
const { Op } = Sequelize;

/**
 * What a signed-in website client is allowed to see and do in the portal.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 * The client's SUBSCRIPTION PLAN is the gatekeeper, not the raw catalogue:
 *
 *   subscription_plans        scoped by (event_category_id, event_type_id,
 *                             religion_id) — NULL on any one means "all"
 *   subscription_plan_menus   the exact menus that plan grants
 *
 * So the Create Event wizard must offer the plan's scope, not every taxonomy
 * row, and the plan's menus, not the whole event_menus catalogue. Otherwise a
 * client on a 2-menu Basic plan is offered all 16.
 *
 * A client with NO plan gets nothing to choose from and an explicit reason,
 * rather than silently falling back to everything.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PLAN_ATTRS = [
    'id', 'name', 'plan_code', 'billing_cycle', 'short_description',
    'event_category_id', 'event_type_id', 'religion_id',
    'currency_code', 'price', 'trial_days', 'is_active',
];

const TAXONOMY_ATTRS = ['id', 'name', 'description', 'icon', 'color', 'sort_order', 'is_active'];

/** Only live, active rows — a client must never be offered a disabled option. */
const activeWhere = (companyId, extra = {}) => ({
    is_active: 1,
    ...(companyId ? { company_id: companyId } : {}),
    ...extra,
});

/**
 * The invitation-template columns the wizard's theme picker needs.
 *
 * Deliberately NOT the whole row: `permissions`, `custom_css` and the audit
 * columns are the admin's business, and shipping them to every client on every
 * wizard load is bytes nobody reads.
 */
const TEMPLATE_ATTRS = [
    'id', 'name', 'code', 'description', 'style', 'layout_style', 'thumbnail',
    'background_type', 'background_color', 'secondary_color', 'background_image',
    'gradient_from', 'gradient_via', 'gradient_to', 'gradient_type', 'gradient_direction',
    'overlay_enabled', 'overlay_color', 'overlay_opacity',
    'image_position', 'image_scale', 'image_shape', 'corner_radius',
    'background_position', 'image_size',
    'orientation', 'dimension',
    'primary_font', 'secondary_font', 'border_style',
    // Without these two the portal cannot draw the frame or the decorations at
    // all — it was rendering a bare colour where the admin's own preview showed
    // an arch, a toran and a mosque silhouette, and the two previews of the SAME
    // template disagreed completely.
    'frame_style_id', 'decoration_ids',
    'components', 'component_order',
    'event_category_id', 'event_type_id', 'religion_id',
    'is_featured', 'sort_order',
];

/**
 * Read to decide entitlement, then STRIPPED before the row is returned.
 *
 * They have to be selected or the filter below reads `undefined` on every row
 * and quietly passes everything — a gate that is present in the code and absent
 * at runtime. They must not be RETURNED, because which plans a template is
 * restricted to is the admin's business, not a browsable list for the client.
 */
const TEMPLATE_GATE_ATTRS = ['available_for', 'plan_availability', 'plan_ids'];

/**
 * Which admin-authored templates this client's PLAN entitles them to.
 *
 * Same rule as the taxonomy above: the plan is the gatekeeper. On top of that a
 * template must be BOTH published and active — those are two separate questions
 * (see the event_templates migration), and a draft must never reach a client
 * however active it is.
 *
 * ── TWO GATES THAT CANNOT BE FULLY ENFORCED YET, AND WHY ─────────────────────
 *
 * 1. `available_for` (Individual Clients / Event Management Companies).
 *    `website_clients` has NO account-type column, so there is nothing to
 *    compare against. A template naming EITHER audience is therefore offered.
 *    What IS enforced is the honest half: `available_for: []` means the admin
 *    said nobody, so it is offered to nobody. Per-audience gating needs a
 *    column on website_clients first — adding a guess here would silently hide
 *    templates from half the accounts on a rule nobody set.
 *
 * 2. `plan_availability: 'trial'`.
 *    There is no `trial_ends_at` on website_clients, so "is this client in
 *    their trial right now" is unanswerable. Evaluated at PLAN level instead —
 *    offered when the plan grants a trial at all. Excluding it outright would
 *    make the admin's third radio button do nothing at all, which is worse.
 */
/**
 * Turn `frame_style_id` and `decoration_ids` into the artwork URLs a preview
 * can actually draw, for the WHOLE page in two queries.
 *
 * Neither is a foreign key Sequelize can join on — `decoration_ids` is a JSON
 * array — so this batches by hand. Per row it would be two queries per
 * template: ten templates, twenty round trips, ~374ms each against production.
 *
 * Decoration order comes from the stored array, not the query, because the
 * array IS the display order. Ids that no longer resolve simply do not appear,
 * which is why a deleted decoration degrades to "no artwork" rather than an
 * error. Mirrors `attachDecorations` in eventTemplate.service.js.
 */
const attachArtwork = async (rows, companyId) => {
    const frameIds = [...new Set(rows.map((r) => r.frame_style_id).filter(Boolean))];
    const decoIds = [...new Set(rows.flatMap((r) => r.decoration_ids ?? []))];

    const [frames, decos] = await Promise.all([
        frameIds.length
            ? FrameStyle.findAll({
                where: { id: frameIds, is_active: 1 },
                attributes: ['id', 'name', 'file_url'],
                raw: true,
            })
            : [],
        decoIds.length
            ? Decoration.findAll({
                where: {
                    id: decoIds,
                    is_active: 1,
                    ...(companyId ? { company_id: companyId } : {}),
                },
                attributes: ['id', 'name', 'type', 'file_url'],
                raw: true,
            })
            : [],
    ]);

    const frameById = new Map(frames.map((f) => [f.id, f]));
    const decoById = new Map(decos.map((d) => [d.id, d]));

    for (const row of rows) {
        // Named `frame_url` and `decorationItems` to match what the preview
        // components already expect, so nothing has to re-map them client-side.
        row.frame_url = frameById.get(row.frame_style_id)?.file_url ?? null;
        row.decorationItems = (row.decoration_ids ?? [])
            .map((id) => decoById.get(id))
            .filter(Boolean);
    }

    return rows;
};

const templatesForPlan = async (companyId, plan) => {
    const where = {
        is_active: 1,
        status: 'published',
        ...(companyId ? { company_id: companyId } : {}),
    };

    // A NULL scope column on the PLAN means "all", so each narrowing is applied
    // only when the plan actually names a value — matching the taxonomy above.
    // A NULL scope column on the TEMPLATE also means "all", which is why every
    // one of these is an OR against NULL rather than a plain equals: a general
    // template must not be filtered out by a plan that names a category.
    const scope = [];
    if (plan.event_category_id) {
        scope.push({ [Op.or]: [{ event_category_id: null }, { event_category_id: plan.event_category_id }] });
    }
    if (plan.event_type_id) {
        scope.push({ [Op.or]: [{ event_type_id: null }, { event_type_id: plan.event_type_id }] });
    }
    if (plan.religion_id) {
        scope.push({ [Op.or]: [{ religion_id: null }, { religion_id: plan.religion_id }] });
    }
    if (scope.length) where[Op.and] = scope;

    const rows = await EventTemplate.findAll({
        where,
        attributes: [...TEMPLATE_ATTRS, ...TEMPLATE_GATE_ATTRS],
        order: [['is_featured', 'DESC'], ['sort_order', 'ASC'], ['id', 'ASC']],
    });

    const hasTrial = Number(plan.trial_days) > 0;

    const entitled = rows
        .map((r) => r.toJSON())
        .filter((t) => {
            // available_for: [] is the admin saying nobody. See the note above.
            const audiences = Array.isArray(t.available_for) ? t.available_for : null;
            if (audiences && audiences.length === 0) return false;

            if (t.plan_availability === 'selected') {
                const ids = Array.isArray(t.plan_ids) ? t.plan_ids.map(Number) : [];
                return ids.includes(Number(plan.id));
            }
            if (t.plan_availability === 'trial') return hasTrial;
            return true; // 'all'
        })
        .map((t) => {
            for (const key of TEMPLATE_GATE_ATTRS) delete t[key];
            return t;
        });

    // Only for the templates that SURVIVED the gating — resolving artwork for
    // rows the client will never see would be work done to be thrown away.
    return attachArtwork(entitled, companyId);
};

/**
 * The signed-in client, with the plan joined.
 *
 * `defaultScope` on the model already drops the password and OTP columns, so
 * this is safe to return to the browser as-is.
 */
const getMe = async (clientId) => {
    const client = await WebsiteClient.findByPk(clientId);
    if (!client) return null;

    const plain = client.toJSON();
    plain.plan = null;

    if (client.subscription_plan_id) {
        const plan = await SubscriptionPlan.findByPk(client.subscription_plan_id, {
            attributes: PLAN_ATTRS,
        });
        // A plan that has since been deactivated is reported rather than
        // hidden: the client needs to know why their options vanished.
        if (plan) plain.plan = plan.toJSON();
    }

    return plain;
};

/**
 * Everything the Create Event wizard needs, derived from the client's plan.
 *
 * Returns the taxonomy narrowed to the plan's scope and only the menus the
 * plan grants. One request rather than four, because every part of it comes
 * from the same plan lookup and the wizard needs all of it at once.
 */
const getEventOptions = async (clientId) => {
    const client = await WebsiteClient.findByPk(clientId);
    if (!client) {
        return { plan: null, reason: 'Account not found.', categories: [], types: [], religions: [], menus: [], templates: [] };
    }

    const companyId = client.company_id ?? null;

    if (!client.subscription_plan_id) {
        return {
            plan: null,
            reason: 'No subscription plan is assigned to your account yet. Please contact us.',
            categories: [], types: [], religions: [], menus: [], templates: [],
        };
    }

    const plan = await SubscriptionPlan.findByPk(client.subscription_plan_id, { attributes: PLAN_ATTRS });
    if (!plan) {
        return {
            plan: null,
            reason: 'Your subscription plan is no longer available. Please contact us.',
            categories: [], types: [], religions: [], menus: [], templates: [],
        };
    }
    if (Number(plan.is_active) !== 1) {
        return {
            plan: plan.toJSON(),
            reason: 'Your subscription plan is inactive. Please contact us.',
            categories: [], types: [], religions: [], menus: [], templates: [],
        };
    }

    // A NULL scope column on the plan means "all", which is why each filter is
    // applied only when the plan actually names a value.
    const catWhere = activeWhere(companyId);
    if (plan.event_category_id) catWhere.id = plan.event_category_id;

    const categories = await EventCategory.findAll({
        where: catWhere, attributes: TAXONOMY_ATTRS, order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });

    const typeWhere = activeWhere(companyId);
    if (plan.event_type_id) typeWhere.id = plan.event_type_id;
    else if (plan.event_category_id) typeWhere.event_category_id = plan.event_category_id;

    const types = await EventType.findAll({
        where: typeWhere, attributes: [...TAXONOMY_ATTRS, 'event_category_id'],
        order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });

    const relWhere = activeWhere(companyId);
    if (plan.religion_id) relWhere.id = plan.religion_id;
    else {
        if (plan.event_category_id) relWhere.event_category_id = plan.event_category_id;
        if (plan.event_type_id) relWhere.event_type_id = plan.event_type_id;
    }

    const religions = await Religion.findAll({
        where: relWhere, attributes: [...TAXONOMY_ATTRS, 'event_category_id', 'event_type_id'],
        order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });

    // The menus the PLAN grants — not the catalogue. Read through the join so a
    // menu the admin later deselects from the plan disappears here too.
    const grants = await SubscriptionPlanMenu.findAll({
        where: { plan_id: plan.id },
        attributes: ['menu_id', 'sort_order'],
    });
    const menuIds = grants.map((g) => g.menu_id);

    const menus = menuIds.length
        ? await EventMenu.findAll({
            where: activeWhere(companyId, { id: { [Op.in]: menuIds } }),
            attributes: [...TAXONOMY_ATTRS, 'slug', 'menu_group'],
            order: [['sort_order', 'ASC'], ['id', 'ASC']],
        })
        : [];

    // The admin-authored invitation templates this plan entitles them to. The
    // wizard narrows these further by the category/type actually chosen in
    // step 1 — done there rather than here so changing the category does not
    // cost a round trip mid-wizard.
    const templates = await templatesForPlan(companyId, plan);

    return {
        plan: plan.toJSON(),
        reason: menus.length ? null : 'Your plan does not include any menus yet. Please contact us.',
        categories: categories.map((r) => r.toJSON()),
        types: types.map((r) => r.toJSON()),
        religions: religions.map((r) => r.toJSON()),
        menus: menus.map((r) => r.toJSON()),
        templates,
    };
};

/**
 * Replace the client's favourite templates.
 *
 * Takes the whole list rather than a toggle: the caller already knows the
 * resulting set, and a toggle endpoint races itself when two hearts are clicked
 * quickly — both requests read the same starting list and the second overwrites
 * the first.
 *
 * Ids are validated only for SHAPE. The template catalogue lives in the
 * frontend (nothing in the DB references it), so checking membership here would
 * mean a backend deploy every time a template is added.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/i;

const setFavouriteTemplates = async (clientId, ids) => {
    const client = await WebsiteClient.findByPk(clientId);
    if (!client) return null;

    const clean = [...new Set(
        (Array.isArray(ids) ? ids : [])
            .filter((id) => typeof id === 'string' && SLUG.test(id))
    )].slice(0, 100); // a bounded list cannot be used to stuff the row

    await client.update({ favourite_templates: clean });
    return clean;
};

module.exports = { getMe, getEventOptions, setFavouriteTemplates };
