export function App() {
  const apiUrl = import.meta.env.VITE_API_URL;
  return <main data-api-url={apiUrl}>DeployReady</main>;
}
