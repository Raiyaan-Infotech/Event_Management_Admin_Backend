const axios = require('axios');
const { Event, EventParticipant, EventNearbyCache } = require('../models');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

/**
 * Near By (Jamal's "Organizer Flow – Near By Location Setup", 2026-10-24).
 *
 * The organizer picks up to 10 kinds of place (Bus Stop, ATM, Hospital…), a
 * search radius and a sort order (`events.nearby_settings`); the places
 * themselves come from Google Places API (New) "Nearby Search" around the
 * event's venue pin (`venue_lat` / `venue_lng`) — one call per category.
 *
 * Calls are made HERE, never from the phone, so the key stays on the server
 * (`GOOGLE_MAPS_API_KEY`). The result is kept in `event_nearby_cache` (one
 * row per event) keyed by the pin + radius + categories, and reused for
 * [CACHE_DAYS] — guests opening Near By cost no Google call. Saving new
 * settings or moving the venue pin changes the key, so the next read fetches.
 *
 * Read: the organizer and the event's participants (participants get the
 * places only after the organizer has saved settings). Write: organizer only.
 */

const MAX_CATEGORIES = 10;
const RADII_KM = [1, 3, 5, 10];
const DEFAULT_RADIUS_KM = 3;
const SORTS = [
    { key: 'distance', label: 'Distance (Nearest First)' },
    { key: 'rating', label: 'Rating (Highest First)' },
    { key: 'name', label: 'Name (A to Z)' },
];
const CACHE_DAYS = 7;
/** Google's own cap per Nearby Search call. */
const PER_CATEGORY = 20;

/**
 * The categories the organizer can pick, in the design's order. `types` are
 * Places API (New) place types (Table A). `suggested` = picked on a page that
 * was never saved (the design's pre-selected chips).
 */
const CATEGORIES = [
    { key: 'bus_stop', label: 'Bus Stop', types: ['bus_station', 'bus_stop'], suggested: true },
    { key: 'atm', label: 'ATM', types: ['atm'], suggested: true },
    { key: 'school', label: 'School', types: ['school'] },
    { key: 'hospital', label: 'Hospital', types: ['hospital'], suggested: true },
    { key: 'restaurant', label: 'Restaurant', types: ['restaurant'] },
    { key: 'hotel', label: 'Hotel', types: ['hotel', 'lodging'], suggested: true },
    { key: 'petrol_bunk', label: 'Petrol Bunk', types: ['gas_station'] },
    { key: 'pharmacy', label: 'Pharmacy', types: ['pharmacy'] },
    { key: 'parking', label: 'Parking', types: ['parking'], suggested: true },
    { key: 'police_station', label: 'Police Station', types: ['police'] },
];
const CATEGORY_BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

const EVENT_ATTRS = [
    'id', 'website_client_id', 'venue_name', 'venue_address', 'venue_lat', 'venue_lng',
    'venue_map_link', 'nearby_settings',
];

// ── Helpers ─────────────────────────────────────────────────────────────────

// `Places_API` = the name used on Render (Jamal, 2026-10-24).
const apiKey = () => process.env.GOOGLE_MAPS_API_KEY
    || process.env.GOOGLE_PLACES_API_KEY
    || process.env.Places_API
    || '';

/** Distance in km between two points (haversine), 2 decimals. */
const distanceKm = (lat1, lng1, lat2, lng2) => {
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
};

/**
 * "lat,lng" out of a Google Maps link (`?q=13.05,80.28`, `@13.05,80.28,15z`,
 * `ll=` / `query=`) — older events have only the link, no pin.
 */
