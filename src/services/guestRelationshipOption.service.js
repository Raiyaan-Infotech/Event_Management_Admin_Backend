const { GuestRelationshipOption } = require('../models');
const guestOption = require('./guestOption.service');

/**
 * "Relationship with Invitor" — the dropdown on step 1 of the mobile app's
 * guest registration form.
 *
 * All behaviour lives in guestOption.service.js; this file exists to bind it to
 * one model, one permission slug and one set of error words. See that file's
 * header for why the two lists share an implementation.
 */
module.exports = guestOption.build({
    Model: GuestRelationshipOption,
    modelName: 'GuestRelationshipOption',
    moduleSlug: 'guest_relationship_options',
    label: 'relationship',
});
