<template>
  <div class="wrap">
    <h2>All datasets</h2>

    <div class="topbar">
      <input v-model="q" type="text" placeholder="Search" /> <!-- placeholder="Filter by name, email, taxon, organelle, filename..." -->
      <span class="muted">{{ flatCount }} {{ flatCount === 1 ? 'dataset' : 'datasets' }}</span>
    </div>

    <div v-if="loading" class="muted">Loading...</div>
    <div v-else-if="err" class="error">{{ err }}</div>
    <div v-else>
      <div v-for="u in grouped" :key="u.user.id" class="user-block">
        <h3 class="user-title">
          {{ u.user.first_name }} {{ u.user.last_name }}
          <span class="muted">— {{ u.user.email }}</span>
        </h3>

        <div v-for="org in u.organisms" :key="org.taxon_id" class="org-block">
          <h4 class="org-title">
            Organism: <b>{{ org.display }}</b>
            <span class="muted"> (taxon ID: {{ org.taxon_id }})</span>
          </h4>

          <div v-for="o in org.organelles" :key="o.id" class="organelle-block">
            <h5 class="organelle-title">Organelle: <b>{{ o.name || '—' }}</b></h5>

            <ul class="ds-list">
              <li v-for="d in o.datasets" :key="d.id" class="ds-item">
                <div class="main">
                  <div class="title">#{{ d.id }} — {{ d.filename }}</div>
                  <div class="meta">
                    <span>Rows: <b>{{ d.rows_count ?? 0 }}</b></span>
                    <span>Status: <b>{{ d.status }}</b></span>
                    <span>Created: <b>{{ fmt(d.created_at) }}</b></span>
                  </div>
                </div>
                <RouterLink class="go" :to="{ name: 'graph', params: { datasetId: d.id } }">View graph →</RouterLink>
              </li>
            </ul>
          </div>
        </div>

      </div>

      <div v-if="grouped.length === 0" class="muted">No dataset matches your search.</div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, computed } from 'vue';
import { fetchAllDatasets } from '@/services/datasets';

const all = ref([]);
const loading = ref(false);
const err = ref('');
const q = ref('');

onMounted(async () => {
  loading.value = true;
  err.value = '';
  try {
    all.value = await fetchAllDatasets();
  } catch (e) {
    err.value = e?.response?.data?.error || 'Loading failed';
  } finally {
    loading.value = false;
  }
});

const flatCount = computed(() => all.value.length);

function fmt(d) {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
}

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  if (!s) return all.value;
  return all.value.filter(d => {
    const fields = [
      d.user?.first_name, d.user?.last_name, d.user?.email,
      d.organism?.scientific_name, d.organism?.common_name,
      String(d.organism?.taxon_id),
      d.organelle?.name,
      d.filename,
      d.status
    ];
    return fields.some(v => typeof v === 'string' && v.toLowerCase().includes(s));
  });
});

// Helpers pour labels d’organismes
function isFallbackLabel(s) {
  return /^taxon\s*\d+$/i.test((s || '').trim());
}
function labelFromOrganism(org) {
  return (
      org?.scientific_name ||
      org?.common_name ||
      org?.name || // sécurité si l’API a juste "name"
      null
  );
}

// Grouping: User -> Organism -> Organelle
const grouped = computed(() => {
  const byUser = new Map();

  for (const d of filtered.value) {
    // ----- User level -----
    if (!byUser.has(d.user.id)) {
      byUser.set(d.user.id, { user: d.user, orgs: new Map() });
    }
    const u = byUser.get(d.user.id);

    // ----- Organism level -----
    const tax = d.organism?.taxon_id ?? 'unknown';
    const incomingLabel = labelFromOrganism(d.organism);

    if (!u.orgs.has(tax)) {
      // Première rencontre
      u.orgs.set(tax, {
        taxon_id: tax,
        display: incomingLabel || `taxon ${tax}`,
        organs: new Map(),
      });
    } else {
      // Déjà rencontré → upgrade le label si on trouve mieux
      const orgEntry = u.orgs.get(tax);
      if (incomingLabel && isFallbackLabel(orgEntry.display)) {
        orgEntry.display = incomingLabel;
      }
    }

    const orgEntry = u.orgs.get(tax);

    // ----- Organelle level -----
    const orgId = d.organelle?.id ?? 'unknown';
    const orgName = d.organelle?.name || '—';
    if (!orgEntry.organs.has(orgId)) {
      orgEntry.organs.set(orgId, { id: orgId, name: orgName, datasets: [] });
    }
    orgEntry.organs.get(orgId).datasets.push(d);
  }

  // Map -> Array pour v-for
  return Array.from(byUser.values()).map(u => ({
    user: u.user,
    organisms: Array.from(u.orgs.values()).map(o => ({
      taxon_id: o.taxon_id,
      display: o.display,
      organelles: Array.from(o.organs.values()),
    })),
  }));
});
</script>


<style scoped>
.wrap { max-width: 1000px; margin: 28px auto; padding: 0 12px; }
.topbar { display:flex; align-items:center; gap:12px; margin: 10px 0 16px; }
.topbar input { flex:1; padding:8px 10px; border:1px solid #333; border-radius:6px; }
.muted { color:#aaa; }
.error { color:#e55; }
.user-block { border:1px solid #333; border-radius:8px; padding:12px; margin-bottom:16px; }
.user-title { margin:0 0 8px 0; }
.org-block { border-top:1px dashed #444; padding-top:8px; margin-top:8px; }
.org-title { margin:6px 0; }
.organelle-block { padding-left:10px; border-left:3px solid #333; margin:8px 0; }
.organelle-title { margin:4px 0 8px 0; }
.ds-list { list-style:none; padding:0; margin:0; }
.ds-item { display:flex; align-items:center; justify-content:space-between; border-top:1px solid #333; padding:8px 0; }
.ds-item:first-child { border-top:0; }
.title { font-weight:600; }
.meta { display:flex; gap:12px; font-size:0.9rem; margin-top:4px; color:#ccc; }
.go { text-decoration:none; }
</style>
