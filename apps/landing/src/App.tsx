import './App.css'

function App() {
  const getSubdomainUrl = (subdomain: string) => {
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname
      const protocol = window.location.protocol
      
      // Check if we're on localhost (development)
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return subdomain === 'react' 
          ? 'http://localhost:5173'
          : 'http://localhost:5174'
      }
      
      // In production, construct subdomain URL
      // Handle both root domain (fuzzyfilter.com) and www (www.fuzzyfilter.com)
      const parts = hostname.split('.')
      
      // If it's a root domain like "fuzzyfilter.com"
      if (parts.length === 2) {
        return `${protocol}//${subdomain}.${parts.join('.')}`
      }
      
      // If it has www or other subdomain, replace the first part
      if (parts.length >= 2) {
        parts[0] = subdomain
        return `${protocol}//${parts.join('.')}`
      }
      
      // Fallback: try to construct subdomain
      return `${protocol}//${subdomain}.${hostname}`
    }
    return '#'
  }

  return (
    <div className="app">
      <header className="header">
        <div className="container">
          <h1 className="title">FuzzyFilter</h1>
          <p className="subtitle">Smart, flexible filtering library for React and Vue</p>
        </div>
      </header>
      
      <main className="main">
        <div className="container">
          <div className="cards">
            <a href={getSubdomainUrl('react')} className="card">
              <div className="card-icon">⚛️</div>
              <h2>React Example</h2>
              <p>Explore the React implementation with interactive demos and documentation</p>
              <div className="card-link">View React Demo →</div>
            </a>
            
            <a href={getSubdomainUrl('vue')} className="card">
              <div className="card-icon">💚</div>
              <h2>Vue Example</h2>
              <p>See how FuzzyFilter works with Vue.js and explore the composable API</p>
              <div className="card-link">View Vue Demo →</div>
            </a>
          </div>
          
          <div className="info">
            <h2>About FuzzyFilter</h2>
            <p>
              FuzzyFilter is a powerful filtering library that provides intelligent, 
              fuzzy search capabilities with support for multiple data types, operators, 
              and frameworks. Built with TypeScript for type safety and performance.
            </p>
          </div>
        </div>
      </main>
      
      <footer className="footer">
        <div className="container">
          <p>Built with ❤️ for developers</p>
        </div>
      </footer>
    </div>
  )
}

export default App
