import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { Op } from 'sequelize';
import Crosslink from '../models/Crosslink.js';
import Protein from '../models/Protein.js';

import { Dataset, Organelle, Organism, User } from '../models/index.js';


const router = express.Router();

/**
 * GET /datasets
 * Public + filtres (optionnels): organism_taxon_id, organelle_id, user_id, status, q (filename like)
 * Pagination: ?limit=200&offset=0
 */
router.get('/', async (req, res) => {
    const where = {};
    const { organism_taxon_id, organelle_id, user_id, status, q } = req.query;

    if (organism_taxon_id) where.organism_taxon_id = organism_taxon_id;
    if (organelle_id) where.organelle_id = organelle_id;
    if (user_id) where.user_id = user_id;
    if (status) where.status = status;
    if (q) where.filename = { [Op.like]: `%${q}%` };

    const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
    const offset = parseInt(req.query.offset || '0', 10);
    const items = await Dataset.findAll({ where, order: [['created_at','DESC']], limit, offset });
    res.json({ items });
});


/**
 * GET /datasets/mine
 * Liste les datasets du user connecté (user_id = req.user.id)
 * + enrichissement organelle/organism
 */
router.get('/mine', authRequired, async (req, res) => {
    try {
        const rows = await Dataset.findAll({
            where: { user_id: req.user.id },
            order: [['created_at', 'DESC']],
            raw: true
        });

        if (!rows.length) return res.json({ datasets: [] });

        const organelleIds = [...new Set(rows.map(r => r.organelle_id))];
        const taxonIds     = [...new Set(rows.map(r => r.organism_taxon_id))];

        const organelles = await Organelle.findAll({ where: { id: organelleIds }, raw: true });
        const organisms  = await Organism.findAll({ where: { taxon_id: taxonIds }, raw: true });

        const organelleMap = Object.fromEntries(organelles.map(o => [o.id, o]));
        const organismMap  = Object.fromEntries(organisms.map(o => [o.taxon_id, o]));

        res.json({
            datasets: rows.map(d => ({
                id: d.id,
                filename: d.filename,
                rows_count: d.rows_count,
                status: d.status,
                created_at: d.created_at,
                experiment: d.experiment ?? null,
                description: d.description ?? null,
                organelle: { id: d.organelle_id, name: organelleMap[d.organelle_id]?.name ?? null },
                organism:  {
                    taxon_id: d.organism_taxon_id,
                    scientific_name: organismMap[d.organism_taxon_id]?.scientific_name ?? null,
                    common_name:     organismMap[d.organism_taxon_id]?.common_name ?? null
                }
            }))
        });
    } catch (e) {
        console.error('GET /datasets/mine ERROR:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Public: tous les datasets

router.get('/all', async (req, res) => {
    try {
        const rows = await Dataset.findAll({
            include: [
                { model: User,      as: 'user',      attributes: ['id','first_name','last_name','email'] },
                { model: Organism,  as: 'organism',  attributes: ['taxon_id','name','common_name'] },
                { model: Organelle, as: 'organelle', attributes: ['id','name'] }
            ],
            order: [
                ['user_id', 'ASC'],
                ['organism_taxon_id', 'ASC'],
                ['organelle_id', 'ASC'],
                ['created_at', 'DESC']
            ]
        });

        const datasets = rows.map(d => ({
            id: d.id,
            filename: d.filename,
            rows_count: d.rows_count,
            status: d.status,
            created_at: d.created_at,
            user: d.user ? {
                id: d.user.id,
                first_name: d.user.first_name,
                last_name: d.user.last_name,
                email: d.user.email
            } : null,
            organism: d.organism ? {
                taxon_id: d.organism.taxon_id,
                // ⬇️ your model uses `name` (not `scientific_name`)
                name: d.organism.name,
                common_name: d.organism.common_name
            } : null,
            organelle: d.organelle ? {
                id: d.organelle.id,
                name: d.organelle.name
            } : null
        }));

        res.json({ datasets });
    } catch (e) {
        console.error('GET /datasets/all ERROR:', e?.message, e?.stack);
        res.status(500).json({ error: 'Internal server error', detail: e?.message });
    }
});

/**
 * GET /datasets/:id
 * Public
 */
router.get('/:id', async (req, res) => {
    const ds = await Dataset.findByPk(req.params.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found' });
    res.json({ dataset: ds });
});

/**
 * POST /datasets
 * Auth requis. Crée un enregistrement (status défaut 'uploaded')
 * Body: { organism_taxon_id, organelle_id, filename, file_sha256? }
 */
router.post('/', authRequired, async (req, res) => {
    const { organism_taxon_id, organelle_id, filename, file_sha256 } = req.body || {};
    if (!organism_taxon_id || !organelle_id || !filename) {
        return res.status(400).json({ error: 'organism_taxon_id, organelle_id, filename requis' });
    }
    try {
        const dataset = await Dataset.create({
            user_id: req.user.id,
            organism_taxon_id, organelle_id, filename,
            file_sha256: file_sha256 || null, rows_count: 0, status: 'uploaded',
            created_at: new Date()
        });
        res.status(201).json({ dataset });
    } catch (e) {
        if (e?.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({ error: 'This file already exists for this user.' });
        }
        console.error(e);
        res.status(500).json({ error: 'Dataset creation failed' });
    }
});

/**
 * PATCH /datasets/:id
 * Auth requis. Met à jour status / rows_count / file_sha256 (pas d’owner check).
 * Body (optionnels): { status, rows_count, file_sha256 }
 */
router.patch('/:id', authRequired, async (req, res) => {
    const ds = await Dataset.findByPk(req.params.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found' });
    const { status, rows_count, file_sha256 } = req.body || {};
    if (status) ds.status = status;
    if (rows_count !== undefined) ds.rows_count = rows_count;
    if (file_sha256 !== undefined) ds.file_sha256 = file_sha256;
    await ds.save({ silent: true });
    res.json({ dataset: ds });
});

/**
 * DELETE /datasets/:id
 * Auth requis. Suppression libre (aucun contrôle d’owner).
 */
router.delete('/:id', authRequired, async (req, res) => {
    const ds = await Dataset.findByPk(req.params.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found' });
    await ds.destroy();
    res.json({ ok: true });
});
/**
 * GET /datasets/:id/graph
 * Renvoie les données prêtes pour l’UI:
 * - crosslinks: [{ Protein1, Protein2, AbsPos1, AbsPos2, Score }]
 * - proteins:  [{ uniprot_id, gene_name, protein_name, sequence, length, taxon_id }]
 *
 *  Route publique (tu as dit que tout le monde peut voir).
 */
router.get('/:id/graph', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad dataset ID' });

        const dataset = await Dataset.findByPk(id);
        if (!dataset) return res.status(404).json({ error: 'Dataset not found' });

        // Crosslinks du dataset
        const links = await Crosslink.findAll({
            where: { dataset_id: id },
            attributes: ['protein1_uid', 'protein2_uid', 'abspos1', 'abspos2', 'score'],
            order: [['id', 'ASC']]
        });

        // Protéines impliquées
        const set = new Set();
        for (const l of links) {
            if (l.protein1_uid) set.add(l.protein1_uid);
            if (l.protein2_uid) set.add(l.protein2_uid);
        }
        const ids = [...set];
        const proteins = ids.length
            ? await Protein.findAll({
                where: { uniprot_id: { [Op.in]: ids } },
                attributes: [
                    'uniprot_id','taxon_id','gene_name','protein_name',
                    'sequence','length','go_terms','subcellular_locations','string_refs','updated_at'
                ]
            })
            : [];

        // Mise en forme pour coller à TON store actuel
        const csvData = links.map(l => ({
            Protein1: l.protein1_uid,
            Protein2: l.protein2_uid,
            AbsPos1:  l.abspos1,
            AbsPos2:  l.abspos2,
            Score:    l.score
        }));

        // fastaData = la “liste protéines” de ton front
        const fastaData = proteins.map(p => ({
            uniprot_id:   p.uniprot_id,
            taxon_id:     p.taxon_id,
            gene_name:    p.gene_name,
            protein_name: p.protein_name,
            sequence:     p.sequence,
            length:       p.length,
            go_terms:     p.go_terms,
            subcellular_locations: p.subcellular_locations,
            string_refs:           p.string_refs,
            updated_at:   p.updated_at
        }));

        return res.json({
            dataset: {
                id: dataset.id,
                filename: dataset.filename,
                organism_taxon_id: dataset.organism_taxon_id,
                organelle_id: dataset.organelle_id,
                rows_count: dataset.rows_count,
                status: dataset.status,
                created_at: dataset.created_at
            },
            crosslinks: csvData,
            proteins: fastaData
        });
    } catch (e) {
        console.error('GET /datasets/:id/graph ERROR:', e);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /datasets/:id/meta  -> renvoie organism name + taxon
router.get('/:id/meta', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad dataset ID' });
    const row = await Dataset.findByPk(id, {
        include: [{ model: Organism, as: 'organism', attributes: ['taxon_id','name','common_name'] }],
        attributes: ['id','filename','organism_taxon_id']
    });
    if (!row) return res.status(404).json({ error: 'Dataset not found' });

    return res.json({
        id: row.id,
        filename: row.filename,
        organism: row.organism ? {
            taxon_id: row.organism.taxon_id,
            name: row.organism.name,
            common_name: row.organism.common_name
        } : { taxon_id: row.organism_taxon_id, name: null, common_name: null }
    });
});

export default router;
