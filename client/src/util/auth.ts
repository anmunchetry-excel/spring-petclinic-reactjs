/**
 * SPA auth helpers (Option A — HTTP Basic + localStorage).
 * Keys and behaviour: docs/authentication/SIMPLE_AUTH_PRD.md
 */

export const USERNAME_KEY = 'petclinic.username';
export const PASSWORD_KEY = 'petclinic.password';

export interface ICredentials {
  username: string;
  password: string;
}

export const getCredentials = (): ICredentials | null => {
  const username = localStorage.getItem(USERNAME_KEY);
  const password = localStorage.getItem(PASSWORD_KEY);
  if (!username || !password) {
    return null;
  }
  return { username, password };
};

export const setCredentials = (username: string, password: string): void => {
  localStorage.setItem(USERNAME_KEY, username);
  localStorage.setItem(PASSWORD_KEY, password);
};

export const clearCredentials = (): void => {
  localStorage.removeItem(USERNAME_KEY);
  localStorage.removeItem(PASSWORD_KEY);
};

export const isLoggedIn = (): boolean => getCredentials() !== null;

/**
 * End the SPA session. Clears localStorage credentials.
 * Returns the path callers should navigate to (`/login`).
 */
export const logout = (): string => {
  clearCredentials();
  return '/login';
};

export const basicAuthHeader = (): { Authorization?: string } => {
  const creds = getCredentials();
  if (!creds) {
    return {};
  }
  return {
    Authorization: 'Basic ' + btoa(creds.username + ':' + creds.password)
  };
};

/** Merge Accept / Content-Type / caller headers with Basic when logged in. */
export const requestHeaders = (extra: { [key: string]: string } = {}): { [key: string]: string } => {
  return Object.assign(
    { 'Accept': 'application/json' },
    extra,
    basicAuthHeader()
  );
};

/** react-router v2 onEnter guard — redirect to /login when not authenticated. */
export const requireAuth = (nextState: any, replace: (loc: { pathname: string }) => void): void => {
  if (!isLoggedIn()) {
    replace({ pathname: '/login' });
  }
};
