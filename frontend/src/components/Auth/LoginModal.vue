<template>
  <Modal @close="$emit('close')">
    <h3 style="margin-top:0">Log in</h3>
    <form @submit.prevent="submit" style="display:grid; gap:10px; margin-top:12px;">
      <input v-model="email" type="email" placeholder="Email" required />
      <input v-model="password" type="password" placeholder="Password" required />
      <button :disabled="loading" type="submit">
        {{ loading ? 'Logging in...' : 'Log in' }}
      </button>
      <p v-if="err" style="color:#e66; margin:0">{{ err }}</p>
    </form>
  </Modal>
</template>

<script setup>
import { ref } from 'vue';
import Modal from '../Modal.vue';
import { login, useAuth } from '@/services/auth.js';

const emit = defineEmits(['close','success']);
const { loading } = useAuth();

const email = ref('');
const password = ref('');
const err = ref('');

async function submit() {
  err.value = '';
  try {
    await login({ email: email.value.trim(), password: password.value });
    emit('success');
    emit('close');
  } catch (e) {
    err.value = e?.response?.data?.error || 'Connection failed';
  }
}
</script>
