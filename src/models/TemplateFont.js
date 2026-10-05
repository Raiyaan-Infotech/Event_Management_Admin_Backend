const { DataTypes } = require('sequelize');

/**
 * A font the admin ADDED for invitation templates — on top of the ten built
 * into the template wizard's list.
 *
 * Two ways in, and a row is exactly one of them (`source`):
 *   upload — a font file (TTF / OTF / WOFF / WOFF2) stored in the media
 *            storage; `file_url` is where it lives.
 *   link   — an address the admin pasted; `link_url` is either a stylesheet
 *            (a Google Fonts "css2" link) or a font file hosted elsewhere.
 *
 * `name` is the CSS family name: it is what a template stores in
 * `primary_font` / `secondary_font` and what every renderer asks the browser
 * for. A stylesheet link must therefore be named exactly as the stylesheet
 * names the family.
 */
module.exports = (sequelize) => {
    const TemplateFont = sequelize.define('TemplateFont', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        source: {
            type: DataTypes.ENUM('upload', 'link'),
            allowNull: false,
            defaultValue: 'upload',
        },
        file_url: {
            type: DataTypes.STRING(500),
            allowNull: true,
        },
        file_name: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        file_format: {
            type: DataTypes.STRING(10),
            allowNull: true,
        },
        file_size: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        link_url: {
            type: DataTypes.STRING(1000),
            allowNull: true,
        },
        is_active: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
        },
        company_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        created_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        updated_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
    }, {
        tableName: 'template_fonts',
        timestamps: true,
        paranoid: true,
    });

    return TemplateFont;
};
