<template>
  <section class="dimer-section">
    <div class="dimer-header">
      <h4>Boltz Dimer Prediction</h4>
      <span v-if="currentSpec" class="dimer-badge">{{ currentSpec.mode }}</span>
    </div>
    
    <p v-if="!currentSpec" class="dimer-hint">
      Select a crosslink to prepare a homodimer or heterodimer prediction.
    </p>
    
    <template v-else>
      <div class="dimer-pair-info">
        <span><strong>Target:</strong> {{ currentSpec.label }}</span>
        <span class="dimer-xl-pos">
          XL: {{ currentSpec.crosslink.Protein1 }}:{{ currentSpec.crosslink.AbsPos1 }}
          &mdash;
          {{ currentSpec.crosslink.Protein2 }}:{{ currentSpec.crosslink.AbsPos2 }}
        </span>
      </div>
      
      <div class="dimer-controls">
        <button
        type="button"
        class="predict-dimer-btn"
        :disabled="isPredictingCurrent || queuePosition !== null"
        @click="requestPrediction"
        >
        {{ buttonLabel }}
      </button>
      
      <span v-if="cachedResult && !isPredictingCurrent && queuePosition === null" class="status-cached">
        Cached
      </span>
    </div>
    
    <!-- Status messages for active computation or queue spot -->
    <div v-if="isPredictingCurrent" class="status-banner predicting">
      Predicting {{ currentSpec.mode }} with Boltz...
    </div>
    
    <div v-else-if="queuePosition !== null" class="status-banner queued">
      Queued for Boltz prediction &mdash; <strong>Position #{{ queuePosition }}</strong> in queue.
    </div>
    
    <div v-else-if="activeJob && activeJob.key !== currentSpec.key" class="status-banner info">
      Currently predicting <strong>{{ activeJob.label }}</strong> ({{ queue.length }} waiting).
    </div>
    
    <div v-if="lastError" class="status-banner error">
      {{ lastError }}
    </div>
    
    <!-- CHANGED: Added confidence metrics strip (ipTM, Mean pLDDT, and pTM) when a prediction result is available -->
    <div v-if="cachedResult?.cifText" class="dimer-confidence-grid">
      <div class="metric-card" title="Interface predicted TM-score (0-1)">
        <span class="metric-label">ipTM</span>
        <span class="metric-value">{{ formatScore(confidenceMetrics?.iptm) }}</span>
      </div>
      <div class="metric-card" title="Overall predicted TM-score (0-1)">
        <span class="metric-label">pTM</span>
        <span class="metric-value">{{ formatScore(confidenceMetrics?.ptm) }}</span>
      </div>
      <div class="metric-card" title="Mean complex pLDDT (0-100)">
        <span class="metric-label">Mean pLDDT</span>
        <span class="metric-value">{{ formatPlddt(confidenceMetrics?.complex_plddt) }}</span>
      </div>
    </div>
    
    <!-- Programmatic 3Dmol viewer for cached dimer structure -->
    <div v-show="cachedResult?.cifText" class="dimer-viewer-wrapper">
      <!-- CHANGED: Added a compact legend explaining the two per-chain pLDDT gradients -->
      <div class="plddt-legend">
        <span class="legend-item">
          <span class="legend-swatch chain-a-swatch"></span>
          Chain A pLDDT (low &rarr; high)
        </span>
        <span class="legend-item">
          <span class="legend-swatch chain-b-swatch"></span>
          Chain B pLDDT (low &rarr; high)
        </span>
      </div>
      <div ref="dimerViewerEl" class="dimer-viewer-canvas"></div>
    </div>
  </template>
</section>
</template>

<script setup>
import { ref, toRef, computed, watch, onBeforeUnmount, nextTick } from 'vue';
import { useDimerPrediction } from '@/composables/useDimerPrediction';

const props = defineProps({
  selectedCrosslink: {
    type: Object,
    default: null
  },
  selectedProtein: {
    type: Object,
    default: null
  }
});

