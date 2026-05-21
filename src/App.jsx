import React, { useState, useEffect } from 'react';
import DailySanityDashboard from './DailySanityDashboard';
import HistoricalExecutionDetails from './HistoricalExecutionDetails';
import AppSecPerformance from './AppSecPerformance';
import PublicReport from './PublicReport';

function App() {
  const [currentHash, setCurrentHash] = useState(window.location.hash);

  useEffect(() => {
    const handleHashChange = () => setCurrentHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (currentHash.startsWith('#/history/')) {
    const fullId = currentHash.split('#/history/')[1] || '';
    const id = fullId.split('?')[0];
    return <HistoricalExecutionDetails id={id} />;
  }

  if (currentHash === '#/appsec-performance') {
    return <AppSecPerformance />;
  }

  if (currentHash === '#/public-report') {
    return <PublicReport />;
  }

  return <DailySanityDashboard />;
}

export default App;
