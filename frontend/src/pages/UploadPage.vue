<template>
  <div style="max-width:900px; margin:30px auto;">
    <h2>Upload a graph (CSV)</h2>

    <section style="border:1px solid #333; padding:16px; border-radius:8px;">
      <!-- Organelle obligatoire -->
      <label style="display:block; margin-bottom:10px;">
        <b>Organelle:</b>
        <select
            v-model.number="selectedOrganelleId"
            style="margin-left:8px;"
            :disabled="isBusy"
        >
          <option :value="0" disabled>Select an organelle…</option>
          <option v-for="o in organelles" :key="o.id" :value="o.id">{{ o.name }}</option>
        </select>
      </label>

      <!-- Fichier : activé quand organelle choisie, désactivé si busy -->
      <input
          type="file"
          accept=".csv,text/csv"
          :disabled="!selectedOrganelleId || isBusy"
          @change="onFile"
      />
      <small v-if="!selectedOrganelleId" style="color:#aaa; display:block; margin-top:6px;">
        Select an organelle first to enable file upload.
      </small>

      <p v-if="err" style="color:#e55">{{ err }}</p>
    </section>

    <section v-if="analysis" style="margin-top:20px; border:1px solid #333; padding:16px; border-radius:8px;">
      <h3>File analysis</h3>
      <ul>
        <li><b>File:</b> {{ analysis.filename }}</li>
        <li><b>SHA-256:</b> <code>{{ analysis.file_sha256 }}</code></li>
        <li><b>Organism (taxon):</b> {{ analysis.organism_taxon_id }}</li>
        <li><b>Organelle:</b> {{ analysis.organelle.name }} (id={{ analysis.organelle.id }})</li>
      </ul>

      <div v-if="existingDatasets.length">
        <h4>Existing datasets (same organism & organelle)</h4>
        <ul>
          <li v-for="d in existingDatasets" :key="d.id">
            #{{ d.id }} — {{ d.filename }} — {{ d.rows_count }} rows — {{ d.status }} — {{ new Date(d.created_at).toLocaleString() }}
          </li>
        </ul>
      </div>
      <div v-else>
        <em>No existing dataset for this organism/organelle.</em>
      </div>

      <h4 style="margin-top:16px;">Choice</h4>
      <label style="display:block; margin:6px 0;">
        <input type="radio" value="create" v-model="mode" :disabled="isBusy" /> Create a new dataset
      </label>
      <label v-if="existingDatasets.length" style="display:block; margin:6px 0;">
        <input type="radio" value="append" v-model="mode" :disabled="isBusy" /> Complete a dataset
      </label>

      <div v-if="mode==='append' && existingDatasets.length" style="margin-top:8px;">
        <select v-model.number="selectedDatasetId" :disabled="isBusy">
          <option disabled value="">Select a dataset</option>
          <option v-for="d in existingDatasets" :key="d.id" :value="d.id">
            #{{ d.id }} — {{ d.filename }} ({{ d.rows_count }} rows)
          </option>
        </select>
      </div>
      <h4 style="margin-top:16px;">Experiment & Description (optional)</h4>
      <div style="display:grid; gap:10px; grid-template-columns: 1fr;">
        <label>
          <div style="font-weight:600; margin-bottom:4px;">Experiment</div>
          <textarea
              v-model="formExperiment"
              :disabled="isBusy"
              rows="3"
              placeholder="e.g. Crosslinking conditions, sample prep, instrument..."
              style="width:100%; resize:vertical;"
          ></textarea>
        </label>

        <label>
          <div style="font-weight:600; margin-bottom:4px;">Description / Comment</div>
          <textarea
              v-model="formDescription"
              :disabled="isBusy"
              rows="3"
              placeholder="Any notes you want to attach to this dataset…"
              style="width:100%; resize:vertical;"
          ></textarea>
        </label>
      </div>



      <button
          :disabled="isBusy || (mode==='append' && !selectedDatasetId)"
          style="margin-top:12px;"
          @click="commit"
      >
        {{ submitting ? 'Importing…' : 'Import' }}
      </button>

      <!-- Progress -->
      <div v-if="submitting" class="import-progress">
        <div class="progress-track"><div class="progress-bar" :style="{ width: progress + '%' }"></div></div>
        <div class="progress-status">
          <span class="left">{{ statusText }}</span>
          <span class="right">{{ progress }}%</span>
        </div>
        <ul class="import-logs"><li v-for="(msg, i) in stepLogs" :key="i">{{ msg }}</li></ul>
      </div>

      <!-- Préparation en cours (quand ré-analyse suite au changement d’organelle) -->
      <div v-if="preparing" style="margin-top:10px; color:#bbb;">
        Re-analyzing with selected organelle…
      </div>

      <p v-if="okMsg" style="color:#5c5; margin-top:10px;">{{ okMsg }}</p>
      <p v-if="errCommit" style="color:#e55; margin-top:10px;">{{ errCommit }}</p>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed } from 'vue';
import { prepareUpload, commitUpload } from '../services/upload';
import { fetchOrganelles } from '../services/organelles';
import router from '@/router';

const organelles = ref([]);
const selectedOrganelleId = ref(0);
const formExperiment = ref('');
const formDescription = ref('');

const file = ref(null);
const err = ref('');
const analysis = ref(null);
const existingDatasets = ref([]);
const mode = ref('create');
const selectedDatasetId = ref('');

const preparing = ref(false);
const submitting = ref(false);
const okMsg = ref('');
const errCommit = ref('');

const progress = ref(0);
const statusText = ref('');
const stepLogs = ref([]);