const selectedCrosslinkRef = toRef(props, 'selectedCrosslink');
const selectedProteinRef = toRef(props, 'selectedProtein');

const {
  activeJob,
  queue,
  lastError,
  currentSpec,
  cachedResult,
  isPredictingCurrent,
  queuePosition,
  buttonLabel,
  requestPrediction
} = useDimerPrediction(selectedCrosslinkRef, selectedProteinRef);

const confidenceMetrics = computed(() => {
  const res = cachedResult.value;
  if (!res || typeof res !== 'object') return null;
  
  const src =
  res.confidence && typeof res.confidence === 'object'
  ? res.confidence
  : res.data?.confidence && typeof res.data.confidence === 'object'
  ? res.data.confidence
  : res;
  
  const pickNumber = (...keys) => {
    for (const k of keys) {
      const v = src?.[k] ?? res?.[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
        return Number(v);
      }
    }
    return null;
  };
  
  return {
    iptm: pickNumber('iptm', 'ipTM'),
    complex_plddt: pickNumber('complex_plddt', 'complexPlddt', 'mean_plddt', 'plddt'),
    ptm: pickNumber('ptm', 'pTM')
  };
});

function formatScore(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
}

function formatPlddt(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const normalized = value <= 1 ? value * 100 : value;
  return normalized.toFixed(1);
}

const MAX_CROSSLINK_DISTANCE_ANGSTROMS = 35;
const dimerViewerEl = ref(null);
let dimerViewer = null;
let resizeObserver = null;
let renderToken = 0;
let crosslinkShape = null;

function normalizeId(id) {
  return String(id || '').trim().toUpperCase();
}

function getModelChains(model) {
  const atoms = model?.selectedAtoms({}) || [];
  return [...new Set(atoms.map((a) => a.chain).filter((c) => c !== undefined && c !== null))];
}

function findCaAtom(model, chain, resi) {
  const targetResi = Number(resi);
  if (!model || !Number.isFinite(targetResi)) return null;
  
  const allAtoms = model.selectedAtoms({}) || [];
  
  let match = allAtoms.find(
  (a) => a.chain === chain && Number(a.resi) === targetResi && a.atom === 'CA'
  );
  if (match) return match;
  
  match = allAtoms.find(
  (a) => Number(a.resi) === targetResi && a.atom === 'CA'
  );
  if (match) return match;
  
  return (
  allAtoms.find((a) => a.chain === chain && Number(a.resi) === targetResi) ||
  allAtoms.find((a) => Number(a.resi) === targetResi) ||
  null
  );
}

function resolvePairChains(spec, chains) {
  const chainA = chains[0] ?? 'A';
  const chainB = chains[1] ?? chains[0] ?? 'B';
  
  const xl = spec?.crosslink;
  if (!xl) return { chain1: chainA, chain2: chainB };
  
  if (spec.mode === 'homodimer') {
    return { chain1: chainA, chain2: chainB };
  }
  
  const p1 = normalizeId(xl.Protein1);
  const p2 = normalizeId(xl.Protein2);
  const protA = normalizeId(spec.protA);
  const protB = normalizeId(spec.protB);
  
  const toChain = (prot) => {
    if (prot === protA) return chainA;
    if (prot === protB) return chainB;
    return chainA;
  };
  
  return {
    chain1: toChain(p1),
    chain2: toChain(p2)
  };
}

