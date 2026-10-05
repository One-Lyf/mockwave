import React from 'react';
import ReactDOM from 'react-dom/client';
import schema from '../../../stacks/kitdemo/schema.json';
import { createKitdemoStore, deviceBackend, stackBackend, type KitSchema, type KitdemoSession } from '../../../engine/src';
import { initTheme } from '../theme';
import Shell from './Shell';

initTheme();

// No sign-in provider is wired into this app yet, so the shell runs device-only. A provider
// returns a KitdemoSession here and the stack backend (owner-scoped rows) takes over.
const session: KitdemoSession | null = null;

const store = createKitdemoStore(
  session,
  {
    device: () => deviceBackend('kitdemo'),
    stack: (s) =>
      stackBackend({
        url: import.meta.env.VITE_KITDEMO_STACK_URL ?? '',
        key: import.meta.env.VITE_KITDEMO_STACK_KEY ?? '',
        schema: 'kitdemo',
        accessToken: s.accessToken,
      }),
  },
  schema as KitSchema,
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Shell store={store} session={session} schema={schema as KitSchema} />
  </React.StrictMode>
);
