import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

import { sha256File } from '../utils/hashFile.js';
import { parseCsv } from '../parsers/parseCsv.js';
import { getProteinInfo, getOrganismFromAcc} from '../services/uniprot.js';

import { authRequired } from '../middleware/auth.js';
import Dataset from '../models/Dataset.js';
import Organism from '../models/Organism.js';
import Organelle from '../models/Organelle.js';
import Protein from '../models/Protein.js';
import Crosslink from '../models/Crosslink.js';

const router = express.Router();

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '__' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage });

// —— helpers ——

// Upsert proteins selon ton schéma (uniprot_id PK, taxon_id NOT NULL)
// routes/upload.js (ou ton service équivalent)
async function upsertProteinsForTaxon(accessions, fallbackTaxonId) {
    const existing = await Protein.findAll({ where: { uniprot_id: accessions } });
    const have = new Set(existing.map(p => p.uniprot_id));
    const missing = accessions.filter(a => !have.has(a));
    if (missing.length === 0) return;

    const CHUNK = 25;          // 20~50 raisonnable
    const PARALLEL = 3;        // 2~4 flux en parallèle (évite 10+)
    const chunks = [];
    for (let i = 0; i < missing.length; i += CHUNK) {
        chunks.push(missing.slice(i, i + CHUNK));
    }

    // petit pool de workers
    let idx = 0;
    await Promise.all(
        Array.from({ length: Math.min(PARALLEL, chunks.length) }).map(async () => {
            while (idx < chunks.length) {
                const myIndex = idx++;
                const slice = chunks[myIndex];
                const infos = await Promise.all(
                    slice.map(acc => getProteinInfo(acc).catch(() => null))
                );

                const payload = infos.filter(Boolean).map(info => ({
                    uniprot_id:   info.uniprot_id,
                    taxon_id:     info.taxon_id || fallbackTaxonId,
                    gene_name:    info.gene_name || null,
                    protein_name: info.protein_name || null,
                    sequence:     info.sequence || null,
                    length:       info.length || null,
                    go_terms:     info.go_terms || null,
                    subcellular_locations: info.subcellular_locations || '[]',
                    string_refs:  info.string_refs || '[]',
                    updated_at:   new Date(),
                }));

                if (payload.length) {
                    await Protein.bulkCreate(payload, { ignoreDuplicates: true });
                    // Update pour rafraîchir si déjà existait
                    for (const p of payload) {
                        await Protein.update(
                            {
                                taxon_id: p.taxon_id,
                                gene_name: p.gene_name,
                                protein_name: p.protein_name,
                                sequence: p.sequence,
                                length: p.length,
                                go_terms: p.go_terms,
                                subcellular_locations: p.subcellular_locations,
                                string_refs: p.string_refs,
                                updated_at: new Date(),
                            },
                            { where: { uniprot_id: p.uniprot_id } }
                        );
                    }
                }
            }
        })
    );
}


// —— routes ——

// 1) PREPARE: upload fichier + détection taxon + organelle
router.post('/prepare', authRequired, upload.single('file'), async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ error: 'Auth required' });
        if (!req.file) return res.status(400).json({ error: 'File required' });

        const organelle_id = Number(req.body?.organelle_id);
        if (!Number.isFinite(organelle_id)) {
            return res.status(400).json({ error: 'organelle_id required' });
            }
        const organelle = await Organelle.findByPk(organelle_id);
        if (!organelle) return res.status(404).json({ error: 'Unknown organelle' });

        const originalName = req.file.originalname;
        const filePath = req.file.path;

        // hash + nom canonique
        const file_sha256 = await sha256File(filePath);
        const hashedPath = path.join(uploadDir, `${file_sha256}.csv`);
        if (!fs.existsSync(hashedPath)) fs.renameSync(filePath, hashedPath);
        else fs.unlinkSync(filePath);

        // utilise TON parser (parse tout le fichier)
        const rows = parseCsv(hashedPath);
        if (!rows.length) return res.status(400).json({ error: 'Empty CSV or missing headers' });

        // Ton parser garantit Protein1 (sinon la ligne est filtrée), Protein2 fallback = Protein1
        const firstAcc = rows[0]?.Protein1?.toString().trim();
        if (!firstAcc) return res.status(400).json({ error: 'No UniProt ID detected (Protein1)' });

        const { taxon_id: organism_taxon_id, scientific_name, common_name } =
            await getOrganismFromAcc(firstAcc);

// crée/retourne l’organisme avec "name" (NOT NULL)
        await Organism.findOrCreate({
            where:    { taxon_id: organism_taxon_id },
            defaults: { taxon_id: organism_taxon_id, name: scientific_name, common_name }
        });

        // Datasets existants pour (user, organism, organelle)
        const existing = await Dataset.findAll({
            where: { user_id: req.user.id, organism_taxon_id, organelle_id: organelle.id },
            order: [['created_at', 'DESC']]
        });

        // Si tu veux afficher l’entête dans l’UI, on la déduit
        const header = Object.keys(rows[0] || {});

        return res.json({
            analysis: {
                organism_taxon_id,
                organelle: { id: organelle.id, name: organelle.name },
                filename: originalName,
                file_sha256,
                header, // déduit
            },
            existingDatasets: existing.map(d => ({
                id: d.id, filename: d.filename, rows_count: d.rows_count, status: d.status, created_at: d.created_at
            }))
        });
    } catch (e) {
        console.error('POST /uploads/prepare ERROR:', e);
        return res.status(500).json({ error: 'File analysis failed', details: String(e.message || e) });
    }
});


