const { EventResponsibility } = require('../models');
const guestOption = require('./guestOption.service');

/**
 * Menu Management → Responsibilities (Jamal, 2026-10-27): the Contact Person
 * responsibilities per event category. Behaviour lives in
 * guestOption.service.js (same table shape, same rules).
 */
module.exports = guestOption.build({
    Model: EventResponsibility,
    modelName: 'EventResponsibility',
    moduleSlug: 'event_responsibilities',
    label: 'responsibility',
});
