export function App() {
  const apiUrl = import.meta.env.VITE_API_URL;
  const missing = import.meta.env.VITE_MISSING_API_KEY;
  return <main data-api-url={apiUrl} data-missing={missing} />;
}
