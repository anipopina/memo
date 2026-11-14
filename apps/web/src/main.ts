import { createApp } from 'vue';
import App from './App.vue';
import OAuthConsent from './components/OAuthConsent.vue';
import './style.css';
createApp(location.pathname === '/connect' ? OAuthConsent : App).mount('#app');
