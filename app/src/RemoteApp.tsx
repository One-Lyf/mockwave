// Federated entry for the OneLyf shell. This module owns the app's style
// import so the shell only lazy-imports and renders it.
//
// Theme is not initialized here. main.tsx calls initTheme() for the standalone
// app. The shell already sets [data-theme] on <html>, which index.css reads,
// so a mounted Mockwave follows the shell instead of writing that attribute.
import App from './App';
import './index.css';

export default function RemoteApp() {
  // The shell owns [data-theme]. Hide the in-app control so a click cannot
  // write that attribute over the host.
  return <App embedded />;
}
