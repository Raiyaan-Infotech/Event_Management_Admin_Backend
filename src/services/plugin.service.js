const { Plugin, Setting } = require('../models');
const { Op } = require('sequelize');

// ─── Predefined plugin definitions ───────────────────────────────────────────

const PREDEFINED_PLUGINS = [
    // Content (built-in modules — can be toggled on/off)
    {
        slug: 'blog',
        name: 'Blog',
        description: 'Manage blog posts, categories, and tags.',
        category: 'content',
        icon: 'book-open',
        config_group: null,
        config_route: null,
    },
    {
        slug: 'faq',
        name: 'FAQ',
        description: 'Manage frequently asked questions and categories.',
        category: 'content',
        icon: 'help-circle',
        config_group: null,
        config_route: null,
    },
    {
        slug: 'announcements',
        name: 'Announcements',
        description: 'Display announcements and banners to your users.',
        category: 'content',
        icon: 'bell-ring',
        config_group: null,
        config_route: null,
    },
    {
        slug: 'testimonials',
        name: 'Testimonials',
        description: 'Showcase customer reviews and testimonials.',
        category: 'content',
        icon: 'star',
        config_group: null,
        config_route: null,
    },
    {
        slug: 'contact-form',
        name: 'Contact Form',
        description: 'Receive and manage contact messages from visitors.',
        category: 'content',
        icon: 'phone',
        config_group: null,
        config_route: null,
    },
    {
        slug: 'pages',
        name: 'Pages',
        description: 'Create and manage custom static pages.',
        category: 'content',
        icon: 'file-text',
        config_group: null,
        config_route: null,
    },
    {
        slug: 'simple-slider',
        name: 'Simple Slider',
        description: 'Create and manage homepage image sliders.',
        category: 'content',
        icon: 'image',
        config_group: null,
        config_route: null,
    },

    // Marketing
    {
        slug: 'ads',
        name: 'Ads & Banners',
        description: 'Manage advertisements and ad banners on your site.',
        category: 'marketing',
        icon: 'megaphone',
        config_group: null,
        config_route: null,
    },
    {
        slug: 'newsletter',
        name: 'Newsletter',
        description: 'Collect and manage newsletter subscriptions.',
        category: 'marketing',
        icon: 'newspaper',
        config_group: null,
        config_route: null,
    },

    // General (built-in)
    {
        slug: 'locations',
        name: 'Locations',
        description: 'Manage countries, states, and cities.',
        category: 'general',
        icon: 'map-pin',
        config_group: null,
        config_route: null,
    },

    // Authentication
    {
        slug: 'google-oauth',
        name: 'Google OAuth',
        description: 'Allow users to sign in with their Google account.',
        category: 'authentication',
        icon: 'google',
        config_group: 'social_login',
        config_route: '/admin/settings/social-login',
    },
    {
        slug: 'facebook-oauth',
        name: 'Facebook OAuth',
        description: 'Allow users to sign in with their Facebook account.',
        category: 'authentication',
        icon: 'facebook',
        config_group: 'social_login',
        config_route: '/admin/settings/social-login',
    },

    // Analytics
    {
        slug: 'google-tag-manager',
        name: 'Google Tag Manager',
        description: 'Manage and deploy marketing tags without editing code.',
        category: 'analytics',
        icon: 'tag',
        config_group: 'analytics',
        config_route: '/admin/settings/website-tracking',
    },
    {
        slug: 'google-analytics',
        name: 'Google Analytics 4',
        description: 'Track website traffic and user engagement with GA4.',
        category: 'analytics',
        icon: 'bar-chart',
        config_group: 'analytics',
        config_route: '/admin/settings/website-tracking',
    },

    // Storage
    {
        slug: 'amazon-s3',
        name: 'Amazon S3',
        description: 'Store and serve uploaded files via Amazon S3.',
        category: 'storage',
        icon: 'cloud',
        config_group: 'media',
        config_route: '/admin/settings/media',
    },
    {
        slug: 'cloudflare-r2',
        name: 'Cloudflare R2',
        description: 'Zero-egress object storage compatible with S3 API.',
        category: 'storage',
        icon: 'cloud',
        config_group: 'media',
        config_route: '/admin/settings/media',
    },
    {
        slug: 'digitalocean-spaces',
        name: 'DigitalOcean Spaces',
        description: 'Scalable object storage from DigitalOcean.',
        category: 'storage',
        icon: 'cloud',
        config_group: 'media',
        config_route: '/admin/settings/media',
    },
    {
        slug: 'wasabi',
        name: 'Wasabi Storage',
        description: 'Hot cloud storage — fast, low-cost, reliable.',
        category: 'storage',
        icon: 'cloud',
        config_group: 'media',
        config_route: '/admin/settings/media',
    },

    // Maps
    {
        slug: 'google-maps',
        name: 'Google Maps',
        description: 'Embed maps and location services powered by Google.',
        category: 'maps',
        icon: 'map-pin',
        config_group: 'google_maps',
        config_route: '/admin/plugins/google-maps/config',
    },

    // Payment
    {
        slug: 'stripe',
        name: 'Stripe Payments',
        description: 'Accept online payments with cards, wallets, and more via Stripe.',
        category: 'payment',
        icon: 'credit-card',
        config_group: 'stripe',
        config_route: '/admin/payments/stripe',
    },
    {
        slug: 'paypal',
        name: 'PayPal',
        description: 'Fast and trusted global payments via PayPal.',
        category: 'payment',
        icon: 'credit-card',
        config_group: 'paypal',
        config_route: '/admin/payments/paypal',
    },
    {
        slug: 'razorpay',
        name: 'Razorpay',
        description: 'Accept payments via cards, UPI, wallets & more (India-focused).',
        category: 'payment',
        icon: 'credit-card',
        config_group: 'razorpay',
        config_route: '/admin/payments/razorpay',
    },
    {
        slug: 'paystack',
        name: 'Paystack',
        description: 'Simple and reliable payments across Africa.',
        category: 'payment',
        icon: 'credit-card',
        config_group: 'paystack',
        config_route: '/admin/payments/paystack',
    },
    {
        slug: 'mollie',
        name: 'Mollie',
        description: 'Effortless European online payments.',
        category: 'payment',
        icon: 'credit-card',
        config_group: 'mollie',
        config_route: '/admin/payments/mollie',
    },
    {
        slug: 'flutterwave',
        name: 'Flutterwave',
        description: 'Pan-African payment infrastructure.',
        category: 'payment',
        icon: 'credit-card',
        config_group: 'flutterwave',
        config_route: '/admin/payments/flutterwave',
    },

    // Security
    {
        slug: 'recaptcha',
        name: 'Google reCAPTCHA',
        description: 'Protect your forms from bots with Google reCAPTCHA.',
        category: 'security',
        icon: 'shield',
        config_group: 'recaptcha',
        config_route: '/admin/plugins/recaptcha/config',
    },

    // Communication
    {
        slug: 'twilio',
        name: 'Twilio SMS',
        description: 'Send SMS notifications and OTPs via Twilio.',
        category: 'communication',
        icon: 'message-square',
        config_group: 'twilio',
        config_route: '/admin/plugins/twilio/config',
    },
];

