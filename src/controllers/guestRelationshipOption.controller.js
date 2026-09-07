const service = require('../services/guestRelationshipOption.service');
const guestOption = require('./guestOption.controller');

/** "Relationship with Invitor" options. Behaviour lives in guestOption.controller.js. */
module.exports = guestOption.build({
    service,
    resourceKey: 'relationshipOption',
    label: 'relationship option',
});
