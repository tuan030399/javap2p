import { UploadedJarRecord } from '../types/j2me';

const DB_NAME = 'javadeck_storage_v1';
const STORE_NAME = 'uploaded_jars';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB không được hỗ trợ trên trình duyệt này.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Không thể mở kho lưu trữ IndexedDB.'));
  });
}

export async function saveUploadedJar(record: UploadedJarRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Lỗi lưu tệp .JAR.'));
  });
}

export async function listUploadedJars(): Promise<UploadedJarRecord[]> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const items = (req.result as UploadedJarRecord[]) || [];
        items.sort((a, b) => b.uploadedAt - a.uploadedAt);
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function deleteUploadedJar(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function getHighScore(gameKey: string): number {
  try {
    const raw = localStorage.getItem(`javadeck_hs_${gameKey}`);
    return raw ? Math.max(0, parseInt(raw, 10) || 0) : 0;
  } catch {
    return 0;
  }
}

export function saveHighScore(gameKey: string, score: number): number {
  const prev = getHighScore(gameKey);
  const next = Math.max(prev, Math.floor(score));
  try {
    localStorage.setItem(`javadeck_hs_${gameKey}`, String(next));
  } catch {
    // ignore storage quota errors
  }
  return next;
}
