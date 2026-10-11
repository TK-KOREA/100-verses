// 서버 요청. 헤더 없이 보낸다: GET은 쿼리, POST는 JSON 문자열 본문(Content-Type 지정 안 함 → text/plain).
import { API_URL, TIMEOUT_MS, RETRIES } from './config.js';

export class ApiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

async function once(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      // 구글 오류 페이지(404 등)는 연결 오류로 본다.
      throw new ApiError('NETWORK', 'HTTP ' + r.status);
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('NETWORK', e.name === 'AbortError' ? 'timeout' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

async function request(url, init) {
  if (!API_URL) throw new ApiError('OFFLINE_ONLY');
  let lastErr;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      const json = await once(url, init);
      if (!json.ok) throw new ApiError(json.error?.code || 'SERVER', json.error?.message);
      return json.data;
    } catch (e) {
      lastErr = e;
      if (e.code !== 'NETWORK') throw e; // 서버가 답한 오류는 다시 보내지 않는다.
    }
  }
  throw lastErr;
}

export function get(action, params = {}) {
  const q = new URLSearchParams({ action, ...params });
  return request(API_URL + '?' + q.toString(), { method: 'GET' });
}

// POST는 request_id로 서버가 한 번만 저장하므로 다시 보내도 안전하다.
export function post(action, body = {}) {
  return request(API_URL, { method: 'POST', body: JSON.stringify({ action, ...body }) });
}
