import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined') {
  const preventZoom = (e: Event) => e.preventDefault();
  window.addEventListener('gesturestart', preventZoom, {passive: false});
  window.addEventListener('gesturechange', preventZoom, {passive: false});
  window.addEventListener('gestureend', preventZoom, {passive: false});
  window.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    },
    {passive: false}
  );
}

createRoot(document.getElementById('root')!).render(<App />);
