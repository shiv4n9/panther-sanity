import { useState } from 'react';

const AppSecPerformance = () => {
  const releaseVersion = "25.4X300-202604130112.0-EVO";
  
  const performanceData = [
    {
      category: "HTTP Throughput via CPS Method (Payload: 64KB)",
      subcategory: "Throughput",
      tests: [
        {
          description: "AppSec + IDP-Recommended policy",
          result: "1000 CPS, 570 Mbps",
          comments: "CPU:82, Global data shm: 84"
        },
        {
          description: "AppSec + IDP-Enterprise Rec policy",
          result: "350 CPS, 200 Mbps",
          comments: "CPU: 82, Global data shm: 84"
        }
      ]
    },
    {
      category: "HTTPS Throughput via CPS Method (Payload: 64KB)",
      subcategory: "",
      tests: [
        {
          description: "AppSec + SSL(TLS1.2)",
          result: "215 CPS, 125 Mbps",
          comments: "CPU: 81, Global data shm: 76"
        },
        {
          description: "AppSec + SSL+ IDP-Recommended policy",
          result: "190 CPS, 110 Mbps",
          comments: "CPU: 75, Global data shm: 75"
        },
        {
          description: "AppSec + SSL+ IDP-Enterprise Rec policy",
          result: "60 CPS, 34 Mbps",
          comments: "CPU: 70, Global data shm: 64"
        }
      ]
    },
    {
      category: "CPS Performance (Payload: 64B)",
      subcategory: "",
      tests: [
        {
          description: "AppSec with ASC enabled CPS",
          result: "11000 CPS",
          comments: "CPU: 80, Global data shm: 84"
        },
        {
          description: "AppSec CPS",
          result: "2800 CPS",
          comments: "CPU: 81, Global Data shm: 81"
        },
        {
          description: "AppSec + SSL(TLS1.2)",
          result: "230 CPS",
          comments: "CPU: 38, Global Data Shm: 78"
        }
      ]
    }
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        .performance-table {
          font-family: 'Inter', sans-serif;
          width: 100%;
          border-collapse: collapse;
          background: white;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .performance-table th,
        .performance-table td {
          border: 1px solid #e2e8f0;
          padding: 12px 16px;
          text-align: left;
        }
        
        .performance-table th {
          background: #f8fafc;
          font-weight: 600;
          font-size: 14px;
          color: #1e293b;
        }
        
        .performance-table td {
          font-size: 14px;
          color: #334155;
        }
        
        .category-header {
          background: #f1f5f9 !important;
          font-weight: 700;
          font-size: 16px;
          color: #0f172a;
        }
        
        .subcategory-cell {
          background: #f8fafc;
          font-weight: 600;
        }
        
        .release-header {
          background: white;
          border: 2px solid #e2e8f0;
          padding: 16px;
          margin-bottom: 24px;
          border-radius: 8px;
        }
        
        .release-title {
          font-size: 20px;
          font-weight: 700;
          color: #0f172a;
          text-decoration: underline;
          margin-bottom: 12px;
        }
      `}</style>

      <div className="min-h-screen bg-slate-50 text-slate-800" style={{ fontFamily: "'Inter', sans-serif" }}>
        {/* Header */}
        <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 py-5">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
                  <span className="w-2 h-7 bg-gradient-to-b from-slate-600 to-slate-800 rounded-full"></span>
                  SRX440 AppSec Performance Results
                </h1>
                <p className="text-sm font-medium text-slate-500 mt-1.5 ml-5">
                  Application Security & IDP Performance Testing
                </p>
              </div>
              <a
                href="/"
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors"
              >
                ← Back to Dashboard
              </a>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="release-header">
            <div className="release-title">Release: {releaseVersion}</div>
          </div>

          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            <table className="performance-table">
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>Testcase Description</th>
                  <th style={{ width: '30%' }}>SRX440 Tested Numbers</th>
                  <th style={{ width: '30%' }}>Comments</th>
                </tr>
              </thead>
              <tbody>
                {performanceData.map((category, catIndex) => (
                  <>
                    {/* Category Header */}
                    <tr key={`cat-${catIndex}`}>
                      <td className="category-header" colSpan={3}>
                        {category.category}
                      </td>
                    </tr>
                    
                    {/* Subcategory if exists */}
                    {category.subcategory && (
                      <tr key={`subcat-${catIndex}`}>
                        <td colSpan={3} className="subcategory-cell">
                          {category.subcategory}
                        </td>
                      </tr>
                    )}
                    
                    {/* Test Results */}
                    {category.tests.map((test, testIndex) => (
                      <tr key={`test-${catIndex}-${testIndex}`}>
                        <td>{test.description}</td>
                        <td className="font-semibold">{test.result}</td>
                        <td className="text-slate-600">{test.comments}</td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer Note */}
          <div className="mt-6 text-center text-sm text-slate-500">
            <p>Performance data collected on SRX440 platform with various AppSec, IDP, and SSL configurations</p>
          </div>
        </main>
      </div>
    </>
  );
};

export default AppSecPerformance;
