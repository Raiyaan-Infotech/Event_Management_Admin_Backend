const service = require('../services/guestFoodPreferenceOption.service');
const guestOption = require('./guestOption.controller');

/** "Food Preference" options. Behaviour lives in guestOption.controller.js. */
module.exports = guestOption.build({
    service,
    resourceKey: 'foodPreferenceOption',
    label: 'food preference option',
});
