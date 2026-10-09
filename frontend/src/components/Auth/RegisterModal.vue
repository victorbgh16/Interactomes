<template>
  <Modal @close="$emit('close')">
    <h3 style="margin-top:0">Create an account</h3>

    <form @submit.prevent="submit" style="display:grid; gap:10px; margin-top:12px;">
      <input v-model.trim="first_name" placeholder="First name" required />
      <input v-model.trim="last_name"  placeholder="Name"       required />
      <input v-model.trim="email" type="email" placeholder="Email" required />

      <input
          v-model="password"
          type="password"
          placeholder="Password (8 characters minimum)"
          required
          minlength="8"
          autocomplete="new-password"
      />

      <input
          v-model="confirmPassword"
          type="password"
          placeholder="Confirm password"
          required
          minlength="8"
          autocomplete="new-password"
      />

      <!-- Alerte si les deux mdp ne correspondent pas (affichée seulement si les deux sont saisis) -->
      <p v-if="password && confirmPassword && !passwordsMatch" style="color:#e66; margin:0">
        Passwords do not match.
      </p>

      <!-- Autre erreur éventuelle (API, etc.) -->
      <p v-if="err" style="color:#e66; margin:0">{{ err }}</p>

      <button :disabled="loading || !canSubmit" type="submit">
        {{ loading ? 'Creating...' : "Sign up" }}
      </button>
    </form>
  </Modal>
</template>

<script setup>
import { ref, computed } from 'vue';
import Modal from '../Modal.vue';
import { register, useAuth } from '@/services/auth.js';

const emit = defineEmits(['close','success']);
const { loading } = useAuth();

const first_name = ref('');
const last_name  = ref('');
const email      = ref('');
const password   = ref('');
const confirmPassword = ref('');
const err        = ref('');

const passwordsMatch = computed(() => password.value === confirmPassword.value);
const strongEnough   = computed(() => (password.value?.length || 0) >= 8);
const canSubmit = computed(() =>
    first_name.value.trim() &&
    last_name.value.trim() &&
    email.value.trim() &&
    strongEnough.value &&
    password.value &&
    confirmPassword.value &&
    passwordsMatch.value
);

async function submit() {
  err.value = '';

  if (!passwordsMatch.value) {
    err.value = 'Passwords do not match.';
    return;
  }
  if (!strongEnough.value) {
    err.value = 'Password must be at least 8 characters.';
    return;
  }

  try {
    await register({
      first_name: first_name.value.trim(),
      last_name:  last_name.value.trim(),
      email:      email.value.trim(),
      password:   password.value
      // Optionnel: tu peux aussi envoyer confirm_password si tu ajoutes le check côté backend
      // confirm_password: confirmPassword.value
    });
    emit('success');
    emit('close');
  } catch (e) {
    err.value = e?.response?.data?.error || "Registration failed";
  }
}
</script>
