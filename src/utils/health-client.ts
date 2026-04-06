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
 * Fetch health report from a running Qwen Loop instance via HTTP
 * 
 * @param options - Configuration for the health client connection
 * @returns Promise resolving to the health report data
 * @throws Error if the request fails or times out
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
 * Check if a health server is available at the specified host/port
 * 
 * @param host - Hostname to check (default: 'localhost')
 * @param port - Port number to check (default: 3100)
 * @returns Promise resolving to true if server is available, false otherwise
 */
export async function isHealthServerAvailable(host = 'localhost', port = 3100): Promise<boolean> {
  try {
    await fetchHealthReport({ host, port, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
