const { GuestFoodPreferenceOption } = require('../models');
const guestOption = require('./guestOption.service');

/**
 * "Food Preference" — the dropdown on step 1 of the mobile app's guest
 * registration form.
 *
 * All behaviour lives in guestOption.service.js; this file exists to bind it to
 * one model, one permission slug and one set of error words.
 */
module.exports = guestOption.build({
    Model: GuestFoodPreferenceOption,
    modelName: 'GuestFoodPreferenceOption',
    moduleSlug: 'guest_food_preference_options',
    label: 'food preference',
});