function applyDimerCrosslinkOverlay(viewer, model, spec) {
  if (!viewer || !model) return;
  
  if (crosslinkShape) {
    try {
      viewer.removeShape(crosslinkShape);
    } catch {
      // Ignore if already removed
    }
    crosslinkShape = null;
  }
  
  const xl = spec?.crosslink;
  const abs1 = Number(xl?.AbsPos1);
  const abs2 = Number(xl?.AbsPos2);
  if (!xl || !Number.isFinite(abs1) || !Number.isFinite(abs2)) return;
  
  const chains = getModelChains(model);
  const { chain1, chain2 } = resolvePairChains(spec, chains);
  
  const atom1 = findCaAtom(model, chain1, abs1);
  const atom2 = findCaAtom(model, chain2, abs2);
  
  let highlightColor = '#2ecc71';
  
  if (atom1 && atom2) {
    const dx = atom2.x - atom1.x;
    const dy = atom2.y - atom1.y;
    const dz = atom2.z - atom1.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    console.log(
    `Crosslink distance (${atom1.chain}:${atom1.resi} - ${atom2.chain}:${atom2.resi}): ${distance.toFixed(2)} Å`
    );
    
    if (distance > MAX_CROSSLINK_DISTANCE_ANGSTROMS) {
      highlightColor = '#e74c3c';
    }
    
    crosslinkShape = viewer.addCylinder({
      start: { x: atom1.x, y: atom1.y, z: atom1.z },
      end: { x: atom2.x, y: atom2.y, z: atom2.z },
      radius: 0.15,
      color: highlightColor,
      fromCap: true,
      toCap: true
    });
  }
  
  const sel1 = atom1 ? { chain: atom1.chain, resi: atom1.resi } : { resi: abs1 };
  const sel2 = atom2 ? { chain: atom2.chain, resi: atom2.resi } : { resi: abs2 };
  
  viewer.addStyle(sel1, {
    stick: { color: highlightColor, radius: 0.3 },
    sphere: { color: highlightColor, radius: 0.5 }
  });
  viewer.addStyle(sel2, {
    stick: { color: highlightColor, radius: 0.3 },
    sphere: { color: highlightColor, radius: 0.5 }
  });
}

function destroyViewer() {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (dimerViewerEl.value) {
    dimerViewerEl.value.innerHTML = '';
  }
  dimerViewer = null;
  crosslinkShape = null;
}

function waitForVisibleBox(el, token, maxFrames = 60) {
  return new Promise((resolve) => {
    let frame = 0;
    
    function check() {
      if (token !== renderToken) {
        resolve(false);
        return;
      }
      if (!el || !el.isConnected) {
        resolve(false);
        return;
      }
      
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const isHidden =
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      rect.width < 10 ||
      rect.height < 10;
      
      if (!isHidden) {
        resolve(true);
        return;
      }
      
      frame += 1;
      if (frame >= maxFrames) {
        resolve(false);
        return;
      }
      
      requestAnimationFrame(check);
    }
    
    requestAnimationFrame(check);
  });
}

