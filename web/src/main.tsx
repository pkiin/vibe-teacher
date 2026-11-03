import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { startEmailConfirmation } from './auth/email-confirmation';
import './styles/app.css';

const emailConfirmation = startEmailConfirmation(window.location, window.history);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App emailConfirmation={emailConfirmation} />
    </BrowserRouter>
  </React.StrictMode>,
);
