import { ref, computed, watch } from 'vue';
import { useDataStore } from '@/store/dataStore';

// Module-level singleton state so in-flight jobs and cache survive component resets
const cache = ref(new Map());       // key -> { cifText, mode, protA, protB, confidence, dimerKey, predictedAt }
const activeJob = ref(null);      // { id, key, mode, protA, protB, label, promise }
const queue = ref([]);            // Array of { id, key, mode, protA, protB, label, payload }
const checkedDbKeys = new Set();  // Avoid repeated DB lookups for keys already checked
let isProcessing = false;
let jobCounter = 0;

function normalizeId(id) {
    return String(id || '').trim().toUpperCase();
}

export function getDimerSpec(crosslink, currentProtein) {
    if (!crosslink || !currentProtein?.uniprot_id) return null;
    
    const currentId = normalizeId(currentProtein.uniprot_id);
    const p1 = normalizeId(crosslink.Protein1);
    const p2 = normalizeId(crosslink.Protein2);
    if (!p1 || !p2) return null;
    
    const isIntra = p1 === p2;
    const mode = isIntra ? 'homodimer' : 'heterodimer';
    
    // Canonical pair ordering so A_B and B_A share cache/queue entries
    const [protA, protB] = isIntra ? [p1, p1] : [p1, p2].sort();
    const key = `${mode}:${protA}_${protB}`;
    const label = isIntra
    ? `Homodimer (${protA})`
    : `Heterodimer (${protA} + ${protB})`;
    
    return {
        key,
        mode,
        protA,
        protB,
        label,
        isIntra,
        currentId,
        crosslink
    };
}

function findSequence(uniprotId, dataStore, currentProtein) {
    const target = normalizeId(uniprotId);
    if (currentProtein && normalizeId(currentProtein.uniprot_id) === target && currentProtein.sequence) {
        return currentProtein.sequence;
    }
    const match = dataStore?.fastaData?.find(
        (entry) => normalizeId(entry.uniprot_id) === target
    );
    return match?.sequence || '';
}

async function fetchFromMariaDbCache(spec, seqA, seqB) {
    // Backend dimer_key format: `${mode}:${p1}_${p2}:${seqHash16}`
    // If we don't know seqHash yet, we can still check if a matching prediction exists via a helper or after predict.
    // If `key` is already exact on the server, query directly; otherwise skip if not yet in cache.
    if (!spec?.key || checkedDbKeys.has(spec.key)) return null;
    checkedDbKeys.add(spec.key);
    
    try {
        const params = new URLSearchParams({ dimer_key: spec.key });
        const res = await fetch(`/api/boltz/prediction?${params.toString()}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (data?.found && data?.cif) {
            return {
                cifText: data.cif,
                mode: data.mode || spec.mode,
                protA: spec.protA,
                protB: spec.protB,
                confidence: data.confidence || null,
                dimerKey: data.dimer_key || spec.key,
                predictedAt: new Date().toISOString()
            };
        }
    } catch {
        // Ignore transient network errors during background cache check
    }
    return null;
}

async function callLocalBoltz(job) {
    const response = await fetch('/api/boltz/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job.payload)
    });
    
    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Boltz prediction failed (${response.status}): ${errText}`);
    }
    
    const data = await response.json();
    return {
        cifText: data.cif || data.structure || '',
        mode: job.mode,
        protA: job.protA,
        protB: job.protB,
        confidence: data.confidence || null,
        dimerKey: data.dimer_key || null,
        predictedAt: new Date().toISOString()
    };
}

async function processQueue() {
    if (isProcessing) return;
    isProcessing = true;
    
    try {
        while (queue.value.length > 0) {
            const nextJob = queue.value.shift();
            activeJob.value = { ...nextJob };
            
            try {
                const result = await callLocalBoltz(nextJob);
                const updatedCache = new Map(cache.value);
                updatedCache.set(nextJob.key, result);
                cache.value = updatedCache;
            } catch (err) {
                console.error(`[DimerQueue] Error predicting ${nextJob.key}:`, err);
            } finally {
                activeJob.value = null;
            }
        }
    } finally {
        isProcessing = false;
    }
}

