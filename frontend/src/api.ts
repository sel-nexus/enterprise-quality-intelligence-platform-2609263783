/** Call the local API using its same-origin browser session. */
export interface User { id: string; name: string; email: string; role: string; status: string }
const base = import.meta.env.VITE_API_BASE || '';

/** Send a request and translate HTTP errors into visible messages. */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, { ...options, credentials: 'same-origin' });
  if (!response.ok) {
    if (response.status === 401 && path.endsWith('/login')) throw new Error('Invalid email or password.');
    if (response.status === 401) throw new Error('Your session has expired. Please sign in again.');
    throw new Error('The service could not complete your request. Please try again.');
  }
  return response.json() as Promise<T>;
}

/** Verify credentials and return the server's identity. */
export async function login(email: string, password: string): Promise<User> {
  const result = await request<{ user: User }>('/api/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  });
  return result.user;
}

/** Resolve the existing session from the API. */
export const me = () => request<User>('/api/v1/auth/me');
/** Clear the browser's session cookie. */
export const logout = () => request<{ message: string }>('/api/v1/auth/logout', { method: 'POST' });
