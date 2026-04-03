/* ═══════════════════════════════════════════════════════════════════════
   DYNAMO BOT UI INTEGRATION (Auth & Real-Time Stats)
   ═══════════════════════════════════════════════════════════════════════ */

(function initDynamoUI() {
  const DOM = {
    // Auth Elements
    loginNav: document.getElementById('btn-login-nav'),
    logoutNav: document.getElementById('btn-logout-nav'),
    loginMobile: document.getElementById('btn-login-mobile'),
    logoutMobile: document.getElementById('btn-logout-mobile'),
    loginHero: document.getElementById('btn-login-hero'),
    authContainer: document.getElementById('hero-auth-container'),
    welcomeContainer: document.getElementById('hero-welcome-message'),
    mainNavLinks: document.getElementById('main-nav-links'),
    mobileNavLinks: document.getElementById('mobile-nav-links'),
    
    // Status Elements (Desktop + Mobile)
    dots: [document.getElementById('nav-status-dot'), document.getElementById('mobile-status-dot')],
    statuses: [document.getElementById('nav-bot-status'), document.getElementById('mobile-bot-status')],
    counts: [document.getElementById('nav-server-count'), document.getElementById('mobile-server-count')]
  };

  /**
   * ACTUALIZACIÓN EN TIEMPO REAL DEL BOT
   */
  async function fetchBotStats() {
    try {
      // Sustituye esta URL por el endpoint real de tu bot (ej. https://api.tuservidor.com/stats)
      // const { ok, data } = await Http.request('URL_DE_TU_API', {}, { timeout: 5000 });
      
      // Simulación de respuesta exitosa para el diseño
      const ok = true;
      const data = { status: 'online', servers: 18987 };

      if (ok && data.status === 'online') {
        DOM.dots.forEach(el => {
          if(!el) return;
          el.style.color = 'var(--success)';
          el.classList.remove('status-dot--pulse'); // Detiene el pulso al conectar
        });
        DOM.statuses.forEach(el => {
          if(!el) return;
          el.textContent = 'Bot activo';
          el.classList.add('online');
        });
        DOM.counts.forEach(el => {
          if(!el) return;
          el.textContent = `${data.servers.toLocaleString('es-ES')} Servidores`;
        });
      }
    } catch (error) {
      Logger.error("Error obteniendo estadísticas:", error);
      DOM.dots.forEach(el => el && (el.style.color = 'var(--error)'));
      DOM.statuses.forEach(el => el && (el.textContent = 'Desconectado'));
    }
  }

  /**
   * MANEJO DE ESTADO DE SESIÓN (LOGIN/LOGOUT)
   */
  function updateUIForSession() {
    const isLoggedIn = Auth.isAuthenticated();

    if (isLoggedIn) {
      // Ocultar botones de login, mostrar logout
      if(DOM.loginNav) DOM.loginNav.style.display = 'none';
      if(DOM.logoutNav) DOM.logoutNav.style.display = 'inline-flex';
      if(DOM.loginMobile) DOM.loginMobile.style.display = 'none';
      if(DOM.logoutMobile) DOM.logoutMobile.style.display = 'inline-flex';
      
      // Hero section update
      if(DOM.authContainer) DOM.authContainer.style.display = 'none';
      if(DOM.welcomeContainer) DOM.welcomeContainer.style.display = 'block';

      // Actualizar Links de Navegación
      const authLinksHTML = `
        <li><a href="#inicio">Panel</a></li>
        <li><a href="#caracteristicas">Support</a></li>
        <li><a href="#comandos" class="nav-link-commands">Commands</a></li>
        <li><a href="#servidores">Servers</a></li>
        <li><a href="#premium" class="nav-link-premium">Premium</a></li>
      `;
      if(DOM.mainNavLinks) DOM.mainNavLinks.innerHTML = authLinksHTML;
      if(DOM.mobileNavLinks) DOM.mobileNavLinks.innerHTML = authLinksHTML.replace(/<li>|<\/li>/g, '');

    } else {
      // Mostrar botones de login, ocultar logout
      if(DOM.loginNav) DOM.loginNav.style.display = 'inline-flex';
      if(DOM.logoutNav) DOM.logoutNav.style.display = 'none';
      if(DOM.loginMobile) DOM.loginMobile.style.display = 'inline-flex';
      if(DOM.logoutMobile) DOM.logoutMobile.style.display = 'none';

      // Hero section update
      if(DOM.authContainer) DOM.authContainer.style.display = 'flex';
      if(DOM.welcomeContainer) DOM.welcomeContainer.style.display = 'none';

      // Restaurar Links de Navegación por defecto
      const defaultLinksHTML = `
        <li><a href="#inicio">Inicio</a></li>
        <li><a href="#caracteristicas">Características</a></li>
        <li><a href="#como-funciona">Ayuda</a></li>
      `;
      if(DOM.mainNavLinks) DOM.mainNavLinks.innerHTML = defaultLinksHTML;
      if(DOM.mobileNavLinks) DOM.mobileNavLinks.innerHTML = defaultLinksHTML.replace(/<li>|<\/li>/g, '');
    }
  }

  function handleLogout() {
    Auth.clearToken();
    updateUIForSession();
    Toast.success('Sesión cerrada', 'Has cerrado sesión correctamente.', 3000);
  }

  // --- Inicialización y Event Listeners ---
  
  // Eventos de Logout
  if(DOM.logoutNav) DOM.logoutNav.addEventListener('click', handleLogout);
  if(DOM.logoutMobile) DOM.logoutMobile.addEventListener('click', handleLogout);

  // NOTA PARA EL DESARROLLADOR: 
  // Para pruebas rápidas visuales del login, descomenta las líneas de abajo.
  // En producción, el login redirige a Discord por la etiqueta <a>, y a la vuelta tu backend 
  // debe ejecutar `Auth.setToken('tu-token-jwt')` para que la sesión inicie.
  
  /*
  const demoLogin = (e) => { e.preventDefault(); Auth.setToken('demo_token'); updateUIForSession(); Toast.success('Login', 'Sesión iniciada'); };
  if(DOM.loginNav) DOM.loginNav.addEventListener('click', demoLogin);
  if(DOM.loginHero) DOM.loginHero.addEventListener('click', demoLogin);
  if(DOM.loginMobile) DOM.loginMobile.addEventListener('click', demoLogin);
  */

  // Ejecutar al cargar
  fetchBotStats();
  updateUIForSession();
  
  // Opcional: Actualizar las estadísticas cada 60 segundos
  // setInterval(fetchBotStats, 60000); 

})();
