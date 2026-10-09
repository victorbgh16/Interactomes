<!-- components/Header.vue -->
<template>
  <header class="app-header">
    <div class="header-left">
      <!-- LOGO = bouton Accueil -->
      <RouterLink to="/" class="logo-link" aria-label="Go to homepage">
        <img src="@/assets/logo/networkLogo.png" alt="Logo Interactomes" class="logo" />
      </RouterLink>
      <h1 class="title">Interactomes</h1>

      <nav class="main-nav" aria-label="Main Navigation">
        <RouterLink to="/" class="nav-link">Home</RouterLink>
        <RouterLink to="/datasets" class="nav-link">Datasets</RouterLink>
        <RouterLink v-if="isLoggedIn" to="/upload" class="nav-link cta"> Upload New Graph</RouterLink>
      </nav>
    </div>


    <div class="header-right">
      <!-- Hello + Logout en ligne quand connecté -->

      <span v-if="isLoggedIn" class="hello" :title="fullName(user)">
        👋 {{ fullName(user) }}
      </span>

      <!-- Bouton profil (ouvre le menu) -->
      <button
          class="profile-button"
          aria-haspopup="menu"
          :aria-expanded="menuOpen ? 'true' : 'false'"
          aria-label="Profile"
          @click="toggleMenu"
          @keydown.escape="closeMenu"
          ref="profileBtnRef"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="icon-profile" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z" />
        </svg>
      </button>

      <!-- MENU profil -->
      <div
          v-if="menuOpen"
          class="profile-menu"
          role="menu"
          ref="menuRef"
      >
        <!-- Non connecté: ouvrir modales -->
        <template v-if="!isLoggedIn">
          <button role="menuitem" class="menu-item" @click="openLogin">
            Log in
          </button>
          <button role="menuitem" class="menu-item primary" @click="openRegister">
            Sign up
          </button>
        </template>

        <!-- Connecté: profil + logout -->
        <template v-else>
          <button role="menuitem" class="menu-item" @click="goProfile">
            My Account
          </button>
          <button role="menuitem" class="menu-item danger" @click="handleLogout">
            Log out
          </button>
        </template>

      </div>
    </div>
  </header>
</template>

<script setup>
import {ref, onMounted, onBeforeUnmount, defineProps, defineEmits} from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuth } from '@/services/auth' // adapte le chemin
const emit = defineEmits(['open-login', 'open-register', 'logout', 'go-profile'])

const { user, isLoggedIn, logout } = useAuth()
const router = useRouter()


const menuOpen = ref(false)
const profileBtnRef = ref(null)
const menuRef = ref(null)

function toggleMenu(){ menuOpen.value = !menuOpen.value }
function closeMenu(){ menuOpen.value = false }

function handleClickOutside(e){
  const btn = profileBtnRef.value, menu = menuRef.value
  if (!btn || !menu) return
  if (!btn.contains(e.target) && !menu.contains(e.target)) closeMenu()
}


onMounted(() => document.addEventListener('click', handleClickOutside, { capture: true }))
onBeforeUnmount(() => document.removeEventListener('click', handleClickOutside, { capture: true }))

function openLogin(){ closeMenu(); emit('open-login') }
function openRegister(){ closeMenu(); emit('open-register') }
function goProfile(){ closeMenu(); router.push('/account') }
function handleLogout(){ closeMenu(); logout(); router.push('/') }

function fullName(u){
  if (!u) return 'User'
  const first = u.first_name ?? ''
  const last  = u.last_name   ?? ''
  const name = `${first} ${last}`.trim()
  return name || u.username || u.email || 'User'
}
</script>

<style scoped>
.app-header {
  width: 100%;
  padding: 0.75rem 1.25rem;
  background-color: #1e1e1e;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #333;
  position: relative;
  z-index: 20;
}

/* LEFT */
.header-left { display: flex; align-items: center; gap: 0.75rem; }
.logo-link { display: inline-flex; align-items: center; text-decoration: none; }
.logo { height: 48px; }
.title { color: #fff; font-size: 1.3rem; font-weight: 700; margin-right: 0.75rem; }

.main-nav { display: flex; gap: 0.75rem; margin-left: 0.5rem; border-left: 1px solid #2a2a2a; padding-left: 0.75rem; }
.nav-link {
  color: #cfcfcf; text-decoration: none; padding: 0.35rem 0.55rem; border-radius: 6px;
  transition: background-color 120ms ease, color 120ms ease;
}

.nav-link.cta {
  color: #4a90e2; /* bleu plus visible */
  font-weight: 600;
  border: 1px solid transparent;
  background-color: transparent;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.nav-link.cta:hover {
  color: #fff;
  background-color: #4a90e2;
}

.nav-link:hover, .nav-link.router-link-active { color: #fff; background-color: #2a2a2a; }

/* RIGHT */
.header-right { display: flex; align-items: center; position: relative; gap: 0.5rem; }
.hello { color: #e9e9e9; font-size: 0.95rem; margin-right: 0.25rem; white-space: nowrap; }

.profile-button {
  background: none; border: none; cursor: pointer; padding: 0.15rem; color: #fff; border-radius: 8px;
  transition: background-color 120ms ease;
}
.profile-button:hover { background-color: #2a2a2a; }
.icon-profile { width: 28px; height: 28px; }

/* MENU */
.profile-menu {
  position: absolute; top: calc(100% + 8px); right: 0; min-width: 220px;
  background: #1c1c1c; border: 1px solid #303030; border-radius: 10px; box-shadow: 0 10px 28px rgba(0,0,0,0.45);
  padding: 0.4rem; display: flex; flex-direction: column; gap: 0.25rem;
  animation: dropIn 120ms ease-out;
}
@keyframes dropIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }

.menu-item {
  display: block; width: 100%; padding: 0.6rem 0.75rem; text-decoration: none; color: #e9e9e9;
  border-radius: 8px; background: transparent; text-align: left;
  transition: background-color 120ms ease, color 120ms ease;
}
.menu-item:hover { background: #2a2a2a; }
.menu-item.primary { background: #2a2a2a; color: #fff; font-weight: 600; }
.menu-item.primary:hover { background: #343434; }
.menu-item.danger { color: #ffb3b3; }
.menu-item.danger:hover { background: #332020; }

@media (max-width: 860px) {
  .title { display: none; }
  .main-nav { display: none; }
}

</style>