const isBusy = computed(() => preparing.value || submitting.value);

// petit “token” pour ignorer les réponses obsolètes si l’utilisateur change vite
let prepareSeq = 0;

onMounted(async () => {
  try {
    organelles.value = await fetchOrganelles();
  } catch (e) {
    console.error('organelles load error', e);
  }
});

function setProgressSmooth(target, durationMs = 600) {
  const start = progress.value;
  const delta = Math.max(0, target - start);
  if (delta === 0) return;
  const steps = Math.max(1, Math.floor(durationMs / 50));
  let i = 0;
  const timer = setInterval(() => {
    i++;
    progress.value = Math.min(target, Math.round(start + (delta * i) / steps));
    if (i >= steps) clearInterval(timer);
  }, 50);
}

async function runPrepare() {
  if (!file.value || !selectedOrganelleId.value) return;
  if (submitting.value) return; // pas de prepare pendant un commit

  const mySeq = ++prepareSeq;
  err.value = '';
  preparing.value = true;
  analysis.value = null;
  existingDatasets.value = [];
  okMsg.value = '';
  errCommit.value = '';

  try {
    const data = await prepareUpload(file.value, selectedOrganelleId.value);
    // si une autre requête a été lancée entre-temps, on ignore ce résultat
    if (mySeq !== prepareSeq) return;

    analysis.value = data.analysis;
    existingDatasets.value = data.existingDatasets || [];
    mode.value = 'create';
    selectedDatasetId.value = '';
  } catch (e2) {
    if (mySeq === prepareSeq) {
      err.value = e2?.response?.data?.error || 'Analysis failed';
    }
  } finally {
    if (mySeq === prepareSeq) preparing.value = false;
  }
}

async function onFile(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  file.value = f;
  await runPrepare();
}

// ▶ re-analyse immédiate si l’organelle change et qu’un fichier est déjà choisi
watch(selectedOrganelleId, async (newId) => {
  if (!newId) {
    // orga désélectionnée : on garde le fichier mais on efface l’analyse
    analysis.value = null;
    existingDatasets.value = [];
    return;
  }
  // si un fichier est déjà connu et qu’on n’est pas en import, relance prepare
  if (file.value && !submitting.value) {
    await runPrepare();
  }
});

async function commit() {
  if (!analysis.value) return;

  submitting.value = true;
  okMsg.value = '';
  errCommit.value = '';
  progress.value = 0;
  statusText.value = 'Preparing…';
  stepLogs.value = [];

  stepLogs.value.push(`Organism (taxon): ${analysis.value.organism_taxon_id}`);
  stepLogs.value.push(`Organelle: ${analysis.value.organelle.name} (id=${analysis.value.organelle.id})`);
  stepLogs.value.push(`File: ${analysis.value.filename}`);

  try {
    setProgressSmooth(20, 400);
    statusText.value = 'Verifying / creating proteins…';

    const payload = {
      file_sha256: analysis.value.file_sha256,
      filename: analysis.value.filename,
      organism_taxon_id: analysis.value.organism_taxon_id,
      organelle_id: analysis.value.organelle.id,
      mode: mode.value,
      dataset_id: mode.value === 'append' ? Number(selectedDatasetId.value) : undefined,
      experiment:  (formExperiment.value?.trim()  || undefined),
      description: (formDescription.value?.trim() || undefined)
    };

    setTimeout(() => setProgressSmooth(55, 800), 250);
    setTimeout(() => { statusText.value = 'Inserting crosslinks…'; setProgressSmooth(85, 900); }, 900);

    const res = await commitUpload(payload);

    statusText.value = 'Finalizing…';
    setProgressSmooth(100, 300);

    const inserted = res?.inserted_crosslinks ?? 0;
    const proteins = res?.checked_proteins ?? 0;
    const ds = res?.dataset;

    stepLogs.value.push(`Proteins verified/created: ${proteins}`);
    stepLogs.value.push(`Crosslinks inserted: ${inserted}`);
    if (ds?.rows_count != null) stepLogs.value.push(`Total crosslinks in dataset: ${ds.rows_count}`);

    okMsg.value = `Success — dataset #${ds?.id ?? '?'}, ${inserted} crosslinks imported`;
    router.push({ name: 'graph', params: { datasetId: ds.id } });
  } catch (e3) {
    errCommit.value = e3?.response?.data?.error || e3?.message || 'Import failed';
    statusText.value = 'Error';
  } finally {
    setTimeout(() => { submitting.value = false; }, 600);
  }
}
</script>




<style scoped>
.import-progress {
  margin-top: 12px;
}

.progress-track {
  width: 100%;
  height: 10px;
  background: #2d2d2d;
  border: 1px solid #3a3a3a;
  border-radius: 999px;
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #4CAF50, #7ad37d);
  transition: width 0.25s ease;
}

.progress-status {
  display: flex;
  justify-content: space-between;
  color: #e6e6e6;
  font-size: 0.9rem;
  margin-top: 6px;
}
.progress-status .left { opacity: .9; }
.progress-status .right { font-variant-numeric: tabular-nums; }


.import-logs li {
  margin: 2px 0;
  list-style: disc;
}

.import-progress { margin-top: 12px; }
.progress-track { height: 8px; background:#2b2b32; border-radius: 999px; overflow:hidden; }
.progress-bar { height: 100%; background:#3b82f6; transition: width .2s ease; }
.progress-status {
  display:flex; justify-content:space-between; font-size:.9rem; color:#ddd; margin-top:6px;
}
.import-logs { margin-top:8px; padding-left:18px; color:#bbb; max-height:120px; overflow:auto; }
</style>

