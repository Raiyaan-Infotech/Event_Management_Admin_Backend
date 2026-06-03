const { UiBlock } = require('../models');

const HERO_VARIANT_LABELS = [
    'Classic Premium',
    'EventPress Center',
    'Smart Study Layout',
    'Dark Luxury Stats Layout',
    'Stress-Free Events Layout',
    'Widescreen Left-Aligned Layout',
    'Widescreen Center-Aligned Layout',
    'Widescreen Right-Aligned Layout',
    'Widescreen Left-Aligned (with Button)',
    'Widescreen Center-Aligned (with Button)',
    'Widescreen Right-Aligned (with Button)',
    'Widescreen Left-Aligned (with 2 Buttons)',
    'Widescreen Center-Aligned (with 2 Buttons)',
    'Widescreen Right-Aligned (with 2 Buttons)',
    'Widescreen Left-Aligned Layout (No Title)',
    'Widescreen Center-Aligned Layout (No Title)',
    'Widescreen Right-Aligned Layout (No Title)',
    'Widescreen Left-Aligned (No Title, with Button)',
    'Widescreen Center-Aligned (No Title, with Button)',
    'Widescreen Right-Aligned (No Title, with Button)',
    'Widescreen Left-Aligned (No Title, with 2 Buttons)',
    'Widescreen Center-Aligned (No Title, with 2 Buttons)',
    'Widescreen Right-Aligned (No Title, with 2 Buttons)',
];

const CORE_UI_BLOCK_DEFAULTS = [
    {
        block_type: 'register',
        label: 'Register',
        icon: 'UserPlus',
        category_id: 2,
        description: 'Controls whether the register action appears in the website header.',
        variants: [{ key: 'variant_1', label: 'Standard' }],
        plan_ids: [1, 2, 3],
        is_active: 1,
    },
    {
        block_type: 'hero_section',
        label: 'Hero Section',
        icon: 'Sparkles',
        category_id: 2,
        description: 'Configurable hero banner with text, images, page buttons, and layout variants.',
        variants: HERO_VARIANT_LABELS.map((label, index) => ({
            key: `variant_${index + 1}`,
            label,
        })),
        plan_ids: [1, 2, 3],
        is_active: 1,
    },
];

const ensureCoreUiBlocks = async () => {
    for (const defaults of CORE_UI_BLOCK_DEFAULTS) {
        const [block, created] = await UiBlock.findOrCreate({
            where: { block_type: defaults.block_type },
            defaults,
        });

        if (!created) {
            await block.update({
                label: defaults.label,
                icon: defaults.icon,
                category_id: defaults.category_id,
                description: defaults.description,
                variants: defaults.variants,
                plan_ids: defaults.plan_ids,
                is_active: 1,
            });
        }
    }
};

module.exports = {
    CORE_UI_BLOCK_DEFAULTS,
    HERO_VARIANT_LABELS,
    ensureCoreUiBlocks,
};
