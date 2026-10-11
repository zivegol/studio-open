(function (global) {
  'use strict';

  const OCS_USER_URL = '/ocs/v2.php/cloud/user?format=json';
  const DAV_ROOT = '/remote.php/dav/files/';
  const STORAGE_API = '/studio-core-api';
  let userPromise = null;

  function encodePath(path) {
    return String(path || '')
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/');
  }

  async function getCurrentUser() {
    if (!userPromise) {
      userPromise = fetch(`${STORAGE_API}?op=user`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      }).then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Sessione Nextcloud assente o scaduta. Accedi nuovamente.');
        }
        if (!response.ok) {
          throw new Error(`Impossibile rilevare l'utente Nextcloud (HTTP ${response.status}).`);
        }
        const data = await response.json();
        if (!data || !data.id) {
          throw new Error('La risposta Nextcloud non contiene un utente valido.');
        }
        return {
          id: String(data.id),
          displayName: String(data.displayName || data.id)
        };
      }).catch((error) => {
        userPromise = null;
        throw error;
      });
    }
    return userPromise;
  }

  async function davBase() {
    const user = await getCurrentUser();
    return `${DAV_ROOT}${encodeURIComponent(user.id)}/`;
  }

  async function davUrl(path) {
    return (await davBase()) + encodePath(path);
  }

  async function request(path, options) {
    const method = String((options && options.method) || 'GET').toUpperCase();
    if (method === 'GET') {
      return fetch(`${STORAGE_API}?op=get&path=${encodeURIComponent(path)}`, {
        credentials: 'include',
        headers: (options && options.headers) || {}
      });
    }
    const response = await fetch(await davUrl(path), {
      credentials: 'include',
      ...options
    });
    if (response.status === 401) throw new Error('Sessione Nextcloud scaduta. Accedi nuovamente.');
    if (response.status === 403) throw new Error('Non hai il permesso per questa operazione.');
    if (response.status === 507) throw new Error('Spazio Nextcloud insufficiente.');
    return response;
  }

  async function propfind(path, depth) {
    return request(path, {
      method: 'PROPFIND',
      headers: { Depth: String(depth == null ? 1 : depth) }
    });
  }

  async function put(path, data, options) {
    const headers = { 'X-Studio-Request': 'true' };
    if (options && options.contentType) headers['Content-Type'] = options.contentType;
    const response = await fetch(`${STORAGE_API}?op=put&path=${encodeURIComponent(path)}`, {
      method: 'POST', credentials: 'include', headers, body: data
    });
    if (!response.ok) {
      throw new Error(`Salvataggio Nextcloud non riuscito (HTTP ${response.status}).`);
    }
    const result = await response.json();
    return { response, etag: result.etag || response.headers.get('ETag') };
  }

  async function ensureFolder(path) {
    const response = await fetch(`${STORAGE_API}?op=ensure&path=${encodeURIComponent(path)}`, {
      method: 'POST', credentials: 'include', headers: { 'X-Studio-Request': 'true' }
    });
    if (!response.ok) {
      throw new Error(`Impossibile creare la cartella "${path}" (HTTP ${response.status}).`);
    }
  }

  global.StudioStorage = Object.freeze({
    version: '1.0.0',
    rootConvention: 'Studio/Clienti',
    encodePath,
    getCurrentUser,
    davBase,
    davUrl,
    request,
    propfind,
    put,
    ensureFolder
  });
})(window);
