/**
 * Where a menu appears — decided by the menu itself, not by a column.
 *
 * `menu_group` used to carry this ('app' / 'portal' / 'core'), which meant an
 * admin could silently move "Guests" into the event wizard by editing a
 * dropdown. Placement is a property of the feature — Chat is a mobile tile, the
 * guest register is a portal section — so it lives here, and `menu_group` is
 * back to being a plain Core / Add-on label.
 *
 * Anything not listed here is an ordinary event menu: offered by the create
 * event wizard and stored on the event.
 */

/** Tiles in the mobile app. Granted by the plan, switched per event (§549). */
const APP_FEATURE_SLUGS = [
    'participants',
    'family',
    'wishes',
    'near-by',
    'downloads',
    'chat',
    'invite-share',
    'social-wall',
];

/** Sidebar sections of the client portal — never per-event choices. */
const PORTAL_SECTION_SLUGS = ['guests', 'messages', 'splash-screens'];

const isAppFeature = (slug) => APP_FEATURE_SLUGS.includes(String(slug));
const isPortalSection = (slug) => PORTAL_SECTION_SLUGS.includes(String(slug));

/** An event menu is everything that is neither of the above. */
const isEventMenu = (slug) => !isAppFeature(slug) && !isPortalSection(slug);

module.exports = {
    APP_FEATURE_SLUGS,
    PORTAL_SECTION_SLUGS,
    isAppFeature,
    isPortalSection,
    isEventMenu,
};