export function useDimerPrediction(selectedCrosslinkRef, selectedProteinRef) {
    const dataStore = useDataStore();
    const lastError = ref(null);
    
    const currentSpec = computed(() => {
        const xl = selectedCrosslinkRef?.value;
        const prot = selectedProteinRef?.value;
        if (!xl || !prot) return null;
        
        // Explicitly touch crosslink fields so mutations or new objects always re-evaluate
        const _touch = [
            xl.Protein1,
            xl.Protein2,
            xl.AbsPos1,
            xl.AbsPos2,
            xl.id
        ];
        void _touch;
        
        return getDimerSpec(xl, prot);
    });
    
    const cachedResult = computed(() => {
        const spec = currentSpec.value;
        if (!spec) return null;
        return cache.value.get(spec.key) || null;
    });
    
    // Check MariaDB cache when switching to a dimer not yet in the session Map
    watch(
        () => currentSpec.value?.key,
        async (newKey) => {
            if (!newKey || cache.value.has(newKey)) return;
            const spec = currentSpec.value;
            if (!spec) return;
            const seqA = findSequence(spec.protA, dataStore, selectedProteinRef?.value);
            const seqB = findSequence(spec.protB, dataStore, selectedProteinRef?.value);
            const dbHit = await fetchFromMariaDbCache(spec, seqA, seqB);
            if (dbHit && !cache.value.has(newKey)) {
                const updatedCache = new Map(cache.value);
                updatedCache.set(newKey, dbHit);
                cache.value = updatedCache;
            }
        },
        { immediate: true }
    );
    
    const isPredictingCurrent = computed(() => {
        const spec = currentSpec.value;
        return Boolean(spec && activeJob.value?.key === spec.key);
    });
    
    const queuePosition = computed(() => {
        const spec = currentSpec.value;
        if (!spec) return null;
        const idx = queue.value.findIndex((item) => item.key === spec.key);
        return idx === -1 ? null : idx + 1;
    });
    
    const buttonLabel = computed(() => {
        const spec = currentSpec.value;
        if (!spec) return 'Predict Dimer';
        
        const prefix = cachedResult.value ? 'Re-predict' : 'Predict';
        return spec.mode === 'homodimer'
        ? `${prefix} Homodimer`
        : `${prefix} Heterodimer`;
    });
    
    function requestPrediction() {
        lastError.value = null;
        const spec = currentSpec.value;
        if (!spec) return;
        
        if (activeJob.value?.key === spec.key) return;
        if (queue.value.some((item) => item.key === spec.key)) return;
        
        const seqA = findSequence(spec.protA, dataStore, selectedProteinRef?.value);
        const seqB = findSequence(spec.protB, dataStore, selectedProteinRef?.value);
        
        if (!seqA || !seqB) {
            lastError.value = `Missing sequence data for ${!seqA ? spec.protA : spec.protB}.`;
            return;
        }
        
        const job = {
            id: ++jobCounter,
            key: spec.key,
            mode: spec.mode,
            protA: spec.protA,
            protB: spec.protB,
            label: spec.label,
            payload: {
                mode: spec.mode,
                chains: [
                    { id: 'A', uniprot_id: spec.protA, sequence: seqA },
                    { id: 'B', uniprot_id: spec.protB, sequence: seqB }
                ],
                crosslink: {
                    protein1: normalizeId(spec.crosslink.Protein1),
                    protein2: normalizeId(spec.crosslink.Protein2),
                    pos1: Number(spec.crosslink.AbsPos1),
                    pos2: Number(spec.crosslink.AbsPos2)
                }
            }
        };
        
        queue.value = [...queue.value, job];
        processQueue();
    }
    
    return {
        cache,
        activeJob,
        queue,
        lastError,
        currentSpec,
        cachedResult,
        isPredictingCurrent,
        queuePosition,
        buttonLabel,
        requestPrediction
    };
}