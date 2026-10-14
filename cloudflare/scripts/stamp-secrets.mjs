export function stampSecrets(stamp) {
  if (!stamp.startsWith('/9j/') || !/^[A-Za-z0-9+/]+={0,2}$/.test(stamp)) throw new Error('Expected JPEG base64.');
  // Three chunks keep each secret below Cloudflare's 5 KB per-value limit.
  if (stamp.length > 3 * 4096) throw new Error('Stamp too large for three secret chunks.');
  const chunkSize = Math.ceil(stamp.length / 3);
  return Object.fromEntries([1, 2, 3].map((n) => [
    'STAMP_JPEG_B64_' + n, stamp.slice((n - 1) * chunkSize, n * chunkSize),
  ]));
}
