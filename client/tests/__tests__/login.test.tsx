require('jest');

import * as React from 'react';
import { shallow } from 'enzyme';

import LoginPage from '../../src/components/auth/LoginPage';
import { USERNAME_KEY, PASSWORD_KEY, clearCredentials } from '../../src/util/auth';

fetch = require('./fetch-mock');
const fetchMock: any = fetch;

describe('LoginPage (Phase 5)', () => {
  let routerPush: jest.Mock;

  beforeEach(() => {
    fetchMock.mockClear();
    clearCredentials();
    localStorage.clear();
    routerPush = jest.fn();
  });

  afterEach(() => {
    clearCredentials();
    localStorage.clear();
  });

  const mountPage = () => {
    const wrapper = shallow(<LoginPage />);
    (wrapper.instance() as any).context = { router: { push: routerPush } };
    return wrapper;
  };

  it('T-FE-03: empty fields show validation and do not call the API', () => {
    const wrapper = mountPage();
    wrapper.find('form').simulate('submit', { preventDefault: () => { /* noop */ } });

    expect(fetchMock.mock.calls.length).toBe(0);
    expect(wrapper.state().error).toBeTruthy();
    expect(localStorage.getItem(USERNAME_KEY)).toBeNull();
  });

  it('T-FE-01: valid credentials probe success stores session and navigates home', () => {
    fetchMock.mockResponse(JSON.stringify({ id: 1, firstName: 'George' }), { status: 200 });

    const wrapper = mountPage();
    wrapper.setState({ username: 'admin', password: 'admin', error: null });
    return (wrapper.instance() as any).onSubmit({ preventDefault: () => { /* noop */ } }).then(() => {
      expect(fetchMock.mock.calls.length).toBe(1);
      const [requestUrl, init] = fetchMock.mock.calls[0];
      expect(requestUrl).toContain('/api/owners/1');
      expect(init.headers.Authorization).toBe('Basic ' + btoa('admin:admin'));
      expect(localStorage.getItem(USERNAME_KEY)).toBe('admin');
      expect(localStorage.getItem(PASSWORD_KEY)).toBe('admin');
      expect(routerPush).toHaveBeenCalledWith({ pathname: '/' });
    });
  });

  it('T-FE-02: invalid credentials show error and do not store session', () => {
    fetchMock.mockResponse('', { status: 401 });

    const wrapper = mountPage();
    wrapper.setState({ username: 'admin', password: 'wrong', error: null });
    return (wrapper.instance() as any).onSubmit({ preventDefault: () => { /* noop */ } }).then(() => {
      expect(localStorage.getItem(USERNAME_KEY)).toBeNull();
      expect(localStorage.getItem(PASSWORD_KEY)).toBeNull();
      expect(routerPush).not.toHaveBeenCalled();
      expect(wrapper.state().error).toBeTruthy();
    });
  });
});
