import React from 'react';
import { ResilienceTabletopPage } from './pages/ResilienceTabletopPage';

export default function App(): React.ReactElement {
  return (
    <ResilienceTabletopPage
      onBack={() => {
        window.location.href =
          window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? 'http://localhost:5173/'
            : 'https://0trust.dev/';
      }}
    />
  );
}
