export function App() {
  const apiUrl = import.meta.env.VITE_API_URL;
  const missing = import.meta.env.VITE_MISSING_API_KEY;
  const healthUrl = 'http://localhost:4173/health';
  const previewUrl = `http://127.0.0.1:5173`;
  return <main data-api-url={apiUrl} data-missing={missing} data-health={healthUrl} data-preview={previewUrl} />;
}
