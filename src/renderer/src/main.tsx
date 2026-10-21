import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from './Panel';
import { Pet } from './Pet';
import './styles.css';

// Both windows load this page; ?view= picks which one it is.
const view = new URLSearchParams(location.search).get('view') === 'pet' ? 'pet' : 'panel';
document.documentElement.dataset.view = view;

createRoot(document.getElementById('root')!).render(<StrictMode>{view === 'pet' ? <Pet /> : <Panel />}</StrictMode>);
