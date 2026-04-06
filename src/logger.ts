import winston from 'winston';
import chalk from 'chalk';

/**
 * Valid log levels supported by the logger
 */
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = typeof LOG_LEVELS[number];

/**
 * Log rotation configuration
 * Can be used to customize file transport behavior
 */
export interface LogRotationConfig {
  /** Log file directory path */
  dirname?: string;
  /** Log file name */
  filename?: string;
  /** Maximum size of each log file in bytes */
  maxsize: number;
  /** Maximum number of log files to keep */
  maxFiles: number;
}

/** Default log rotation configuration */
export const DEFAULT_LOG_ROTATION: LogRotationConfig = {
  dirname: 'logs',
  filename: 'qwen-loop.log',
  maxsize: 5242880, // 5MB
  maxFiles: 5
};

/**
 * Extended log metadata that can be attached to log messages
 */
export interface LogMetadata {
  /** Agent identifier */
  agent?: string;
  /** Task identifier */
  task?: string;
  /** Project name (for multi-project mode) */
  project?: string;
  /** Duration in milliseconds */
  duration?: number;
  /** Error object for error logs */
  error?: Error | unknown;
  /** Task description snippet (auto-truncated) */
  description?: string;
  /** Additional custom metadata */
  [key: string]: unknown;
}

/**
 * Structured log entry format for file output
 */
interface StructuredLogEntry {
  timestamp: string;
  level: string;
  message: string;
  agent?: string;
  task?: string;
  project?: string;
  duration?: number;
  error?: string;
  [key: string]: unknown;
}

/**
 * Sanitize sensitive data from log metadata
 * Removes or masks API keys, tokens, passwords, etc.
 */
function sanitizeMetadata(metadata: LogMetadata): LogMetadata {
  const sanitized: LogMetadata = { ...metadata };
  const sensitiveKeys = ['apikey', 'api_key', 'token', 'secret', 'password', 'authorization', 'auth'];

  for (const [key, value] of Object.entries(sanitized)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && /(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/i.test(value)) {
      sanitized[key] = value.replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)\S+/gi, '$1[REDACTED]');
    }
  }

  return sanitized;
}

/**
 * Truncate long strings in metadata to prevent excessive log sizes
 */
function truncateMetadata(metadata: Record<string, unknown>, maxLength = 500): Record<string, unknown> {
  const truncated: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string' && value.length > maxLength) {
      truncated[key] = `${value.slice(0, maxLength)}... [truncated, ${value.length - maxLength} chars omitted]`;
    } else {
      truncated[key] = value;
    }
  }
  
  return truncated;
}

/**
 * Logger singleton class that provides structured, colorized logging
 * with support for console and file outputs.
 */
class Logger {
  private static instance: Logger;
  private logger: winston.Logger;
  private logSampling: Map<string, number> = new Map(); // Track sampling counters for deduplication

