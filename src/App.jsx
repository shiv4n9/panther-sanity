import React, { useState, useEffect } from 'react';
import DailySanityDashboard from './DailySanityDashboard';
import HistoricalExecutionDetails from './HistoricalExecutionDetails';

function App() {
  const [currentHash, setCurrentHash] = useState(window.location.hash);

  useEffect(() => {
    const handleHashChange = () => setCurrentHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (currentHash.startsWith('#/history/')) {
    const id = currentHash.split('#/history/')[1];
    return <HistoricalExecutionDetails id={id} />;
  }

  return <DailySanityDashboard />;
}

export default App;
