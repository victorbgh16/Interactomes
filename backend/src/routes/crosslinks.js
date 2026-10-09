import express from 'express';
import { authRequired } from '../middleware/auth.js';
import Dataset from '../models/Dataset.js';
import Crosslink from '../models/Crosslink.js';

const router = express.Router();

/**
 * GET /datasets/:datasetId/crosslinks
 * Public. Pagination: ?limit=200&offset=0
 */
router.get('/datasets/:datasetId/crosslinks', async (req, res) => {
    const dataset_id = req.params.datasetId;
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 40000);
    const offset = parseInt(req.query.offset || '0', 10);

    const { rows, count } = await Crosslink.findAndCountAll({
        where: { dataset_id },
        limit,
        offset,
        order: [['id', 'ASC']]
    });
    res.json({ items: rows, total: count });
});

/**
 * POST /datasets/:datasetId/crosslinks/import
 * Auth requis. rows = [{Protein1,Protein2,AbsPos1,AbsPos2,Score}, ...]
 * - Vérifie l’existence du dataset
 * - Insert bulk
 * - Met à jour rows_count (+inserted)
 * - Passe status -> 'parsed' si encore 'uploaded'
 */
router.post('/datasets/:datasetId/crosslinks/import', authRequired, async (req, res) => {
    try {
        const dataset_id = req.params.datasetId;
        const { rows } = req.body || {};

        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ error: 'Rows empty' });
        }

        const ds = await Dataset.findByPk(dataset_id);
        if (!ds) return res.status(404).json({ error: 'Dataset not found' });

        // mapping CSV -> colonnes DB (adapte ici si besoin)
        const now = new Date();
        const payload = rows.map(r => ({
            dataset_id,
            protein1_uid: r.Protein1,
            protein2_uid: r.Protein2,
            abspos1: r.AbsPos1,
            abspos2: r.AbsPos2,
            score: r.Score ?? null
        }));

        await Crosslink.bulkCreate(payload, { ignoreDuplicates: false });

        // MAJ dataset: rows_count et status
        ds.rows_count = (ds.rows_count || 0) + payload.length;
        if (ds.status === 'uploaded') ds.status = 'parsed';
        await ds.save({ silent: true });

        res.json({ ok: true, inserted: payload.length, dataset: { id: ds.id, rows_count: ds.rows_count, status: ds.status } });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Import failed' });
    }
});

export default router;
