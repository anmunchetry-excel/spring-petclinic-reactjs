// React
import * as React from 'react';
import * as ReactDOM from 'react-dom';

import { browserHistory as history } from 'react-router';

require('./styles/less/petclinic.less');

// The Application
import Root from './Root';

const mountPoint = document.getElementById('mount');

const render = (Component: any) => ReactDOM.render(<Component history={history} />, mountPoint);

// Render Application
render(Root);

declare var module: any;
if (module.hot) {
  module.hot.accept('./Root', () => render(require('./Root').default));
}
