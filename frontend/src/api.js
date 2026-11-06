/** Cliente da API do backend. O frontend nunca vê tokens do Instagram. */
export class ApiError extends Error {
  constructor(info, status) {
    super(info?.message || 'Erro de comunicação com o servidor.');
    this.code = info?.code || 'NETWORK';
    this.hint = info?.hint;
    this.details = info?.details;
    this.status = status;
  }
}

async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError({ code: 'NETWORK', message: 'Servidor indisponível. Verifique se o backend está rodando.' }, 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (data?.error?.code === 'ACCESS_REQUIRED') window.dispatchEvent(new Event('sorteio:locked'));
    throw new ApiError(data?.error, res.status);
  }
  return data;
}

export const api = {
  access: () => request('GET', '/api/access'),
  unlock: (password) => request('POST', '/api/access', { password }),
  authStatus: () => request('GET', '/api/auth/status'),
  logout: () => request('POST', '/api/auth/logout', {}),
  connectToken: (token) => request('POST', '/api/auth/token', { token }),
  saveApp: (appId, appSecret) => request('POST', '/api/auth/app', { appId, appSecret }),
  state: () => request('GET', '/api/state'),
  collect: (url) => request('POST', '/api/collect', { url }),
  job: (id) => request('GET', `/api/collect/${id}`),
  importList: (text, label) => request('POST', '/api/import', { text, label }),
  saveSettings: (settings) => request('PUT', '/api/settings', settings),
  participants: (params) => request('GET', `/api/participants?${new URLSearchParams(params)}`),
  draw: () => request('POST', '/api/draw', {}),
  removeWinner: (id) => request('DELETE', `/api/winners/${encodeURIComponent(id)}`),
  reset: () => request('POST', '/api/reset', {}),
};