async function renderDimerStructure(cifText, attempt = 0) {
  if (!cifText) return;
  const token = ++renderToken;
  
  await nextTick();
  await new Promise((r) => requestAnimationFrame(r));
  if (token !== renderToken) return;
  
  const el = dimerViewerEl.value;
  if (!el || !window.$3Dmol) {
    if (attempt < 10) {
      setTimeout(() => renderDimerStructure(cifText, attempt + 1), 120);
    }
    return;
  }
  
  const ready = await waitForVisibleBox(el, token, 60);
  if (!ready || token !== renderToken) {
    if (attempt < 6) {
      setTimeout(() => renderDimerStructure(cifText, attempt + 1), 150);
    }
    return;
  }
  
  try {
    destroyViewer();
    
    dimerViewer = window.$3Dmol.createViewer(el, {
      backgroundColor: '#141414'
    });
    
    const model = dimerViewer.addModel(cifText, 'cif');
    const atoms = model.selectedAtoms({}) || [];
    const chains = [
    ...new Set(atoms.map((a) => a.chain).filter((c) => c !== undefined && c !== null))
    ];
    
    let minB = Infinity;
    let maxB = -Infinity;
    for (const a of atoms) {
      if (typeof a.b === 'number' && Number.isFinite(a.b)) {
        if (a.b < minB) minB = a.b;
        if (a.b > maxB) maxB = a.b;
      }
    }
    
    const isUnitScale = Number.isFinite(maxB) && maxB > 0 && maxB <= 1;
    const rangeMin = Number.isFinite(minB) ? minB : isUnitScale ? 0.5 : 50;
    const rangeMax =
    Number.isFinite(maxB) && maxB > rangeMin ? maxB : isUnitScale ? 1.0 : 100;
    
    const chainAId = chains[0] || 'A';
    const chainBId = chains[1] || 'B';
    
    currentModel = model;
    currentColorRange = { rangeMin, rangeMax };
    
    applyBaseCartoonStyles(dimerViewer, currentModel, rangeMin, rangeMax);
    applyDimerCrosslinkOverlay(dimerViewer, currentModel, currentSpec.value);
    
    dimerViewer.setStyle({}, {});
    dimerViewer.setStyle(
    { chain: chainAId },
    {
      cartoon: {
        colorscheme: {
          prop: 'b',
          gradient: 'linear',
          min: rangeMin,
          max: rangeMax,
          colors: ['#bae6fd', '#38bdf8', '#0284c7', '#1e3a8a']
        }
      }
    }
    );
    
    if (chains.length > 1) {
      dimerViewer.setStyle(
      { chain: chainBId },
      {
        cartoon: {
          colorscheme: {
            prop: 'b',
            gradient: 'linear',
            min: rangeMin,
            max: rangeMax,
            colors: ['#fef08a', '#fbbf24', '#f97316', '#9a3412']
          }
        }
      }
      );
    }
    
    applyDimerCrosslinkOverlay(dimerViewer, model, currentSpec.value);
    
    dimerViewer.resize();
    dimerViewer.render();
    dimerViewer.zoomTo();
    dimerViewer.render();
    
    if (!resizeObserver && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (!dimerViewer || !dimerViewerEl.value) return;
        const r = dimerViewerEl.value.getBoundingClientRect();
        if (r.width < 10 || r.height < 10) return;
        try {
          dimerViewer.resize();
          dimerViewer.render();
        } catch {
          // Ignore transient resize glitches
        }
      });
      resizeObserver.observe(el);
    }
  } catch (err) {
    console.warn('3Dmol render failed, resetting viewer:', err);
    destroyViewer();
    if (attempt < 3 && token === renderToken) {
      setTimeout(() => renderDimerStructure(cifText, attempt + 1), 180);
    }
  }
}

let currentModel = null;
let currentColorRange = { rangeMin: 50, rangeMax: 100 };

function applyBaseCartoonStyles(viewer, model, rangeMin, rangeMax) {
  const atoms = model?.selectedAtoms({}) || [];
  const chains = [
  ...new Set(atoms.map((a) => a.chain).filter((c) => c !== undefined && c !== null))
  ];
  const chainAId = chains[0] || 'A';
  const chainBId = chains[1] || 'B';
  
  viewer.setStyle({}, {});
  viewer.setStyle(
  { chain: chainAId },
  {
    cartoon: {
      colorscheme: {
        prop: 'b',
        gradient: 'linear',
        min: rangeMin,
        max: rangeMax,
        colors: ['#bae6fd', '#38bdf8', '#0284c7', '#1e3a8a']
      }
    }
  }
  );
  
  if (chains.length > 1) {
    viewer.setStyle(
    { chain: chainBId },
    {
      cartoon: {
        colorscheme: {
          prop: 'b',
          gradient: 'linear',
          min: rangeMin,
          max: rangeMax,
          colors: ['#fef08a', '#fbbf24', '#f97316', '#9a3412']
        }
      }
    }
    );
  }
}

function refreshCrosslinkVisualization() {
  if (!dimerViewer || !currentModel) return;
  const { rangeMin, rangeMax } = currentColorRange;
  
  try {
    applyBaseCartoonStyles(dimerViewer, currentModel, rangeMin, rangeMax);
    applyDimerCrosslinkOverlay(dimerViewer, currentModel, currentSpec.value);
    dimerViewer.render();
  } catch (err) {
    console.warn('Failed to refresh crosslink highlight, re-rendering model:', err);
    if (cachedResult.value?.cifText) {
      renderDimerStructure(cachedResult.value.cifText);
    }
  }
}