// ─── Category order for display ───────────────────────────────────────────────

const CATEGORY_ORDER = [
    'content',
    'marketing',
    'authentication',
    'analytics',
    'storage',
    'payment',
    'maps',
    'security',
    'communication',
    'general',
];

// ─── Seed predefined plugins for a company ────────────────────────────────────

const seedPlugins = async (companyId) => {
    for (const plugin of PREDEFINED_PLUGINS) {
        await Plugin.findOrCreate({
            where: { slug: plugin.slug, company_id: companyId },
            defaults: {
                ...plugin,
                company_id: companyId,
                is_active: 0,
            },
        });
    }
};

// ─── Get all plugins (grouped by category) ───────────────────────────────────

const getAll = async (companyId) => {
    const plugins = await Plugin.findAll({
        where: { company_id: companyId },
        order: [['category', 'ASC'], ['name', 'ASC']],
    });

    // Group by category
    const grouped = {};
    for (const plugin of plugins) {
        const cat = plugin.category;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(plugin);
    }

    // Return in a defined order
    const sorted = {};
    for (const cat of CATEGORY_ORDER) {
        if (grouped[cat]) sorted[cat] = grouped[cat];
    }
    // Catch any remaining categories not in the order
    for (const cat of Object.keys(grouped)) {
        if (!sorted[cat]) sorted[cat] = grouped[cat];
    }

    return { plugins, grouped: sorted };
};

// ─── Get single plugin by slug ────────────────────────────────────────────────

const getBySlug = async (slug, companyId) => {
    const plugin = await Plugin.findOne({
        where: { slug, company_id: companyId },
    });

    if (!plugin) {
        const error = new Error('Plugin not found');
        error.statusCode = 404;
        throw error;
    }

    // Also fetch config settings for this plugin
    let config = [];
    if (plugin.config_group) {
        config = await Setting.findAll({
            where: {
                group: plugin.config_group,
                company_id: companyId,
            },
            attributes: ['key', 'value', 'type', 'description'],
        });
    }

    return { plugin, config };
};

// ─── Toggle plugin active state ───────────────────────────────────────────────

const toggle = async (slug, companyId) => {
    const plugin = await Plugin.findOne({
        where: { slug, company_id: companyId },
    });

    if (!plugin) {
        const error = new Error('Plugin not found');
        error.statusCode = 404;
        throw error;
    }

    const newState = plugin.is_active === 1 ? 0 : 1;
    await plugin.update({ is_active: newState });

    return plugin;
};

module.exports = {
    getAll,
    getBySlug,
    toggle,
    seedPlugins,
    PREDEFINED_PLUGINS,
};
