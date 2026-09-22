import * as React from 'react';

import { getCredentials } from '../util/auth';

export default () => {
  const creds = getCredentials();
  return (
    <span>
      <h2>Welcome</h2>
      {creds && (
        <p>Signed in as <strong>{creds.username}</strong></p>
      )}
      <div className='row'>
        <div className='col-md-12'>
          <img className='img-responsive' src='/images/pets.png' />
        </div>
      </div>
    </span>
  );
};
