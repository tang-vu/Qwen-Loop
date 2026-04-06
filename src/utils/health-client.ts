import { request } from 'http';
import { HealthReport } from '../types.js';

/**
 * Options for fetching health data from a running instance
 */
export interface HealthClientOptions {
  /** Hostname of the health server (default: 'localhost') */
  host?: string;
  /** Port number of the health server (default: 3100) */
  port?: number;
  /** Request timeout in milliseconds (default: 5000) */
  timeout?: number;
}

/**
 * Fetch a comprehensive health report from a running Qwen Loop instance via HTTP
 *
 * Connects to the health server endpoint and retrieves detailed system metrics
 * including agent health, task throughput, resource usage, and configuration.
 *
 * @param options - Configuration for the health client connection. If omitted,
 *                  defaults to localhost:3100 with a 5-second timeout.
 * @returns Promise resolving to a {@link HealthReport} object containing system metrics
 * @throws {Error} If the connection is refused, the request times out, or the response
 *                 cannot be parsed as valid JSON
 *
 * @example
 * ```typescript
 * const report = await fetchHealthReport({ host: 'localhost', port: 3100 });
 * console.log(`System status: ${report.status}`);
 * console.log(`Healthy agents: ${report.agents.filter(a => a.healthy).length}`);
 * ```
 */
export async function fetchHealthReport(options: HealthClientOptions = {}): Promise<HealthReport> {
  const host = options.host || 'localhost';
  const port = options.port || 3100;
  const timeout = options.timeout || 5000;

  return new Promise((resolve, reject) => {
    const requestOptions = {
      hostname: host,
      port: port,
      path: '/health/json',
      method: 'GET',
      timeout: timeout
    };

    const req = request(requestOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Health server returned status ${res.statusCode}: ${data}`));
          return;
        }

        try {
          const report: HealthReport = JSON.parse(data);
          resolve(report);
        } catch (error) {
          reject(new Error(`Failed to parse health report: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });

    req.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        reject(new Error(`Cannot connect to health server at ${host}:${port}. Is the loop running with --health-port enabled?`));
      } else {
        reject(new Error(`Failed to fetch health report: ${error.message}`));
      }
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to health server timed out after ${timeout}ms`));
    });

    req.end();
  });
}

/**
 * Check if a Qwen Loop health server is available at the specified host/port
 *
 * Attempts to connect to the health endpoint and retrieve a report.
 * Returns `true` if the server responds successfully, `false` otherwise
 * (including connection refused, timeout, or parse errors).
 *
 * @param host - Hostname to check (default: 'localhost')
 * @param port - Port number to check (default: 3100)
 * @returns Promise resolving to `true` if server is reachable and responding,
 *          `false` if unavailable or an error occurs
 *
 * @example
 * ```typescript
 * const available = await isHealthServerAvailable('localhost', 3100);
 * if (available) {
 *   console.log('Health server is running');
 * } else {
 *   console.log('Health server is not available');
 * }
 * ```
 */
export async function isHealthServerAvailable(host = 'localhost', port = 3100): Promise<boolean> {
  try {
    await fetchHealthReport({ host, port, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
