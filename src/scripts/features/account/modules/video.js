import { hostMatches } from './dom.js';

export const videoProviderMeta = {
  rutube: { label: 'Rutube', title: 'Предпросмотр Rutube' },
  vk: { label: 'VK Видео', title: 'Предпросмотр VK Видео' },
  'yandex-disk': { label: 'Яндекс Диск', title: 'Ссылка на видео в Яндекс Диске' },
  file: { label: 'Загруженный файл', title: 'Предпросмотр видеофайла' }
};

export function parseVideoUrl(value = '') {
  const raw = String(value).trim();
  if (!raw) return { valid: false, message: 'Вставьте ссылку на видео-визитку.' };
  if (/^\/uploads\/[a-f0-9]{64}\.(?:mp4|webm|mov)$/i.test(raw)) return { valid: true, provider: 'file', label: videoProviderMeta.file.label, title: videoProviderMeta.file.title, url: raw, embedUrl: '' };
  let url;
  try { url = new URL(raw); } catch { return { valid: false, message: 'Проверьте формат ссылки: она должна начинаться с https:// или http://.' }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { valid: false, message: 'Ссылка должна начинаться с https:// или http://.' };
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let provider = null;
  let embedUrl = '';
  if (hostMatches(host, 'rutube.ru')) {
    provider = 'rutube';
    const id = url.pathname.match(/\/(?:video|shorts|play\/embed)\/([a-z0-9_-]+)/i)?.[1];
    if (!id) return { valid: false, message: 'Вставьте ссылку на конкретное видео Rutube.' };
    embedUrl = `https://rutube.ru/play/embed/${encodeURIComponent(id)}`;
  } else if (hostMatches(host, 'vk.com') || hostMatches(host, 'vkvideo.ru') || hostMatches(host, 'vk.ru')) {
    provider = 'vk';
    const pathMatch = url.pathname.match(/\/(?:video|clip)(-?\d+)_(\d+)/i);
    const oid = pathMatch?.[1] || url.searchParams.get('oid');
    const id = pathMatch?.[2] || url.searchParams.get('id');
    if (!oid || !id) return { valid: false, message: 'Вставьте ссылку на конкретное видео VK Видео.' };
    const params = new URLSearchParams({ oid, id });
    const hash = url.searchParams.get('hash');
    if (hash) params.set('hash', hash);
    embedUrl = `https://vk.com/video_ext.php?${params.toString()}`;
  } else if (hostMatches(host, 'disk.yandex.ru') || hostMatches(host, 'yadi.sk')) {
    provider = 'yandex-disk';
    if (!url.pathname.match(/\/(?:d|i)\/[^/]+/i)) return { valid: false, message: 'Вставьте публичную ссылку на файл в Яндекс Диске.' };
  }
  if (!provider) return { valid: false, message: 'Поддерживаются только публичные ссылки Rutube, VK Видео или Яндекс Диск.' };
  return { valid: true, provider, label: videoProviderMeta[provider].label, title: videoProviderMeta[provider].title, url: url.href, embedUrl };
}
