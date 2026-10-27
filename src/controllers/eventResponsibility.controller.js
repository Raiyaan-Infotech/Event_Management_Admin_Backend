const service = require('../services/eventResponsibility.service');
const guestOption = require('./guestOption.controller');

/** Contact Person responsibilities. Behaviour lives in guestOption.controller.js. */
module.exports = guestOption.build({
    service,
    resourceKey: 'responsibility',
    label: 'responsibility',
});
