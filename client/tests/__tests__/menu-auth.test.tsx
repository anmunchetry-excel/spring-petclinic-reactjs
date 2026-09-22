require('jest');

import * as React from 'react';
import { shallow } from 'enzyme';

import Menu from '../../src/components/Menu';
import { setCredentials, clearCredentials } from '../../src/util/auth';

describe('Menu auth links (Phase 5)', () => {
  beforeEach(() => {
    clearCredentials();
    localStorage.clear();
  });

  afterEach(() => {
    clearCredentials();
    localStorage.clear();
  });

  it('shows Login link when logged out', () => {
    const menu = shallow(<Menu name='/' />);
    const loginItem = menu.findWhere(n => n.name() === 'MenuItem' && n.prop('url') === '/login');
    expect(loginItem.length).toBe(1);
    expect(loginItem.prop('title')).toBe('log in');
    expect(menu.findWhere(n => n.type() === 'a' && n.prop('title') === 'log out').length).toBe(0);
  });

  it('T-FE-04: shows Logout (not Login) when logged in', () => {
    setCredentials('admin', 'admin');
    const menu = shallow(<Menu name='/' />);
    expect(menu.findWhere(n => n.name() === 'MenuItem' && n.prop('url') === '/login').length).toBe(0);
    const logout = menu.findWhere(n => n.type() === 'a' && n.prop('title') === 'log out');
    expect(logout.length).toBe(1);
    expect(logout.text()).toContain('Logout');
  });
});
