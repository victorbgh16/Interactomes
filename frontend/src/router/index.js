import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '@/pages/HomePage.vue'
import UploadPage from '@/pages/UploadPage.vue';
import AccountPage from '../pages/Account.vue'

function requireAuth(to, from, next) {
    const tok = localStorage.getItem('token');
    if (!tok) return next({ name: 'login', query: { redirect: to.fullPath } });
    next();
}

const routes = [
    {
        path: '/',
        name: 'Home',
        component: HomePage
    },
    {
        path: '/account',
        name: 'account',
        component: AccountPage,
        beforeEnter: requireAuth
    },
    { 
        path: '/upload',
        name: 'upload',
        component: UploadPage,
        beforeEnter: requireAuth
    },
    { path: '/graph/:datasetId',
        name: 'graph',
        component: () => import('../pages/GraphView.vue')
    },
    { path: '/datasets',
        name: 'datasetsDirectory',
        component: () => import('../pages/DatasetsView.vue')
    }

]

const router = createRouter({
    history: createWebHistory(),
    routes,
})

export default router
