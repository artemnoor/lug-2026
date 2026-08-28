// Web gateway logs and metrics.

export function createLogger(service) {
  const write = (level, event, fields = {}) => console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](JSON.stringify({ ts: new Date().toISOString(), level, service, event, ...fields }, (_, value) => value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value));
  return { info: (event, fields) => write('info', event, fields), warn: (event, fields) => write('warn', event, fields), error: (event, fields) => write('error', event, fields) };
}

export function createMetrics() {
  const counters = new Map();
  const buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  const histogram = { counts: buckets.map(() => 0), count: 0, sum: 0 };
  return {
    increment(name) { counters.set(name, (counters.get(name) || 0) + 1); },
    observe(_name, value) { histogram.count += 1; histogram.sum += value; buckets.forEach((bucket, index) => { if (value <= bucket) histogram.counts[index] += 1; }); },
    prometheus() { const lines = [...counters].sort().map(([name, value]) => `lug_${name.replaceAll('.', '_')}{service="lug-web"} ${value}`); buckets.forEach((bucket, index) => lines.push(`lug_http_request_duration_bucket{le="${bucket}",service="lug-web"} ${histogram.counts[index]}`)); lines.push(`lug_http_request_duration_bucket{le="+Inf",service="lug-web"} ${histogram.count}`, `lug_http_request_duration_count{service="lug-web"} ${histogram.count}`, `lug_http_request_duration_sum{service="lug-web"} ${histogram.sum.toFixed(3)}`); return `${lines.join('\n')}\n`; }
  };
}
