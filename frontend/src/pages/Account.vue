<template>
  <div style="max-width:900px; margin:40px auto; padding:0 12px;">
    <h2>My Account</h2>

    <div v-if="loading">Loading...</div>

    <template v-else>
      <div v-if="user">
        <ul>
          <li><b>ID:</b> {{ user.id }}</li>
          <li><b>First name:</b> {{ user.first_name }}</li>
          <li><b>Name:</b> {{ user.last_name }}</li>
          <li><b>Email:</b> {{ user.email }}</li>
          <li><b>Created on:</b> {{ new Date(user.created_at).toLocaleString() }}</li>
        </ul>

        <!-- Mes datasets -->
        <section style="margin-top:20px; border:1px solid #333; border-radius:8px; padding:12px;">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <h3 style="margin:0;">My datasets</h3>
            <RouterLink to="/upload" class="btn">Upload a graph</RouterLink>
          </div>

          <div v-if="datasetsLoading" class="muted" style="margin-top:8px;">Loading datasets...</div>
          <div v-else-if="datasetsError" class="error" style="margin-top:8px;">{{ datasetsError }}</div>
          <div v-else-if="datasets.length === 0" class="muted" style="margin-top:8px;">No datasets available at this time.</div>

          <ul v-else class="list">
            <li v-for="d in datasets" :key="d.id" class="item">
              <div class="main">
                <RouterLink class="title" :to="{ name: 'graph', params: { datasetId: d.id } }">
                  #{{ d.id }} — {{ d.filename }}
                </RouterLink>

                <div class="meta">
                  <span>Organelle: <b>{{ d.organelle?.name ?? '—' }}</b></span>
                  <span>Taxon: <b>{{ d.organism?.taxon_id }}</b></span>
                  <span>Rows: <b>{{ d.rows_count ?? 0 }}</b></span>
                  <span>Status: <b>{{ d.status }}</b></span>
                  <span>Created: <b>{{ formatDate(d.created_at) }}</b></span>
                </div>

                <!-- 🆕 Notes (experiment / description) -->
                <div v-if="d.experiment || d.description" class="notes">
                  <div v-if="d.experiment" class="note">
                    <span class="note-label">Experiment</span>
                    <div class="note-bubble">{{ d.experiment }}</div>
                  </div>
                  <div v-if="d.description" class="note">
                    <span class="note-label">Description</span>
                    <div class="note-bubble">{{ d.description }}</div>
                  </div>
                </div>
              </div>

              <RouterLink class="go" :to="{ name: 'graph', params: { datasetId: d.id } }">
                See graph →
              </RouterLink>
            </li>
          </ul>
        </section>

      </div>

      <div v-else>
        <p>Not connected.</p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useAuth, me } from '../services/auth.js';
import { fetchMyDatasets } from '../services/datasets';

const { user, loading, isLoggedIn } = useAuth();

const datasets = ref([]);
const datasetsLoading = ref(false);
const datasetsError = ref('');

function formatDate(d) {
  try { return new Date(d).toLocaleString(); } catch { return d; }
}

onMounted(async () => {
  try { await me(); } catch {}
  if (!isLoggedIn.value) return;
  datasetsLoading.value = true;
  datasetsError.value = '';
  try {
    datasets.value = await fetchMyDatasets();
  } catch (e) {
    datasetsError.value = e?.response?.data?.error || 'Loading not possible.';
  } finally {
    datasetsLoading.value = false;
  }
});
</script>

<style scoped>
.btn { border:1px solid #4caf50; padding:6px 10px; border-radius:6px; text-decoration:none; }
.muted { color:#aaa; }
.error { color:#e55; }
.list { list-style:none; padding:0; margin:10px 0 0; }
.item { display:flex; align-items:center; justify-content:space-between; border-top:1px solid #333; padding:10px 0; }
.item:first-child { border-top:0; }
.title { font-weight:600; text-decoration:none; }
.meta { display:flex; flex-wrap:wrap; gap:12px; font-size:0.9rem; margin-top:4px; }
.go { text-decoration:none; }

.notes { margin-top: 8px; display: grid; gap: 8px; }
.note { display: grid; gap: 4px; }
.note-label {
  font-weight: 600;
  font-size: .9rem;
  color: #ddd;
}
.note-bubble {
  background: #2f2f37;
  border: 1px solid #3a3a43;
  border-radius: 6px;
  padding: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  color: #eaeaea;
}

</style>