const coordsFromLink = (link) => {
    const m = String(link || '').match(/(?:[?&](?:q|query|ll|destination)=|@)(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/);
    if (!m) return null;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};

const venueOf = (event) => {
    let lat = event.venue_lat == null ? null : Number(event.venue_lat);
    let lng = event.venue_lng == null ? null : Number(event.venue_lng);
    if (!(Number.isFinite(lat) && Number.isFinite(lng)) || (lat === 0 && lng === 0)) {
        const fromLink = coordsFromLink(event.venue_map_link);
        lat = fromLink?.lat ?? null;
        lng = fromLink?.lng ?? null;
    }
    const pinned = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    return {
        name: event.venue_name || null,
        address: event.venue_address || null,
        lat: pinned ? lat : null,
        lng: pinned ? lng : null,
        has_location: pinned,
    };
};

/** The saved settings, or the suggested ones when never saved. */
const settingsOf = (event) => {
    const raw = event.nearby_settings && typeof event.nearby_settings === 'object'
        ? event.nearby_settings
        : null;
    const categories = Array.isArray(raw?.categories)
        ? raw.categories.filter((k) => CATEGORY_BY_KEY.has(k)).slice(0, MAX_CATEGORIES)
        : CATEGORIES.filter((c) => c.suggested).map((c) => c.key);
    const radius = Number(raw?.radius_km);
    const sort = SORTS.some((s) => s.key === raw?.sort) ? raw.sort : 'distance';
    return {
        categories,
        radius_km: RADII_KM.includes(radius) ? radius : DEFAULT_RADIUS_KM,
        sort,
        saved: !!raw,
    };
};

/** Validates a save body against the lists above; throws a clear message. */
const cleanSettings = (body = {}) => {
    if (!Array.isArray(body.categories)) throw ApiError.badRequest('Please choose at least one category.');
    const categories = [...new Set(body.categories.map((k) => String(k)))];
    if (!categories.length) throw ApiError.badRequest('Please choose at least one category.');
    if (categories.length > MAX_CATEGORIES) {
        throw ApiError.badRequest(`You can choose up to ${MAX_CATEGORIES} categories.`);
    }
    const unknown = categories.find((k) => !CATEGORY_BY_KEY.has(k));
    if (unknown) throw ApiError.badRequest('One of the chosen categories is not available.');
    const radius = Number(body.radius_km ?? DEFAULT_RADIUS_KM);
    if (!RADII_KM.includes(radius)) throw ApiError.badRequest('Please choose a search radius from the list.');
    const sort = body.sort ?? 'distance';
    if (!SORTS.some((s) => s.key === sort)) throw ApiError.badRequest('Please choose how to sort the results.');
    // Kept in the design's order, whatever order they were tapped in.
    const ordered = CATEGORIES.map((c) => c.key).filter((k) => categories.includes(k));
    return { categories: ordered, radius_km: radius, sort };
};

const cacheKeyOf = (venue, settings) => [
    venue.lat.toFixed(5), venue.lng.toFixed(5), settings.radius_km,
    [...settings.categories].sort().join(','),
].join('|');

const sortPlaces = (places, sort) => {
    const list = [...places];
    if (sort === 'rating') {
        list.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.distance_km - b.distance_km);
    } else if (sort === 'name') {
        list.sort((a, b) => a.name.localeCompare(b.name));
    } else {
        list.sort((a, b) => a.distance_km - b.distance_km);
    }
    return list;
};

const resolveEvent = async (clientId, rawId) => {
    const eventId = Number(rawId);
    if (!eventId) throw ApiError.badRequest('Please choose an event.');
    const event = await Event.findByPk(eventId, { attributes: EVENT_ATTRS });
    if (!event) throw ApiError.notFound('That event was not found.');
    if (Number(event.website_client_id) === Number(clientId)) return { event, isOwner: true };
    const participant = await EventParticipant.findOne({
        where: { event_id: eventId, participant_client_id: clientId },
        attributes: ['id'],
    });
    if (!participant) throw ApiError.notFound('That event is not on your account.');
    return { event, isOwner: false };
};

// ── Google Places (New) ─────────────────────────────────────────────────────

/** One category around the venue. Throws an ApiError the organizer can read. */
const searchCategory = async (venue, radiusKm, category) => {
    let res;
    try {
        res = await axios.post(
            'https://places.googleapis.com/v1/places:searchNearby',
            {
                includedTypes: category.types,
                maxResultCount: PER_CATEGORY,
                rankPreference: 'DISTANCE',
                locationRestriction: {
                    circle: {
                        center: { latitude: venue.lat, longitude: venue.lng },
                        radius: radiusKm * 1000,
                    },
                },
            },
            {
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': apiKey(),
                    'X-Goog-FieldMask': [
                        'places.id', 'places.displayName', 'places.formattedAddress',
                        'places.shortFormattedAddress', 'places.location', 'places.rating',
                        'places.userRatingCount', 'places.googleMapsUri',
                    ].join(','),
                },
            },
        );
    } catch (e) {
        const g = e.response?.data?.error;
        logger.error(`[nearby] Google Places ${category.key}: ${g?.status || e.code} ${g?.message || e.message}`);
        const disabled = (g?.details || []).some((d) => d.reason === 'SERVICE_DISABLED');
        throw new ApiError(
            503,
            disabled
                ? 'Google Places is not turned on for this app yet. Please try again later.'
                : 'We couldn\'t load nearby places right now. Please try again.',
        );
    }
    return (res.data?.places || []).map((p) => {
        const lat = p.location?.latitude;
        const lng = p.location?.longitude;
        return {
            id: p.id,
            name: p.displayName?.text || category.label,
            category: category.key,
            category_label: category.label,
            address: p.shortFormattedAddress || p.formattedAddress || null,
            lat,
            lng,
            distance_km: distanceKm(venue.lat, venue.lng, lat, lng),
            rating: p.rating ?? null,
            rating_count: p.userRatingCount ?? null,
            map_url: p.googleMapsUri
                || `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${p.id}`,
        };
    }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.distance_km <= radiusKm);
};

