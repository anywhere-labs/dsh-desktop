/**
 * The app's window: Studio's editor, as the open-source Studio is (its App, unchanged), and the chat in the column
 * Studio leaves for it (lib/host.ts `panel`). One page, one theme, one layer of dialogs over both.
 * (TinTin 移植自官方 apps/desktop/shell/main.tsx;chat 源树在 tintin-resources/openfilm-shell-src/chat。)
 */
import './boot';
import './bridge';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from 'openfilm/studio-ui/App.tsx';
import { FocusNav } from 'openfilm/studio-ui/components/FocusNav.tsx';
import { applyStudioHost } from 'openfilm/studio-ui/lib/host.ts';
import { mountChat } from '../../dsh-plugin-desktop-tintin/tintin-resources/openfilm-shell-src/chat/mount';
import './tintin-library';
import { bootFail } from './boot';
import './shell.css';
import '../../dsh-plugin-desktop-tintin/tintin-resources/openfilm-shell-src/chat/chat.css';

applyStudioHost();
createRoot(document.getElementById('root')!).render(<StrictMode><FocusNav /><App /></StrictMode>);
void mountChat(document.getElementById('of-chat')!);
