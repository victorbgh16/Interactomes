import axios from 'axios';

const api = axios.create({

    // baseURL: '/',
    baseURL: 'http://localhost:3001',
});

api.interceptors.request.use((config) => {
    const tok = localStorage.getItem('token');
    if (tok) config.headers.Authorization = `Bearer ${tok}`;
    return config;
});


export default api;
