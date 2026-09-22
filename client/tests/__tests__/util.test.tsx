require('jest');

import { url, submitForm } from '../../src/util';
import { setCredentials, clearCredentials } from '../../src/util/auth';

import * as React from 'react';

fetch = require('./fetch-mock');
const fetchMock: any = fetch;

describe('util', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    clearCredentials();
    localStorage.clear();
  });

  afterEach(() => {
    clearCredentials();
    localStorage.clear();
  });

  describe('url', () => {
    it('returns url with full path', () => {
      expect(url('xxx')).toBe('http://localhost:9966/petclinic/xxx');
    });

    it('collapses a leading slash so the backend does not see a double slash', () => {
      expect(url('/xxx')).toBe('http://localhost:9966/petclinic/xxx');
    });
  });

  describe('submitForm', () => {
    it('submits all data', () => {
      fetchMock.mockResponse(JSON.stringify({ 'x': 'y' }), { status: 200 });
      return submitForm('POST', '/some-enzyme', { name: 'Test' }, (status, response) => {
        // make sure request data is passed to fetch as expected 
        expect(fetchMock.mock.calls.length).toBe(1);
        expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:9966/petclinic/some-enzyme');
        expect(fetchMock.mock.calls[0][1].method).toBe('POST');
        expect(fetchMock.mock.calls[0][1].body).toEqual(JSON.stringify({ name: 'Test' }));

        // make sure response from fetch ist corrently passed to the onSuccess callback
        expect(status).toBe(200);
        expect(response).toEqual({ 'x': 'y' });
      });
    });

    it('works with No Content (204) responses', () => {
      fetchMock.mockResponse('', { status: 204 });
      return submitForm('PUT', '/somewhere', { name: 'Test' }, (status, response) => {
        expect(fetchMock.mock.calls.length).toBe(1);
        expect(status).toBe(204);
        expect(response).toEqual({});
      });
    });

    it('T-FE-05: attaches Authorization Basic when credentials are stored', () => {
      setCredentials('admin', 'secret');
      fetchMock.mockResponse(JSON.stringify({}), { status: 200 });
      return submitForm('POST', '/api/owners', { firstName: 'A' }, () => {
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
          'Basic ' + btoa('admin:secret')
        );
      });
    });
  });
});
