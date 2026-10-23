import { DataTypes } from 'sequelize';
import sequelize from '../database/config.js';

const Protein = sequelize.define('Protein', {
    uniprot_id: { type: DataTypes.STRING(20), primaryKey: true },   // PK = UniProt
    taxon_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, // FK -> organisms.taxon_id
    gene_name: { type: DataTypes.STRING(255) },
    protein_name: { type: DataTypes.STRING(512) },
    sequence: { type: DataTypes.TEXT('medium') },
    length: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    go_terms: { type: DataTypes.TEXT },
    subcellular_locations: { type: DataTypes.TEXT, allowNull: true },
    string_refs:           { type: DataTypes.TEXT, allowNull: true },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    pae_image_path: {type: DataTypes.STRING, allowNull: true, field: 'pae_image_path'}
}, {
    tableName: 'proteins',
    timestamps: false,
    indexes: [
        { fields: ['taxon_id'] },
        { fields: ['gene_name'] }
    ]
});

export default Protein;
