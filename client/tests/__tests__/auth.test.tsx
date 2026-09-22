require('jest');

import {
  USERNAME_KEY,
  PASSWORD_KEY,
  getCredentials,
  setCredentials,
  clearCredentials,
  isLoggedIn,
  basicAuthHeader,
  requireAuth
} from '../../src/util/auth';

describe('auth helpers (Phase 5)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('credentials storage', () => {
    it('T-FE-01: setCredentials stores username and password', () => {
      setCredentials('admin', 'admin');
      expect(localStorage.getItem(USERNAME_KEY)).toBe('admin');
      expect(localStorage.getItem(PASSWORD_KEY)).toBe('admin');
      expect(getCredentials()).toEqual({ username: 'admin', password: 'admin' });
      expect(isLoggedIn()).toBe(true);
    });

    it('T-FE-02: clearCredentials empties storage (invalid login must not leave credentials)', () => {
      setCredentials('admin', 'admin');
      clearCredentials();
      expect(localStorage.getItem(USERNAME_KEY)).toBeNull();
      expect(localStorage.getItem(PASSWORD_KEY)).toBeNull();
      expect(getCredentials()).toBeNull();
      expect(isLoggedIn()).toBe(false);
    });

    it('T-FE-03: empty username or password is not treated as logged in', () => {
      expect(isLoggedIn()).toBe(false);
      localStorage.setItem(USERNAME_KEY, '');
      localStorage.setItem(PASSWORD_KEY, 'x');
      expect(isLoggedIn()).toBe(false);
      expect(getCredentials()).toBeNull();
    });
  });

  describe('basicAuthHeader', () => {
    it('T-FE-05: with storage set returns Authorization Basic header', () => {
      setCredentials('admin', 'admin');
      const header = basicAuthHeader();
      expect(header).toEqual({
        Authorization: 'Basic ' + btoa('admin:admin')
      });
    });

    it('T-FE-05b: with empty storage returns empty object (no Authorization)', () => {
      expect(basicAuthHeader()).toEqual({});
    });
  });

  describe('requireAuth route guard', () => {
    it('T-FE-06: unauthenticated visit redirects to /login', () => {
      const replace = jest.fn();
      requireAuth({ location: { pathname: '/owners/list' } }, replace);
      expect(replace).toHaveBeenCalledWith({ pathname: '/login' });
    });

    it('T-FE-06b: authenticated visit does not redirect', () => {
      setCredentials('admin', 'admin');
      const replace = jest.fn();
      requireAuth({ location: { pathname: '/owners/list' } }, replace);
      expect(replace).not.toHaveBeenCalled();
    });
  });
});