// Rebuild structure only when CIF text changes
watch(
  () => cachedResult.value?.cifText,
  (newCif) => {
    currentModel = null;
    if (newCif) {
      renderDimerStructure(newCif);
    } else {
      destroyViewer();
    }
  },
  { immediate: true }
);

// Update ball-and-stick + cylinder whenever selected crosslink changes on an existing model
watch(
  () => [
    currentSpec.value?.key,
    currentSpec.value?.crosslink?.Protein1,
    currentSpec.value?.crosslink?.Protein2,
    currentSpec.value?.crosslink?.AbsPos1,
    currentSpec.value?.crosslink?.AbsPos2
  ],
  () => {
    if (cachedResult.value?.cifText && dimerViewer && currentModel) {
      refreshCrosslinkVisualization();
    }
  }
);

onBeforeUnmount(() => {
  renderToken += 1;
  destroyViewer();
});
</script>

<style scoped>
.dimer-section {
  margin: 0.75rem 1rem 1rem;
  color: #f3f4f6;
  text-align: left;
  box-sizing: border-box;
}

.dimer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.65rem;
}

.dimer-header h4 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: #ffffff;
}

.dimer-badge {
  font-size: 0.75rem;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  background: #25252e;
  border: 1px solid #3c3c4a;
  color: #cbd5e1;
}

.dimer-hint {
  font-size: 0.85rem;
  color: #9ca3af;
  margin: 0;
  line-height: 1.4;
}

.dimer-pair-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 0.85rem;
  margin-bottom: 0.75rem;
}

.dimer-xl-pos {
  color: #9ca3af;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.8rem;
}

.dimer-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.65rem;
}

.predict-dimer-btn {
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  padding: 0.45rem 0.85rem;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.predict-dimer-btn:hover:not(:disabled) {
  background: #1d4ed8;
}

.predict-dimer-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.status-cached {
  font-size: 0.75rem;
  color: #2ecc71;
  background: rgba(46, 204, 113, 0.15);
  border: 1px solid rgba(46, 204, 113, 0.35);
  padding: 2px 8px;
  border-radius: 999px;
}

.status-banner {
  font-size: 0.82rem;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  margin-bottom: 0.65rem;
  line-height: 1.35;
}

.status-banner.predicting {
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(59, 130, 246, 0.4);
  color: #bfdbfe;
}

.status-banner.queued {
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.4);
  color: #fde68a;
}

.status-banner.info {
  background: rgba(148, 163, 184, 0.12);
  border: 1px solid rgba(148, 163, 184, 0.3);
  color: #cbd5e1;
}

.status-banner.error {
  background: rgba(231, 76, 60, 0.15);
  border: 1px solid rgba(231, 76, 60, 0.45);
  color: #fca5a5;
}

/* CHANGED: Styles for the 3-column confidence metric cards */
.dimer-confidence-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.4rem;
  margin-bottom: 0.65rem;
}

.metric-card {
  background: #1e1e26;
  border: 1px solid #343440;
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.metric-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #9ca3af;
}

.metric-value {
  font-size: 0.86rem;
  font-weight: 700;
  color: #f9fafb;
  font-variant-numeric: tabular-nums;
}

.dimer-viewer-wrapper {
  margin-top: 0.5rem;
}

/* CHANGED: Styles for the two-chain pLDDT gradient legend */
.plddt-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  font-size: 0.73rem;
  color: #cbd5e1;
  margin-bottom: 0.4rem;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.legend-swatch {
  width: 22px;
  height: 9px;
  border-radius: 3px;
  display: inline-block;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.chain-a-swatch {
  background: linear-gradient(90deg, #bae6fd, #0284c7);
}

.chain-b-swatch {
  background: linear-gradient(90deg, #fde68a, #ea580c);
}

.dimer-viewer-canvas {
  width: 100%;
  height: 320px;
  position: relative;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #3a3a43;
  background: #141414;
}
</style>