  private constructor(level: string = 'info') {
    // Console format: human-readable with colors
    const consoleFormat = winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message, agent, task, project, duration, description, ...meta }) => {
        const agentTag = agent ? chalk.cyan(`[${agent}]`) : '';
        const taskTag = task ? chalk.yellow(`[Task:${String(task).slice(0, 8)}]`) : '';
        const projectTag = project ? chalk.magenta(`[${project}]`) : '';
        const durationTag = duration !== undefined ? chalk.green(`[${this.formatDuration(duration as number)}]`) : '';
        const descTag = description ? chalk.white(`"${description}"`) : '';

        const levels: Record<string, string> = {
          error: chalk.red('ERROR'),
          warn: chalk.yellow('WARN '),
          info: chalk.blue('INFO '),
          debug: chalk.gray('DEBUG')
        };

        let logLine = `${chalk.gray(timestamp)} ${levels[level]} ${agentTag}${projectTag}${taskTag}${durationTag} ${message}`;

        if (descTag) {
          logLine += ` ${descTag}`;
        }

        // Add only essential metadata to console (not everything)
        const essentialKeys = ['priority', 'retryCount', 'status', 'count', 'exitCode', 'length'];
        const essentialMeta = Object.entries(meta).filter(([key]) =>
          essentialKeys.includes(key)
        );

        if (essentialMeta.length > 0) {
          const metaStr = essentialMeta.map(([k, v]) => `${k}=${v}`).join(' ');
          logLine += chalk.gray(` {${metaStr}}`);
        }

        return logLine;
      })
    );

    // File format: structured JSON for analysis
    const fileFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format((info) => {
        const structured: any = {
          timestamp: String(info.timestamp || ''),
          level: info.level,
          message: String(info.message || '')
        };

        if (info.agent) structured.agent = String(info.agent);
        if (info.task) structured.task = String(info.task);
        if (info.project) structured.project = String(info.project);
        if (info.duration !== undefined && info.duration !== null) {
          structured.duration = Number(info.duration);
        }
        if (info.description) {
          structured.description = typeof info.description === 'string'
            ? info.description.slice(0, 200)
            : String(info.description);
        }
        if (info.error) {
          structured.error = info.error instanceof Error ? (info.error.stack || info.error.message) : String(info.error);
        }

        // Add remaining metadata with truncation for long strings
        Object.entries(info).forEach(([key, value]) => {
          if (!['timestamp', 'level', 'message', 'agent', 'task', 'project', 'duration', 'description', 'error', Symbol.for('level')].includes(key)) {
            structured[key] = typeof value === 'string' && value.length > 1000
              ? `${value.slice(0, 1000)}... [truncated]`
              : value;
          }
        });

        return structured;
      })(),
      winston.format.json()
    );

    this.logger = winston.createLogger({
      level,
      format: winston.format.combine(
        winston.format((info) => {
          // Sanitize metadata before logging
          if (info.agent || info.task || info.project || info.error) {
            const sanitized = sanitizeMetadata(info);
            Object.assign(info, sanitized);
          }
          return info;
        })(),
        winston.format.combine(consoleFormat)
      ),
      transports: [
        new winston.transports.Console({
          format: consoleFormat,
          silent: false
        }),
        new winston.transports.File({
          dirname: DEFAULT_LOG_ROTATION.dirname,
          filename: `${DEFAULT_LOG_ROTATION.dirname}/${DEFAULT_LOG_ROTATION.filename}`,
          format: fileFormat,
          maxsize: DEFAULT_LOG_ROTATION.maxsize,
          maxFiles: DEFAULT_LOG_ROTATION.maxFiles,
          tailable: true
        })
      ]
    });
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  /**
   * Check if a debug message should be sampled (deduplicated)
   * Returns true if the message should be logged
   */
  private shouldSample(message: string, intervalMs = 5000): boolean {
    const now = Date.now();
    const lastTime = this.logSampling.get(message) || 0;
    
    if (now - lastTime > intervalMs) {
      this.logSampling.set(message, now);
      return true;
    }
    return false;
  }

  /**
   * Get or create the Logger singleton instance
   * @param level - Optional log level to set on creation
   * @returns The Logger instance
   */
  static getInstance(level?: string): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(level);
    }
    return Logger.instance;
  }

  /**
   * Log an informational message
   * @param message - The message to log
   * @param metadata - Optional metadata (agent, task, project, duration, etc.)
   */
  info(message: string, metadata?: LogMetadata) {
    this.logger.info(message, metadata);
  }

  /**
   * Log a warning message
   * @param message - The message to log
   * @param metadata - Optional metadata (agent, task, project, duration, etc.)
   */
  warn(message: string, metadata?: LogMetadata) {
    this.logger.warn(message, metadata);
  }

  /**
   * Log an error message
   * @param message - The message to log
   * @param metadata - Optional metadata (agent, task, project, error, etc.)
   */
  error(message: string, metadata?: LogMetadata) {
    // Always include full error details in file logs
    const enhancedMetadata = metadata ? { ...metadata } : {};
    if (metadata?.error) {
      const error = metadata.error;
      enhancedMetadata.errorDetails = error instanceof Error 
        ? { message: error.message, stack: error.stack, name: error.name }
        : error;
    }
    this.logger.error(message, enhancedMetadata);
  }

  /**
   * Log a debug message with automatic sampling to reduce verbosity
   * @param message - The message to log
   * @param metadata - Optional metadata (agent, task, project, duration, etc.)
   * @param sampleInterval - Milliseconds between duplicate messages (default: 5000)
   */
  debug(message: string, metadata?: LogMetadata, sampleInterval?: number) {
    // Sample repetitive debug messages (e.g., "No tasks in queue" polling)
    if (sampleInterval !== undefined && !this.shouldSample(message, sampleInterval)) {
      return;
    }
    this.logger.debug(message, metadata);
  }

  /**
   * Log a debug message without sampling (for unique, important debug info)
   * @param message - The message to log
   * @param metadata - Optional metadata
   */
  debugOnce(message: string, metadata?: LogMetadata) {
    this.logger.debug(message, metadata);
  }
}

export const logger = Logger.getInstance();

/**
 * Set the global log level
 * @param level - The logging level to use
 * @throws Error if the log level is invalid
 */
export function setLogLevel(level: LogLevel) {
  if (!LOG_LEVELS.includes(level)) {
    throw new Error(`Invalid log level: "${level}". Must be one of: ${LOG_LEVELS.join(', ')}`);
  }
  Logger.getInstance(level);
}

/**
 * Helper to create a duration tracker for timing operations
 * @returns Object with start() and end() methods for tracking duration
 */
export function createDurationTracker() {
  const startTime = Date.now();
  return {
    /** Get elapsed milliseconds since creation */
    elapsed: () => Date.now() - startTime
  };
}

/**
 * Build standardized log metadata from common context
 * @param context - Context object with agent, task, project info
 * @param extras - Additional metadata to include
 * @returns Sanitized metadata object ready for logging
 */
export function buildLogContext(
  context: { agent?: string; task?: string; project?: string },
  extras?: Record<string, unknown>
): LogMetadata {
  const metadata: LogMetadata = {};
  
  if (context.agent) metadata.agent = context.agent;
  if (context.task) metadata.task = context.task;
  if (context.project) metadata.project = context.project;
  
  if (extras) {
    Object.assign(metadata, extras);
  }
  
  return metadata;
}
