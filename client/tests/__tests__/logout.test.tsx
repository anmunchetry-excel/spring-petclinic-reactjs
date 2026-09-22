require('jest');

import * as React from 'react';
import { shallow } from 'enzyme';

import Menu from '../../src/components/Menu';
import { submitForm } from '../../src/util';
import {
  USERNAME_KEY,
  PASSWORD_KEY,
  setCredentials,
  clearCredentials,
  isLoggedIn,
  basicAuthHeader,
  requireAuth,
  logout
} from '../../src/util/auth';

fetch = require('./fetch-mock');
const fetchMock: any = fetch;

describe('logout (Phase 6)', () => {
  let originalLocation: Location;

  beforeEach(() => {
    fetchMock.mockClear();
    clearCredentials();
    localStorage.clear();
    originalLocation = window.location;
    delete (window as any).location;
    (window as any).location = { href: '' };
  });

  afterEach(() => {
    clearCredentials();
    localStorage.clear();
    (window as any).location = originalLocation;
  });

  it('T-FE-07: logout clears local storage credentials', () => {
    setCredentials('admin', 'admin');
    expect(isLoggedIn()).toBe(true);

    const redirect = logout();

    expect(localStorage.getItem(USERNAME_KEY)).toBeNull();
    expect(localStorage.getItem(PASSWORD_KEY)).toBeNull();
    expect(isLoggedIn()).toBe(false);
    expect(redirect).toBe('/login');
  });

  it('T-FE-07b: Menu Logout click clears storage and navigates to /login', () => {
    setCredentials('admin', 'admin');
    const menu = shallow(<Menu name='/' />);
    const logoutLink = menu.findWhere(n => n.type() === 'a' && n.prop('title') === 'log out');
    logoutLink.simulate('click', { preventDefault: () => { /* noop */ } });

    expect(localStorage.getItem(USERNAME_KEY)).toBeNull();
    expect(localStorage.getItem(PASSWORD_KEY)).toBeNull();
    expect(window.location.href).toBe('/login');
  });

  it('T-FE-08: after logout nav shows Login; no Basic header on next fetch', () => {
    setCredentials('admin', 'admin');
    logout();

    const menu = shallow(<Menu name='/login' />);
    expect(menu.findWhere(n => n.name() === 'MenuItem' && n.prop('url') === '/login').length).toBe(1);
    expect(menu.findWhere(n => n.type() === 'a' && n.prop('title') === 'log out').length).toBe(0);
    expect(basicAuthHeader()).toEqual({});

    fetchMock.mockResponse(JSON.stringify({}), { status: 200 });
    return submitForm('POST', '/api/owners', { firstName: 'A' }, () => {
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    });
  });

  it('T-FE-09: after logout protected route guard redirects to /login', () => {
    setCredentials('admin', 'admin');
    logout();

    const replace = jest.fn();
    requireAuth({ location: { pathname: '/owners/list' } }, replace);
    expect(replace).toHaveBeenCalledWith({ pathname: '/login' });
  });
});
