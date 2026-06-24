import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

const links = [
  { href: 'https://vite.dev', label: 'Vite', logo: viteLogo },
  { href: 'https://react.dev', label: 'React', logo: reactLogo },
]

function App() {
  return (
    <main className="app-shell">
      <section className="intro">
        <div className="logo-row" aria-label="Project stack">
          {links.map((link) => (
            <a
              className="logo-link"
              href={link.href}
              key={link.label}
              rel="noreferrer"
              target="_blank"
              title={link.label}
            >
              <img src={link.logo} className="logo" alt={`${link.label} logo`} />
            </a>
          ))}
        </div>

        <p className="eyebrow">React Web Template</p>
        <h1>FluxArt</h1>
        <p className="lede">
          A clean Vite + React + TypeScript starting point with strict typing,
          linting, and a small responsive app shell.
        </p>

        <div className="actions" aria-label="Primary actions">
          <a className="button button-primary" href="https://react.dev/learn" rel="noreferrer" target="_blank">
            React Docs
          </a>
          <a className="button button-secondary" href="https://vite.dev/guide/" rel="noreferrer" target="_blank">
            Vite Guide
          </a>
        </div>
      </section>
    </main>
  )
}

export default App