// 2) COMMIT: créer un dataset ou compléter un dataset existant
router.post('/commit', authRequired, async (req, res) => {
    try {
            const { file_sha256, filename, organism_taxon_id, organelle_id, mode, dataset_id, experiment, description } = req.body || {};        if (!file_sha256 || !filename || !organism_taxon_id || !organelle_id || !mode) {
            return res.status(400).json({ error: 'Required fields: file_sha256, filename, organism_taxon_id, organelle_id, mode' });
        }

        const csvPath = path.join(uploadDir, `${file_sha256}.csv`);
        if (!fs.existsSync(csvPath)) return res.status(400).json({ error: 'File not found (re-run /prepare)' });


        // FK présentes ?
        const [org, orga] = await Promise.all([
            Organism.findByPk(Number(organism_taxon_id)),
            Organelle.findByPk(Number(organelle_id))
        ]);
        if (!org)  return res.status(400).json({ error: `Organism taxon_id ${organism_taxon_id} not found (redo /prepare)` });
        if (!orga) return res.status(400).json({ error: `Organelle id ${organelle_id} not found (redo /prepare)` });


        // create / append
        let dataset;
        if (mode === 'create') {
            dataset = await Dataset.create({
                user_id: req.user.id,
                organism_taxon_id,
                organelle_id,
                filename,
                file_sha256,
                rows_count: 0,
                status: 'uploaded',
                created_at: new Date(),
                experiment: (experiment ?? null),
                description: (description ?? null)
            });
        } else if (mode === 'append') {
            if (!dataset_id) return res.status(400).json({ error: 'dataset_id required for append' });
            dataset = await Dataset.findByPk(dataset_id);
            if (!dataset) return res.status(404).json({ error: 'Dataset not found' });
            if (dataset.organism_taxon_id !== Number(organism_taxon_id) || dataset.organelle_id !== Number(organelle_id)) {
                return res.status(400).json({ error: 'Incompatible dataset (different organism/organelle)' });
            }
            if (experiment != null || description != null) {
                if (typeof experiment === 'string')  dataset.experiment  = experiment;
                if (typeof description === 'string') dataset.description = description;
                await dataset.save({ silent: true });
            }
        } else {
            return res.status(400).json({ error: 'Invalid mode' });
        }

        // 📥 parse CSV en sécurité
        let rows;
        try {
            rows = parseCsv(csvPath);    // ta fonction
        } catch (e) {
            return res.status(400).json({ error: 'Invalid CSV', details: String(e.message || e) });
        }
        if (!rows?.length) return res.status(400).json({ error: 'Empty CSV' });

        // Accumule les accessions + crosslinks
        const accs = new Set();
        const payload = [];

        for (const r of rows) {
            const p1 = (r.Protein1 || '').toString().trim();
            const p2 = (r.Protein2 || '').toString().trim(); // déjà fallback dans ton parser
            const a1 = Number.parseInt(r?.AbsPos1, 10);
            const a2 = Number.parseInt(r?.AbsPos2, 10);
            const score = r?.Score !== undefined && r?.Score !== '' ? Number.parseFloat(r.Score) : null;

            if (!p1 || !p2) continue;
            if (!Number.isInteger(a1) || !Number.isInteger(a2)) continue;

            accs.add(p1); accs.add(p2);

            payload.push({
                dataset_id: dataset.id,
                protein1_uid: p1,
                protein2_uid: p2,
                abspos1: a1,
                abspos2: a2,
                score: Number.isFinite(score) ? score : null,
            });
        }
        if (!payload.length) {
            return res.status(400).json({ error: 'No valid crosslinks (positions missing or non-numeric)' });
        }
        // Upsert proteins manquantes ( Protein.taxon_id NOT NULL)
        await upsertProteinsForTaxon([...accs], Number(organism_taxon_id));



        if (payload.length) {
            const CHUNK_XL = 2000; // ajuste 1000~5000 selon ta DB
            const t = await Crosslink.sequelize.transaction();
            try {
                for (let i = 0; i < payload.length; i += CHUNK_XL) {
                    const slice = payload.slice(i, i + CHUNK_XL);
                    await Crosslink.bulkCreate(slice, { transaction: t });
                }
                await t.commit();
            } catch (e) {
                await t.rollback();
                throw e;
            }
        }
        // MAJ dataset
        dataset.rows_count = (dataset.rows_count || 0) + payload.length;
        if (dataset.status === 'uploaded') dataset.status = 'parsed';
        await dataset.save({ silent: true });

        return res.json({
            ok: true,
            dataset: { id: dataset.id, rows_count: dataset.rows_count, status: dataset.status },
            inserted_crosslinks: payload.length,
            checked_proteins: accs.size
        });
    } catch (e) {
        console.error('POST /uploads/commit ERROR:', e);
        return res.status(500).json({
            error: 'Commit failed',
            details: e?.original?.sqlMessage || e?.message || String(e)
        });    }
});


export default router;