/** Every chosen category, in parallel; a place in two categories kept once. */
const fetchPlaces = async (venue, settings) => {
    if (!apiKey()) {
        throw new ApiError(503, 'Nearby places are not set up on the server yet.');
    }
    const lists = await Promise.all(
        settings.categories.map((k) => searchCategory(venue, settings.radius_km, CATEGORY_BY_KEY.get(k))),
    );
    const seen = new Set();
    const places = [];
    for (const list of lists) {
        for (const p of list) {
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            places.push(p);
        }
    }
    return places;
};

/** The places for [settings], from the cache when it still matches. */
const placesFor = async (event, venue, settings, { refresh = false } = {}) => {
    const key = cacheKeyOf(venue, settings);
    const cached = await EventNearbyCache.findByPk(event.id);
    const fresh = cached
        && cached.cache_key === key
        && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_DAYS * 86400000;
    if (fresh && !refresh) return { places: cached.places, fetched_at: cached.fetched_at };

    const places = await fetchPlaces(venue, settings);
    const fetchedAt = new Date();
    await EventNearbyCache.upsert({
        event_id: event.id, cache_key: key, places, fetched_at: fetchedAt,
    });
    return { places, fetched_at: fetchedAt };
};

// ── API ─────────────────────────────────────────────────────────────────────

/** GET /events/:id/nearby-settings — the settings page. Organizer only. */
const getSettings = async (clientId, eventId) => {
    const { event, isOwner } = await resolveEvent(clientId, eventId);
    if (!isOwner) throw ApiError.forbidden('Only the organizer can see Near By settings.');
    return {
        event_id: event.id,
        venue: venueOf(event),
        settings: settingsOf(event),
        options: {
            max_categories: MAX_CATEGORIES,
            categories: CATEGORIES.map(({ key, label }) => ({ key, label })),
            radii_km: RADII_KM,
            default_radius_km: DEFAULT_RADIUS_KM,
            sorts: SORTS,
        },
    };
};

/** PUT /events/:id/nearby-settings — Save Selection. Organizer only. */
const updateSettings = async (clientId, eventId, body = {}) => {
    const { event, isOwner } = await resolveEvent(clientId, eventId);
    if (!isOwner) throw ApiError.forbidden('Only the organizer can change Near By settings.');
    const next = cleanSettings(body);
    await event.update({ nearby_settings: next });
    return { event_id: event.id, venue: venueOf(event), settings: { ...next, saved: true } };
};

/**
 * GET /events/:id/nearby — the places (Preview Nearby Results; later the
 * participant's Near By). `?refresh=1` (organizer only) skips the cache.
 */
const list = async (clientId, eventId, query = {}) => {
    const { event, isOwner } = await resolveEvent(clientId, eventId);
    const venue = venueOf(event);
    const settings = settingsOf(event);
    const base = {
        event_id: event.id,
        venue,
        settings,
        categories: settings.categories.map((k) => ({ key: k, label: CATEGORY_BY_KEY.get(k).label })),
    };
    // Guests see nothing until the organizer has set Near By up.
    if (!isOwner && !settings.saved) return { ...base, places: [], fetched_at: null };
    if (!venue.has_location) {
        // A guest cannot fix the pin — they just see no places.
        if (!isOwner) return { ...base, places: [], fetched_at: null };
        throw ApiError.badRequest('Please set the venue location on the map first.');
    }
    if (!settings.categories.length) return { ...base, places: [], fetched_at: null };

    const refresh = isOwner && ['1', 'true'].includes(String(query.refresh));
    const { places, fetched_at } = await placesFor(event, venue, settings, { refresh });
    return { ...base, places: sortPlaces(places, settings.sort), fetched_at };
};

module.exports = {
    getSettings,
    updateSettings,
    list,
    // For tests.
    _internal: { distanceKm, settingsOf, cleanSettings, cacheKeyOf, sortPlaces, venueOf, coordsFromLink, CATEGORIES },
};
