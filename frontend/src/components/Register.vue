<template>
  <div style="max-width:400px; margin:40px auto;">
    <h2>Create an account</h2>
    <form @submit.prevent="submit" style="display:grid; gap:8px;">
      <input v-model="first_name" placeholder="First name" required />
      <input v-model="last_name" placeholder="Name" required />
      <input v-model="email" type="email" placeholder="Email" required />
      <input v-model="password" type="password" placeholder="Password" required />
      <button :disabled="loading" type="submit">
        {{ loading ? 'Creating...' : "Sign up" }}
      </button>
      <p v-if="err" style="color:#e33">{{ err }}</p>
    </form>
    <p style="margin-top:10px;">
      Already registered?
      <RouterLink to="/login">Log in</RouterLink>
    </p>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { register, useAuth } from '../services/auth';
import { useRouter } from 'vue-router';

const { loading } = useAuth();
const first_name = ref('');
const last_name  = ref('');
const email      = ref('');
const password   = ref('');
const err        = ref('');
const router     = useRouter();

async function submit() {
  err.value = '';
  try {
    await register({
      first_name: first_name.value.trim(),
      last_name: last_name.value.trim(),
      email: email.value.trim(),
      password: password.value
    });
    router.push('/account');
  } catch (e) {
    err.value = e?.response?.data?.error || "Registration failed";
  }
}
</script>
