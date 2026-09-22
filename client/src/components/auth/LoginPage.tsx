import * as React from 'react';

import { IRouterContext } from '../../types';
import { url } from '../../util';
import { setCredentials, clearCredentials, requestHeaders } from '../../util/auth';

interface ILoginPageState {
  username: string;
  password: string;
  error: string | null;
  submitting: boolean;
}

/** Login probe — seeded owner; 2xx means Basic credentials are valid. */
const LOGIN_PROBE_PATH = 'api/owners/1';

export default class LoginPage extends React.Component<{}, ILoginPageState> {
  context: IRouterContext;

  static contextTypes = {
    router: React.PropTypes.object.isRequired
  };

  constructor(props) {
    super(props);
    this.onFieldChange = this.onFieldChange.bind(this);
    this.onSubmit = this.onSubmit.bind(this);
    this.state = {
      username: '',
      password: '',
      error: null,
      submitting: false
    };
  }

  onFieldChange(event) {
    const { name, value } = event.target;
    this.setState({ [name]: value, error: null } as any);
  }

  onSubmit(event) {
    event.preventDefault();

    const { username, password } = this.state;
    if (!username || !username.trim() || !password || !password.trim()) {
      this.setState({ error: 'Username and password are required.' });
      return Promise.resolve();
    }

    this.setState({ submitting: true, error: null });

    // Do not persist until the probe succeeds (T-FE-02).
    clearCredentials();

    const headers = requestHeaders();
    headers['Authorization'] = 'Basic ' + btoa(username.trim() + ':' + password);

    return fetch(url(LOGIN_PROBE_PATH), { method: 'GET', headers })
      .then(response => {
        if (response.status >= 200 && response.status < 300) {
          setCredentials(username.trim(), password);
          this.setState({ submitting: false, error: null });
          this.context.router.push({ pathname: '/' });
          return;
        }
        this.setState({
          submitting: false,
          error: 'Invalid username or password.'
        });
      })
      .catch(() => {
        this.setState({
          submitting: false,
          error: 'Could not reach the server. Try again.'
        });
      });
  }

  render() {
    const { username, password, error, submitting } = this.state;

    return (
      <span>
        <h2>Login</h2>
        <form className='form-horizontal' onSubmit={this.onSubmit}>
          <div className='form-group'>
            <label className='col-sm-2 control-label'>Username</label>
            <div className='col-sm-10'>
              <input
                type='text'
                name='username'
                className='form-control'
                value={username}
                onChange={this.onFieldChange}
                autoComplete='username'
              />
            </div>
          </div>
          <div className='form-group'>
            <label className='col-sm-2 control-label'>Password</label>
            <div className='col-sm-10'>
              <input
                type='password'
                name='password'
                className='form-control'
                value={password}
                onChange={this.onFieldChange}
                autoComplete='current-password'
              />
            </div>
          </div>
          {error && (
            <div className='alert alert-danger' role='alert'>{error}</div>
          )}
          <div className='form-group'>
            <div className='col-sm-offset-2 col-sm-10'>
              <button type='submit' className='btn btn-default' disabled={submitting}>
                {submitting ? 'Signing in…' : 'Login'}
              </button>
            </div>
          </div>
        </form>
      </span>
    );
  }
}
