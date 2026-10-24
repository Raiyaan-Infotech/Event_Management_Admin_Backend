/**
 * Near By (2026-10-24) — the pure parts of clientNearby.service: settings
 * defaults, save validation, distance, sorting, cache key. No server, no
 * Google call, writes nothing.
 *
 *   node tests/nearby-settings.test.js
 */
require('dotenv').config();
const { _internal: n } = require('../src/services/clientNearby.service');

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
    if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}`); }
};
const throws = (name, fn, text) => {
    try { fn(); ok(name, false); } catch (e) { ok(`${name} — "${e.message}"`, !text || e.message.includes(text)); }
};

console.log('\nNear By');

// Defaults: never saved = the design's five suggested chips, 3 km, nearest first.
const d = n.settingsOf({ nearby_settings: null });
ok('unsaved = suggested categories', d.categories.join() === 'bus_stop,atm,hospital,hotel,parking');
ok('unsaved = 3 km, distance, saved false', d.radius_km === 3 && d.sort === 'distance' && d.saved === false);
const s = n.settingsOf({ nearby_settings: { categories: ['atm', 'bogus'], radius_km: 7, sort: 'x' } });
ok('saved: unknown category dropped, bad radius/sort fall back', s.categories.join() === 'atm' && s.radius_km === 3 && s.sort === 'distance' && s.saved);

// Save validation.
const c = n.cleanSettings({ categories: ['parking', 'atm', 'atm'], radius_km: 5, sort: 'rating' });
ok('save: deduped and in the design order', c.categories.join() === 'atm,parking' && c.radius_km === 5 && c.sort === 'rating');
throws('save: none chosen', () => n.cleanSettings({ categories: [] }), 'at least one');
throws('save: more than 10', () => n.cleanSettings({ categories: [...n.CATEGORIES.map((x) => x.key), 'atm', 'extra'] }), 'up to 10');
throws('save: unknown category', () => n.cleanSettings({ categories: ['casino'] }), 'not available');
throws('save: radius not in list', () => n.cleanSettings({ categories: ['atm'], radius_km: 2 }), 'radius');
throws('save: unknown sort', () => n.cleanSettings({ categories: ['atm'], sort: 'random' }), 'sort');
ok('ten categories offered', n.CATEGORIES.length === 10);

// Distance: MG Road → Bangalore Palace is about 2.6 km.
const km = n.distanceKm(12.9716, 77.5946, 12.9988, 77.5921);
ok(`distance ≈ 3 km (${km})`, km > 2.5 && km < 3.5);
ok('distance to itself = 0', n.distanceKm(12.97, 77.59, 12.97, 77.59) === 0);

// Venue: no pin / 0,0 = no location.
ok('venue without pin', n.venueOf({ venue_lat: null, venue_lng: null }).has_location === false);
ok('venue at 0,0 = no pin', n.venueOf({ venue_lat: '0.0000000', venue_lng: '0.0000000' }).has_location === false);
ok('venue with pin (DECIMAL strings)', n.venueOf({ venue_lat: '12.9716000', venue_lng: '77.5946000' }).lat === 12.9716);

ok('venue from map link ?q=', n.venueOf({ venue_map_link: 'https://maps.google.com/?q=13.0500,80.2824' }).lat === 13.05);
ok('venue from map link @lat,lng', n.coordsFromLink('https://www.google.com/maps/place/X/@12.97,77.59,15z')?.lng === 77.59);
ok('pin wins over link', n.venueOf({ venue_lat: '1.5', venue_lng: '2.5', venue_map_link: '?q=9,9' }).lat === 1.5);
ok('link without coords = no location', n.venueOf({ venue_map_link: 'https://maps.app.goo.gl/abc' }).has_location === false);

// Sorting.
const places = [
    { name: 'B', distance_km: 2, rating: 4.1 },
    { name: 'a', distance_km: 0.5, rating: null },
    { name: 'C', distance_km: 1, rating: 4.8 },
];
ok('sort distance', n.sortPlaces(places, 'distance').map((p) => p.name).join() === 'a,C,B');
ok('sort rating (no rating last)', n.sortPlaces(places, 'rating').map((p) => p.name).join() === 'C,B,a');
ok('sort name', n.sortPlaces(places, 'name').map((p) => p.name).join() === 'a,B,C');

// Cache key: tap order does not matter; radius / pin do.
const v = { lat: 12.9716, lng: 77.5946 };
ok('cache key ignores category order',
    n.cacheKeyOf(v, { radius_km: 3, categories: ['atm', 'hotel'] }) === n.cacheKeyOf(v, { radius_km: 3, categories: ['hotel', 'atm'] }));
ok('cache key changes with radius',
    n.cacheKeyOf(v, { radius_km: 3, categories: ['atm'] }) !== n.cacheKeyOf(v, { radius_km: 5, categories: ['atm'] }));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
